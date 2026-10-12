-- CBT, public school pages, revision history and school scoped file storage.
alter table public.assignments add constraint assignments_id_school_unique unique (id, school_id);
alter table public.assignment_submissions drop constraint assignment_submissions_assignment_id_fkey;
alter table public.assignment_submissions add constraint assignment_submission_school_assignment_fk
  foreign key (assignment_id, school_id) references public.assignments(id, school_id) on delete cascade;

create table public.lesson_note_revisions (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  lesson_note_id uuid not null references public.lesson_notes(id) on delete cascade,
  version integer not null, title text not null, content text not null, changed_by uuid not null references public.profiles(id),
  reason text, created_at timestamptz not null default now(), unique (lesson_note_id, version)
);

create table public.school_public_pages (
  id uuid primary key default gen_random_uuid(), school_id uuid not null unique references public.schools(id) on delete cascade,
  slug text not null unique, page_data jsonb not null default '{}'::jsonb, seo_title text, seo_description text,
  published boolean not null default false, updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.question_banks (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  name text not null, subject_id uuid, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  foreign key (subject_id, school_id) references public.subjects(id, school_id) on delete restrict,
  unique (id, school_id)
);
create table public.questions (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  bank_id uuid not null, question_type text not null check (question_type in ('multiple_choice','true_false','short_answer','essay')),
  prompt text not null, options jsonb not null default '[]'::jsonb, correct_answer jsonb,
  marks numeric(8,2) not null default 1 check (marks > 0), explanation text,
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  foreign key (bank_id, school_id) references public.question_banks(id, school_id) on delete cascade,
  unique (id, school_id)
);
create table public.examinations (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  teacher_assignment_id uuid not null, title text not null, instructions text, starts_at timestamptz not null, ends_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0), max_attempts integer not null default 1 check (max_attempts > 0),
  randomize_questions boolean not null default false, status text not null default 'draft' check (status in ('draft','published','closed')),
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  foreign key (teacher_assignment_id, school_id) references public.teacher_assignments(id, school_id) on delete cascade,
  check (ends_at > starts_at), unique (id, school_id)
);
create table public.examination_questions (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  examination_id uuid not null, question_id uuid not null, position integer not null, marks numeric(8,2) not null check (marks > 0),
  foreign key (examination_id, school_id) references public.examinations(id, school_id) on delete cascade,
  foreign key (question_id, school_id) references public.questions(id, school_id) on delete restrict,
  unique (examination_id, question_id), unique (examination_id, position), unique (id, school_id)
);
create table public.examination_attempts (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  examination_id uuid not null, student_id uuid not null, attempt_number integer not null,
  started_at timestamptz not null default now(), expires_at timestamptz not null, submitted_at timestamptz,
  status text not null default 'in_progress' check (status in ('in_progress','submitted','expired','marked')),
  objective_score numeric(8,2), manual_score numeric(8,2), reviewed_by uuid references public.profiles(id),
  foreign key (examination_id, school_id) references public.examinations(id, school_id) on delete cascade,
  foreign key (student_id, school_id) references public.student_profiles(id, school_id) on delete cascade,
  unique (examination_id, student_id, attempt_number), unique (id, school_id)
);
create table public.examination_answers (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  attempt_id uuid not null, examination_question_id uuid not null, answer jsonb,
  is_correct boolean, score numeric(8,2), feedback text, saved_at timestamptz not null default now(),
  foreign key (attempt_id, school_id) references public.examination_attempts(id, school_id) on delete cascade,
  foreign key (examination_question_id, school_id) references public.examination_questions(id, school_id) on delete cascade,
  unique (attempt_id, examination_question_id)
);

create or replace function public.can_access_school_user(target_school uuid, target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select target_user=(select auth.uid()) or public.has_school_role(target_school,array['owner','admin']::public.school_role[])
  or exists (
    select 1 from public.student_profiles s where s.school_id=target_school and s.user_id=target_user
      and public.can_access_student(s.id)
  );
$$;

alter table public.lesson_note_revisions enable row level security;
alter table public.school_public_pages enable row level security;
alter table public.question_banks enable row level security;
alter table public.questions enable row level security;
alter table public.examinations enable row level security;
alter table public.examination_questions enable row level security;
alter table public.examination_attempts enable row level security;
alter table public.examination_answers enable row level security;

create or replace function public.can_access_assignment(target_assignment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.teacher_assignments ta
    join public.staff_profiles sp on sp.id=ta.staff_id and sp.school_id=ta.school_id
    where ta.id=target_assignment and (
      public.has_school_role(ta.school_id,array['owner','admin']::public.school_role[])
      or sp.user_id=(select auth.uid())
      or exists (
        select 1 from public.student_profiles st where st.school_id=ta.school_id
          and st.class_id=ta.class_id and (ta.class_arm_id is null or st.class_arm_id=ta.class_arm_id)
          and public.can_access_student(st.id)
      )
    )
  );
$$;

drop policy "Published assignments readable by members" on public.assignments;
create policy "Class and staff read assignments" on public.assignments for select to authenticated using (public.can_access_assignment(teacher_assignment_id) or public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
drop policy "Lesson notes read by members" on public.lesson_notes;
create policy "Class and staff read lesson notes" on public.lesson_notes for select to authenticated using ((status='published' and public.can_access_assignment(teacher_assignment_id)) or public.has_school_role(school_id,array['owner','admin','teacher','staff']::public.school_role[]));
drop policy "Members read published examinations" on public.examinations;
create policy "Eligible users read published examinations" on public.examinations for select to authenticated using ((status='published' and public.can_access_assignment(teacher_assignment_id)) or public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));

create policy "School members read lesson revisions" on public.lesson_note_revisions for select to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher','staff']::public.school_role[]));
create policy "Teachers write lesson revisions" on public.lesson_note_revisions for insert to authenticated with check (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]) and changed_by=(select auth.uid()));
create policy "Published school pages are public" on public.school_public_pages for select to anon,authenticated using (published or public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Admins edit school page" on public.school_public_pages for all to authenticated using (public.has_school_role(school_id,array['owner','admin']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Staff read question banks" on public.question_banks for select to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
create policy "Teachers manage question banks" on public.question_banks for all to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
create policy "Staff read questions" on public.questions for select to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
create policy "Teachers manage questions" on public.questions for all to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
create policy "Members read published examinations" on public.examinations for select to authenticated using (public.is_school_member(school_id) and (status='published' or public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[])));
create policy "Teachers manage examinations" on public.examinations for all to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
create policy "No direct examination question reads" on public.examination_questions for select to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
create policy "Teachers manage examination questions" on public.examination_questions for all to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
create policy "Students and staff read attempts" on public.examination_attempts for select to authenticated using (public.can_access_student(student_id) or public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
create policy "Students create own attempts" on public.examination_attempts for insert to authenticated with check (public.can_access_student(student_id));
create policy "Students may update active attempts" on public.examination_attempts for update to authenticated using (public.can_access_student(student_id) and status='in_progress') with check (public.can_access_student(student_id));
create policy "Teachers grade attempts" on public.examination_attempts for update to authenticated using (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[])) with check (public.has_school_role(school_id,array['owner','admin','teacher']::public.school_role[]));
-- Answer writes and reads go through validated API functions so correct answers stay private.
revoke all on public.examination_answers from anon, authenticated;
revoke all on public.examination_questions from anon, authenticated;
grant select on public.examination_questions to authenticated;
revoke insert, update, delete on public.examination_attempts from anon, authenticated;

-- School file paths use: {school_id}/{owner_user_id}/... . Student files may be read
-- by verified linked guardians through can_access_school_user; payroll files remain admin-only.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('school-private','school-private',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('school-public','school-public',true,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "Private school files read by authorized school users" on storage.objects for select to authenticated
using (bucket_id='school-private' and array_length(storage.foldername(name),1)>=2
  and public.can_access_school_user((storage.foldername(name))[1]::uuid,(storage.foldername(name))[2]::uuid));
create policy "Users upload into own school folder" on storage.objects for insert to authenticated
with check (bucket_id='school-private' and array_length(storage.foldername(name),1)>=2
  and (storage.foldername(name))[2]::uuid=(select auth.uid())
  and public.is_school_member((storage.foldername(name))[1]::uuid));
create policy "Users update own files and admins manage school files" on storage.objects for update to authenticated
using (bucket_id='school-private' and array_length(storage.foldername(name),1)>=2 and
  (public.can_access_school_user((storage.foldername(name))[1]::uuid,(storage.foldername(name))[2]::uuid)))
with check (bucket_id='school-private' and array_length(storage.foldername(name),1)>=2 and
  (public.can_access_school_user((storage.foldername(name))[1]::uuid,(storage.foldername(name))[2]::uuid)));
create policy "Admins delete school files" on storage.objects for delete to authenticated
using (bucket_id='school-private' and array_length(storage.foldername(name),1)>=2 and
  public.has_school_role((storage.foldername(name))[1]::uuid,array['owner','admin']::public.school_role[]));
create policy "School members upload approved public images" on storage.objects for insert to authenticated
with check (bucket_id='school-public' and array_length(storage.foldername(name),1)>=1
  and public.has_school_role((storage.foldername(name))[1]::uuid,array['owner','admin']::public.school_role[]));


