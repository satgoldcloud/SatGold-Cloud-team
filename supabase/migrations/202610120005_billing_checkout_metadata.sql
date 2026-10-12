alter table public.payment_transactions add column requested_plan_id text references public.subscription_plans(id);
alter table public.payment_transactions add column requested_billing_period text check (requested_billing_period in ('monthly','annual'));
create index payment_transactions_school_created_idx on public.payment_transactions(school_id,created_at desc);

-- Activation is atomic and idempotent. A callback and webhook may arrive for the
-- same successful payment; the payment row lock prevents a duplicate renewal.
create or replace function public.activate_subscription_payment(
  target_payment uuid, verified_transaction_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  payment_row public.payment_transactions%rowtype;
  end_at timestamptz;
  started_at timestamptz := now();
begin
  select * into payment_row from public.payment_transactions where id=target_payment for update;
  if not found then raise exception 'Payment not found'; end if;
  if payment_row.status='succeeded' then
    select current_period_end into end_at from public.school_subscriptions where id=payment_row.subscription_id and school_id=payment_row.school_id;
    return jsonb_build_object('status','active','currentPeriodEnd',end_at,'duplicate',true);
  end if;
  if payment_row.status <> 'pending' or payment_row.requested_plan_id is null or payment_row.requested_billing_period is null then
    raise exception 'Payment is not eligible for activation';
  end if;
  end_at := started_at + case when payment_row.requested_billing_period='annual' then interval '1 year' else interval '1 month' end;
  update public.payment_transactions set status='succeeded',provider_transaction_id=verified_transaction_id,verified_at=started_at where id=payment_row.id;
  update public.school_subscriptions set plan_id=payment_row.requested_plan_id,billing_period=payment_row.requested_billing_period,
    status='active',trial_ends_at=null,current_period_start=started_at,current_period_end=end_at,updated_at=started_at
    where id=payment_row.subscription_id and school_id=payment_row.school_id;
  if not found then raise exception 'Subscription not found'; end if;
  insert into public.audit_logs (school_id,action,entity_type,entity_id,metadata)
    values (payment_row.school_id,'subscription.payment_verified','payment',payment_row.id::text,
      jsonb_build_object('provider',payment_row.provider,'reference',payment_row.reference,'amount',payment_row.amount,'currency',payment_row.currency));
  return jsonb_build_object('status','active','currentPeriodEnd',end_at,'duplicate',false);
end;
$$;
revoke all on function public.activate_subscription_payment(uuid,text) from public,anon,authenticated;
grant execute on function public.activate_subscription_payment(uuid,text) to service_role;

create table public.ai_usage_records (
  id bigint generated always as identity primary key, school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade, model text not null,
  created_at timestamptz not null default now()
);
create index ai_usage_school_month_idx on public.ai_usage_records(school_id,created_at desc);
alter table public.ai_usage_records enable row level security;
create policy "School admins read AI usage" on public.ai_usage_records for select to authenticated
using (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
revoke insert, update, delete on public.ai_usage_records from anon,authenticated;

create or replace function public.consume_school_ai_request(target_school uuid,target_user uuid,target_model text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  usage_limit integer;
  used_count integer;
begin
  perform pg_advisory_xact_lock(hashtext(target_school::text),hashtext(date_trunc('month',now())::text));
  select coalesce((p.entitlements->>'ai_requests_monthly')::integer,0) into usage_limit
    from public.school_subscriptions s join public.subscription_plans p on p.id=s.plan_id
    where s.school_id=target_school and (s.status='active' or (s.status='trialing' and s.trial_ends_at>now()))
    order by s.created_at desc limit 1;
  if usage_limit is null or usage_limit <= 0 then raise exception 'AI is not enabled for this subscription'; end if;
  select count(*)::integer into used_count from public.ai_usage_records u
    where u.school_id=target_school and u.created_at >= date_trunc('month',now());
  if used_count >= usage_limit then raise exception 'Monthly AI request limit reached'; end if;
  insert into public.ai_usage_records(school_id,user_id,model) values (target_school,target_user,target_model);
  return used_count+1;
end;
$$;
revoke all on function public.consume_school_ai_request(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.consume_school_ai_request(uuid,uuid,text) to service_role;
