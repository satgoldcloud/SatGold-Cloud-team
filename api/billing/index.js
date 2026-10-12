import { send, method } from '../_lib/http.js';
import { requireUser, requireSchoolRole } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

export default async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });
  const schoolId = String(req.query.schoolId || '');
  if (!/^[0-9a-f-]{36}$/i.test(schoolId)) return send(res, 400, { error: 'A valid school ID is required.' });
  try {
    const membership = await requireSchoolRole(auth.user.id, schoolId, ['owner','admin']);
    if (!membership) return send(res, 403, { error: 'Only a school owner or administrator can view billing.' });
    const admin = getSupabaseAdmin();
    const [{ data: plans, error: plansError }, { data: subscription, error: subscriptionError }] = await Promise.all([
      admin.from('subscription_plans').select('id,name,monthly_price,annual_price,currency,trial_days,entitlements').eq('enabled', true).order('monthly_price'),
      admin.from('school_subscriptions').select('id,plan_id,billing_period,status,trial_ends_at,current_period_start,current_period_end,cancel_at_period_end,subscription_plans(name)').eq('school_id', schoolId).in('status',['trialing','active','past_due','cancelled','expired']).order('created_at',{ascending:false}).limit(1).maybeSingle()
    ]);
    if (plansError) throw plansError;
    if (subscriptionError) throw subscriptionError;
    return send(res, 200, { plans: plans || [], subscription, providers: { paystack: Boolean(process.env.PAYSTACK_SECRET_KEY), flutterwave: Boolean(process.env.FLUTTERWAVE_SECRET_KEY) } });
  } catch (error) {
    console.error('Billing read failed:', error.message || error);
    return send(res, 500, { error: 'Could not load school billing.' });
  }
};
