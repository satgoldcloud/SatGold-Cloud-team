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
    const membership = await requireSchoolRole(auth.user.id, schoolId);
    if (!membership) return send(res, 403, { error: 'You do not have access to this school.' });
    const admin = getSupabaseAdmin();
    if (req.method === 'GET') {
      const { data, error } = await admin.from('school_public_pages').select('slug,page_data,seo_title,seo_description,published').eq('school_id', schoolId).maybeSingle();
      if (error) throw error;
      return send(res, 200, { page: data });
    }
    if (!['owner', 'admin'].includes(membership.role)) return send(res, 403, { error: 'Only school administrators can edit this page.' });
    const fields = ['description', 'history', 'mission', 'vision', 'contactEmail', 'phone', 'admissionInfo', 'programmes', 'facilities', 'faqs', 'announcements', 'socialLinks', 'logoUrl', 'coverUrl'];
    const pageData = {};
    for (const key of fields) {
      const value = req.body?.pageData?.[key];
      if (value === undefined) continue;
      if (typeof value === 'string') pageData[key] = value.trim().slice(0, key === 'description' || key === 'history' || key === 'mission' || key === 'vision' || key === 'admissionInfo' ? 5000 : 500);
      else if (Array.isArray(value)) pageData[key] = value.slice(0, 30).map((item) => String(item).trim().slice(0, 300)).filter(Boolean);
      else if (key === 'socialLinks' && value && typeof value === 'object') pageData[key] = Object.fromEntries(Object.entries(value).filter(([k, v]) => ['facebook', 'instagram', 'youtube', 'linkedin', 'website'].includes(k) && typeof v === 'string').map(([k, v]) => [k, v.trim().slice(0, 500)]));
      else return send(res, 400, { error: `The ${key} page field is invalid.` });
    }
    const seoTitle = typeof req.body?.seoTitle === 'string' ? req.body.seoTitle.trim().slice(0, 70) : undefined;
    const seoDescription = typeof req.body?.seoDescription === 'string' ? req.body.seoDescription.trim().slice(0, 180) : undefined;
    const published = typeof req.body?.published === 'boolean' ? req.body.published : undefined;
    const { data: current, error: currentError } = await admin.from('school_public_pages').select('page_data').eq('school_id', schoolId).single();
    if (currentError) throw currentError;
    const updates = { page_data: { ...(current.page_data || {}), ...pageData }, updated_by: auth.user.id, updated_at: new Date().toISOString() };
    if (seoTitle !== undefined) updates.seo_title = seoTitle;
    if (seoDescription !== undefined) updates.seo_description = seoDescription;
    if (published !== undefined) updates.published = published;
    const { data, error } = await admin.from('school_public_pages').update(updates).eq('school_id', schoolId).select('slug,page_data,seo_title,seo_description,published').single();
    if (error) throw error;
    await admin.from('audit_logs').insert({ school_id: schoolId, actor_id: auth.user.id, action: published ? 'school_page.published' : 'school_page.updated', entity_type: 'school_public_page', entity_id: schoolId });
    return send(res, 200, { page: data });
  } catch (error) { console.error('School page update failed:', error.message || error); return send(res, 500, { error: 'Could not update this school page.' }); }
};
