alter table public.lesson_notes add column review_note text;
alter table public.assignments add column max_score numeric(8,2) check (max_score is null or max_score > 0);
alter table public.assessments add column review_note text;
alter table public.assessments add column reviewed_by uuid references public.profiles(id);
alter table public.assessments add column reviewed_at timestamptz;

create or replace function public.validate_assessment_score()
returns trigger language plpgsql set search_path = '' as $$
declare
  allowed_max numeric(8,2);
begin
  select max_score into allowed_max from public.assessments where id=new.assessment_id and school_id=new.school_id;
  if allowed_max is null then raise exception 'Assessment does not belong to this school'; end if;
  if new.score > allowed_max then raise exception 'Assessment score cannot exceed maximum score'; end if;
  return new;
end;
$$;
create trigger assessment_score_max_guard before insert or update on public.assessment_scores
for each row execute function public.validate_assessment_score();

create or replace function public.validate_assignment_score()
returns trigger language plpgsql set search_path = '' as $$
declare
  allowed_max numeric(8,2);
begin
  select max_score into allowed_max from public.assignments where id=new.assignment_id and school_id=new.school_id;
  if not found then raise exception 'Assignment does not belong to this school'; end if;
  if allowed_max is not null and new.score is not null and new.score > allowed_max then raise exception 'Assignment score cannot exceed maximum score'; end if;
  return new;
end;
$$;
create trigger assignment_score_max_guard before insert or update on public.assignment_submissions
for each row execute function public.validate_assignment_score();

-- Student submissions use the validated API so deadlines and eligibility are enforced.
revoke insert, update, delete on public.assignment_submissions from anon,authenticated;
