import { send, method } from '../_lib/http.js';
import { requireUser, requireSchoolRole } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

export default async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });
  const schoolId = String(req.body?.schoolId || '');
  const examId = String(req.body?.examId || '');
  if (!/^[0-9a-f-]{36}$/i.test(schoolId) || !/^[0-9a-f-]{36}$/i.test(examId)) return send(res, 400, { error: 'A valid school and examination are required.' });
  try {
    const membership = await requireSchoolRole(auth.user.id, schoolId, ['student']);
    if (!membership) return send(res, 403, { error: 'Only an enrolled student can start this examination.' });
    const admin = getSupabaseAdmin();
    const [{ data: student, error: studentError }, { data: exam, error: examError }] = await Promise.all([
      admin.from('student_profiles').select('id,class_id,class_arm_id,status').eq('school_id', schoolId).eq('user_id', auth.user.id).maybeSingle(),
      admin.from('examinations').select('id,title,instructions,starts_at,ends_at,duration_minutes,max_attempts,randomize_questions,status,teacher_assignments!inner(class_id,class_arm_id)').eq('school_id', schoolId).eq('id', examId).maybeSingle()
    ]);
    if (studentError) throw studentError;
    if (examError) throw examError;
    if (!student || student.status !== 'active' || !exam) return send(res, 404, { error: 'Examination or student record not found.' });
    const assignment = exam.teacher_assignments;
    if (student.class_id !== assignment.class_id || (assignment.class_arm_id && student.class_arm_id !== assignment.class_arm_id)) return send(res, 403, { error: 'This examination is not assigned to your class.' });
    const now = Date.now();
    if (exam.status !== 'published' || now < Date.parse(exam.starts_at) || now > Date.parse(exam.ends_at)) return send(res, 409, { error: 'This examination is not open right now.' });

    const { data: attempts, error: attemptsError } = await admin.from('examination_attempts').select('id,attempt_number,status,expires_at').eq('school_id', schoolId).eq('examination_id', examId).eq('student_id', student.id).order('attempt_number');
    if (attemptsError) throw attemptsError;
    let active = (attempts || []).find((attempt) => attempt.status === 'in_progress' && Date.parse(attempt.expires_at) > now);
    for (const expired of (attempts || []).filter((attempt) => attempt.status === 'in_progress' && Date.parse(attempt.expires_at) <= now)) {
      await admin.from('examination_attempts').update({ status: 'expired' }).eq('id', expired.id).eq('status', 'in_progress');
    }
    if (!active && (attempts || []).length >= exam.max_attempts) return send(res, 409, { error: 'You have used all available attempts.' });
    if (!active) {
      const attemptNumber = (attempts || []).length + 1;
      const expiresAt = Math.min(now + exam.duration_minutes * 60_000, Date.parse(exam.ends_at));
      const { data, error } = await admin.from('examination_attempts').insert({
        school_id: schoolId, examination_id: examId, student_id: student.id, attempt_number: attemptNumber,
        expires_at: new Date(expiresAt).toISOString(), status: 'in_progress'
      }).select('id,attempt_number,expires_at,status').single();
      if (error) {
        if (error.code === '23505') return send(res, 409, { error: 'An examination attempt was started in another session. Refresh to continue it.' });
        throw error;
      }
      active = data;
    }
    const { data: questionRows, error: questionError } = await admin.from('examination_questions')
      .select('id,position,marks,questions!inner(id,question_type,prompt,options)')
      .eq('school_id', schoolId).eq('examination_id', examId).order('position');
    if (questionError) throw questionError;
    const questions = (questionRows || []).map((row) => ({ id: row.id, position: row.position, marks: row.marks, ...row.questions }));
    if (!questions.length) return send(res, 409, { error: 'This examination does not have any questions yet.' });
    if (exam.randomize_questions) questions.sort(() => Math.random() - 0.5);
    return send(res, 200, { exam: { id: exam.id, title: exam.title, instructions: exam.instructions }, attempt: active, questions });
  } catch (error) {
    console.error('Exam start failed:', error.message || error);
    return send(res, 500, { error: 'Could not start the examination.' });
  }
};
