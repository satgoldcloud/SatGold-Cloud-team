import { send, method } from '../_lib/http.js';
import { requireUser, requireSchoolRole } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

function normalize(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim().toLocaleLowerCase();
  return JSON.stringify(value);
}

export default async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });
  const attemptId = String(req.body?.attemptId || '');
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return send(res, 400, { error: 'A valid attempt ID is required.' });
  try {
    const admin = getSupabaseAdmin();
    const { data: attempt, error: attemptError } = await admin.from('examination_attempts').select('id,school_id,examination_id,student_id,status,expires_at,student_profiles!inner(user_id)').eq('id', attemptId).maybeSingle();
    if (attemptError) throw attemptError;
    if (!attempt || attempt.student_profiles.user_id !== auth.user.id) return send(res, 404, { error: 'Examination attempt not found.' });
    const membership = await requireSchoolRole(auth.user.id, attempt.school_id, ['student']);
    if (!membership) return send(res, 403, { error: 'You are not enrolled as a student in this school.' });
    if (attempt.status !== 'in_progress') return send(res, 409, { error: 'This attempt has already been submitted.' });
    if (Date.parse(attempt.expires_at) <= Date.now()) {
      await admin.from('examination_attempts').update({ status: 'expired' }).eq('id', attempt.id).eq('status', 'in_progress');
      return send(res, 409, { error: 'The examination time has expired.' });
    }

    const { data: rows, error: rowsError } = await admin.from('examination_questions')
      .select('id,marks,questions!inner(question_type,correct_answer)').eq('school_id', attempt.school_id).eq('examination_id', attempt.examination_id);
    if (rowsError) throw rowsError;
    const { data: answers, error: answersError } = await admin.from('examination_answers').select('id,examination_question_id,answer').eq('attempt_id', attempt.id);
    if (answersError) throw answersError;
    const answerMap = new Map((answers || []).map((row) => [row.examination_question_id, row]));
    let objectiveScore = 0;
    let manualCount = 0;
    for (const row of (rows || [])) {
      const answer = answerMap.get(row.id);
      const question = row.questions;
      if (!['multiple_choice','true_false','short_answer'].includes(question.question_type)) { if (answer) manualCount += 1; continue; }
      const correct = normalize(answer?.answer) !== '' && normalize(answer?.answer) === normalize(question.correct_answer);
      if (correct) objectiveScore += Number(row.marks);
      if (answer) {
        const { error } = await admin.from('examination_answers').update({ is_correct: correct, score: correct ? row.marks : 0 }).eq('id', answer.id);
        if (error) throw error;
      }
    }
    const submittedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await admin.from('examination_attempts').update({
      status: 'submitted', submitted_at: submittedAt, objective_score: objectiveScore
    }).eq('id', attempt.id).eq('status', 'in_progress').select('id,status,submitted_at,objective_score').maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return send(res, 409, { error: 'This attempt has already been submitted.' });
    return send(res, 200, { attempt: updated, manualReviewRequired: manualCount > 0 });
  } catch (error) {
    console.error('Exam submit failed:', error.message || error);
    return send(res, 500, { error: 'Could not submit the examination.' });
  }
};
