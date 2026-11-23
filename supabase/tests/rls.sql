begin;
create extension if not exists pgtap;
select plan(12);

insert into auth.users(id,email) values
  ('00000000-0000-4000-8000-000000000001','teacher@example.invalid'),
  ('00000000-0000-4000-8000-000000000002','admin@example.invalid'),
  ('00000000-0000-4000-8000-000000000003','third@example.invalid');
insert into public.app_operators(user_id,workspace_owner_id) values
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');

set local role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
insert into public.teacher_settings(owner_id,teacher_name,currency)
values('00000000-0000-4000-8000-000000000001','Violin Teacher','CAD');
insert into public.students(id,owner_id,name) values
('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Student A');
insert into public.lessons(id,owner_id,student_id,lesson_date,minutes,charge_cents,entry_key)
values('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','2026-11-04',45,6750,gen_random_uuid());
insert into public.invoices(id,owner_id,student_id,status,period_start,period_end)
values('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','draft','2026-11-01','2026-11-30');

select is(count(*)::int,1,'teacher sees shared student') from public.students;
select is(public.app_workspace_owner_id(),'00000000-0000-4000-8000-000000000001','teacher gets canonical workspace') ;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select is(count(*)::int,1,'admin sees shared student') from public.students;
select is(count(*)::int,1,'admin sees shared lesson') from public.lessons;
select is(count(*)::int,1,'admin sees shared draft') from public.invoices;
select is(public.app_workspace_owner_id(),'00000000-0000-4000-8000-000000000001','admin gets canonical workspace');
insert into public.students(id,owner_id,name) values
('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Student B');
select is(count(*)::int,2,'admin insert belongs to shared workspace');

set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select is(count(*)::int,0,'unrelated UID sees zero students') from public.students;
select is(count(*)::int,0,'unrelated UID sees zero invoices') from public.invoices;
select throws_ok($$insert into public.students(owner_id,name) values('00000000-0000-4000-8000-000000000001','Other')$$,
  '42501','unrelated UID insert denied');
select throws_ok($$update public.students set name='Hijacked' where id='10000000-0000-4000-8000-000000000001'$$,
  null,'unrelated UID update denied or changes zero');

set local role anon;
select is(count(*)::int,0,'anon sees no students') from public.students;
select * from finish();
rollback;
