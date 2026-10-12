import { createHmac, timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin } from './supabase.js';

export function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function paystackSignature(rawBody, secret) {
  return createHmac('sha512', secret).update(rawBody).digest('hex');
}

export async function verifyProvider(provider, payment) {
  if (provider === 'paystack') {
    if (!process.env.PAYSTACK_SECRET_KEY) throw new Error('Paystack is not configured.');
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(payment.reference)}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }, signal: AbortSignal.timeout(15000)
    });
    const body = await response.json();
    if (!response.ok || body.status !== true) throw new Error('Paystack transaction verification failed.');
    const tx = body.data;
    const expectedKobo = Math.round(Number(payment.amount) * 100);
    if (tx.status !== 'success' || tx.reference !== payment.reference || Number(tx.amount) !== expectedKobo || tx.currency !== payment.currency) throw new Error('Paystack transaction details did not match this payment.');
    return { transactionId: String(tx.id), amount: Number(payment.amount), currency: tx.currency };
  }
  if (provider === 'flutterwave') {
    if (!process.env.FLUTTERWAVE_SECRET_KEY) throw new Error('Flutterwave is not configured.');
    if (!payment.provider_transaction_id) throw new Error('Flutterwave transaction ID is missing.');
    const response = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(payment.provider_transaction_id)}/verify`, {
      headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }, signal: AbortSignal.timeout(15000)
    });
    const body = await response.json();
    if (!response.ok || body.status !== 'success' || !body.data) throw new Error('Flutterwave transaction verification failed.');
    const tx = body.data;
    if (tx.status !== 'successful' || tx.tx_ref !== payment.reference || Number(tx.amount) < Number(payment.amount) || tx.currency !== payment.currency) throw new Error('Flutterwave transaction details did not match this payment.');
    return { transactionId: String(tx.id), amount: Number(tx.amount), currency: tx.currency };
  }
  throw new Error('Unsupported payment provider.');
}

export async function activateSubscription(payment, transaction) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('activate_subscription_payment', {
    target_payment: payment.id, verified_transaction_id: transaction.transactionId
  });
  if (error) throw error;
  return data;
}
