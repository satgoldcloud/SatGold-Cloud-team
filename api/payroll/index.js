import { send, method } from '../_lib/http.js';
import { requireUser, requireSchoolRole } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';

const money = (v) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1000000000 && Math.round(Number(v) * 100) === Number(v) * 100;
export default async (req, res) => {
  if (!method(req, res, ['GET', 'POST', 'PATCH'])) return;
  const auth = await requireUser(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });
  const schoolId = String(req.query.schoolId || req.body?.schoolId || '');
  if (!/^[0-9a-f-]{36}$/i.test(schoolId)) return send(res, 400, { error: 'A valid school ID is required.' });
  try {
    const membership = await requireSchoolRole(auth.user.id, schoolId);
    if (!membership) return send(res, 403, { error: 'You do not have access to this school.' });
    const admin = getSupabaseAdmin(), canManage = ['owner', 'admin'].includes(membership.role);
    if (req.method === 'GET') {
      if (!canManage && !['teacher', 'staff'].includes(membership.role)) return send(res, 403, { error: 'Payroll access is restricted.' });
      let q = admin.from('payroll_items').select('id,payroll_period_id,staff_id,gross,allowances,deductions,net,payment_status,payroll_periods(period_start,period_end,status),staff_profiles!inner(first_name,last_name,staff_number,user_id)').eq('school_id', schoolId).order('id', { ascending: false }).limit(500);
      if (!canManage) q = q.eq('staff_profiles.user_id', auth.user.id);
      else if (!['owner', 'admin'].includes(membership.role) && membership.role !== 'staff') return send(res, 403, { error: 'Payroll access is restricted.' });
      const { data, error } = await q;
      if (error) throw error;
      return send(res, 200, { payroll: data || [] });
    }
    if (!canManage) return send(res, 403, { error: 'Only school owners and administrators can manage payroll.' });
    if (req.method === 'POST') {
      const start = String(req.body?.periodStart || ''), end = String(req.body?.periodEnd || ''), items = req.body?.items;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start || !Array.isArray(items) || !items.length || items.length > 1000) return send(res, 400, { error: 'Choose a valid payroll period and at least one staff salary.' });
      const { data: period, error: periodError } = await admin.from('payroll_periods').insert({ school_id: schoolId, period_start: start, period_end: end }).select('id').single();
      if (periodError) return send(res, 409, { error: 'Could not create this payroll period. Check for an existing period with those dates.' });
      const staffIds = [...new Set(items.map((item) => String(item.staffId || '')))];
      if (staffIds.length !== items.length || staffIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id)) || items.some((item) => !money(item.gross) || !money(item.allowances || 0) || !money(item.deductions || 0) || Number(item.deductions) > Number(item.gross) + Number(item.allowances || 0))) {
        await admin.from('payroll_periods').delete().eq('id', period.id); return send(res, 400, { error: 'Payroll amounts or staff records are invalid.' });
      }
      const { data: staff, error: staffError } = await admin.from('staff_profiles').select('id').eq('school_id', schoolId).eq('status', 'active').in('id', staffIds);
      if (staffError || staff?.length !== staffIds.length) { await admin.from('payroll_periods').delete().eq('id', period.id); return send(res, 400, { error: 'One or more staff members are not active in this school.' }); }
      const rows = items.map((item) => {
        const baseCents = Math.round(Number(item.gross) * 100), allowanceCents = Math.round(Number(item.allowances || 0) * 100), deductionsCents = Math.round(Number(item.deductions) * 100), grossCents = baseCents + allowanceCents;
        return { school_id: schoolId, payroll_period_id: period.id, staff_id: item.staffId, gross: (baseCents / 100).toFixed(2), allowances: (allowanceCents / 100).toFixed(2), deductions: (deductionsCents / 100).toFixed(2), net: ((grossCents - deductionsCents) / 100).toFixed(2) };
      });
      const { error: itemError } = await admin.from('payroll_items').insert(rows);
      if (itemError) { await admin.from('payroll_periods').delete().eq('id', period.id); throw itemError; }
      await admin.from('audit_logs').insert({ school_id: schoolId, actor_id: auth.user.id, action: 'payroll.created', entity_type: 'payroll_period', entity_id: period.id, metadata: { items: rows.length } });
      return send(res, 201, { periodId: period.id, items: rows.length });
    }
    const periodId = String(req.body?.periodId || ''), action = String(req.body?.action || '');
    if (!/^[0-9a-f-]{36}$/i.test(periodId) || !['approve', 'cancel', 'paid'].includes(action)) return send(res, 400, { error: 'A valid payroll action is required.' });
    const { data: period, error: findError } = await admin.from('payroll_periods').select('id,status').eq('id', periodId).eq('school_id', schoolId).maybeSingle();
    if (findError) throw findError;
    if (!period || (action === 'approve' && period.status !== 'draft') || (action === 'paid' && period.status !== 'approved') || (action === 'cancel' && ['paid', 'cancelled'].includes(period.status))) return send(res, 409, { error: 'This payroll period cannot take that action.' });
    const updates = action === 'approve' ? { status: 'approved', approved_by: auth.user.id } : { status: action === 'cancel' ? 'cancelled' : 'paid' };
    const { error } = await admin.from('payroll_periods').update(updates).eq('id', periodId).eq('school_id', schoolId);
    if (error) throw error;
    if (action === 'paid') await admin.from('payroll_items').update({ payment_status: 'recorded' }).eq('payroll_period_id', periodId).eq('school_id', schoolId);
    await admin.from('audit_logs').insert({ school_id: schoolId, actor_id: auth.user.id, action: `payroll.${action}`, entity_type: 'payroll_period', entity_id: periodId, reason: action === 'paid' ? 'Payment recorded manually; no transfer was initiated.' : null });
    return send(res, 200, { updated: true, message: action === 'paid' ? 'Payment status recorded manually; this did not initiate or verify a bank transfer.' : undefined });
  } catch (error) { console.error('Payroll request failed:', error.message || error); return send(res, 500, { error: 'Could not complete the payroll request.' }); }
};
