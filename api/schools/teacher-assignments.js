import { send, method } from '../_lib/http.js';
import { requireUser, requireSchoolRole } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

export default async (req, res) => {
  if (!method(req, res, ['GET', 'POST'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });
  const schoolId = String(req.query.schoolId || req.body?.schoolId || '');
  if (!/^[0-9a-f-]{36}$/i.test(schoolId)) return send(res, 400, { error: 'A valid school ID is required.' });
  try {
    const membership = await requireSchoolRole(auth.user.id, schoolId);
    if (!membership) return send(res, 403, { error: 'You do not have access to this school.' });
    const admin = getSupabaseAdmin();
    if (req.method === 'GET') {
      if (!['owner', 'admin', 'teacher', 'staff'].includes(membership.role)) return send(res, 403, { error: 'Teaching assignment access is restricted.' });
      let q = admin.from('teacher_assignments').select('id,staff_id,class_id,class_arm_id,subject_id,academic_session_id,staff_profiles(first_name,last_name,staff_type),school_classes(name),class_arms(name),subjects(name),academic_sessions(name)').eq('school_id', schoolId).order('created_at');
      if (membership.role === 'teacher') {
        const { data: staff, error } = await admin.from('staff_profiles').select('id').eq('school_id', schoolId).eq('user_id', auth.user.id).maybeSingle();
        if (error) throw error;
        if (!staff) return send(res, 200, { teacherAssignments: [] });
        q = q.eq('staff_id', staff.id);
      }
      const { data, error } = await q;
      if (error) throw error;
      return send(res, 200, { teacherAssignments: data || [] });
    }
    if (!['owner', 'admin'].includes(membership.role)) return send(res, 403, { error: 'Only school administrators can assign teachers.' });
    const staffId = String(req.body?.staffId || ''), classId = String(req.body?.classId || ''), classArmId = String(req.body?.classArmId || '') || null, subjectId = String(req.body?.subjectId || ''), sessionId = String(req.body?.academicSessionId || '');
    if (![staffId, classId, subjectId, sessionId].every((id) => /^[0-9a-f-]{36}$/i.test(id)) || (classArmId && !/^[0-9a-f-]{36}$/i.test(classArmId))) return send(res, 400, { error: 'Choose a valid teacher, class, subject and session.' });
    const [staff, classRow, subject, session, arm] = await Promise.all([
      admin.from('staff_profiles').select('id,staff_type').eq('school_id', schoolId).eq('id', staffId).eq('status', 'active').maybeSingle(),
      admin.from('school_classes').select('id').eq('school_id', schoolId).eq('id', classId).maybeSingle(),
      admin.from('subjects').select('id').eq('school_id', schoolId).eq('id', subjectId).maybeSingle(),
      admin.from('academic_sessions').select('id').eq('school_id', schoolId).eq('id', sessionId).maybeSingle(),
      classArmId ? admin.from('class_arms').select('id').eq('school_id', schoolId).eq('id', classArmId).eq('class_id', classId).maybeSingle() : Promise.resolve({ data: { id: true }, error: null })
    ]);
    for (const result of [staff, classRow, subject, session, arm]) if (result.error) throw result.error;
    if (!staff.data || staff.data.staff_type !== 'teaching' || !classRow.data || !subject.data || !session.data || !arm.data) return send(res, 400, { error: 'The selected teacher, class, arm, subject or session does not belong to this school.' });
    const { data, error } = await admin.from('teacher_assignments').insert({ school_id: schoolId, staff_id: staffId, class_id: classId, class_arm_id: classArmId, subject_id: subjectId, academic_session_id: sessionId }).select('id').single();
    if (error?.code === '23505') return send(res, 409, { error: 'This teacher is already assigned to that class, subject and session.' });
    if (error) throw error;
    await admin.from('audit_logs').insert({ school_id: schoolId, actor_id: auth.user.id, action: 'teacher_assignment.created', entity_type: 'teacher_assignment', entity_id: data.id });
    return send(res, 201, { teacherAssignment: data });
  } catch (error) { console.error('Teacher assignment request failed:', error.message || error); return send(res, 500, { error: 'Could not complete the teacher assignment request.' }); }
};
