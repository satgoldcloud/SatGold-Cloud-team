import { randomUUID } from 'node:crypto';
import { Resend } from 'resend';
import { send, method } from '../_lib/http.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function makeSlug(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55);
}

export default async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  const name = cleanText(req.body?.schoolName, 120);
  const ownerName = cleanText(req.body?.ownerName, 120);
  const email = cleanText(req.body?.email, 254).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const contactEmail = cleanText(req.body?.contactEmail || email, 254).toLowerCase();
  if (name.length < 2 || ownerName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || password.length > 128) {
    return send(res, 400, { error: 'Enter a school name, your name, a valid email, and a password of at least 10 characters.' });
  }
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return send(res, 503, { error: 'School registration is not available until email verification is configured.' });
  }

  let admin;
  let userId;
  let schoolId;
  try {
    admin = getSupabaseAdmin();
    const slugBase = makeSlug(name) || 'school';
    const slug = `${slugBase}-${randomUUID().slice(0, 6)}`;
    const { data: created, error: authError } = await admin.auth.admin.generateLink({
      type: 'signup', email, password,
      options: { data: { display_name: ownerName }, redirectTo: `${process.env.APP_URL || 'http://localhost:3000'}/login.html` }
    });
    if (authError) throw authError;
    userId = created.user.id;

    const { data: school, error: schoolError } = await admin.from('schools').insert({
      name, slug, contact_email: contactEmail, created_by: userId, status: 'pending'
    }).select('id,name,slug').single();
    if (schoolError) throw schoolError;
    schoolId = school.id;

    const { error: membershipError } = await admin.from('school_memberships').insert({
      school_id: school.id, user_id: userId, role: 'owner', status: 'active'
    });
    if (membershipError) throw membershipError;

    const { error: pageError } = await admin.from('school_public_pages').insert({ school_id: school.id, slug, page_data: {}, published: false });
    if (pageError) throw pageError;

    const { data: starterPlan, error: starterPlanError } = await admin.from('subscription_plans').select('trial_days').eq('id','starter').single();
    if (starterPlanError) throw starterPlanError;
    const trialEnd = new Date(Date.now() + Number(starterPlan.trial_days) * 24 * 60 * 60 * 1000);
    const { error: trialError } = await admin.from('school_subscriptions').insert({
      school_id: school.id, plan_id: 'starter', billing_period: 'monthly', status: Number(starterPlan.trial_days)>0 ? 'trialing' : 'expired',
      trial_ends_at: trialEnd.toISOString(), current_period_start: new Date().toISOString(), current_period_end: trialEnd.toISOString()
    });
    if (trialError) throw trialError;

    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: `${process.env.RESEND_FROM_NAME || 'SatGold Cloud'} <${process.env.RESEND_FROM_EMAIL}>`,
      to: [email], subject: 'Verify your SatGold Cloud account',
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17324d"><h1>Welcome to SatGold Cloud</h1><p>Hello ${ownerName.replace(/[&<>"']/g, '')}, verify your email address to activate the owner account for <b>${name.replace(/[&<>"']/g, '')}</b>.</p><p><a href="${created.properties.action_link}" style="display:inline-block;background:#17324d;color:#fff;padding:13px 20px;border-radius:5px;text-decoration:none">Verify email</a></p><p>If you did not request this account, you can ignore this message.</p></div>`
    });
    if (result.error) throw result.error;
    return send(res, 201, {
      message: 'School registered. Check your email to verify the owner account.',
      emailVerificationSent: true,
      school: { id: school.id, name: school.name, slug: school.slug }
    });
  } catch (error) {
    if (admin && schoolId) await admin.from('schools').delete().eq('id', schoolId);
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
    const duplicate = /already registered|already been registered|duplicate key/i.test(error?.message || '');
    console.error('School registration failed:', error?.message || error);
    return send(res, duplicate ? 409 : 500, { error: duplicate ? 'An account with this email already exists.' : 'School registration could not be completed. Check server configuration and try again.' });
  }
};
