import {send,method} from '../_lib/http.js';
import {requireUser,requireSchoolRole} from '../_lib/auth.js';
import {getSupabaseAdmin} from '../_lib/supabase.js';
export default async(req,res)=>{
  if(!method(req,res,['GET','PATCH']))return;const auth=await requireUser(req);if(auth.error)return send(res,auth.status,{error:auth.error});const schoolId=String(req.query.schoolId||req.body?.schoolId||'');if(!/^[0-9a-f-]{36}$/i.test(schoolId))return send(res,400,{error:'A valid school ID is required.'});
  try{const membership=await requireSchoolRole(auth.user.id,schoolId);if(!membership)return send(res,403,{error:'You do not have access to this school.'});const admin=getSupabaseAdmin();
    if(req.method==='GET'){
      let q=admin.from('report_drafts').select('id,student_id,academic_session_id,term,payload,status,teacher_id,reviewed_by,review_note,created_at,updated_at,student_profiles(first_name,last_name,student_number),academic_sessions(name)').eq('school_id',schoolId).order('updated_at',{ascending:false}).limit(500);
      if(membership.role==='teacher')q=q.eq('teacher_id',auth.user.id);else if(['student','parent'].includes(membership.role))q=q.eq('status','published');else if(!['owner','admin','staff'].includes(membership.role))return send(res,403,{error:'You cannot view school reports.'});
      const {data,error}=await q;if(error)throw error;let rows=data||[];
      if(membership.role==='student'){const {data:student}=await admin.from('student_profiles').select('id').eq('school_id',schoolId).eq('user_id',auth.user.id).maybeSingle();rows=student?rows.filter((r)=>r.student_id===student.id):[];}
      if(membership.role==='parent'){const {data:guardian}=await admin.from('guardian_profiles').select('id').eq('school_id',schoolId).eq('user_id',auth.user.id).maybeSingle();if(!guardian)rows=[];else{const {data:links}=await admin.from('student_guardians').select('student_id').eq('school_id',schoolId).eq('guardian_id',guardian.id);const ids=new Set((links||[]).map((r)=>r.student_id));rows=rows.filter((r)=>ids.has(r.student_id));}}
      return send(res,200,{reports:rows});
    }
    const reportId=String(req.body?.reportId||''),action=String(req.body?.action||''),reason=typeof req.body?.reason==='string'?req.body.reason.trim().slice(0,1000):'';if(!/^[0-9a-f-]{36}$/i.test(reportId))return send(res,400,{error:'A valid report ID is required.'});
    const {data:report,error:readError}=await admin.from('report_drafts').select('id,student_id,academic_session_id,term,payload,status,teacher_id').eq('school_id',schoolId).eq('id',reportId).maybeSingle();if(readError)throw readError;if(!report)return send(res,404,{error:'Report not found.'});const isAdmin=['owner','admin'].includes(membership.role),isTeacher=membership.role==='teacher'&&report.teacher_id===auth.user.id;let update;
    if(action==='submit'&&isTeacher&&['draft','returned'].includes(report.status))update={status:'submitted',review_note:null};
    else if(action==='approve'&&isAdmin&&report.status==='submitted')update={status:'approved',reviewed_by:auth.user.id,review_note:null};
    else if(action==='return'&&isAdmin&&report.status==='submitted'&&reason)update={status:'returned',reviewed_by:auth.user.id,review_note:reason};
    else if(action==='publish'&&isAdmin&&report.status==='approved')update={status:'published',reviewed_by:auth.user.id,reviewed_at:new Date().toISOString()};
    else return send(res,403,{error:'This report action is not allowed in its current state.'});
    const {data:versions,error:versionError}=await admin.from('report_revisions').select('version').eq('school_id',schoolId).eq('report_id',report.id).order('version',{ascending:false}).limit(1);if(versionError)throw versionError;
    const {error:revisionError}=await admin.from('report_revisions').insert({school_id:schoolId,report_id:report.id,version:(versions?.[0]?.version||0)+1,payload:report.payload,changed_by:auth.user.id,reason:reason||action});if(revisionError)throw revisionError;
    const {data:updated,error:updateError}=await admin.from('report_drafts').update({...update,updated_at:new Date().toISOString()}).eq('id',report.id).select('id,status,review_note,reviewed_by,updated_at').single();if(updateError)throw updateError;
    await admin.from('audit_logs').insert({school_id:schoolId,actor_id:auth.user.id,action:`report.${action}`,entity_type:'report',entity_id:report.id,reason:reason||null});
    if(action==='publish'){
      const recipients=new Set();const {data:student}=await admin.from('student_profiles').select('user_id').eq('id',report.student_id).single();if(student?.user_id)recipients.add(student.user_id);const {data:links}=await admin.from('student_guardians').select('guardian_profiles(user_id)').eq('school_id',schoolId).eq('student_id',report.student_id);(links||[]).forEach((r)=>{if(r.guardian_profiles?.user_id)recipients.add(r.guardian_profiles.user_id);});if(recipients.size)await admin.from('notifications').insert([...recipients].map((userId)=>({school_id:schoolId,user_id:userId,title:'Report published',body:'An approved school report is available in your workspace.',link:'/reports.html'})));
    }
    return send(res,200,{report:updated});
  }catch(error){console.error('Report workflow failed:',error.message||error);return send(res,500,{error:'Could not complete the report request.'});}
};
