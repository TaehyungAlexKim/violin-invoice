begin;
create extension if not exists pgtap;
select plan(14);

insert into auth.users(id,email) values
  ('00000000-0000-4000-8000-000000000001','teacher@example.invalid'),
  ('00000000-0000-4000-8000-000000000002','admin@example.invalid'),
  ('00000000-0000-4000-8000-000000000003','third@example.invalid');
insert into public.app_operators(user_id,workspace_owner_id) values
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');

set local role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
set request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal2","role":"authenticated"}';
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
set request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","aal":"aal1","role":"authenticated"}';
select is(count(*)::int,0,'AAL1 operator cannot read app_operators') from public.app_operators;
select is(count(*)::int,0,'AAL1 operator cannot read students') from public.students;
set request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","aal":"aal2","role":"authenticated"}';
select is(count(*)::int,1,'admin sees shared student') from public.students;
select is(count(*)::int,1,'admin sees shared lesson') from public.lessons;
select is(count(*)::int,1,'admin sees shared draft') from public.invoices;
select is(public.app_workspace_owner_id(),'00000000-0000-4000-8000-000000000001','admin gets canonical workspace');
insert into public.students(id,owner_id,name) values
('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Student B');
select ok(
  (select count(*)::int=2 from public.students)
  and exists (
    select 1 from public.students
    where id='10000000-0000-4000-8000-000000000002'
      and owner_id='00000000-0000-4000-8000-000000000001'
      and name='Student B'
  ),
  'admin insert belongs to and is visible in shared workspace'
);

set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
set request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","aal":"aal2","role":"authenticated"}';
select is(count(*)::int,0,'unrelated UID sees zero students') from public.students;
select is(count(*)::int,0,'unrelated UID sees zero invoices') from public.invoices;
select throws_ok($$insert into public.students(owner_id,name) values('00000000-0000-4000-8000-000000000001','Other')$$,
  '42501','new row violates row-level security policy for table "students"','unrelated UID insert denied');
with updated as (
  update public.students
  set name='Hijacked'
  where id='10000000-0000-4000-8000-000000000001'
  returning 1
)
select is(count(*)::int,0,'unrelated UID update changes zero rows') from updated;

set local role anon;
select throws_ok($$select * from public.students$$,
  '42501','permission denied for table students','anon cannot directly select students');
select * from finish();
rollback;
