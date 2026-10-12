import {send,method} from '../_lib/http.js';
import {requireUser,requireSchoolRole} from '../_lib/auth.js';
import {getSupabaseAdmin} from '../_lib/supabase.js';
export default async(req,res)=>{
  if(!method(req,res,['POST']))return;
  const auth=await requireUser(req);if(auth.error)return send(res,auth.status,{error:auth.error});
  const schoolId=String(req.body?.schoolId||''),classId=String(req.body?.classId||''),name=typeof req.body?.name==='string'?req.body.name.trim().slice(0,80):'';
  if(!/^[0-9a-f-]{36}$/i.test(schoolId)||!/^[0-9a-f-]{36}$/i.test(classId)||name.length<1)return send(res,400,{error:'School, class and class arm name are required.'});
  try{const membership=await requireSchoolRole(auth.user.id,schoolId,['owner','admin']);if(!membership)return send(res,403,{error:'Only school administrators can add class arms.'});const admin=getSupabaseAdmin();const {data,error}=await admin.from('class_arms').insert({school_id:schoolId,class_id:classId,name}).select('id,name,class_id').single();if(error){if(error.code==='23503')return send(res,400,{error:'The selected class does not belong to this school.'});if(error.code==='23505')return send(res,409,{error:'That arm already exists in this class.'});throw error;}return send(res,201,{classArm:data});}catch(error){console.error('Class arm creation failed:',error.message||error);return send(res,500,{error:'Could not create the class arm.'});}
};
