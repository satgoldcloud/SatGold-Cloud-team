import { send, method } from '../_lib/http.js';
import { requireUser, requireSchoolRole } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

export default async (req, res) => {
  if (!method(req, res, ['GET', 'POST', 'PATCH'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });
  const schoolId = String(req.query.schoolId || req.body?.schoolId || '');
  if (!/^[0-9a-f-]{36}$/i.test(schoolId)) return send(res, 400, { error: 'A valid school ID is required.' });
  try {
    const membership = await requireSchoolRole(auth.user.id, schoolId);
    if (!membership) return send(res, 403, { error: 'You do not have access to this school.' });
    const admin = getSupabaseAdmin();
    const isStaff = ['owner', 'admin', 'staff'].includes(membership.role);
    if (req.method === 'GET') {
      let q = admin.from('complaints').select('id,subject,status,opened_by,assigned_to,created_at,updated_at,complaint_messages(id,author_id,body,created_at)').eq('school_id', schoolId).order('updated_at', { ascending: false }).limit(100);
      if (!isStaff) q = q.eq('opened_by', auth.user.id);
      const { data, error } = await q;
      if (error) throw error;
      return send(res, 200, { complaints: data || [] });
    }
    if (req.method === 'POST') {
      const subject = String(req.body?.subject || '').trim().slice(0, 160);
      const body = String(req.body?.body || '').trim().slice(0, 5000);
      if (subject.length < 3 || body.length < 3) return send(res, 400, { error: 'Enter a subject and message.' });
      const { data: complaint, error } = await admin.from('complaints').insert({ school_id: schoolId, opened_by: auth.user.id, subject }).select('id').single();
      if (error) throw error;
      const { error: messageError } = await admin.from('complaint_messages').insert({ school_id: schoolId, complaint_id: complaint.id, author_id: auth.user.id, body });
      if (messageError) { await admin.from('complaints').delete().eq('id', complaint.id); throw messageError; }
      await admin.from('audit_logs').insert({ school_id: schoolId, actor_id: auth.user.id, action: 'complaint.opened', entity_type: 'complaint', entity_id: complaint.id });
      const { data: staffRecipients } = await admin.from('school_memberships').select('user_id').eq('school_id', schoolId).eq('status', 'active').in('role', ['owner', 'admin', 'staff']);
      const recipientIds = [...new Set((staffRecipients || []).map((row) => row.user_id).filter((id) => id !== auth.user.id))];
      if (recipientIds.length) await admin.from('notifications').insert(recipientIds.map((userId) => ({ school_id: schoolId, user_id: userId, title: 'New school enquiry', body: 'A new complaint or enquiry needs a response.', link: '/portal-tools.html' })));
      return send(res, 201, { complaintId: complaint.id });
    }
    const complaintId = String(req.body?.complaintId || ''), action = String(req.body?.action || 'reply');
    if (!/^[0-9a-f-]{36}$/i.test(complaintId)) return send(res, 400, { error: 'A valid complaint is required.' });
    const { data: complaint, error: readError } = await admin.from('complaints').select('id,opened_by,status').eq('id', complaintId).eq('school_id', schoolId).maybeSingle();
    if (readError) throw readError;
    if (!complaint || (!isStaff && complaint.opened_by !== auth.user.id)) return send(res, 404, { error: 'Complaint not found.' });
    if (action === 'reply') {
      const body = String(req.body?.body || '').trim().slice(0, 5000);
      if (body.length < 2) return send(res, 400, { error: 'Enter a reply.' });
      const { error } = await admin.from('complaint_messages').insert({ school_id: schoolId, complaint_id: complaintId, author_id: auth.user.id, body });
      if (error) throw error;
      const status = isStaff && complaint.status === 'open' ? 'in_progress' : complaint.status;
      await admin.from('complaints').update({ status, updated_at: new Date().toISOString() }).eq('id', complaintId);
      if (isStaff && complaint.opened_by !== auth.user.id) await admin.from('notifications').insert({ school_id: schoolId, user_id: complaint.opened_by, title: 'Complaint updated', body: 'Your school has replied to your enquiry.', link: '/portal-tools.html' });
      if (!isStaff) {
        const { data: recipients } = await admin.from('school_memberships').select('user_id').eq('school_id', schoolId).eq('status', 'active').in('role', ['owner', 'admin', 'staff']);
        const ids = [...new Set((recipients || []).map((row) => row.user_id).filter((id) => id !== auth.user.id))];
        if (ids.length) await admin.from('notifications').insert(ids.map((userId) => ({ school_id: schoolId, user_id: userId, title: 'Complaint reply', body: 'A new message was added to a complaint.', link: '/portal-tools.html' })));
      }
      return send(res, 200, { updated: true });
    }
    if (!isStaff || !['in_progress', 'resolved', 'closed', 'open'].includes(action)) return send(res, 403, { error: 'This complaint action is not allowed.' });
    const { error } = await admin.from('complaints').update({ status: action, updated_at: new Date().toISOString() }).eq('id', complaintId).eq('school_id', schoolId);
    if (error) throw error;
    return send(res, 200, { updated: true });
  } catch (error) { console.error('Complaint request failed:', error.message || error); return send(res, 500, { error: 'Could not complete the complaint request.' }); }
};
