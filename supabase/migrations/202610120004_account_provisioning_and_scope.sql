alter table public.student_profiles add column login_identifier text;
alter table public.student_profiles add column must_change_password boolean not null default false;
create unique index student_login_identifier_unique on public.student_profiles(lower(login_identifier)) where login_identifier is not null;
alter table public.guardian_profiles add column email text;
create unique index guardian_email_per_school_unique on public.guardian_profiles(school_id,lower(email)) where email is not null;

create or replace function public.can_access_student_record(target_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.student_profiles st where st.id=target_student and (
      public.can_access_student(st.id)
      or public.has_school_role(st.school_id,array['owner','admin','staff']::public.school_role[])
      or exists (
        select 1 from public.teacher_assignments ta
        join public.staff_profiles sp on sp.id=ta.staff_id and sp.school_id=ta.school_id
        where ta.school_id=st.school_id and sp.user_id=(select auth.uid()) and ta.class_id=st.class_id
          and (ta.class_arm_id is null or ta.class_arm_id=st.class_arm_id)
      )
    )
  );
$$;

drop policy "Authorized users read students" on public.student_profiles;
create policy "Authorized users read assigned students" on public.student_profiles for select to authenticated
using (public.can_access_student_record(id));
drop policy "Authorized attendance read" on public.attendance_records;
create policy "Authorized users read assigned attendance" on public.attendance_records for select to authenticated
using (public.can_access_student_record(student_id));
drop policy "Staff record attendance" on public.attendance_records;
create policy "Staff record assigned attendance" on public.attendance_records for insert to authenticated
with check (public.can_access_student_record(student_id) and recorded_by=(select auth.uid()));

drop policy "Student or teacher reads submissions" on public.assignment_submissions;
create policy "Student or assigned teacher reads submissions" on public.assignment_submissions for select to authenticated
using (public.can_access_student_record(student_id));
drop policy "Linked student submits" on public.assignment_submissions;
create policy "Linked student submits eligible assignment" on public.assignment_submissions for insert to authenticated
with check (public.can_access_student(student_id) and exists (
  select 1 from public.assignments a where a.id=assignment_submissions.assignment_id
    and a.school_id=assignment_submissions.school_id and a.status='published'
    and public.can_access_assignment(a.teacher_assignment_id)
));
drop policy "Teacher grades submissions" on public.assignment_submissions;
create policy "Assigned staff grades submissions" on public.assignment_submissions for update to authenticated
using (
  public.has_school_role(assignment_submissions.school_id,array['owner','admin']::public.school_role[])
  or (public.can_access_student_record(assignment_submissions.student_id) and exists (
    select 1 from public.assignments a where a.id=assignment_submissions.assignment_id
      and a.school_id=assignment_submissions.school_id and public.can_access_assignment(a.teacher_assignment_id)
  ))
) with check (
  public.has_school_role(assignment_submissions.school_id,array['owner','admin']::public.school_role[])
  or (public.can_access_student_record(assignment_submissions.student_id) and exists (
    select 1 from public.assignments a where a.id=assignment_submissions.assignment_id
      and a.school_id=assignment_submissions.school_id and public.can_access_assignment(a.teacher_assignment_id)
  ))
);

drop policy "Authorized read scores" on public.assessment_scores;
create policy "Authorized users read approved scores" on public.assessment_scores for select to authenticated
using (
  public.can_access_student_record(assessment_scores.student_id) and exists (
    select 1 from public.assessments a where a.id=assessment_scores.assessment_id
      and a.school_id=assessment_scores.school_id and (
        a.status='published'
        or public.has_school_role(assessment_scores.school_id,array['owner','admin']::public.school_role[])
        or (public.has_school_role(assessment_scores.school_id,array['teacher']::public.school_role[]) and public.can_access_assignment(a.teacher_assignment_id))
      )
  )
);
drop policy "Teachers record scores" on public.assessment_scores;
create policy "Teachers record scores for assigned classes" on public.assessment_scores for insert to authenticated
with check (
  assessment_scores.recorded_by=(select auth.uid()) and (
    public.has_school_role(assessment_scores.school_id,array['owner','admin']::public.school_role[])
    or (public.can_access_student_record(assessment_scores.student_id) and exists (
      select 1 from public.assessments a where a.id=assessment_scores.assessment_id
        and a.school_id=assessment_scores.school_id and public.can_access_assignment(a.teacher_assignment_id)
    ))
  )
);
create policy "Teachers update scores for assigned classes" on public.assessment_scores for update to authenticated
using (
  public.has_school_role(assessment_scores.school_id,array['owner','admin']::public.school_role[])
  or (public.can_access_student_record(assessment_scores.student_id) and exists (
    select 1 from public.assessments a where a.id=assessment_scores.assessment_id
      and a.school_id=assessment_scores.school_id and public.can_access_assignment(a.teacher_assignment_id)
  ))
) with check (
  public.has_school_role(assessment_scores.school_id,array['owner','admin']::public.school_role[])
  or (public.can_access_student_record(assessment_scores.student_id) and exists (
    select 1 from public.assessments a where a.id=assessment_scores.assessment_id
      and a.school_id=assessment_scores.school_id and public.can_access_assignment(a.teacher_assignment_id)
  ))
);

drop policy "Members read assessments" on public.assessments;
create policy "Staff and eligible families read assessments" on public.assessments for select to authenticated
using (
  public.has_school_role(school_id,array['owner','admin','teacher','staff']::public.school_role[])
  or (status='published' and public.can_access_assignment(teacher_assignment_id))
);
drop policy "Teachers manage assessments" on public.assessments;
create policy "Admins manage assessments" on public.assessments for all to authenticated
using (public.has_school_role(school_id,array['owner','admin']::public.school_role[]))
with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Teachers create assigned assessments" on public.assessments for insert to authenticated
with check (created_by=(select auth.uid()) and public.has_school_role(school_id,array['teacher']::public.school_role[])
  and public.can_access_assignment(teacher_assignment_id) and status in ('draft','submitted'));
create policy "Teachers revise own unapproved assessments" on public.assessments for update to authenticated
using (created_by=(select auth.uid()) and public.can_access_assignment(teacher_assignment_id))
with check (created_by=(select auth.uid()) and public.has_school_role(school_id,array['teacher']::public.school_role[])
  and status in ('draft','submitted','returned') and public.can_access_assignment(teacher_assignment_id));

drop policy "Authorized read reports" on public.report_drafts;
create policy "Authorized users read reports" on public.report_drafts for select to authenticated
using (
  public.has_school_role(school_id,array['owner','admin','staff']::public.school_role[])
  or (public.has_school_role(school_id,array['teacher']::public.school_role[]) and teacher_id=(select auth.uid()))
  or (status='published' and public.can_access_student(student_id))
);
drop policy "Teachers and admins update reports" on public.report_drafts;
create policy "Admins review and publish reports" on public.report_drafts for update to authenticated
using (public.has_school_role(school_id,array['owner','admin']::public.school_role[]))
with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Teachers revise own draft reports" on public.report_drafts for update to authenticated
using (teacher_id=(select auth.uid()) and public.has_school_role(school_id,array['teacher']::public.school_role[]))
with check (teacher_id=(select auth.uid()) and public.has_school_role(school_id,array['teacher']::public.school_role[])
  and status in ('draft','submitted','returned'));

drop policy "Teachers update lesson notes" on public.lesson_notes;
create policy "Admins review lesson notes" on public.lesson_notes for update to authenticated
using (public.has_school_role(school_id,array['owner','admin']::public.school_role[]))
with check (public.has_school_role(school_id,array['owner','admin']::public.school_role[]));
create policy "Teachers revise own lesson notes" on public.lesson_notes for update to authenticated
using (created_by=(select auth.uid()) and public.has_school_role(school_id,array['teacher']::public.school_role[]))
with check (created_by=(select auth.uid()) and public.has_school_role(school_id,array['teacher']::public.school_role[])
  and status in ('draft','submitted','returned'));

drop policy "Complaint participants read messages" on public.complaint_messages;
create policy "Complaint participants read messages" on public.complaint_messages for select to authenticated
using (exists (
  select 1 from public.complaints c where c.id=complaint_messages.complaint_id
    and c.school_id=complaint_messages.school_id and (c.opened_by=(select auth.uid())
      or c.assigned_to=(select auth.uid()) or public.has_school_role(c.school_id,array['owner','admin','staff']::public.school_role[]))
));
drop policy "Complaint participants send messages" on public.complaint_messages;
create policy "Complaint participants send messages" on public.complaint_messages for insert to authenticated
with check (author_id=(select auth.uid()) and exists (
  select 1 from public.complaints c where c.id=complaint_messages.complaint_id
    and c.school_id=complaint_messages.school_id and (c.opened_by=(select auth.uid())
      or c.assigned_to=(select auth.uid()) or public.has_school_role(c.school_id,array['owner','admin','staff']::public.school_role[]))
));

drop policy "Students and staff read attempts" on public.examination_attempts;
create policy "Authorized users read assigned attempts" on public.examination_attempts for select to authenticated
using (public.can_access_student_record(student_id));
-- Attempt and answer writes are intentionally server-only. The API enforces timing, limits and marking.
revoke insert, update, delete on public.examination_attempts from anon, authenticated;
