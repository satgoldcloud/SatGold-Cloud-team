import { send, method } from '../_lib/http.js';
import { requireUser, requireSchoolRole } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

const isUuid = (value) => /^[0-9a-f-]{36}$/i.test(String(value || ''));

export default async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });

  const schoolId = String(req.body?.schoolId || '');
  const classId = String(req.body?.classId || '');
  const classArmId = String(req.body?.classArmId || '') || null;
  const sessionId = String(req.body?.academicSessionId || '');
  const term = typeof req.body?.term === 'string' ? req.body.term.trim().slice(0, 80) : '';
  if (!isUuid(schoolId) || !isUuid(classId) || !isUuid(sessionId) || (classArmId && !isUuid(classArmId)) || !term) {
    return send(res, 400, { error: 'Choose a school, class, session, term and optional class arm.' });
  }

  try {
    const membership = await requireSchoolRole(auth.user.id, schoolId, ['owner', 'admin']);
    if (!membership) return send(res, 403, { error: 'Only school administrators can compile reports.' });
    const admin = getSupabaseAdmin();
    const [sessionResult, scalesResult, studentsResult, assignmentsResult] = await Promise.all([
      admin.from('academic_sessions').select('id,name,starts_on,ends_on').eq('school_id', schoolId).eq('id', sessionId).maybeSingle(),
      admin.from('grading_scales').select('label,min_percent,max_percent,remark').eq('school_id', schoolId).order('min_percent'),
      admin.from('student_profiles').select('id,student_number,first_name,last_name,class_id,class_arm_id').eq('school_id', schoolId).eq('class_id', classId).eq('status', 'active'),
      admin.from('teacher_assignments').select('id,subject_id,class_id,class_arm_id,subjects(name)').eq('school_id', schoolId).eq('class_id', classId).eq('academic_session_id', sessionId)
    ]);
    if (sessionResult.error) throw sessionResult.error;
    if (scalesResult.error) throw scalesResult.error;
    if (studentsResult.error) throw studentsResult.error;
    if (assignmentsResult.error) throw assignmentsResult.error;
    const session = sessionResult.data;
    if (!session) return send(res, 400, { error: 'Academic session does not belong to this school.' });
    const studentList = classArmId ? (studentsResult.data || []).filter((student) => student.class_arm_id === classArmId) : (studentsResult.data || []);
    if (!studentList.length) return send(res, 409, { error: 'No active students were found for that class and arm.' });
    const scales = scalesResult.data || [];
    if (!scales.length) return send(res, 409, { error: 'Configure a school grading scale before compiling reports.' });
    const assignments = (assignmentsResult.data || []).filter((assignment) => !assignment.class_arm_id || !classArmId || assignment.class_arm_id === classArmId);
    if (!assignments.length) return send(res, 409, { error: 'No teachers or subjects are assigned to this class and session.' });

    const assignmentIds = assignments.map((assignment) => assignment.id);
    const { data: assessments, error: assessmentError } = await admin.from('assessments')
      .select('id,teacher_assignment_id,title,category,max_score,weight,status')
      .eq('school_id', schoolId).eq('academic_session_id', sessionId).eq('term', term)
      .in('teacher_assignment_id', assignmentIds).in('status', ['approved', 'published']);
    if (assessmentError) throw assessmentError;
    const assessmentList = assessments || [];
    const assignedWithAssessments = new Set(assessmentList.map((assessment) => assessment.teacher_assignment_id));
    const missingSubjects = assignments.filter((assignment) => !assignedWithAssessments.has(assignment.id)).map((assignment) => assignment.subjects?.name || assignment.subject_id);
    if (missingSubjects.length) return send(res, 409, { error: 'Some assigned subjects have no approved assessment submissions.', missingSubjects });
    if (!assessmentList.length) return send(res, 409, { error: 'No approved assessment submissions were found for this term.' });

    const assessmentIds = assessmentList.map((assessment) => assessment.id);
    const studentIds = studentList.map((student) => student.id);
    const { data: scores, error: scoresError } = await admin.from('assessment_scores')
      .select('assessment_id,student_id,score').eq('school_id', schoolId).in('assessment_id', assessmentIds).in('student_id', studentIds);
    if (scoresError) throw scoresError;
    const scoreMap = new Map((scores || []).map((score) => [`${score.assessment_id}:${score.student_id}`, Number(score.score)]));
    const missingScores = [];
    for (const assessment of assessmentList) for (const student of studentList) {
      if (!scoreMap.has(`${assessment.id}:${student.id}`)) missingScores.push({ assessment: assessment.title, student: `${student.first_name} ${student.last_name}` });
    }
    if (missingScores.length) return send(res, 409, { error: 'Some assessment scores are missing. Complete the records before compilation.', missingCount: missingScores.length, missingScores: missingScores.slice(0, 50) });

    const ranges = scales.map((scale) => ({ min: Number(scale.min_percent), max: Number(scale.max_percent) })).sort((a, b) => a.min - b.min);
    if (ranges[0].min !== 0 || ranges[ranges.length - 1].max !== 100 || ranges.some((range, index) => index > 0 && Math.abs(range.min - ranges[index - 1].max) > 0.01)) {
      return send(res, 409, { error: 'Grading scale must cover 0 to 100 without gaps before compilation.' });
    }
    const { data: attendance, error: attendanceError } = await admin.from('attendance_records')
      .select('student_id,status').eq('school_id', schoolId).in('student_id', studentIds)
      .gte('attendance_date', session.starts_on).lte('attendance_date', session.ends_on);
    if (attendanceError) throw attendanceError;
    const assessmentsByAssignment = new Map();
    assessmentList.forEach((assessment) => {
      const rows = assessmentsByAssignment.get(assessment.teacher_assignment_id) || [];
      rows.push(assessment); assessmentsByAssignment.set(assessment.teacher_assignment_id, rows);
    });

    const outputRows = [];
    for (const student of studentList) {
      const subjectRows = [];
      let overallWeighted = 0;
      let overallWeight = 0;
      for (const assignment of assignments) {
        const tests = assessmentsByAssignment.get(assignment.id) || [];
        if (!tests.length) continue;
        let weightedPercent = 0; let totalWeight = 0; let earned = 0; let maximum = 0;
        for (const assessment of tests) {
          const score = scoreMap.get(`${assessment.id}:${student.id}`);
          const weight = Number(assessment.weight);
          weightedPercent += score / Number(assessment.max_score) * weight;
          totalWeight += weight; earned += score; maximum += Number(assessment.max_score);
        }
        const percentage = totalWeight ? weightedPercent / totalWeight * 100 : 0;
        const grade = [...scales].sort((a, b) => Number(b.min_percent) - Number(a.min_percent))
          .find((scale) => percentage >= Number(scale.min_percent) && percentage <= Number(scale.max_percent));
        if (!grade) return send(res, 409, { error: `Grading scale has no grade for ${percentage.toFixed(2)}%.` });
        subjectRows.push({ subjectId: assignment.subject_id, subject: assignment.subjects?.name || 'Subject', earned: Math.round(earned * 100) / 100, maximum: Math.round(maximum * 100) / 100, percentage: Math.round(percentage * 100) / 100, grade: grade.label, remark: grade.remark || '' });
        overallWeighted += weightedPercent; overallWeight += totalWeight;
      }
      const attendanceRows = (attendance || []).filter((row) => row.student_id === student.id);
      const payload = {
        session: session.name, term, subjects: subjectRows,
        overallPercentage: overallWeight ? Math.round(overallWeighted / overallWeight * 10000) / 100 : 0,
        attendance: {
          present: attendanceRows.filter((row) => row.status === 'present').length,
          absent: attendanceRows.filter((row) => row.status === 'absent').length,
          late: attendanceRows.filter((row) => row.status === 'late').length,
          excused: attendanceRows.filter((row) => row.status === 'excused').length
        }
      };
      outputRows.push({ student, payload });
    }

    for (const item of outputRows) {
      const { data: existing, error: existingError } = await admin.from('report_drafts').select('id,payload')
        .eq('school_id', schoolId).eq('student_id', item.student.id).eq('academic_session_id', sessionId).eq('term', term).maybeSingle();
      if (existingError) throw existingError;
      if (existing) {
        const { data: versions, error: versionError } = await admin.from('report_revisions').select('version')
          .eq('school_id', schoolId).eq('report_id', existing.id).order('version', { ascending: false }).limit(1);
        if (versionError) throw versionError;
        const { error: revisionError } = await admin.from('report_revisions').insert({ school_id: schoolId, report_id: existing.id, version: (versions?.[0]?.version || 0) + 1, payload: existing.payload, changed_by: auth.user.id, reason: 'Report recompiled from approved assessment records' });
        if (revisionError) throw revisionError;
        const { error: updateError } = await admin.from('report_drafts').update({ payload: item.payload, status: 'draft', teacher_id: auth.user.id, reviewed_by: null, review_note: null, updated_at: new Date().toISOString() }).eq('id', existing.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await admin.from('report_drafts').insert({ school_id: schoolId, student_id: item.student.id, academic_session_id: sessionId, term, payload: item.payload, status: 'draft', teacher_id: auth.user.id });
        if (insertError) throw insertError;
      }
    }
    await admin.from('audit_logs').insert({ school_id: schoolId, actor_id: auth.user.id, action: 'reports.compiled', entity_type: 'class_report_batch', entity_id: `${classId}:${sessionId}:${term}`, metadata: { students: outputRows.length, assessment_count: assessmentList.length } });
    return send(res, 200, { compiled: outputRows.length, students: outputRows.map(({ student, payload }) => ({ id: student.id, studentNumber: student.student_number, name: `${student.first_name} ${student.last_name}`, overallPercentage: payload.overallPercentage })) });
  } catch (error) {
    console.error('Report compilation failed:', error.message || error);
    return send(res, 500, { error: 'Could not compile school reports.' });
  }
};
