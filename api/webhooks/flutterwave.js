import { safeEqual, activateSubscription, verifyProvider } from '../_lib/payments.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

async function acknowledge(status, body) { return Response.json(body || {}, { status }); }

export async function POST(request) {
  const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;
  const signature = request.headers.get('verif-hash') || '';
  if (!secretHash) return acknowledge(503,{error:'Flutterwave webhook is not configured.'});
  if (!safeEqual(signature,secretHash)) return acknowledge(401,{error:'Invalid webhook signature.'});
  let payload;
  try { payload = JSON.parse(await request.text()); } catch { return acknowledge(400,{error:'Invalid webhook payload.'}); }
  if (payload.event !== 'charge.completed' || payload.data?.status !== 'successful') return acknowledge(200,{received:true});
  const reference = String(payload.data?.tx_ref || '');
  const transactionId = String(payload.data?.id || '');
  const eventId = `${payload.event}:${transactionId || reference}`;
  if (!reference || !/^\d{1,20}$/.test(transactionId) || eventId.length > 180) return acknowledge(400,{error:'Webhook event is missing transaction details.'});
  const admin = getSupabaseAdmin();
  try {
    const { data: payment, error } = await admin.from('payment_transactions')
      .select('id,school_id,subscription_id,provider,reference,amount,currency,status,provider_transaction_id,requested_plan_id,requested_billing_period')
      .eq('provider','flutterwave').eq('reference',reference).maybeSingle();
    if (error) throw error;
    if (!payment) return acknowledge(200,{received:true,ignored:true});
    if (payment.provider_transaction_id && payment.provider_transaction_id !== transactionId) throw new Error('Transaction ID did not match the pending payment.');
    if (!payment.provider_transaction_id) {
      const { error: idError } = await admin.from('payment_transactions').update({provider_transaction_id:transactionId}).eq('id',payment.id).eq('status','pending');
      if (idError) throw idError;
      payment.provider_transaction_id = transactionId;
    }
    const { error: eventError } = await admin.from('webhook_events').insert({provider:'flutterwave',event_id:eventId,status:'processing'});
    if (eventError?.code === '23505') {
      const { data: previous } = await admin.from('webhook_events').select('status').eq('provider','flutterwave').eq('event_id',eventId).maybeSingle();
      if (previous?.status === 'processed') return acknowledge(200,{received:true,duplicate:true});
      await admin.from('webhook_events').update({status:'processing',processed_at:null}).eq('provider','flutterwave').eq('event_id',eventId);
    } else if (eventError) throw eventError;
    const transaction = await verifyProvider('flutterwave',payment);
    await activateSubscription(payment,transaction);
    await admin.from('webhook_events').update({status:'processed',processed_at:new Date().toISOString()}).eq('provider','flutterwave').eq('event_id',eventId);
    return acknowledge(200,{received:true});
  } catch (error) {
    await admin.from('webhook_events').update({status:'failed'}).eq('provider','flutterwave').eq('event_id',eventId);
    console.error('Flutterwave webhook processing failed:',error.message || error);
    return acknowledge(500,{error:'Webhook could not be processed.'});
  }
}
