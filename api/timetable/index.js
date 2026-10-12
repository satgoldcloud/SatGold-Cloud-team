import { send, method } from '../_lib/http.js';
import { requireUser, requireSchoolRole } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

export default async (req, res) => {
  if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });
  const schoolId = String(req.query.schoolId || req.body?.schoolId || '');
  if (!/^[0-9a-f-]{36}$/i.test(schoolId)) return send(res, 400, { error: 'A valid school ID is required.' });
  try {
    const membership = await requireSchoolRole(auth.user.id, schoolId);
    if (!membership) return send(res, 403, { error: 'You do not have access to this school.' });
    const admin = getSupabaseAdmin();
    if (req.method === 'GET') {
      let q = admin.from('timetable_entries').select('id,weekday,starts_at,ends_at,room,teacher_assignment_id,teacher_assignments(class_id,class_arm_id,subject_id,staff_id,school_classes(name),class_arms(name),subjects(name),staff_profiles(first_name,last_name))').eq('school_id', schoolId).order('weekday').order('starts_at');
      if (membership.role === 'teacher') {
        const { data: staff } = await admin.from('staff_profiles').select('id').eq('school_id', schoolId).eq('user_id', auth.user.id).maybeSingle();
        if (!staff) return send(res, 200, { timetable: [] });
        const { data: assignments, error } = await admin.from('teacher_assignments').select('id').eq('school_id', schoolId).eq('staff_id', staff.id);
        if (error) throw error;
        q = q.in('teacher_assignment_id', (assignments || []).map((a) => a.id));
      } else if (['student', 'parent'].includes(membership.role)) {
        const { data: students, error } = await admin.from('student_profiles').select('class_id,class_arm_id').eq('school_id', schoolId).eq(membership.role === 'student' ? 'user_id' : 'id', membership.role === 'student' ? auth.user.id : '');
        if (error) throw error;
        let ids = [];
        if (membership.role === 'parent') {
          const { data: guardian } = await admin.from('guardian_profiles').select('id').eq('school_id', schoolId).eq('user_id', auth.user.id).maybeSingle();
          const { data: links } = guardian ? await admin.from('student_guardians').select('student_id').eq('school_id', schoolId).eq('guardian_id', guardian.id) : { data: [] };
          const { data: children } = links?.length ? await admin.from('student_profiles').select('class_id,class_arm_id').eq('school_id', schoolId).in('id', links.map((l) => l.student_id)) : { data: [] };
          ids = children || [];
        } else ids = students || [];
        if (!ids.length) return send(res, 200, { timetable: [] });
        const { data: assignments, error: ae } = await admin.from('teacher_assignments').select('id,class_id,class_arm_id').eq('school_id', schoolId);
        if (ae) throw ae;
        q = q.in('teacher_assignment_id', (assignments || []).filter((a) => ids.some((s) => a.class_id === s.class_id && (!a.class_arm_id || a.class_arm_id === s.class_arm_id))).map((a) => a.id));
      } else if (!['owner', 'admin', 'staff'].includes(membership.role)) return send(res, 403, { error: 'You cannot view this timetable.' });
      const { data, error } = await q;
      if (error) throw error;
      return send(res, 200, { timetable: data || [] });
    }
    if (!['owner', 'admin'].includes(membership.role)) return send(res, 403, { error: 'Only administrators can change the timetable.' });
    if (req.method === 'DELETE') {
      const id = String(req.body?.id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return send(res, 400, { error: 'A valid timetable entry is required.' });
      const { error } = await admin.from('timetable_entries').delete().eq('id', id).eq('school_id', schoolId);
      if (error) throw error;
      return send(res, 200, { deleted: true });
    }
    const assignmentId = String(req.body?.teacherAssignmentId || ''), weekday = Number(req.body?.weekday), start = String(req.body?.startsAt || ''), end = String(req.body?.endsAt || '');
    if (!/^[0-9a-f-]{36}$/i.test(assignmentId) || !Number.isInteger(weekday) || weekday < 1 || weekday > 7 || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || end <= start) return send(res, 400, { error: 'Enter a valid class assignment, day and time range.' });
    const { data: assignment, error: assignmentError } = await admin.from('teacher_assignments').select('id,staff_id,class_id,class_arm_id').eq('id', assignmentId).eq('school_id', schoolId).maybeSingle();
    if (assignmentError) throw assignmentError;
    if (!assignment) return send(res, 404, { error: 'The teaching assignment was not found.' });
    const { data: entries, error } = await admin.from('timetable_entries').select('id,starts_at,ends_at,teacher_assignment_id,teacher_assignments(staff_id,class_id,class_arm_id)').eq('school_id', schoolId).eq('weekday', weekday);
    if (error) throw error;
    const conflict = (entries || []).some((item) => {
      const sameClass = item.teacher_assignments?.class_id === assignment.class_id && (!item.teacher_assignments?.class_arm_id || !assignment.class_arm_id || item.teacher_assignments.class_arm_id === assignment.class_arm_id);
      const overlaps = start < item.ends_at && end > item.starts_at;
      return overlaps && (sameClass || item.teacher_assignments?.staff_id === assignment.staff_id);
    });
    if (conflict) return send(res, 409, { error: 'This time conflicts with another class or the assigned teacher.' });
    const { data, error: insertError } = await admin.from('timetable_entries').insert({ school_id: schoolId, teacher_assignment_id: assignmentId, weekday, starts_at: start, ends_at: end, room: String(req.body?.room || '').trim().slice(0, 80) || null }).select('id').single();
    if (insertError) throw insertError;
    await admin.from('audit_logs').insert({ school_id: schoolId, actor_id: auth.user.id, action: 'timetable.entry_created', entity_type: 'timetable_entry', entity_id: data.id });
    return send(res, 201, { entryId: data.id });
  } catch (error) { console.error('Timetable request failed:', error.message || error); return send(res, 500, { error: 'Could not complete the timetable request.' }); }
};
