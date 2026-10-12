import { send, method } from './_lib/http.js';
import { requireUser } from './_lib/auth.js';
import { getSupabaseAdmin } from './_lib/supabase.js';

export default async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });
  try {
    const admin = getSupabaseAdmin();
    const [{ data: profile, error: profileError }, { data: memberships, error: membershipsError }] = await Promise.all([
      admin.from('profiles').select('id,display_name,platform_role').eq('id', auth.user.id).single(),
      admin.from('school_memberships').select('role,schools(id,name,slug,status)').eq('user_id', auth.user.id).eq('status', 'active')
    ]);
    if (profileError) throw profileError;
    if (membershipsError) throw membershipsError;
    return send(res, 200, { profile, schools: (memberships || []).filter((m) => m.schools).map(({ role, schools }) => ({ role, school: schools })) });
  } catch (error) {
    console.error('Profile read failed:', error.message);
    return send(res, 500, { error: 'Could not load your profile.' });
  }
};
