import { send, method } from '../_lib/http.js';
import { requireUser, requireSchoolRole } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

async function linkedStudentIds(admin, schoolId, userId, role) {
  if (role === 'student') {
    const { data, error } = await admin.from('student_profiles').select('id').eq('school_id', schoolId).eq('user_id', userId);
    if (error) throw error;
    return (data || []).map((row) => row.id);
  }
  if (role === 'parent') {
    const { data: guardian, error } = await admin.from('guardian_profiles').select('id').eq('school_id', schoolId).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (!guardian) return [];
    const { data, error: linkError } = await admin.from('student_guardians').select('student_id').eq('school_id', schoolId).eq('guardian_id', guardian.id);
    if (linkError) throw linkError;
    return (data || []).map((row) => row.student_id);
  }
  return null;
}

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
      let query = admin.from('attendance_records').select('id,student_id,attendance_date,status,note,student_profiles(first_name,last_name,student_number)').eq('school_id', schoolId).order('attendance_date', { ascending: false }).limit(1000);
      const from = String(req.query.from || ''), to = String(req.query.to || '');
      if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte('attendance_date', from);
      if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte('attendance_date', to);
      const ids = await linkedStudentIds(admin, schoolId, auth.user.id, membership.role);
      if (ids) {
        if (!ids.length) return send(res, 200, { attendance: [] });
        query = query.in('student_id', ids);
      } else if (membership.role === 'teacher') {
        const { data: staff, error } = await admin.from('staff_profiles').select('id').eq('school_id', schoolId).eq('user_id', auth.user.id).maybeSingle();
        if (error) throw error;
        if (!staff) return send(res, 200, { attendance: [] });
        const { data: assignments, error: assignError } = await admin.from('teacher_assignments').select('class_id,class_arm_id').eq('school_id', schoolId).eq('staff_id', staff.id);
        if (assignError) throw assignError;
        const { data: students, error: studentError } = await admin.from('student_profiles').select('id,class_id,class_arm_id').eq('school_id', schoolId).eq('status', 'active');
        if (studentError) throw studentError;
        const allowed = (students || []).filter((student) => (assignments || []).some((a) => a.class_id === student.class_id && (!a.class_arm_id || a.class_arm_id === student.class_arm_id))).map((student) => student.id);
        if (!allowed.length) return send(res, 200, { attendance: [] });
        query = query.in('student_id', allowed);
      } else if (!['owner', 'admin', 'staff'].includes(membership.role)) return send(res, 403, { error: 'You cannot view attendance.' });
      const { data, error } = await query;
      if (error) throw error;
      return send(res, 200, { attendance: data || [] });
    }
    if (!['owner', 'admin', 'teacher', 'staff'].includes(membership.role)) return send(res, 403, { error: 'Only school staff can record attendance.' });
    const classId = String(req.body?.classId || ''), date = String(req.body?.attendanceDate || ''), records = req.body?.records;
    if (!/^[0-9a-f-]{36}$/i.test(classId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(records) || records.length < 1 || records.length > 500) return send(res, 400, { error: 'Choose a class, date and attendance records.' });
    let assignments = [];
    if (membership.role === 'teacher') {
      const { data: staff, error } = await admin.from('staff_profiles').select('id').eq('school_id', schoolId).eq('user_id', auth.user.id).maybeSingle();
      if (error) throw error;
      if (!staff) return send(res, 403, { error: 'Teacher staff record not found.' });
      const { data, error: assignError } = await admin.from('teacher_assignments').select('class_arm_id').eq('school_id', schoolId).eq('staff_id', staff.id).eq('class_id', classId);
      if (assignError) throw assignError;
      assignments = data || [];
      if (!assignments.length) return send(res, 403, { error: 'You are not assigned to this class.' });
    }
    const allowedStatuses = new Set(['present', 'absent', 'late', 'excused']);
    if (records.some((row) => !/^[0-9a-f-]{36}$/i.test(String(row.studentId || '')) || !allowedStatuses.has(row.status)) || new Set(records.map((row) => row.studentId)).size !== records.length) return send(res, 400, { error: 'Each student must have one valid attendance status.' });
    const ids = records.map((row) => row.studentId);
    const { data: students, error: studentError } = await admin.from('student_profiles').select('id,class_id,class_arm_id').eq('school_id', schoolId).eq('class_id', classId).eq('status', 'active').in('id', ids);
    if (studentError) throw studentError;
    if ((students || []).length !== ids.length) return send(res, 400, { error: 'One or more student records do not belong to the selected class.' });
    if (membership.role === 'teacher' && students.some((student) => !assignments.some((assignment) => !assignment.class_arm_id || assignment.class_arm_id === student.class_arm_id))) return send(res, 403, { error: 'You are not assigned to every student arm in this attendance batch.' });
    const rows = records.map((row) => ({ school_id: schoolId, student_id: row.studentId, recorded_by: auth.user.id, attendance_date: date, status: row.status, note: typeof row.note === 'string' ? row.note.trim().slice(0, 500) : null }));
    const { data: saved, error: saveError } = await admin.from('attendance_records').upsert(rows, { onConflict: 'student_id,attendance_date' }).select('id,student_id,status,attendance_date');
    if (saveError) throw saveError;
    await admin.from('audit_logs').insert({ school_id: schoolId, actor_id: auth.user.id, action: 'attendance.recorded', entity_type: 'attendance_batch', entity_id: `${classId}:${date}`, metadata: { count: saved?.length || 0 } });
    const absentIds = records.filter((row) => row.status === 'absent').map((row) => row.studentId);
    if (absentIds.length) {
      const { data: links } = await admin.from('student_guardians').select('guardian_profiles(user_id)').eq('school_id', schoolId).in('student_id', absentIds);
      const recipients = new Set((links || []).map((row) => row.guardian_profiles?.user_id).filter(Boolean));
      if (recipients.size) await admin.from('notifications').insert([...recipients].map((userId) => ({ school_id: schoolId, user_id: userId, title: 'Attendance update', body: 'An attendance record was updated for a linked student.', link: '/portal-tools.html' })));
    }
    return send(res, 200, { saved: saved?.length || 0 });
  } catch (error) { console.error('Attendance request failed:', error.message || error); return send(res, 500, { error: 'Could not complete the attendance request.' }); }
};
