import { send, method } from '../_lib/http.js';
import { requireUser, requireSchoolRole } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';
import { activateSubscription, verifyProvider } from '../_lib/payments.js';

export default async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });
  const reference = String(req.body?.reference || '');
  if (reference.length < 10 || reference.length > 120) return send(res, 400, { error: 'A valid payment reference is required.' });
  try {
    const admin = getSupabaseAdmin();
    const { data: payment, error } = await admin.from('payment_transactions')
      .select('id,school_id,subscription_id,provider,reference,amount,currency,status,provider_transaction_id,requested_plan_id,requested_billing_period')
      .eq('reference', reference).maybeSingle();
    if (error) throw error;
    if (!payment) return send(res, 404, { error: 'Payment reference not found.' });
    const membership = await requireSchoolRole(auth.user.id, payment.school_id, ['owner','admin']);
    if (!membership) return send(res, 403, { error: 'You cannot verify this school payment.' });
    if (payment.provider === 'flutterwave' && !payment.provider_transaction_id) {
      const transactionId = String(req.body?.transactionId || '');
      if (!/^\d{1,20}$/.test(transactionId)) return send(res, 400, { error: 'Flutterwave transaction ID is required for verification.' });
      payment.provider_transaction_id = transactionId;
      const { error: saveIdError } = await admin.from('payment_transactions').update({ provider_transaction_id: transactionId }).eq('id', payment.id).eq('status', 'pending');
      if (saveIdError) throw saveIdError;
    }
    const transaction = await verifyProvider(payment.provider, payment);
    const subscription = await activateSubscription(payment, transaction);
    return send(res, 200, { payment: { reference, status: 'succeeded', amount: payment.amount, currency: payment.currency }, subscription });
  } catch (error) {
    console.error('Payment verification failed:', error.message || error);
    return send(res, 409, { error: 'Payment could not be verified. Your school subscription has not been activated.' });
  }
};
