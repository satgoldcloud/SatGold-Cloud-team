-- Guard against duplicate teaching assignments. Class arm may be NULL for whole-class assignments.
create unique index teacher_assignments_unique_scope on public.teacher_assignments (
  school_id, staff_id, class_id, coalesce(class_arm_id, '00000000-0000-0000-0000-000000000000'::uuid), subject_id, academic_session_id
);

-- Store allowances separately while keeping gross as the full amount used in net calculations.
alter table public.payroll_items add column allowances numeric(12,2) not null default 0 check (allowances >= 0);
create index timetable_school_weekday_idx on public.timetable_entries(school_id, weekday, starts_at, ends_at);
create index complaints_school_status_idx on public.complaints(school_id, status, updated_at desc);
create index notification_school_user_date_idx on public.notifications(school_id, user_id, created_at desc);
create index payroll_school_period_idx on public.payroll_items(school_id, payroll_period_id);
