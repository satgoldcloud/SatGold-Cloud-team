import { send, method } from '../_lib/http.js';
import { requireUser, requireSchoolRole } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

export default async (req, res) => {
  if (!method(req, res, ['GET', 'PATCH'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });
  const schoolId = String(req.query.schoolId || req.body?.schoolId || '');
  if (!/^[0-9a-f-]{36}$/i.test(schoolId)) return send(res, 400, { error: 'A valid school ID is required.' });
  try {
    if (!(await requireSchoolRole(auth.user.id, schoolId))) return send(res, 403, { error: 'You do not have access to this school.' });
    const admin = getSupabaseAdmin();
    if (req.method === 'GET') {
      const { data, error } = await admin.from('notifications').select('id,title,body,link,read_at,created_at').eq('school_id', schoolId).eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return send(res, 200, { notifications: data || [], unread: (data || []).filter((item) => !item.read_at).length });
    }
    const id = String(req.body?.id || '');
    if (req.body?.action === 'read_all') {
      const { error } = await admin.from('notifications').update({ read_at: new Date().toISOString() }).eq('school_id', schoolId).eq('user_id', auth.user.id).is('read_at', null);
      if (error) throw error;
      return send(res, 200, { updated: true });
    }
    if (!/^[0-9a-f-]{36}$/i.test(id)) return send(res, 400, { error: 'A valid notification is required.' });
    const { error } = await admin.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).eq('school_id', schoolId).eq('user_id', auth.user.id);
    if (error) throw error;
    return send(res, 200, { updated: true });
  } catch (error) { console.error('Notification request failed:', error.message || error); return send(res, 500, { error: 'Could not load notifications.' }); }
};
