-- Production follow-up: safely adds the shared-workspace operator model.
-- Existing single-user rows are backfilled as their own workspace owner.
-- The production database is expected to have no app_operators rows today;
-- enroll teacher + admin explicitly afterward with the same owner UID.

alter table public.app_operators
  add column if not exists workspace_owner_id uuid;

update public.app_operators
set workspace_owner_id = user_id
where workspace_owner_id is null;

alter table public.app_operators
  alter column workspace_owner_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_operators_workspace_owner_id_fkey'
      and conrelid = 'public.app_operators'::regclass
  ) then
    alter table public.app_operators
      add constraint app_operators_workspace_owner_id_fkey
      foreign key (workspace_owner_id) references auth.users(id) on delete cascade;
  end if;
end $$;

create or replace function public.app_is_operator()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.app_operators where user_id = auth.uid()) $$;

create or replace function public.app_workspace_owner_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select workspace_owner_id
  from public.app_operators
  where user_id = auth.uid()
  limit 1
$$;

drop policy if exists app_operators_read_self on public.app_operators;
drop policy if exists operator_settings on public.teacher_settings;
drop policy if exists operator_students on public.students;
drop policy if exists operator_lessons on public.lessons;
drop policy if exists operator_drafts on public.invoices;
drop policy if exists operator_claim_read on public.invoice_lesson_claims;
drop policy if exists operator_counters on public.invoice_counters;

create policy app_operators_read_self on public.app_operators for select
  to authenticated using (
    public.app_is_operator()
    and workspace_owner_id = public.app_workspace_owner_id()
  );
create policy operator_settings on public.teacher_settings for all
  to authenticated using (public.app_is_operator() and owner_id = public.app_workspace_owner_id())
  with check (public.app_is_operator() and owner_id = public.app_workspace_owner_id());
create policy operator_students on public.students for all
  to authenticated using (public.app_is_operator() and owner_id = public.app_workspace_owner_id())
  with check (public.app_is_operator() and owner_id = public.app_workspace_owner_id());
create policy operator_lessons on public.lessons for all
  to authenticated using (public.app_is_operator() and owner_id = public.app_workspace_owner_id())
  with check (public.app_is_operator() and owner_id = public.app_workspace_owner_id());
create policy operator_drafts on public.invoices for all
  to authenticated using (public.app_is_operator() and owner_id = public.app_workspace_owner_id())
  with check (public.app_is_operator() and owner_id = public.app_workspace_owner_id() and status = 'draft');
create policy operator_claim_read on public.invoice_lesson_claims for select
  to authenticated using (public.app_is_operator() and owner_id = public.app_workspace_owner_id());
create policy operator_counters on public.invoice_counters for select
  to authenticated using (public.app_is_operator() and owner_id = public.app_workspace_owner_id());

create or replace function public.finalize_invoice(p_invoice_id uuid, p_period_start date, p_period_end date)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
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
  v_owner := public.app_workspace_owner_id();
  if v_owner is null or not public.app_is_operator() then
    raise exception using errcode='42501', message='Access denied.';
  end if;
  if p_period_start is null or p_period_end is null then
    raise exception using errcode='22023', message='A valid period start and end date are required.';
  end if;
  if p_period_start > p_period_end then
    raise exception using errcode='22023', message='The start date must be on or before the end date.';
  end if;
  select * into v_invoice from public.invoices where id=p_invoice_id for update;
  if not found or v_invoice.owner_id <> v_owner or v_invoice.status <> 'draft' then
    raise exception using errcode='P0002', message='Draft invoice was not found.';
  end if;
  update public.invoices set period_start=p_period_start, period_end=p_period_end, updated_at=now()
    where id=v_invoice.id;
  v_invoice.period_start := p_period_start;
  v_invoice.period_end := p_period_end;
  if exists (
    select 1 from public.invoices i
    where i.owner_id=v_owner and i.student_id=v_invoice.student_id and i.status='finalized'
      and i.period && daterange(v_invoice.period_start, v_invoice.period_end, '[]')
  ) then raise exception using errcode='23P01', message='This period overlaps an existing finalized invoice.'; end if;
  select * into v_student from public.students
    where id=v_invoice.student_id and owner_id=v_owner for share;
  if not found then raise exception using errcode='P0002', message='Student was not found.'; end if;
  select * into v_teacher from public.teacher_settings where owner_id=v_owner;
  if not found or btrim(v_teacher.teacher_name)='' then
    raise exception using errcode='55000', message='Teacher name is required before finalizing.';
  end if;

  v_sender := jsonb_build_object('teacherName', btrim(v_teacher.teacher_name), 'currency', v_teacher.currency);
  if v_teacher.business_name is not null and btrim(v_teacher.business_name)<>'' then v_sender := v_sender || jsonb_build_object('businessName', btrim(v_teacher.business_name)); end if;
  if v_teacher.address is not null and btrim(v_teacher.address)<>'' then v_sender := v_sender || jsonb_build_object('address', btrim(v_teacher.address)); end if;
  if v_teacher.email is not null and btrim(v_teacher.email)<>'' then v_sender := v_sender || jsonb_build_object('email', btrim(v_teacher.email)); end if;
  if v_teacher.phone is not null and btrim(v_teacher.phone)<>'' then v_sender := v_sender || jsonb_build_object('phone', btrim(v_teacher.phone)); end if;

  v_recipient := jsonb_build_object('studentName', btrim(v_student.name));
  if v_student.recipient_name is not null and btrim(v_student.recipient_name)<>'' then v_recipient := v_recipient || jsonb_build_object('recipientName', btrim(v_student.recipient_name)); end if;
  if v_student.email is not null and btrim(v_student.email)<>'' then v_recipient := v_recipient || jsonb_build_object('email', btrim(v_student.email)); end if;
  if v_student.phone is not null and btrim(v_student.phone)<>'' then v_recipient := v_recipient || jsonb_build_object('phone', btrim(v_student.phone)); end if;
  if v_student.billing_address is not null and btrim(v_student.billing_address)<>'' then v_recipient := v_recipient || jsonb_build_object('billingAddress', btrim(v_student.billing_address)); end if;

  for v_lesson in
    select l.* from public.lessons l
    where l.owner_id=v_owner and l.student_id=v_invoice.student_id
      and l.lesson_date between v_invoice.period_start and v_invoice.period_end
      and not exists (select 1 from public.invoice_lesson_claims c where c.lesson_id=l.id)
    order by l.lesson_date asc, l.id asc
    for update of l
  loop
    v_total := v_total + v_lesson.charge_cents;
    if v_total > 2147483647 then raise exception using errcode='22003', message='Invoice total exceeds the supported limit.'; end if;
    v_lines := v_lines || jsonb_build_object(
      'sourceLessonId',v_lesson.id,'lessonDate',to_char(v_lesson.lesson_date,'YYYY-MM-DD'),
      'minutes',v_lesson.minutes,'chargeCents',v_lesson.charge_cents);
  end loop;
  if jsonb_array_length(v_lines)=0 then raise exception using errcode='P0001', message='At least one unclaimed lesson is required.'; end if;

  insert into public.invoice_counters(owner_id,year,last_value) values(v_owner,v_year,0)
    on conflict(owner_id,year) do update set last_value=public.invoice_counters.last_value
    returning last_value into v_sequence;
  select last_value into v_sequence from public.invoice_counters
    where owner_id=v_owner and year=v_year for update;
  v_sequence := v_sequence + 1;
  update public.invoice_counters set last_value=v_sequence where owner_id=v_owner and year=v_year;
  v_number := 'VI-' || v_year::text || '-' || lpad(v_sequence::text,6,'0');

  v_snapshot := jsonb_build_object(
    'schemaVersion',1,
    'invoice',jsonb_build_object('id',v_invoice.id,'number',v_number,'status','finalized','issueDate',to_char(v_issue,'YYYY-MM-DD')),
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
    select v_invoice.id, (lesson->>'sourceLessonId')::uuid, v_owner, now()
    from jsonb_array_elements(v_lines) lesson;
  return v_snapshot;
end; $$;

revoke execute on function public.app_is_operator() from public, anon;
revoke execute on function public.app_workspace_owner_id() from public, anon;
revoke execute on function public.finalize_invoice(uuid, date, date) from public, anon, authenticated;
grant execute on function public.app_is_operator() to authenticated;
grant execute on function public.app_workspace_owner_id() to authenticated;
grant execute on function public.finalize_invoice(uuid, date, date) to authenticated;
