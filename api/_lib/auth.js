import { getBearerToken } from './http.js';
import { getSupabasePublic, getSupabaseAdmin } from './supabase.js';

export async function requireUser(req) {
  const token = getBearerToken(req);
  if (!token) return { error: 'Authentication required.', status: 401 };
  const { data, error } = await getSupabasePublic().auth.getUser(token);
  if (error || !data.user) return { error: 'Your session is invalid or expired.', status: 401 };
  if (data.user.user_metadata?.must_change_password) return { error: 'Change your temporary password before using the school workspace.', status: 403 };
  return { user: data.user };
}

export async function requireSchoolRole(userId, schoolId, roles) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('school_memberships')
    .select('role,status').eq('user_id', userId).eq('school_id', schoolId).eq('status', 'active').maybeSingle();
  if (error) throw error;
  if (!data || (roles && !roles.includes(data.role))) return null;
  return data;
}

