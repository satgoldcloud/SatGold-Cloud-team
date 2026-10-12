import { send, method } from '../_lib/http.js';
import { requireUser } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

export default async (req,res) => {
  if (!method(req,res,['GET','PATCH'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res,auth.status,{error:auth.error});
  const admin = getSupabaseAdmin();
  const { data:profile } = await admin.from('profiles').select('platform_role').eq('id',auth.user.id).maybeSingle();
  if (profile?.platform_role !== 'super_admin') return send(res,403,{error:'Platform super administrator access is required.'});
  if (req.method === 'GET') {
    const { data,error } = await admin.from('schools').select('id,name,slug,status,contact_email,created_at').order('created_at',{ascending:false}).limit(500);
    if (error) return send(res,500,{error:'Could not load schools.'});
    return send(res,200,{schools:data});
  }
  const schoolId=String(req.body?.schoolId||''); const status=String(req.body?.status||'');
  if (!/^[0-9a-f-]{36}$/i.test(schoolId)||!['pending','active','suspended','archived'].includes(status)) return send(res,400,{error:'School status request is invalid.'});
  const { data,error } = await admin.from('schools').update({status,updated_at:new Date().toISOString()}).eq('id',schoolId).select('id,name,slug,status').maybeSingle();
  if (error) return send(res,500,{error:'Could not update school status.'});
  if (!data) return send(res,404,{error:'School not found.'});
  await admin.from('audit_logs').insert({actor_id:auth.user.id,action:'platform.school_status_changed',entity_type:'school',entity_id:schoolId,metadata:{status}});
  return send(res,200,{school:data});
};
