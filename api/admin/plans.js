import { send, method } from '../_lib/http.js';
import { requireUser } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

async function platformAdmin(userId,admin) {
  const { data } = await admin.from('profiles').select('platform_role').eq('id',userId).maybeSingle();
  return data?.platform_role === 'super_admin';
}

export default async (req,res) => {
  if (!method(req,res,['GET','PATCH'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res,auth.status,{error:auth.error});
  const admin = getSupabaseAdmin();
  if (!(await platformAdmin(auth.user.id,admin))) return send(res,403,{error:'Platform super administrator access is required.'});
  if (req.method === 'GET') {
    const { data,error } = await admin.from('subscription_plans').select('id,name,monthly_price,annual_price,currency,trial_days,entitlements,enabled').order('monthly_price');
    if (error) return send(res,500,{error:'Could not load plans.'});
    return send(res,200,{plans:data});
  }
  const { id,monthlyPrice,annualPrice,trialDays,entitlements,enabled } = req.body || {};
  if (!['starter','premium','custom'].includes(id) || !Number.isInteger(trialDays) || trialDays<0 || trialDays>365 || typeof enabled!=='boolean' || !entitlements || typeof entitlements!=='object' || Array.isArray(entitlements)) return send(res,400,{error:'Plan configuration is invalid.'});
  const validPrice = (value) => value === null || (Number.isFinite(Number(value)) && Number(value)>=0 && Number(value)<=100000000);
  if (!validPrice(monthlyPrice) || !validPrice(annualPrice)) return send(res,400,{error:'Plan prices must be valid non-negative amounts.'});
  const { data,error } = await admin.from('subscription_plans').update({monthly_price:monthlyPrice,annual_price:annualPrice,trial_days:trialDays,entitlements,enabled,updated_at:new Date().toISOString()}).eq('id',id).select('id,name,monthly_price,annual_price,currency,trial_days,entitlements,enabled').single();
  if (error) { console.error('Plan update failed:',error.message); return send(res,500,{error:'Could not update this plan.'}); }
  return send(res,200,{plan:data});
};
