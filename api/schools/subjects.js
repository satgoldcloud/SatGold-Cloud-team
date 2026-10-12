import { send, method } from '../_lib/http.js';
import { requireUser, requireSchoolRole } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

export default async (req, res) => {
  if (!method(req, res, ['GET','POST'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });
  const schoolId = String(req.query.schoolId || req.body?.schoolId || '');
  if (!/^[0-9a-f-]{36}$/i.test(schoolId)) return send(res, 400, { error: 'A valid school ID is required.' });
  try {
    const membership = await requireSchoolRole(auth.user.id, schoolId);
    if (!membership) return send(res, 403, { error: 'You do not have access to this school.' });
    const admin = getSupabaseAdmin();
    if (req.method === 'GET') {
      const { data, error } = await admin.from('subjects').select('id,name,code').eq('school_id', schoolId).order('name');
      if (error) throw error;
      return send(res, 200, { subjects: data || [] });
    }
    if (!['owner','admin'].includes(membership.role)) return send(res, 403, { error: 'Only school administrators can create subjects.' });
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 100) : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().slice(0, 20) : null;
    if (name.length < 2) return send(res, 400, { error: 'Subject name must contain at least 2 characters.' });
    const { data, error } = await admin.from('subjects').insert({ school_id: schoolId, name, code }).select('id,name,code').single();
    if (error) throw error;
    return send(res, 201, { subject: data });
  } catch (error) {
    if (error.code === '23505') return send(res, 409, { error: 'That subject already exists in this school.' });
    console.error('Subject endpoint failed:', error.message);
    return send(res, 500, { error: 'Could not complete the subject request.' });
  }
};
