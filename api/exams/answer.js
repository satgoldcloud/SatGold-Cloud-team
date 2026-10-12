import { send, method } from '../_lib/http.js';
import { requireUser, requireSchoolRole } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

export default async (req, res) => {
  if (!method(req, res, ['PUT'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });
  const attemptId = String(req.body?.attemptId || '');
  const questionId = String(req.body?.questionId || '');
  const answer = req.body?.answer;
  if (!/^[0-9a-f-]{36}$/i.test(attemptId) || !/^[0-9a-f-]{36}$/i.test(questionId) || answer === undefined) return send(res, 400, { error: 'Attempt, question and answer are required.' });
  if (JSON.stringify(answer).length > 10000) return send(res, 413, { error: 'Answer is too large.' });
  try {
    const admin = getSupabaseAdmin();
    const { data: attempt, error: attemptError } = await admin.from('examination_attempts').select('id,school_id,examination_id,student_id,status,expires_at,student_profiles!inner(user_id)').eq('id', attemptId).maybeSingle();
    if (attemptError) throw attemptError;
    if (!attempt || attempt.student_profiles.user_id !== auth.user.id) return send(res, 404, { error: 'Examination attempt not found.' });
    const membership = await requireSchoolRole(auth.user.id, attempt.school_id, ['student']);
    if (!membership) return send(res, 403, { error: 'You are not enrolled as a student in this school.' });
    if (attempt.status !== 'in_progress' || Date.parse(attempt.expires_at) <= Date.now()) return send(res, 409, { error: 'This attempt has expired or is already submitted.' });
    const { data: question, error: questionError } = await admin.from('examination_questions').select('id').eq('id', questionId).eq('school_id', attempt.school_id).eq('examination_id', attempt.examination_id).maybeSingle();
    if (questionError) throw questionError;
    if (!question) return send(res, 404, { error: 'Question is not part of this examination.' });
    const { error } = await admin.from('examination_answers').upsert({ school_id: attempt.school_id, attempt_id: attempt.id, examination_question_id: question.id, answer, saved_at: new Date().toISOString() }, { onConflict: 'attempt_id,examination_question_id' });
    if (error) throw error;
    return send(res, 200, { saved: true, savedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Exam answer save failed:', error.message || error);
    return send(res, 500, { error: 'Could not save the answer.' });
  }
};
