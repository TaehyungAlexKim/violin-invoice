create extension if not exists btree_gist;
create schema if not exists extensions;
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto' and n.nspname <> 'extensions'
  ) then
    alter extension pgcrypto set schema extensions;
  elsif not exists (select 1 from pg_catalog.pg_extension where extname = 'pgcrypto') then
    create extension pgcrypto with schema extensions;
  end if;
end $$;

create table public.app_operators (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create or replace function public.app_is_operator()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.app_operators where user_id = auth.uid()) $$;

create table public.teacher_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  teacher_name text not null check (char_length(btrim(teacher_name)) between 1 and 200),
  business_name text check (business_name is null or char_length(business_name) between 0 and 200),
  address text check (address is null or char_length(address) <= 1000),
  email text check (email is null or char_length(email) <= 320),
  phone text check (phone is null or char_length(phone) <= 80),
  currency char(3) not null default 'CAD' check (currency = 'CAD'),
  updated_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  recipient_name text check (recipient_name is null or char_length(recipient_name) <= 200),
  email text check (email is null or char_length(email) <= 320),
  phone text check (phone is null or char_length(phone) <= 80),
  billing_address text check (billing_address is null or char_length(billing_address) <= 1000),
  memo text check (memo is null or char_length(memo) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.students add constraint students_owner_id_unique unique(owner_id,id);
create index students_owner_name_idx on public.students(owner_id, name);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null,
  lesson_date date not null,
  minutes smallint not null check (minutes between 1 and 1440),
  charge_cents integer not null check (charge_cents between 0 and 100000000),
  entry_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, entry_key),
  constraint lessons_student_owner_fk foreign key(owner_id, student_id)
    references public.students(owner_id, id) deferrable initially immediate
);
alter table public.lessons add constraint lessons_owner_id_unique unique(owner_id,id);
create index lessons_owner_student_date_idx on public.lessons(owner_id, student_id, lesson_date);
create index lessons_owner_date_idx on public.lessons(owner_id, lesson_date);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null,
  status text not null check (status in ('draft','finalized')),
  period_start date not null,
  period_end date not null check (period_start <= period_end),
  period daterange generated always as (daterange(period_start, period_end, '[]')) stored,
  issue_date date,
  invoice_year smallint,
  sequence_number integer,
  invoice_number text,
  snapshot_schema_version smallint,
  snapshot_json jsonb,
  payload_hash text,
  renderer_name text,
  renderer_version text,
  font_manifest jsonb,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint invoices_student_owner_fk foreign key(owner_id, student_id)
    references public.students(owner_id, id) deferrable initially immediate,
  check (
    (status = 'draft' and issue_date is null and invoice_year is null and sequence_number is null
      and invoice_number is null and snapshot_schema_version is null and snapshot_json is null
      and payload_hash is null and renderer_name is null and renderer_version is null
      and font_manifest is null and finalized_at is null)
    or
    (status = 'finalized' and issue_date is not null and invoice_year is not null
      and sequence_number is not null and invoice_number is not null
      and snapshot_schema_version = 1 and snapshot_json is not null
      and payload_hash is not null and renderer_name is not null
      and renderer_version is not null and font_manifest is not null and finalized_at is not null)
  ),
  unique(owner_id, invoice_number),
  unique(owner_id, invoice_year, sequence_number)
);
alter table public.invoices add constraint invoices_owner_id_unique unique(owner_id,id);
create index invoices_owner_student_end_idx on public.invoices(owner_id, student_id, period_end desc);
create index invoices_owner_status_end_idx on public.invoices(owner_id, status, period_end desc);
alter table public.invoices add constraint invoices_no_finalized_overlap
  exclude using gist (owner_id with =, student_id with =, period with &&)
  where (status = 'finalized');

create table public.invoice_lesson_claims (
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  lesson_id uuid primary key references public.lessons(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  constraint invoice_claim_owner_fk foreign key(owner_id, invoice_id)
    references public.invoices(owner_id, id) deferrable initially immediate,
  constraint invoice_claim_lesson_owner_fk foreign key(owner_id, lesson_id)
    references public.lessons(owner_id, id) deferrable initially immediate
);

create table public.invoice_counters (
  owner_id uuid not null references auth.users(id) on delete cascade,
  year smallint not null,
  last_value integer not null default 0 check (last_value >= 0),
  primary key(owner_id, year)
);

create or replace function public.set_updated_at()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin new.updated_at = now(); return new; end $$;
create trigger students_updated before update on public.students for each row execute function public.set_updated_at();
create trigger lessons_updated before update on public.lessons for each row execute function public.set_updated_at();
create trigger invoices_updated before update on public.invoices for each row execute function public.set_updated_at();
create trigger teacher_updated before update on public.teacher_settings for each row execute function public.set_updated_at();

create or replace function public.reject_claimed_lesson_mutation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.invoice_lesson_claims c where c.lesson_id = old.id) then
    raise exception using errcode='23514', message='This lesson is included in a finalized invoice and cannot be changed.';
  end;
  return coalesce(new, old);
end $$;
create trigger lessons_immutable_claimed before update or delete on public.lessons
for each row execute function public.reject_claimed_lesson_mutation();

create or replace function public.reject_finalized_invoice_mutation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or (old.status = 'finalized') then
    raise exception using errcode='23514', message='Finalized invoices are immutable.';
  end;
  return new;
end $$;
create trigger invoices_immutable before update or delete on public.invoices
for each row execute function public.reject_finalized_invoice_mutation();

alter table public.app_operators enable row level security;
alter table public.teacher_settings enable row level security;
alter table public.students enable row level security;
alter table public.lessons enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lesson_claims enable row level security;
alter table public.invoice_counters enable row level security;

create policy app_operators_read_self on public.app_operators for select
  to authenticated using (public.app_is_operator() and user_id = auth.uid());
create policy operator_settings on public.teacher_settings for all
  to authenticated using (public.app_is_operator() and owner_id = auth.uid())
  with check (public.app_is_operator() and owner_id = auth.uid());
create policy operator_students on public.students for all
  to authenticated using (public.app_is_operator() and owner_id = auth.uid())
  with check (public.app_is_operator() and owner_id = auth.uid());
create policy operator_lessons on public.lessons for all
  to authenticated using (public.app_is_operator() and owner_id = auth.uid())
  with check (public.app_is_operator() and owner_id = auth.uid());
create policy operator_drafts on public.invoices for all
  to authenticated using (public.app_is_operator() and owner_id = auth.uid())
  with check (public.app_is_operator() and owner_id = auth.uid() and status = 'draft');
create policy operator_claim_read on public.invoice_lesson_claims for select
  to authenticated using (public.app_is_operator() and owner_id = auth.uid());
create policy operator_counters on public.invoice_counters for select
  to authenticated using (public.app_is_operator() and owner_id = auth.uid());

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant select on public.app_operators to authenticated;
grant select, insert, update, delete on public.teacher_settings to authenticated;
grant select, insert, update, delete on public.students to authenticated;
grant select, insert, update, delete on public.lessons to authenticated;
grant select, insert, update, delete on public.invoices to authenticated;
grant select on public.invoice_lesson_claims to authenticated;
grant select on public.invoice_counters to authenticated;

create or replace function public.finalize_invoice(p_invoice_id uuid, p_period_start date, p_period_end date)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_invoice public.invoices%rowtype;
  v_student public.students%rowtype;
  v_teacher public.teacher_settings%rowtype;
  v_issue date := (now() at time zone 'America/Vancouver')::date;
  v_year smallint := extract(year from v_issue)::smallint;
  v_sequence integer;
  v_number text;
  v_total bigint := 0;
  v_lines jsonb := '[]'::jsonb;
  v_recipient jsonb;
  v_sender jsonb;
  v_snapshot jsonb;
  v_font jsonb := jsonb_build_object(
    'family','Noto Sans KR','normalFile','NotoSansKR.ttf','boldFile',null,
    'normalOnly',true,
    'sha256','194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252',
    'license','OFL-1.1','licenseFile','OFL.txt','upstream','https://github.com/notofonts/noto-cjk'
  );
  v_lesson record;
begin
  if v_owner is null or not public.app_is_operator() then
    raise exception using errcode='42501', message='Access denied.';
  end;
  if p_period_start is null or p_period_end is null then
    raise exception using errcode='22023', message='A valid period start and end date are required.';
  end;
  if p_period_start > p_period_end then
    raise exception using errcode='22023', message='The start date must be on or before the end date.';
  end;
  select * into v_invoice from public.invoices where id=p_invoice_id for update;
  if not found or v_invoice.owner_id <> v_owner or v_invoice.status <> 'draft' then
    raise exception using errcode='P0002', message='Draft invoice was not found.';
  end;
  update public.invoices
    set period_start=p_period_start, period_end=p_period_end, updated_at=now()
    where id=v_invoice.id;
  v_invoice.period_start := p_period_start;
  v_invoice.period_end := p_period_end;
  if exists (
    select 1 from public.invoices i
    where i.owner_id=v_owner and i.student_id=v_invoice.student_id and i.status='finalized'
      and i.period && daterange(v_invoice.period_start, v_invoice.period_end, '[]')
  ) then
    raise exception using errcode='23P01', message='This period overlaps an existing finalized invoice.';
  end;
  select * into v_student from public.students
    where id=v_invoice.student_id and owner_id=v_owner for share;
  if not found then raise exception using errcode='P0002', message='Student was not found.'; end;
  select * into v_teacher from public.teacher_settings where owner_id=v_owner;
  if not found or btrim(v_teacher.teacher_name)='' then
    raise exception using errcode='55000', message='Teacher name is required before finalizing.';
  end;

  v_sender := jsonb_build_object('teacherName', btrim(v_teacher.teacher_name),
    'currency', v_teacher.currency);
  if v_teacher.business_name is not null and btrim(v_teacher.business_name)<>'' then
    v_sender := v_sender || jsonb_build_object('businessName', btrim(v_teacher.business_name)); end;
  if v_teacher.address is not null and btrim(v_teacher.address)<>'' then
    v_sender := v_sender || jsonb_build_object('address', btrim(v_teacher.address)); end;
  if v_teacher.email is not null and btrim(v_teacher.email)<>'' then
    v_sender := v_sender || jsonb_build_object('email', btrim(v_teacher.email)); end;
  if v_teacher.phone is not null and btrim(v_teacher.phone)<>'' then
    v_sender := v_sender || jsonb_build_object('phone', btrim(v_teacher.phone)); end;

  v_recipient := jsonb_build_object('studentName', btrim(v_student.name));
  if v_student.recipient_name is not null and btrim(v_student.recipient_name)<>'' then
    v_recipient := v_recipient || jsonb_build_object('recipientName', btrim(v_student.recipient_name)); end;
  if v_student.email is not null and btrim(v_student.email)<>'' then
    v_recipient := v_recipient || jsonb_build_object('email', btrim(v_student.email)); end;
  if v_student.phone is not null and btrim(v_student.phone)<>'' then
    v_recipient := v_recipient || jsonb_build_object('phone', btrim(v_student.phone)); end;
  if v_student.billing_address is not null and btrim(v_student.billing_address)<>'' then
    v_recipient := v_recipient || jsonb_build_object('billingAddress', btrim(v_student.billing_address)); end;

  for v_lesson in
    select l.* from public.lessons l
    where l.owner_id=v_owner and l.student_id=v_invoice.student_id
      and l.lesson_date between v_invoice.period_start and v_invoice.period_end
      and not exists (select 1 from public.invoice_lesson_claims c where c.lesson_id=l.id)
    order by l.lesson_date asc, l.id asc
    for update of l
  loop
    v_total := v_total + v_lesson.charge_cents;
    if v_total > 2147483647 then
      raise exception using errcode='22003', message='Invoice total exceeds the supported limit.';
    end;
    v_lines := v_lines || jsonb_build_object(
      'sourceLessonId', v_lesson.id,
      'lessonDate', to_char(v_lesson.lesson_date, 'YYYY-MM-DD'),
      'minutes', v_lesson.minutes,
      'chargeCents', v_lesson.charge_cents
    );
  end loop;
  if jsonb_array_length(v_lines)=0 then
    raise exception using errcode='P0001', message='At least one unclaimed lesson is required.';
  end;

  insert into public.invoice_counters(owner_id,year,last_value)
    values(v_owner,v_year,0)
    on conflict(owner_id,year) do update set last_value=public.invoice_counters.last_value
    returning last_value into v_sequence;
  select last_value into v_sequence from public.invoice_counters
    where owner_id=v_owner and year=v_year for update;
  v_sequence := v_sequence + 1;
  update public.invoice_counters set last_value=v_sequence
    where owner_id=v_owner and year=v_year;
  v_number := 'VI-' || v_year::text || '-' || lpad(v_sequence::text,6,'0');

  v_snapshot := jsonb_build_object(
    'schemaVersion',1,
    'invoice',jsonb_build_object(
      'id',v_invoice.id,'number',v_number,'status','finalized','issueDate',to_char(v_issue,'YYYY-MM-DD')
    ),
    'currency','CAD','businessTimezone','America/Vancouver','locale','en-CA',
    'servicePeriod',jsonb_build_object('start',to_char(v_invoice.period_start,'YYYY-MM-DD'),'end',to_char(v_invoice.period_end,'YYYY-MM-DD')),
    'sender',v_sender,'recipient',v_recipient,'lines',v_lines,
    'subtotalCents',v_total,'taxCents',0,'totalCents',v_total,
    'render',jsonb_build_object('fontManifest',v_font,'templateVersion','1.0','rendererName','pdfmake','rendererVersion','0.3.15')
  );

  update public.invoices set status='finalized', issue_date=v_issue, invoice_year=v_year,
    sequence_number=v_sequence, invoice_number=v_number, snapshot_schema_version=1,
    snapshot_json=v_snapshot, payload_hash=encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex'),
    renderer_name='pdfmake', renderer_version='0.3.15', font_manifest=v_font,
    finalized_at=now(), updated_at=now()
    where id=v_invoice.id;

  insert into public.invoice_lesson_claims(invoice_id,lesson_id,owner_id,claimed_at)
    select v_invoice.id, lesson->>'sourceLessonId', v_owner, now()
    from jsonb_array_elements(v_lines) lesson;
  return v_snapshot;
end $$;
revoke execute on function public.finalize_invoice(uuid, date, date) from public, anon, authenticated;
grant execute on function public.finalize_invoice(uuid, date, date) to authenticated;
