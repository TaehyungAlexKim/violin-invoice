-- Stable draft operation identity for idempotent invoice creation/retries.
alter table public.invoices add column if not exists entry_key uuid;
update public.invoices set entry_key=gen_random_uuid() where entry_key is null;
alter table public.invoices alter column entry_key set not null;
alter table public.invoices alter column entry_key set default gen_random_uuid();
alter table public.invoices add constraint invoices_owner_entry_key_unique unique(owner_id, entry_key);
create index invoices_owner_student_entry_idx
  on public.invoices(owner_id, student_id, entry_key);
