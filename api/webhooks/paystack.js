import { safeEqual, paystackSignature, activateSubscription, verifyProvider } from '../_lib/payments.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

async function acknowledge(status, body) { return Response.json(body || {}, { status }); }

export async function POST(request) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = request.headers.get('x-paystack-signature') || '';
  if (!secret) return acknowledge(503,{error:'Paystack webhook is not configured.'});
  const rawBody = await request.text();
  if (!safeEqual(signature,paystackSignature(rawBody,secret))) return acknowledge(401,{error:'Invalid webhook signature.'});
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return acknowledge(400,{error:'Invalid webhook payload.'}); }
  if (payload.event !== 'charge.success') return acknowledge(200,{received:true});
  const reference = String(payload.data?.reference || '');
  const eventId = `${payload.event}:${payload.data?.id || reference}`;
  if (!reference || eventId.length > 180) return acknowledge(400,{error:'Webhook event is missing its payment reference.'});
  const admin = getSupabaseAdmin();
  try {
    const { data: payment, error } = await admin.from('payment_transactions')
      .select('id,school_id,subscription_id,provider,reference,amount,currency,status,provider_transaction_id,requested_plan_id,requested_billing_period')
      .eq('provider','paystack').eq('reference',reference).maybeSingle();
    if (error) throw error;
    if (!payment) return acknowledge(200,{received:true,ignored:true});
    const { error: eventError } = await admin.from('webhook_events').insert({provider:'paystack',event_id:eventId,status:'processing'});
    if (eventError?.code === '23505') {
      const { data: previous } = await admin.from('webhook_events').select('status').eq('provider','paystack').eq('event_id',eventId).maybeSingle();
      if (previous?.status === 'processed') return acknowledge(200,{received:true,duplicate:true});
      await admin.from('webhook_events').update({status:'processing',processed_at:null}).eq('provider','paystack').eq('event_id',eventId);
    } else if (eventError) throw eventError;
    const transaction = await verifyProvider('paystack',payment);
    await activateSubscription(payment,transaction);
    await admin.from('webhook_events').update({status:'processed',processed_at:new Date().toISOString()}).eq('provider','paystack').eq('event_id',eventId);
    return acknowledge(200,{received:true});
  } catch (error) {
    await admin.from('webhook_events').update({status:'failed'}).eq('provider','paystack').eq('event_id',eventId);
    console.error('Paystack webhook processing failed:',error.message || error);
    return acknowledge(500,{error:'Webhook could not be processed.'});
  }
}
