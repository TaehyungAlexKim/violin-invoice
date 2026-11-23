-- Production follow-up: prevent retroactive lessons in finalized periods and
-- allow operators to remove unused draft invoices.

create or replace function public.reject_lesson_in_finalized_period()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.invoices i
    where i.owner_id = new.owner_id
      and i.student_id = new.student_id
      and i.status = 'finalized'
      and new.lesson_date between i.period_start and i.period_end
  ) then
    raise exception using errcode='23514',
      message='This lesson falls within a finalized invoice period and cannot be saved.';
  end if;
  return new;
end; $$;

drop trigger if exists lessons_reject_finalized_period on public.lessons;
create trigger lessons_reject_finalized_period before insert or update on public.lessons
for each row execute function public.reject_lesson_in_finalized_period();

create or replace function public.reject_finalized_invoice_mutation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.status = 'finalized' then
    raise exception using errcode='23514', message='Finalized invoices are immutable.';
  end if;
  return coalesce(new, old);
end; $$;
