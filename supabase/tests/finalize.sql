begin;
create extension if not exists pgtap;
select plan(21);

insert into auth.users(id,email) values
 ('00000000-0000-4000-8001-000000000011','teacher@example.invalid'),
 ('00000000-0000-4000-8001-000000000012','admin@example.invalid'),
 ('00000000-0000-4000-8001-000000000013','third@example.invalid');
insert into public.app_operators(user_id,workspace_owner_id) values
 ('00000000-0000-4000-8001-000000000011','00000000-0000-4000-8001-000000000011'),
 ('00000000-0000-4000-8001-000000000012','00000000-0000-4000-8001-000000000011');

set local role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8001-000000000011';
set request.jwt.claims = '{"sub":"00000000-0000-4000-8001-000000000011","aal":"aal2","role":"authenticated"}';
insert into public.teacher_settings(owner_id,teacher_name,currency)
 values('00000000-0000-4000-8001-000000000011','김민수','CAD');
insert into public.students(id,owner_id,name) values
 ('10000000-0000-4000-8001-000000000011','00000000-0000-4000-8001-000000000011','Lee');
insert into public.lessons(id,owner_id,student_id,lesson_date,minutes,charge_cents,entry_key)
 values
 ('20000000-0000-4000-8001-000000000011','00000000-0000-4000-8001-000000000011','10000000-0000-4000-8001-000000000011','2026-11-04',45,6750,gen_random_uuid()),
 ('20000000-0000-4000-8001-000000000012','00000000-0000-4000-8001-000000000011','10000000-0000-4000-8001-000000000011','2026-12-04',60,7000,gen_random_uuid());

set request.jwt.claim.sub = '00000000-0000-4000-8001-000000000012';
set request.jwt.claims = '{"sub":"00000000-0000-4000-8001-000000000012","aal":"aal2","role":"authenticated"}';
insert into public.invoices(id,owner_id,student_id,status,period_start,period_end)
 values('30000000-0000-4000-8001-000000000011','00000000-0000-4000-8001-000000000011','10000000-0000-4000-8001-000000000011','draft','2026-11-01','2026-11-30');
set request.jwt.claims = '{"sub":"00000000-0000-4000-8001-000000000012","aal":"aal1","role":"authenticated"}';
select throws_ok($$select public.finalize_invoice('30000000-0000-4000-8001-000000000011','2026-11-04','2026-11-04')$$,'42501','Access denied.','AAL1 operator cannot finalize');
set request.jwt.claims = '{"sub":"00000000-0000-4000-8001-000000000012","aal":"aal2","role":"authenticated"}';
select is(public.app_workspace_owner_id(),'00000000-0000-4000-8001-000000000011','admin uses teacher canonical workspace');
select lives_ok($$select public.finalize_invoice('30000000-0000-4000-8001-000000000011','2026-11-04','2026-11-04')$$,'admin finalizes shared draft');
select is(status,'finalized','admin finalization sets finalized status') from public.invoices where id='30000000-0000-4000-8001-000000000011';
select is(period_start,'2026-11-04'::date,'edited start stored atomically') from public.invoices where id='30000000-0000-4000-8001-000000000011';
select is(period_end,'2026-11-04'::date,'edited end stored atomically') from public.invoices where id='30000000-0000-4000-8001-000000000011';
select ok(
  (select count(*)::int=1 from public.invoice_lesson_claims)
  and exists (
    select 1 from public.invoice_lesson_claims
    where invoice_id='30000000-0000-4000-8001-000000000011'
      and lesson_id='20000000-0000-4000-8001-000000000011'
  ),
  'only selected lesson is claimed with a UUID lesson_id'
);
select is(invoice_number like 'VI-2026-%',true,'first shared invoice number formatted') from public.invoices where id='30000000-0000-4000-8001-000000000011';
select throws_ok($$
  insert into public.lessons(owner_id,student_id,lesson_date,minutes,charge_cents,entry_key)
  values('00000000-0000-4000-8001-000000000011','10000000-0000-4000-8001-000000000011','2026-11-04',30,5000,gen_random_uuid())
$$,'23514','This lesson falls within a finalized invoice period and cannot be saved.','retroactive lesson insert rejected');
insert into public.students(id,owner_id,name) values
 ('10000000-0000-4000-8001-000000000012','00000000-0000-4000-8001-000000000011','Park');
insert into public.lessons(id,owner_id,student_id,lesson_date,minutes,charge_cents,entry_key)
 values
 ('20000000-0000-4000-8001-000000000013','00000000-0000-4000-8001-000000000011','10000000-0000-4000-8001-000000000012','2026-11-04',30,5000,gen_random_uuid()),
 ('20000000-0000-4000-8001-000000000014','00000000-0000-4000-8001-000000000011','10000000-0000-4000-8001-000000000011','2027-01-04',30,5000,gen_random_uuid());
select throws_ok($$
  update public.lessons
  set student_id='10000000-0000-4000-8001-000000000011'
  where id='20000000-0000-4000-8001-000000000013'
$$,'23514','This lesson falls within a finalized invoice period and cannot be saved.','lesson move to finalized-period student rejected');
select throws_ok($$
  update public.lessons
  set lesson_date='2026-11-04'
  where id='20000000-0000-4000-8001-000000000014'
$$,'23514','This lesson falls within a finalized invoice period and cannot be saved.','lesson date move into finalized period rejected');

set request.jwt.claim.sub = '00000000-0000-4000-8001-000000000011';
set request.jwt.claims = '{"sub":"00000000-0000-4000-8001-000000000011","aal":"aal2","role":"authenticated"}';
insert into public.invoices(id,owner_id,student_id,status,period_start,period_end)
 values('30000000-0000-4000-8001-000000000012','00000000-0000-4000-8001-000000000011','10000000-0000-4000-8001-000000000011','draft','2026-12-01','2026-12-31');
select lives_ok($$select public.finalize_invoice('30000000-0000-4000-8001-000000000012','2026-12-04','2026-12-04')$$,'teacher also finalizes shared draft');
select is(last_value,1 + 1,'shared counter increments once per finalization') from public.invoice_counters
 where owner_id='00000000-0000-4000-8001-000000000011';
select throws_ok($$update public.lessons set charge_cents=1 where id='20000000-0000-4000-8001-000000000011'$$,'23514','This lesson is included in a finalized invoice and cannot be changed.','claimed lesson immutable');
select throws_ok($$update public.invoices set snapshot_json='{}' where id='30000000-0000-4000-8001-000000000011'$$,'23514','Finalized invoices are immutable.','snapshot immutable');

set request.jwt.claim.sub = '00000000-0000-4000-8001-000000000013';
set request.jwt.claims = '{"sub":"00000000-0000-4000-8001-000000000013","aal":"aal2","role":"authenticated"}';
select throws_ok($$select public.finalize_invoice('30000000-0000-4000-8001-000000000012','2026-12-04','2026-12-04')$$,'42501','Access denied.','unrelated UID cannot finalize');

set request.jwt.claim.sub = '00000000-0000-4000-8001-000000000012';
set request.jwt.claims = '{"sub":"00000000-0000-4000-8001-000000000012","aal":"aal2","role":"authenticated"}';
insert into public.invoices(id,owner_id,student_id,status,period_start,period_end)
 values('30000000-0000-4000-8001-000000000013','00000000-0000-4000-8001-000000000011','10000000-0000-4000-8001-000000000011','draft','2027-01-01','2027-01-31');
select throws_ok($$select public.finalize_invoice('30000000-0000-4000-8001-000000000013','2027-01-31','2027-01-01')$$,'22023','The start date must be on or before the end date.','reversed range rejected');
select throws_ok($$select public.finalize_invoice('30000000-0000-4000-8001-000000000013',null::date,'2027-01-31')$$,'22023','A valid period start and end date are required.','null start rejected');
insert into public.invoices(id,owner_id,student_id,status,period_start,period_end)
 values('30000000-0000-4000-8001-000000000014','00000000-0000-4000-8001-000000000011','10000000-0000-4000-8001-000000000011','draft','2026-11-03','2026-11-05');
select throws_ok($$select public.finalize_invoice('30000000-0000-4000-8001-000000000014','2026-11-03','2026-11-05')$$,'23P01','This period overlaps an existing finalized invoice.','shared finalized overlap rejected');
select lives_ok($$
  delete from public.invoices where id='30000000-0000-4000-8001-000000000014'
$$,'draft invoice deletion succeeds');
select throws_ok($$
  delete from public.invoices where id='30000000-0000-4000-8001-000000000011'
$$,'23514','Finalized invoices are immutable.','finalized invoice deletion rejected');

select * from finish();
rollback;
