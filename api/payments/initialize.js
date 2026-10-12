import { randomUUID } from 'node:crypto';
import { send, method } from '../_lib/http.js';
import { requireUser, requireSchoolRole } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

export default async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });
  const schoolId = String(req.body?.schoolId || '');
  const planId = String(req.body?.planId || '');
  const billingPeriod = String(req.body?.billingPeriod || 'monthly');
  const provider = String(req.body?.provider || '');
  if (!/^[0-9a-f-]{36}$/i.test(schoolId) || !['starter','premium'].includes(planId) || !['monthly','annual'].includes(billingPeriod) || !['paystack','flutterwave'].includes(provider)) return send(res, 400, { error: 'Choose a valid school, paid plan, billing period and payment provider.' });
  if (!auth.user.email) return send(res, 400, { error: 'Your account needs a verified email address before checkout.' });
  try {
    const membership = await requireSchoolRole(auth.user.id, schoolId, ['owner','admin']);
    if (!membership) return send(res, 403, { error: 'Only a school owner or administrator can manage billing.' });
    const admin = getSupabaseAdmin();
    const key = provider === 'paystack' ? process.env.PAYSTACK_SECRET_KEY : process.env.FLUTTERWAVE_SECRET_KEY;
    if (!key) return send(res, 503, { error: `${provider === 'paystack' ? 'Paystack' : 'Flutterwave'} credentials are not configured.` });
    const [{ data: plan, error: planError }, { data: subscription, error: subError }] = await Promise.all([
      admin.from('subscription_plans').select('id,name,monthly_price,annual_price,currency,enabled').eq('id', planId).single(),
      admin.from('school_subscriptions').select('id').eq('school_id', schoolId).in('status',['trialing','active','past_due']).maybeSingle()
    ]);
    if (planError) throw planError;
    if (subError) throw subError;
    if (!plan.enabled) return send(res, 400, { error: 'This plan is not currently available.' });
    const amount = Number(billingPeriod === 'annual' ? plan.annual_price : plan.monthly_price);
    if (!Number.isFinite(amount) || amount <= 0) return send(res, 400, { error: 'This billing period has not been configured by the platform administrator.' });
    if (!subscription) return send(res, 409, { error: 'A current school subscription is not available. Contact the platform administrator.' });
    const reference = `SG-${schoolId.slice(0,8)}-${randomUUID()}`;
    const { data: payment, error: paymentError } = await admin.from('payment_transactions').insert({
      school_id: schoolId, subscription_id: subscription.id, provider, reference, amount, currency: plan.currency,
      status: 'pending', requested_plan_id: plan.id, requested_billing_period: billingPeriod
    }).select('id,school_id,subscription_id,provider,reference,amount,currency,requested_plan_id,requested_billing_period').single();
    if (paymentError) throw paymentError;
    try {
      let checkoutUrl;
      let providerTransactionId = null;
      if (provider === 'paystack') {
        const response = await fetch('https://api.paystack.co/transaction/initialize', {
          method: 'POST', headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: auth.user.email, amount: Math.round(amount * 100), currency: plan.currency, reference, callback_url: `${process.env.APP_URL || 'http://localhost:3000'}/billing.html` }),
          signal: AbortSignal.timeout(15000)
        });
        const result = await response.json();
        if (!response.ok || result.status !== true || !result.data?.authorization_url) throw new Error('Could not initialize Paystack checkout.');
        checkoutUrl = result.data.authorization_url;
      } else {
        const response = await fetch('https://api.flutterwave.com/v3/payments', {
          method: 'POST', headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ tx_ref: reference, amount, currency: plan.currency, redirect_url: `${process.env.APP_URL || 'http://localhost:3000'}/billing.html`, customer: { email: auth.user.email, name: auth.user.user_metadata?.display_name || auth.user.email }, customizations: { title: 'SatGold Cloud subscription', description: `${plan.name} ${billingPeriod} plan` } }),
          signal: AbortSignal.timeout(15000)
        });
        const result = await response.json();
        if (!response.ok || result.status !== 'success' || !result.data?.link) throw new Error('Could not initialize Flutterwave checkout.');
        checkoutUrl = result.data.link;
        if (result.data.id) providerTransactionId = String(result.data.id);
      }
      if (providerTransactionId) await admin.from('payment_transactions').update({ provider_transaction_id: providerTransactionId }).eq('id', payment.id);
      return send(res, 200, { checkoutUrl, reference: payment.reference, provider });
    } catch (error) {
      await admin.from('payment_transactions').update({ status: 'failed' }).eq('id', payment.id);
      throw error;
    }
  } catch (error) {
    console.error('Checkout initialization failed:', error.message || error);
    return send(res, 502, { error: 'Payment checkout could not be initialized. No subscription was activated.' });
  }
};
