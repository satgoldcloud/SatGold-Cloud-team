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
      const { data, error } = await admin.from('school_classes').select('id,name,level,sort_order,class_arms(id,name)').eq('school_id', schoolId).order('sort_order').order('name');
      if (error) throw error;
      return send(res, 200, { classes: data || [] });
    }
    if (!['owner','admin'].includes(membership.role)) return send(res, 403, { error: 'Only school administrators can create classes.' });
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
    const level = typeof req.body?.level === 'string' ? req.body.level.trim().slice(0, 80) : null;
    if (name.length < 2) return send(res, 400, { error: 'Class name must contain at least 2 characters.' });
    const { data, error } = await admin.from('school_classes').insert({ school_id: schoolId, name, level }).select('id,name,level,sort_order').single();
    if (error) throw error;
    return send(res, 201, { class: data });
  } catch (error) {
    if (error.code === '23505') return send(res, 409, { error: 'That class name already exists in this school.' });
    console.error('Class endpoint failed:', error.message);
    return send(res, 500, { error: 'Could not complete the class request.' });
  }
};
