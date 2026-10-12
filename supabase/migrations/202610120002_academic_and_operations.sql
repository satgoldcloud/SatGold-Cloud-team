-- School operations and academic records. Every private record belongs to one school.
create table public.school_settings (
  school_id uuid primary key references public.schools(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.school_classes (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  name text not null, level text, sort_order integer not null default 0, created_at timestamptz not null default now(),
  unique (school_id, name), unique (id, school_id)
);
create table public.class_arms (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null, name text not null, created_at timestamptz not null default now(),
  foreign key (class_id, school_id) references public.school_classes(id, school_id) on delete cascade,
  unique (class_id, name), unique (id, school_id)
);
create table public.subjects (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  name text not null, code text, created_at timestamptz not null default now(), unique (school_id, name), unique (id, school_id)
);
create table public.academic_sessions (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  name text not null, starts_on date not null, ends_on date not null, is_current boolean not null default false,
  created_at timestamptz not null default now(), check (ends_on >= starts_on), unique (school_id, name), unique (id, school_id)
);
create unique index academic_one_current_session on public.academic_sessions(school_id) where is_current;

create table public.staff_profiles (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null, staff_number text not null, first_name text not null,
  last_name text not null, job_title text, staff_type text not null default 'teaching' check (staff_type in ('teaching','non_teaching')),
  status text not null default 'active' check (status in ('active','inactive','suspended')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (school_id, staff_number), unique (id, school_id)
);
create table public.student_profiles (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null, student_number text not null,
  first_name text not null, last_name text not null, other_names text, class_id uuid, class_arm_id uuid,
  academic_session_id uuid, date_of_birth date, status text not null default 'active' check (status in ('active','inactive','graduated','suspended')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (class_id, school_id) references public.school_classes(id, school_id) on delete restrict,
  foreign key (class_arm_id, school_id) references public.class_arms(id, school_id) on delete restrict,
  foreign key (academic_session_id, school_id) references public.academic_sessions(id, school_id) on delete restrict,
  unique (school_id, student_number), unique (id, school_id)
);
create index student_class_idx on public.student_profiles(school_id, class_id, class_arm_id);
create index student_user_idx on public.student_profiles(user_id) where user_id is not null;

create table public.guardian_profiles (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade, first_name text not null, last_name text not null,
  phone text, created_at timestamptz not null default now(), unique (school_id, user_id), unique (id, school_id)
);
create table public.student_guardians (
  school_id uuid not null references public.schools(id) on delete cascade, student_id uuid not null,
  guardian_id uuid not null, relationship text, is_primary boolean not null default false,
  created_at timestamptz not null default now(), primary key (student_id, guardian_id),
  foreign key (student_id, school_id) references public.student_profiles(id, school_id) on delete cascade,
  foreign key (guardian_id, school_id) references public.guardian_profiles(id, school_id) on delete cascade
);

create or replace function public.can_access_student(target_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.student_profiles s where s.id = target_student and s.user_id = (select auth.uid()))
  or exists (
    select 1 from public.student_guardians sg join public.guardian_profiles g on g.id = sg.guardian_id and g.school_id = sg.school_id
    where sg.student_id = target_student and g.user_id = (select auth.uid())
  );
$$;

create table public.teacher_assignments (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  staff_id uuid not null, class_id uuid not null, class_arm_id uuid, subject_id uuid not null, academic_session_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (staff_id, school_id) references public.staff_profiles(id, school_id) on delete cascade,
  foreign key (class_id, school_id) references public.school_classes(id, school_id) on delete cascade,
  foreign key (class_arm_id, school_id) references public.class_arms(id, school_id) on delete cascade,
  foreign key (subject_id, school_id) references public.subjects(id, school_id) on delete cascade,
  foreign key (academic_session_id, school_id) references public.academic_sessions(id, school_id) on delete cascade,
  unique (id, school_id)
);
create table public.timetable_entries (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  teacher_assignment_id uuid not null, weekday smallint not null check (weekday between 1 and 7),
  starts_at time not null, ends_at time not null, room text,
  foreign key (teacher_assignment_id, school_id) references public.teacher_assignments(id, school_id) on delete cascade,
  check (ends_at > starts_at), unique (teacher_assignment_id, weekday, starts_at)
);
create table public.attendance_records (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null, recorded_by uuid not null references public.profiles(id), attendance_date date not null,
  status text not null check (status in ('present','absent','late','excused')), note text,
  created_at timestamptz not null default now(),
  foreign key (student_id, school_id) references public.student_profiles(id, school_id) on delete cascade,
  unique (student_id, attendance_date)
);

create table public.lesson_notes (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  teacher_assignment_id uuid not null, title text not null, content text not null, status text not null default 'draft' check (status in ('draft','submitted','approved','published','returned')),
  submitted_at timestamptz, reviewed_by uuid references public.profiles(id), reviewed_at timestamptz,
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (teacher_assignment_id, school_id) references public.teacher_assignments(id, school_id) on delete cascade
);
create table public.assignments (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  teacher_assignment_id uuid not null, title text not null, instructions text not null, due_at timestamptz,
  status text not null default 'draft' check (status in ('draft','published','closed')),
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  foreign key (teacher_assignment_id, school_id) references public.teacher_assignments(id, school_id) on delete cascade
);
create table public.assignment_submissions (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  assignment_id uuid not null, student_id uuid not null, answer_text text, attachment_path text,
  submitted_at timestamptz not null default now(), score numeric(8,2), feedback text,
  graded_by uuid references public.profiles(id), graded_at timestamptz,
  foreign key (assignment_id) references public.assignments(id) on delete cascade,
  foreign key (student_id, school_id) references public.student_profiles(id, school_id) on delete cascade,
  unique (assignment_id, student_id)
);

create table public.assessments (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  teacher_assignment_id uuid not null, academic_session_id uuid not null, term text not null, title text not null,
  category text not null, max_score numeric(8,2) not null check (max_score > 0), weight numeric(6,3) not null default 1 check (weight > 0),
  status text not null default 'draft' check (status in ('draft','submitted','approved','published','returned')),
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  foreign key (teacher_assignment_id, school_id) references public.teacher_assignments(id, school_id) on delete cascade,
  foreign key (academic_session_id, school_id) references public.academic_sessions(id, school_id) on delete cascade,
  unique (id, school_id)
);
create table public.assessment_scores (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  assessment_id uuid not null, student_id uuid not null, score numeric(8,2) not null check (score >= 0),
  feedback text, recorded_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  foreign key (assessment_id, school_id) references public.assessments(id, school_id) on delete cascade,
  foreign key (student_id, school_id) references public.student_profiles(id, school_id) on delete cascade,
  unique (assessment_id, student_id)
);
create table public.grading_scales (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  label text not null, min_percent numeric(5,2) not null check (min_percent between 0 and 100),
  max_percent numeric(5,2) not null check (max_percent between 0 and 100), remark text,
  created_at timestamptz not null default now(), check (max_percent >= min_percent), unique (school_id, label)
);
create table public.report_drafts (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null, academic_session_id uuid not null, term text not null, payload jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','submitted','returned','approved','published')),
  teacher_id uuid not null references public.profiles(id), reviewed_by uuid references public.profiles(id), review_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (student_id, school_id) references public.student_profiles(id, school_id) on delete cascade,
  foreign key (academic_session_id, school_id) references public.academic_sessions(id, school_id) on delete cascade,
  unique (student_id, academic_session_id, term)
);
create table public.report_revisions (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  report_id uuid not null references public.report_drafts(id) on delete cascade, version integer not null,
  payload jsonb not null, changed_by uuid not null references public.profiles(id), reason text,
  created_at timestamptz not null default now(), unique (report_id, version)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(), school_id uuid references public.schools(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade, title text not null, body text not null,
  link text, read_at timestamptz, created_at timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications(user_id, created_at desc) where read_at is null;
create table public.complaints (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  opened_by uuid not null references public.profiles(id), subject text not null, status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  assigned_to uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (id, school_id)
);
create table public.complaint_messages (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  complaint_id uuid not null, author_id uuid not null references public.profiles(id), body text not null,
  created_at timestamptz not null default now(),
  foreign key (complaint_id, school_id) references public.complaints(id, school_id) on delete cascade
);
create table public.audit_logs (
  id bigint generated always as identity primary key, school_id uuid references public.schools(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null, action text not null, entity_type text not null,
  entity_id text, reason text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index audit_logs_school_date_idx on public.audit_logs(school_id, created_at desc);

create table public.salary_structures (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  staff_id uuid not null, base_salary numeric(12,2) not null check (base_salary >= 0), currency text not null default 'NGN',
  effective_from date not null, created_at timestamptz not null default now(),
  foreign key (staff_id, school_id) references public.staff_profiles(id, school_id) on delete cascade
);
create table public.payroll_periods (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  period_start date not null, period_end date not null, status text not null default 'draft' check (status in ('draft','approved','paid','cancelled')),
  approved_by uuid references public.profiles(id), created_at timestamptz not null default now(),
  check (period_end >= period_start), unique (school_id, period_start, period_end), unique (id, school_id)
);
create table public.payroll_items (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  payroll_period_id uuid not null, staff_id uuid not null, gross numeric(12,2) not null check (gross >= 0),
  deductions numeric(12,2) not null default 0 check (deductions >= 0), net numeric(12,2) not null check (net >= 0),
  payment_status text not null default 'pending' check (payment_status in ('pending','recorded','failed')),
  foreign key (payroll_period_id, school_id) references public.payroll_periods(id, school_id) on delete cascade,
  foreign key (staff_id, school_id) references public.staff_profiles(id, school_id) on delete cascade,
  unique (payroll_period_id, staff_id)
);

create table public.subscription_plans (
  id text primary key, name text not null, monthly_price numeric(12,2), annual_price numeric(12,2),
  currency text not null default 'NGN', trial_days integer not null default 30 check (trial_days >= 0),
  entitlements jsonb not null default '{}'::jsonb, enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
insert into public.subscription_plans (id,name,monthly_price,annual_price,entitlements) values
 ('starter','Starter',20000,null,'{}'::jsonb),
 ('premium','Premium',50000,null,'{}'::jsonb),
 ('custom','Custom',null,null,'{"custom":true}'::jsonb)
on conflict (id) do nothing;
create table public.school_subscriptions (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  plan_id text not null references public.subscription_plans(id), billing_period text not null default 'monthly' check (billing_period in ('monthly','annual')),
  status text not null default 'trialing' check (status in ('trialing','active','past_due','cancelled','expired')),
  trial_ends_at timestamptz, current_period_start timestamptz, current_period_end timestamptz,
  cancel_at_period_end boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, school_id)
);
create unique index one_current_subscription_per_school on public.school_subscriptions(school_id) where status in ('trialing','active','past_due');
create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  subscription_id uuid, provider text not null check (provider in ('paystack','flutterwave')),
  reference text not null unique, amount numeric(12,2) not null check (amount >= 0), currency text not null default 'NGN',
  status text not null default 'pending' check (status in ('pending','succeeded','failed','refunded')),
  provider_transaction_id text, verified_at timestamptz, created_at timestamptz not null default now(),
  foreign key (subscription_id, school_id) references public.school_subscriptions(id, school_id) on delete restrict
);
create table public.webhook_events (
  id bigint generated always as identity primary key, provider text not null, event_id text not null, received_at timestamptz not null default now(),
  processed_at timestamptz, status text not null default 'received', unique (provider, event_id)
);

-- Every table with school_id has RLS. Members can see only their own school's rows;
-- higher-risk categories apply narrower role and ownership policies below.
alter table public.school_settings enable row level security;
alter table public.school_classes enable row level security;
alter table public.class_arms enable row level security;
alter table public.subjects enable row level security;
alter table public.academic_sessions enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.student_profiles enable row level security;
alter table public.guardian_profiles enable row level security;
alter table public.student_guardians enable row level security;
alter table public.teacher_assignments enable row level security;
alter table public.timetable_entries enable row level security;
alter table public.attendance_records enable row level security;
alter table public.lesson_notes enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_scores enable row level security;
alter table public.grading_scales enable row level security;
alter table public.report_drafts enable row level security;
alter table public.report_revisions enable row level security;
alter table public.notifications enable row level security;
alter table public.complaints enable row level security;
alter table public.complaint_messages enable row level security;
alter table public.audit_logs enable row level security;
alter table public.salary_structures enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payroll_items enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.school_subscriptions enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.webhook_events enable row level security;

-- Basic school setup and teaching records are available to authenticated members;
-- writes are restricted to appropriate roles. All writes still require school membership.
create policy "Members read school settings" on public.school_settings for select to authenticated using (public.is_school_member(school_id));
create policy "Admins manage school settings" on public.school_settings for all to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Members read classes" on public.school_classes for select to authenticated using (public.is_school_member(school_id));
create policy "Admins manage classes" on public.school_classes for all to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Members read class arms" on public.class_arms for select to authenticated using (public.is_school_member(school_id));
create policy "Admins manage class arms" on public.class_arms for all to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Members read subjects" on public.subjects for select to authenticated using (public.is_school_member(school_id));
create policy "Admins manage subjects" on public.subjects for all to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Members read academic sessions" on public.academic_sessions for select to authenticated using (public.is_school_member(school_id));
create policy "Admins manage academic sessions" on public.academic_sessions for all to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Admins and teachers read staff" on public.staff_profiles for select to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher','staff']::public.school_role[]) or user_id=(select auth.uid()));
create policy "Admins manage staff" on public.staff_profiles for all to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Authorized users read students" on public.student_profiles for select to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher','staff']::public.school_role[]) or public.can_access_student(id));
create policy "Admins manage students" on public.student_profiles for all to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Guardian reads own linked profile" on public.guardian_profiles for select to authenticated using (user_id=(select auth.uid()) or public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Admins manage guardian links" on public.guardian_profiles for all to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Student guardian reads authorized links" on public.student_guardians for select to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher','staff']::public.school_role[]) or public.can_access_student(student_id));
create policy "Admins manage student guardians" on public.student_guardians for all to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Members read assignments" on public.teacher_assignments for select to authenticated using (public.is_school_member(school_id));
create policy "Admins manage assignments" on public.teacher_assignments for all to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Members read timetables" on public.timetable_entries for select to authenticated using (public.is_school_member(school_id));
create policy "Admins manage timetables" on public.timetable_entries for all to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Authorized attendance read" on public.attendance_records for select to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher','staff']::public.school_role[]) or public.can_access_student(student_id));
create policy "Staff record attendance" on public.attendance_records for insert to authenticated with check (public.has_school_role(school_id,array['owner','admin','teacher','staff']::public.school_role[]) and recorded_by=(select auth.uid()));
create policy "Admins update attendance" on public.attendance_records for update to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Lesson notes read by members" on public.lesson_notes for select to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher','staff']::public.school_role[]) or (status='published' and public.is_school_member(school_id)));
create policy "Teachers author lesson notes" on public.lesson_notes for insert to authenticated with check (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]) and created_by=(select auth.uid()));
create policy "Teachers update lesson notes" on public.lesson_notes for update to authenticated using (created_by=(select auth.uid()) or public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
create policy "Published assignments readable by members" on public.assignments for select to authenticated using (public.is_school_member(school_id));
create policy "Teachers create assignments" on public.assignments for insert to authenticated with check (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]) and created_by=(select auth.uid()));
create policy "Teachers update assignments" on public.assignments for update to authenticated using (created_by=(select auth.uid()) or public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
create policy "Student or teacher reads submissions" on public.assignment_submissions for select to authenticated using (public.can_access_student(student_id) or public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
create policy "Linked student submits" on public.assignment_submissions for insert to authenticated with check (public.can_access_student(student_id));
create policy "Teacher grades submissions" on public.assignment_submissions for update to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
create policy "Members read assessments" on public.assessments for select to authenticated using (public.is_school_member(school_id));
create policy "Teachers manage assessments" on public.assessments for all to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
create policy "Authorized read scores" on public.assessment_scores for select to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher','staff']::public.school_role[]) or public.can_access_student(student_id));
create policy "Teachers record scores" on public.assessment_scores for all to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
create policy "Members read grading scales" on public.grading_scales for select to authenticated using (public.is_school_member(school_id));
create policy "Admins manage grading scales" on public.grading_scales for all to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Authorized read reports" on public.report_drafts for select to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher','staff']::public.school_role[]) or (status='published' and public.can_access_student(student_id)));
create policy "Teachers create reports" on public.report_drafts for insert to authenticated with check (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]) and teacher_id=(select auth.uid()));
create policy "Teachers and admins update reports" on public.report_drafts for update to authenticated using (teacher_id=(select auth.uid()) or public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
create policy "Authorized read report revisions" on public.report_revisions for select to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
create policy "Admins create report revisions" on public.report_revisions for insert to authenticated with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]) and changed_by=(select auth.uid()));
create policy "Users read own notifications" on public.notifications for select to authenticated using (user_id=(select auth.uid()));
create policy "Users update own notifications" on public.notifications for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy "Complaint participants read" on public.complaints for select to authenticated using (opened_by=(select auth.uid()) or assigned_to=(select auth.uid()) or public.has_school_role(school_id,array['owner','admin','staff']::public.school_role[]));
create policy "Members open complaints" on public.complaints for insert to authenticated with check (public.is_school_member(school_id) and opened_by=(select auth.uid()));
create policy "Authorized staff update complaints" on public.complaints for update to authenticated using (assigned_to=(select auth.uid()) or public.has_school_role(school_id,array['owner','admin','staff']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin','staff']::public.school_role[]));
create policy "Complaint participants read messages" on public.complaint_messages for select to authenticated using (exists (select 1 from public.complaints c where c.id=complaint_id and c.school_id=school_id and (c.opened_by=(select auth.uid()) or c.assigned_to=(select auth.uid()) or public.has_school_role(c.school_id,array['owner','admin','staff']::public.school_role[]))));
create policy "Complaint participants send messages" on public.complaint_messages for insert to authenticated with check (author_id=(select auth.uid()) and exists (select 1 from public.complaints c where c.id=complaint_id and c.school_id=school_id and (c.opened_by=(select auth.uid()) or c.assigned_to=(select auth.uid()) or public.has_school_role(c.school_id,array['owner','admin','staff']::public.school_role[]))));
create policy "Admins read audit logs" on public.audit_logs for select to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Employees read own salary" on public.salary_structures for select to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[]) or exists (select 1 from public.staff_profiles s where s.id=staff_id and s.user_id=(select auth.uid())));
create policy "Admins manage salary" on public.salary_structures for all to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Admins manage payroll periods" on public.payroll_periods for all to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Admins or employee read payroll item" on public.payroll_items for select to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[]) or exists (select 1 from public.staff_profiles s where s.id=staff_id and s.user_id=(select auth.uid())));
create policy "Admins manage payroll items" on public.payroll_items for all to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Public can read enabled plans" on public.subscription_plans for select to anon,authenticated using (enabled);
create policy "School admins read subscriptions" on public.school_subscriptions for select to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "School admins read payments" on public.payment_transactions for select to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));

-- Do not allow browser-side table access to billing, audits, webhook events or payroll writes.
revoke all on public.webhook_events from anon, authenticated;
revoke insert, update, delete on public.audit_logs from anon, authenticated;
revoke insert, update, delete on public.school_subscriptions, public.payment_transactions from anon, authenticated;
revoke insert, update, delete on public.payroll_items, public.payroll_periods from anon, authenticated;


