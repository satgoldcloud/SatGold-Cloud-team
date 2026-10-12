import { send, method } from '../_lib/http.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

export default async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const slug = String(req.query.slug || '').toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return send(res, 400, { error: 'A valid school page slug is required.' });
  try {
    const { data, error } = await getSupabaseAdmin().from('school_public_pages').select('slug,page_data,seo_title,seo_description,updated_at,schools(name,status)').eq('slug', slug).eq('published', true).maybeSingle();
    if (error) throw error;
    if (!data || data.schools?.status !== 'active') return send(res, 404, { error: 'This school page is not available.' });
    return send(res, 200, { page: { slug: data.slug, data: data.page_data, seoTitle: data.seo_title, seoDescription: data.seo_description, updatedAt: data.updated_at, schoolName: data.schools.name } });
  } catch (error) { console.error('Public school page failed:', error.message || error); return send(res, 500, { error: 'Could not load this school page.' }); }
};
