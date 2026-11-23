begin;
create extension if not exists pgtap;
select plan(11);

insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000011','operator2@example.invalid');
insert into public.app_operators(user_id) values ('00000000-0000-4000-8000-000000000011');
set local role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000011';
insert into public.teacher_settings(owner_id,teacher_name,currency)
 values(auth.uid(),'김민수','CAD');
insert into public.students(id,owner_id,name) values
 ('10000000-0000-4000-8001-000000000011',auth.uid(),'Lee');
insert into public.lessons(id,owner_id,student_id,lesson_date,minutes,charge_cents,entry_key)
 values
 ('20000000-0000-4000-8001-000000000011',auth.uid(),'10000000-0000-4000-8001-000000000011','2026-11-04',45,6750,gen_random_uuid()),
 ('20000000-0000-4000-8001-000000000012',auth.uid(),'10000000-0000-4000-8001-000000000011','2026-11-11',60,0,gen_random_uuid());
insert into public.invoices(id,owner_id,student_id,status,period_start,period_end)
 values('30000000-0000-4000-8001-000000000011',auth.uid(),'10000000-0000-4000-8001-000000000011','draft','2026-11-01','2026-11-30');

select lives_ok($$select public.finalize_invoice('30000000-0000-4000-8001-000000000011','2026-11-04','2026-11-04')$$,'edited range finalizes');
select is(count(*)::int,1,'only edited-range lesson claimed') from public.invoice_lesson_claims;
select is(status,'finalized','invoice is finalized') from public.invoices where id='30000000-0000-4000-8001-000000000011';
select is(period_start,'2026-11-04'::date,'edited start stored atomically') from public.invoices where id='30000000-0000-4000-8001-000000000011';
select is(period_end,'2026-11-04'::date,'edited end stored atomically') from public.invoices where id='30000000-0000-4000-8001-000000000011';
select is(invoice_number like 'VI-2026-%',true,'gapless formatted number') from public.invoices where id='30000000-0000-4000-8001-000000000011';
select throws_ok($$update public.lessons set charge_cents=1 where id='20000000-0000-4000-8001-000000000011'$$,'23514','claimed lesson immutable');
select throws_ok($$update public.invoices set snapshot_json='{}' where id='30000000-0000-4000-8001-000000000011'$$,'23514','snapshot immutable');

insert into public.invoices(id,owner_id,student_id,status,period_start,period_end)
 values('30000000-0000-4000-8001-000000000013',auth.uid(),'10000000-0000-4000-8001-000000000011','draft','2026-12-01','2026-12-31');
select throws_ok($$select public.finalize_invoice('30000000-0000-4000-8001-000000000013','2026-12-31','2026-12-01')$$,'22023','reversed range rejected');
select throws_ok($$select public.finalize_invoice('30000000-0000-4000-8001-000000000013',null::date,'2026-12-31')$$,'22023','null start rejected');

insert into public.invoices(id,owner_id,student_id,status,period_start,period_end)
 values('30000000-0000-4000-8001-000000000012',auth.uid(),'10000000-0000-4000-8001-000000000011','draft','2026-11-04','2026-11-04');
select throws_ok($$select public.finalize_invoice('30000000-0000-4000-8001-000000000012','2026-11-04','2026-11-04')$$,'23P01','overlap rejected');
select * from finish();
rollback;
