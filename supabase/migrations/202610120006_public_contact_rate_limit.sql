create table public.public_contact_rate_limits (
  ip_hash text primary key, window_started_at timestamptz not null default now(), request_count integer not null default 0
);
revoke all on public.public_contact_rate_limits from public,anon,authenticated;

create or replace function public.consume_public_contact_request(target_ip_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  current_row public.public_contact_rate_limits%rowtype;
begin
  insert into public.public_contact_rate_limits(ip_hash,window_started_at,request_count)
    values (target_ip_hash,now(),1) on conflict (ip_hash) do nothing;
  select * into current_row from public.public_contact_rate_limits where ip_hash=target_ip_hash for update;
  if current_row.window_started_at < now()-interval '1 hour' then
    update public.public_contact_rate_limits set window_started_at=now(),request_count=1 where ip_hash=target_ip_hash;
    return true;
  end if;
  if current_row.request_count >= 5 then return false; end if;
  update public.public_contact_rate_limits set request_count=request_count+1 where ip_hash=target_ip_hash;
  return true;
end;
$$;
revoke all on function public.consume_public_contact_request(text) from public,anon,authenticated;
grant execute on function public.consume_public_contact_request(text) to service_role;
