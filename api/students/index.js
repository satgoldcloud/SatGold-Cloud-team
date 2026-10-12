import { randomBytes } from 'node:crypto';
import { Resend } from 'resend';
import { send, method } from '../_lib/http.js';
import { requireUser, requireSchoolRole } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';
import { getSchoolEntitlements, exceedsEntitlement } from '../_lib/entitlements.js';

const text = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const safeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));

export default async (req, res) => {
  if (!method(req, res, ['GET','POST'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });
  const schoolId = String(req.query.schoolId || req.body?.schoolId || '');
  if (!/^[0-9a-f-]{36}$/i.test(schoolId)) return send(res, 400, { error: 'A valid school ID is required.' });

  try {
    const membership = await requireSchoolRole(auth.user.id, schoolId);
    if (!membership) return send(res, 403, { error: 'You do not have access to this school.' });
    const admin = getSupabaseAdmin();

    if (req.method === 'GET') {
      if (!['owner','admin','teacher','staff','student','parent'].includes(membership.role)) return send(res, 403, { error: 'You cannot view student records.' });
      let query = admin.from('student_profiles').select('id,student_number,first_name,last_name,other_names,class_id,class_arm_id,status,created_at').eq('school_id', schoolId).order('last_name').limit(500);
      if (membership.role === 'teacher') {
        const { data: staff } = await admin.from('staff_profiles').select('id').eq('school_id', schoolId).eq('user_id', auth.user.id).maybeSingle();
        if (!staff) return send(res, 200, { students: [] });
        const { data: assignments, error: assignmentError } = await admin.from('teacher_assignments').select('class_id,class_arm_id').eq('school_id', schoolId).eq('staff_id', staff.id);
        if (assignmentError) throw assignmentError;
        const filters = [...new Set((assignments || []).map((row) => row.class_arm_id
          ? `and(class_id.eq.${row.class_id},class_arm_id.eq.${row.class_arm_id})` : `class_id.eq.${row.class_id}`))];
        if (!filters.length) return send(res, 200, { students: [] });
        query = query.or(filters.join(','));
      } else if (membership.role === 'student') {
        query = query.eq('user_id', auth.user.id);
      } else if (membership.role === 'parent') {
        const { data: guardian, error: guardianError } = await admin.from('guardian_profiles').select('id').eq('school_id', schoolId).eq('user_id', auth.user.id).maybeSingle();
        if (guardianError) throw guardianError;
        if (!guardian) return send(res, 200, { students: [] });
        const { data: links, error: linksError } = await admin.from('student_guardians').select('student_id').eq('school_id', schoolId).eq('guardian_id', guardian.id);
        if (linksError) throw linksError;
        const studentIds = (links || []).map((row) => row.student_id);
        if (!studentIds.length) return send(res, 200, { students: [] });
        query = query.in('id', studentIds);
      }
      const { data, error } = await query;
      if (error) throw error;
      const students = data || [];
      return send(res, 200, { students });
    }

    if (!['owner','admin'].includes(membership.role)) return send(res, 403, { error: 'Only school administrators can provision student accounts.' });
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return send(res, 503, { error: 'Student account provisioning requires verified email delivery to be configured.' });
    const plan = await getSchoolEntitlements(admin,schoolId);
    if (!plan) return send(res,402,{error:'This school subscription is not active. Renew or contact the platform administrator.'});
    const { count:studentCount,error:countError } = await admin.from('student_profiles').select('id',{count:'exact',head:true}).eq('school_id',schoolId);
    if (countError) throw countError;
    if (exceedsEntitlement(plan.entitlements,'students',studentCount || 0)) return send(res,402,{error:'This school has reached its student limit for the current plan.'});

    const firstName = text(req.body?.firstName, 80);
    const lastName = text(req.body?.lastName, 80);
    const otherNames = text(req.body?.otherNames, 100) || null;
    const classId = text(req.body?.classId, 36);
    const classArmId = text(req.body?.classArmId, 36) || null;
    const sessionId = text(req.body?.academicSessionId, 36) || null;
    const guardianFirstName = text(req.body?.guardianFirstName, 80);
    const guardianLastName = text(req.body?.guardianLastName, 80);
    const guardianEmail = text(req.body?.guardianEmail, 254).toLowerCase();
    const guardianPhone = text(req.body?.guardianPhone, 32) || null;
    const relationship = text(req.body?.relationship, 40) || null;
    if (firstName.length < 1 || lastName.length < 1 || !classId || guardianFirstName.length < 1 || guardianLastName.length < 1 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guardianEmail)) {
      return send(res, 400, { error: 'Complete the student, class and parent/guardian details with a valid guardian email.' });
    }
    const { data: school, error: schoolError } = await admin.from('schools').select('id,name,slug').eq('id', schoolId).single();
    if (schoolError || !school) return send(res, 404, { error: 'School not found.' });
    const { data: classRow, error: classError } = await admin.from('school_classes').select('id').eq('school_id', schoolId).eq('id', classId).maybeSingle();
    if (classError || !classRow) return send(res, 400, { error: 'Choose a class belonging to this school.' });
    if (classArmId) {
      const { data: arm, error: armError } = await admin.from('class_arms').select('id').eq('school_id', schoolId).eq('class_id', classId).eq('id', classArmId).maybeSingle();
      if (armError || !arm) return send(res, 400, { error: 'Choose a class arm belonging to the selected class.' });
    }
    if (sessionId) {
      const { data: session, error: sessionError } = await admin.from('academic_sessions').select('id').eq('school_id', schoolId).eq('id', sessionId).maybeSingle();
      if (sessionError || !session) return send(res, 400, { error: 'Choose an academic session belonging to this school.' });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const studentNumber = `SG-${randomBytes(4).toString('hex').toUpperCase()}`;
    const loginIdentifier = `${school.slug.slice(0, 14)}-${studentNumber}`.toLowerCase();
    const authDomain = (process.env.STUDENT_AUTH_DOMAIN || 'students.satgoldcloud.name.ng').toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(authDomain)) return send(res, 500, { error: 'Student account email domain is not configured correctly.' });
    const studentAuthEmail = `${loginIdentifier}@${authDomain}`;
    const studentTempPassword = `${randomBytes(24).toString('base64url')}A9!`;
    const guardianTempPassword = `${randomBytes(24).toString('base64url')}C7!`;
    let studentUserId;
    let newGuardianUserId;
    let guardianUserId;
    let newGuardianId;
    let studentId;
    let guardianId;
    try {
      const { data: studentAccount, error: studentAuthError } = await admin.auth.admin.createUser({
        email: studentAuthEmail, password: studentTempPassword, email_confirm: true,
        user_metadata: { display_name: `${firstName} ${lastName}`, must_change_password: true, account_type: 'student' }
      });
      if (studentAuthError) throw studentAuthError;
      studentUserId = studentAccount.user.id;
      const { data: student, error: studentError } = await admin.from('student_profiles').insert({
        school_id: schoolId, user_id: studentUserId, student_number: studentNumber, login_identifier: loginIdentifier,
        first_name: firstName, last_name: lastName, other_names: otherNames, class_id: classId,
        class_arm_id: classArmId, academic_session_id: sessionId, status: 'active', must_change_password: true
      }).select('id,student_number,login_identifier').single();
      if (studentError) throw studentError;
      studentId = student.id;
      const { error: studentMembershipError } = await admin.from('school_memberships').insert({ school_id: schoolId, user_id: studentUserId, role: 'student', status: 'active' });
      if (studentMembershipError) throw studentMembershipError;

      const { data: existingGuardian, error: existingGuardianError } = await admin.from('guardian_profiles')
        .select('id,user_id').eq('school_id', schoolId).eq('email', guardianEmail).maybeSingle();
      if (existingGuardianError) throw existingGuardianError;
      if (existingGuardian) {
        const { data: guardianAuth, error: guardianAuthError } = await admin.auth.admin.getUserById(existingGuardian.user_id);
        if (guardianAuthError || !guardianAuth.user?.email_confirmed_at) throw new Error('GUARDIAN_ACTIVATION_REQUIRED');
        guardianId = existingGuardian.id;
        guardianUserId = existingGuardian.user_id;
      } else {
        const { data: parentLink, error: guardianAuthError } = await admin.auth.admin.generateLink({
          type: 'signup', email: guardianEmail, password: guardianTempPassword,
          options: { data: { display_name: `${guardianFirstName} ${guardianLastName}`, must_change_password: true, account_type: 'parent' }, redirectTo: `${process.env.APP_URL || 'http://localhost:3000'}/dashboard.html` }
        });
        if (guardianAuthError) throw guardianAuthError;
        newGuardianUserId = parentLink.user.id;
        guardianUserId = newGuardianUserId;
        const { data: guardian, error: guardianError } = await admin.from('guardian_profiles').insert({
          school_id: schoolId, user_id: newGuardianUserId, email: guardianEmail,
          first_name: guardianFirstName, last_name: guardianLastName, phone: guardianPhone
        }).select('id').single();
        if (guardianError) throw guardianError;
        guardianId = guardian.id;
        newGuardianId = guardian.id;
        const parentResult = await resend.emails.send({
          from: `${process.env.RESEND_FROM_NAME || 'SatGold Cloud'} <${process.env.RESEND_FROM_EMAIL}>`, to: [guardianEmail],
          subject: 'Activate your SatGold Cloud parent account',
          html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17324d"><h1>Your parent account is ready</h1><p>${safeHtml(guardianFirstName)}, your account was created by ${safeHtml(school.name)}. Activate it and choose a new password to access updates for your child.</p><p><a href="${parentLink.properties.action_link}" style="display:inline-block;background:#17324d;color:#fff;padding:13px 20px;border-radius:5px;text-decoration:none">Activate account</a></p></div>`
        });
        if (parentResult.error) throw parentResult.error;
      }

      const { data: guardianMembership, error: guardianMembershipReadError } = await admin.from('school_memberships').select('id').eq('school_id', schoolId).eq('user_id', guardianUserId).maybeSingle();
      if (guardianMembershipReadError) throw guardianMembershipReadError;
      if (!guardianMembership) {
        const { error: guardianMembershipError } = await admin.from('school_memberships').insert({ school_id: schoolId, user_id: guardianUserId, role: 'parent', status: 'active' });
        if (guardianMembershipError) throw guardianMembershipError;
      }

      const { error: linkError } = await admin.from('student_guardians').insert({ school_id: schoolId, student_id: studentId, guardian_id: guardianId, relationship, is_primary: true });
      if (linkError) throw linkError;
      const { error: auditError } = await admin.from('audit_logs').insert({
        school_id: schoolId, actor_id: auth.user.id, action: 'student.account_provisioned', entity_type: 'student',
        entity_id: studentId, metadata: { student_number: studentNumber, class_id: classId }
      });
      if (auditError) throw auditError;

      const studentResult = await resend.emails.send({
        from: `${process.env.RESEND_FROM_NAME || 'SatGold Cloud'} <${process.env.RESEND_FROM_EMAIL}>`, to: [guardianEmail],
        subject: `Student login details from ${school.name}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17324d"><h1>Student account created</h1><p>Account for ${safeHtml(firstName)} ${safeHtml(lastName)} at ${safeHtml(school.name)}:</p><p><b>Login ID:</b> ${safeHtml(studentAuthEmail)}<br><b>Temporary password:</b> ${safeHtml(studentTempPassword)}</p><p>Change the temporary password immediately after the first sign in. Please share these details only with the student's authorized guardian.</p></div>`
      });
      if (studentResult.error) throw studentResult.error;
      return send(res, 201, { student: { id: studentId, studentNumber, loginIdentifier: studentAuthEmail, firstName, lastName }, guardianAccountCreated: Boolean(newGuardianUserId), message: 'Student portal created. Login instructions were sent to the guardian email.' });
    } catch (error) {
      if (studentId) await admin.from('student_profiles').delete().eq('id', studentId);
      if (newGuardianId) await admin.from('guardian_profiles').delete().eq('id', newGuardianId);
      if (studentUserId) await admin.auth.admin.deleteUser(studentUserId);
      if (newGuardianUserId) await admin.auth.admin.deleteUser(newGuardianUserId);
      if (error.message === 'GUARDIAN_ACTIVATION_REQUIRED') return send(res, 409, { error: 'This guardian account is not verified yet. Ask the guardian to activate it before linking another student.' });
      if (/already registered|already been registered|duplicate key/i.test(error.message || '')) return send(res, 409, { error: 'The student account or school record already exists. Review the register and try again.' });
      console.error('Student provisioning failed:', error.message || error);
      return send(res, 500, { error: 'Student and guardian accounts could not be provisioned. No student credentials were returned.' });
    }
  } catch (error) {
    console.error('Student endpoint failed:', error.message || error);
    return send(res, 500, { error: 'Could not complete the student request.' });
  }
};
