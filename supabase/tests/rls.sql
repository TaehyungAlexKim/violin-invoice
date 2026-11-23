begin;
create extension if not exists pgtap;
select plan(8);

insert into auth.users(id,email) values
  ('00000000-0000-4000-8000-000000000001','operator@example.invalid'),
  ('00000000-0000-4000-8000-000000000002','second@example.invalid');
insert into public.app_operators(user_id) values ('00000000-0000-4000-8000-000000000001');

set local role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
insert into public.teacher_settings(owner_id,teacher_name,currency)
values(auth.uid(),'Violin Teacher','CAD');
insert into public.students(id,owner_id,name) values
('10000000-0000-4000-8000-000000000001',auth.uid(),'Student A');
select is(count(*)::int,1,'operator sees own student') from public.students;

set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select is(count(*)::int,0,'second authenticated UID sees no data') from public.students;

set local role anon;
select is(count(*)::int,0,'anon sees no students') from public.students;
select throws_ok($$insert into public.students(owner_id,name) values(auth.uid(),'Anon')$$,
  '42501','anon insert denied');

set local role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select throws_ok($$insert into public.students(owner_id,name) values(auth.uid(),'Other')$$,
  null,'second UID insert denied');

set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
insert into public.lessons(id,owner_id,student_id,lesson_date,minutes,charge_cents,entry_key)
values('20000000-0000-4000-8000-000000000001',auth.uid(),'10000000-0000-4000-8000-000000000001','2026-11-04',45,6750,gen_random_uuid());
insert into public.invoices(id,owner_id,student_id,status,period_start,period_end)
values('30000000-0000-4000-8000-000000000001',auth.uid(),'10000000-0000-4000-8000-000000000001','draft','2026-11-01','2026-11-30');
select is(count(*)::int,1,'operator sees own lesson') from public.lessons;
select is(count(*)::int,1,'operator sees own draft') from public.invoices;
select * from finish();
rollback;
