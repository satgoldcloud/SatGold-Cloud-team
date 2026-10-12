import { send, method } from '../_lib/http.js';
import { requireUser, requireSchoolRole } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

export default async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const schoolId = String(req.body?.schoolId || '');
  if (!/^[0-9a-f-]{36}$/i.test(schoolId) || prompt.length < 5 || prompt.length > 6000) return send(res, 400, { error: 'Provide a valid school and a prompt between 5 and 6,000 characters.' });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return send(res, 503, { error: 'The AI assistant is not configured yet.' });
  const model = process.env.GEMINI_MODEL;
  if (!model) return send(res, 503, { error: 'The AI model is not configured yet.' });
  try {
    const membership = await requireSchoolRole(auth.user.id, schoolId, ['owner','admin','teacher','staff']);
    const admin = getSupabaseAdmin();
    if (!membership) {
      const { data: profile } = await admin.from('profiles').select('platform_role').eq('id',auth.user.id).maybeSingle();
      if (profile?.platform_role !== 'super_admin') return send(res, 403, { error: 'The AI assistant is not available to this account.' });
    }
    const { data: usedCount, error: usageError } = await admin.rpc('consume_school_ai_request',{target_school:schoolId,target_user:auth.user.id,target_model:model});
    if (usageError) {
      if (/limit reached|not enabled/i.test(usageError.message || '')) return send(res, 429,{error:usageError.message});
      throw usageError;
    }
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({systemInstruction:{parts:[{text:'You are SatGold Cloud’s school work assistant. Give clear, practical drafts for authorized school staff. Never claim to publish, approve grades, change permissions, make payments, or complete external actions. Ask the responsible staff member to review important academic or administrative output.'}]},contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0.5,maxOutputTokens:1800}}),
      signal:AbortSignal.timeout(30000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'The AI provider request failed.');
    const text = (result.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('').trim();
    if (!text) throw new Error('The AI provider returned no text.');
    return send(res,200,{text,requestsUsed:usedCount,model});
  } catch (error) {
    console.error('AI assistant failed:',error.message || error);
    return send(res,502,{error:'The AI assistant could not complete that request.'});
  }
};
