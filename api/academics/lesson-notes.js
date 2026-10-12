import {send,method} from '../_lib/http.js';
import {requireUser,requireSchoolRole} from '../_lib/auth.js';
import {getSupabaseAdmin} from '../_lib/supabase.js';

const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
async function assignedTeacher(admin,schoolId,userId,assignmentId){const {data,error}=await admin.from('teacher_assignments').select('id,staff_profiles!inner(user_id)').eq('school_id',schoolId).eq('id',assignmentId).maybeSingle();if(error)throw error;return data?.staff_profiles?.user_id===userId;}
async function accessibleAssignmentIds(admin,schoolId,userId,role){
  if(['owner','admin','staff'].includes(role)){const {data,error}=await admin.from('teacher_assignments').select('id').eq('school_id',schoolId);if(error)throw error;return(data||[]).map((r)=>r.id);}
  if(role==='teacher'){const {data:staff,error}=await admin.from('staff_profiles').select('id').eq('school_id',schoolId).eq('user_id',userId).maybeSingle();if(error)throw error;if(!staff)return[];const {data,error:assignmentError}=await admin.from('teacher_assignments').select('id').eq('school_id',schoolId).eq('staff_id',staff.id);if(assignmentError)throw assignmentError;return( data||[]).map((r)=>r.id);}
  let students=[];
  if(role==='student'){const {data,error}=await admin.from('student_profiles').select('id,class_id,class_arm_id').eq('school_id',schoolId).eq('user_id',userId);if(error)throw error;students=data||[];}
  if(role==='parent'){const {data:guardian,error}=await admin.from('guardian_profiles').select('id').eq('school_id',schoolId).eq('user_id',userId).maybeSingle();if(error)throw error;if(!guardian)return[];const {data:links,error:linkError}=await admin.from('student_guardians').select('student_id').eq('school_id',schoolId).eq('guardian_id',guardian.id);if(linkError)throw linkError;const ids=(links||[]).map((r)=>r.student_id);if(!ids.length)return[];const {data,error:studentError}=await admin.from('student_profiles').select('id,class_id,class_arm_id').eq('school_id',schoolId).in('id',ids);if(studentError)throw studentError;students=data||[];}
  const {data:assignments,error}=await admin.from('teacher_assignments').select('id,class_id,class_arm_id').eq('school_id',schoolId);if(error)throw error;
  return(assignments||[]).filter((a)=>students.some((s)=>s.class_id===a.class_id&&(!a.class_arm_id||a.class_arm_id===s.class_arm_id))).map((a)=>a.id);
}

export default async(req,res)=>{
  if(!method(req,res,['GET','POST','PATCH']))return;
  const auth=await requireUser(req);if(auth.error)return send(res,auth.status,{error:auth.error});
  const schoolId=String(req.query.schoolId||req.body?.schoolId||'');if(!/^[0-9a-f-]{36}$/i.test(schoolId))return send(res,400,{error:'A valid school ID is required.'});
  try{
    const membership=await requireSchoolRole(auth.user.id,schoolId);if(!membership)return send(res,403,{error:'You do not have access to this school.'});
    const admin=getSupabaseAdmin();
    if(req.method==='GET'){
      const assignmentIds=await accessibleAssignmentIds(admin,schoolId,auth.user.id,membership.role);if(!assignmentIds.length)return send(res,200,{lessonNotes:[]});
      let query=admin.from('lesson_notes').select('id,teacher_assignment_id,title,content,status,created_by,created_at,updated_at,teacher_assignments(class_id,class_arm_id,subject_id,school_classes(name),subjects(name))').eq('school_id',schoolId).in('teacher_assignment_id',assignmentIds).order('created_at',{ascending:false}).limit(300);
      if(['student','parent'].includes(membership.role))query=query.eq('status','published');
      const {data,error}=await query;if(error)throw error;return send(res,200,{lessonNotes:data||[]});
    }
    if(req.method==='POST'){
      if(!['owner','admin','teacher'].includes(membership.role))return send(res,403,{error:'Only teachers and school administrators can create lesson notes.'});
      const assignmentId=String(req.body?.teacherAssignmentId||''),title=clean(req.body?.title,180),content=clean(req.body?.content,30000);
      if(!/^[0-9a-f-]{36}$/i.test(assignmentId)||title.length<2||content.length<10)return send(res,400,{error:'Choose a teaching assignment and provide a title and lesson content.'});
      if(membership.role==='teacher'&&!(await assignedTeacher(admin,schoolId,auth.user.id,assignmentId)))return send(res,403,{error:'This teaching assignment is not assigned to your account.'});
      const {data,error}=await admin.from('lesson_notes').insert({school_id:schoolId,teacher_assignment_id:assignmentId,title,content,status:'draft',created_by:auth.user.id}).select('id,title,status,created_at').single();if(error){if(error.code==='23503')return send(res,400,{error:'Teaching assignment does not belong to this school.'});throw error;}return send(res,201,{lessonNote:data});
    }
    const noteId=String(req.body?.lessonNoteId||''),action=String(req.body?.action||''),reason=clean(req.body?.reason,1000);
    if(!/^[0-9a-f-]{36}$/i.test(noteId))return send(res,400,{error:'A valid lesson note is required.'});
    const {data:note,error:noteError}=await admin.from('lesson_notes').select('id,school_id,teacher_assignment_id,title,content,status,created_by').eq('id',noteId).eq('school_id',schoolId).maybeSingle();if(noteError)throw noteError;if(!note)return send(res,404,{error:'Lesson note not found.'});
    const isAdmin=['owner','admin'].includes(membership.role);const isAuthor=membership.role==='teacher'&&note.created_by===auth.user.id&&await assignedTeacher(admin,schoolId,auth.user.id,note.teacher_assignment_id);
    let update={updated_at:new Date().toISOString()};
    if(action==='submit'&&isAuthor&&['draft','returned'].includes(note.status)){update.status='submitted';update.submitted_at=new Date().toISOString();}
    else if(action==='approve'&&isAdmin&&note.status==='submitted'){update.status='approved';update.reviewed_by=auth.user.id;update.reviewed_at=new Date().toISOString();}
    else if(action==='return'&&isAdmin&&note.status==='submitted'&&reason){update.status='returned';update.reviewed_by=auth.user.id;update.reviewed_at=new Date().toISOString();}
    else if(action==='publish'&&isAdmin&&note.status==='approved'){update.status='published';update.reviewed_by=auth.user.id;update.reviewed_at=new Date().toISOString();}
    else if(action==='revise'&&isAuthor&&['draft','returned'].includes(note.status)){
      const title=clean(req.body?.title,180),content=clean(req.body?.content,30000);if(title.length<2||content.length<10)return send(res,400,{error:'Provide a title and lesson content.'});update.title=title;update.content=content;update.status='draft';
    }else return send(res,403,{error:'This lesson note action is not allowed in its current state.'});
    if(action==='return')update.review_note=reason;
    const {data:revisions,error:revisionReadError}=await admin.from('lesson_note_revisions').select('version').eq('lesson_note_id',noteId).order('version',{ascending:false}).limit(1);if(revisionReadError)throw revisionReadError;
    const {error:revisionError}=await admin.from('lesson_note_revisions').insert({school_id:schoolId,lesson_note_id:noteId,version:(revisions?.[0]?.version||0)+1,title:note.title,content:note.content,changed_by:auth.user.id,reason:reason||action});if(revisionError)throw revisionError;
    const {data:updated,error:updateError}=await admin.from('lesson_notes').update(update).eq('id',noteId).select('id,title,status,reviewed_by,reviewed_at,updated_at').single();if(updateError)throw updateError;
    await admin.from('audit_logs').insert({school_id:schoolId,actor_id:auth.user.id,action:`lesson_note.${action}`,entity_type:'lesson_note',entity_id:noteId,reason:reason||null});
    if(action==='publish'){
      const {data:assignment}=await admin.from('teacher_assignments').select('class_id,class_arm_id').eq('id',note.teacher_assignment_id).single();
      let studentsQuery=admin.from('student_profiles').select('id,user_id').eq('school_id',schoolId).eq('class_id',assignment.class_id).eq('status','active');if(assignment.class_arm_id)studentsQuery=studentsQuery.eq('class_arm_id',assignment.class_arm_id);
      const {data:students}=await studentsQuery;const studentIds=(students||[]).map((s)=>s.id);const recipients=new Set((students||[]).map((s)=>s.user_id).filter(Boolean));
      if(studentIds.length){const {data:links}=await admin.from('student_guardians').select('guardian_profiles(user_id)').eq('school_id',schoolId).in('student_id',studentIds);(links||[]).forEach((l)=>{if(l.guardian_profiles?.user_id)recipients.add(l.guardian_profiles.user_id);});}
      if(recipients.size)await admin.from('notifications').insert([...recipients].map((userId)=>({school_id:schoolId,user_id:userId,title:'New lesson note',body:'A lesson note is available in your school workspace.',link:'/dashboard.html'})));
    }
    return send(res,200,{lessonNote:updated});
  }catch(error){console.error('Lesson note workflow failed:',error.message||error);return send(res,500,{error:'Could not complete the lesson note request.'});}
};
