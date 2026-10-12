-- Initial multi-tenant foundation. Authentication is managed by Supabase Auth.
create extension if not exists pgcrypto;

create type public.school_role as enum ('owner', 'admin', 'teacher', 'staff', 'student', 'parent');
create type public.platform_role as enum ('user', 'super_admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  platform_role public.platform_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended', 'archived')),
  timezone text not null default 'Africa/Lagos',
  contact_email text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.school_memberships (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.school_role not null,
  status text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  unique (school_id, user_id)
);

create index school_memberships_user_idx on public.school_memberships(user_id, school_id);
create index schools_status_idx on public.schools(status);

create or replace function public.is_school_member(target_school uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.school_memberships m
    where m.school_id = target_school and m.user_id = (select auth.uid()) and m.status = 'active'
  );
$$;

create or replace function public.has_school_role(target_school uuid, allowed_roles public.school_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.school_memberships m
    where m.school_id = target_school and m.user_id = (select auth.uid())
      and m.status = 'active' and m.role = any(allowed_roles)
  );
$$;

alter table public.profiles enable row level security;
alter table public.schools enable row level security;
alter table public.school_memberships enable row level security;

create policy "Users can read their own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
create policy "Users can update their own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "Members can read their schools" on public.schools
  for select to authenticated using (public.is_school_member(id));
grant select on public.schools to authenticated;
grant update (name, slug, timezone, contact_email) on public.schools to authenticated;
create policy "Owners and admins can update school profile" on public.schools
  for update to authenticated using (public.has_school_role(id, array['owner','admin']::public.school_role[]))
  with check (public.has_school_role(id, array['owner','admin']::public.school_role[]));

create policy "Members can read school memberships" on public.school_memberships
  for select to authenticated using (public.is_school_member(school_id));
-- Membership writes are intentionally reserved for protected server operations.

-- New identities receive a profile. School creation and initial owner membership
-- will be provisioned by a protected server endpoint in the next implementation phase.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();
