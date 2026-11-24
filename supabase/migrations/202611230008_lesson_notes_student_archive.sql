-- Lesson memo: 300 characters, trimmed in application and database.
alter table public.lessons
  add column if not exists note text;
update public.lessons
set note = left(btrim(note), 300)
where note is not null and (char_length(btrim(note)) > 300 or note <> btrim(note));
alter table public.lessons
  drop constraint if exists lessons_note_max_length;
alter table public.lessons
  add constraint lessons_note_max_length
  check (note is null or char_length(btrim(note)) <= 300);

-- Soft archive: preserve all historical rows and relationships.
alter table public.students
  add column if not exists archived_at timestamptz;
create index if not exists students_owner_active_name_idx
  on public.students(owner_id, name)
  where archived_at is null;
create index if not exists lessons_owner_student_note_idx
  on public.lessons(owner_id, student_id)
  where note is not null;

create or replace function public.reject_archived_student_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.students s
    where s.owner_id = new.owner_id
      and s.id = new.student_id
      and s.archived_at is not null
  ) then
    raise exception using errcode='23514',
      message='Archived students cannot have new lessons or invoices.';
  end if;
  return new;
end; $$;

drop trigger if exists lessons_reject_archived_student on public.lessons;
create trigger lessons_reject_archived_student
before insert or update of student_id, owner_id on public.lessons
for each row execute function public.reject_archived_student_owner();

drop trigger if exists invoices_reject_archived_student on public.invoices;
create trigger invoices_reject_archived_student
before insert or update of student_id, owner_id, status on public.invoices
for each row execute function public.reject_archived_student_owner();
