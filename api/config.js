import { send, method } from './_lib/http.js';

export default (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return send(res, 503, { error: 'Authentication is not configured yet.' });
  res.setHeader('Cache-Control', 'public, max-age=300');
  return send(res, 200, { supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY, studentAuthDomain: process.env.STUDENT_AUTH_DOMAIN || 'students.satgoldcloud.name.ng', appName: process.env.APP_NAME || 'SatGold Cloud' });
};
