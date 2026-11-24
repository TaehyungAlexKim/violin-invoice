-- Stable draft operation identity for idempotent invoice creation/retries.
-- Adding a volatile UUID default backfills existing rows without issuing UPDATE
-- statements, so finalized invoices' immutable-row trigger remains satisfied.
alter table public.invoices
  add column if not exists entry_key uuid not null default gen_random_uuid();
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoices_owner_entry_key_unique'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_owner_entry_key_unique unique(owner_id, entry_key);
  end if;
end $$;
create index if not exists invoices_owner_student_entry_idx
  on public.invoices(owner_id, student_id, entry_key);
