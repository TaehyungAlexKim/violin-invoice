-- Production follow-up: every application authorization helper requires AAL2.
-- Supabase Auth MFA raises the JWT assurance level; no public database MFA
-- grants are needed because enrollment and verification use GoTrue Auth APIs.

create or replace function public.app_is_operator()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (select 1 from public.app_operators where user_id = auth.uid())
$$;

create or replace function public.app_workspace_owner_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select workspace_owner_id
  from public.app_operators
  where user_id = auth.uid()
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
  limit 1
$$;

revoke execute on function public.app_is_operator() from public, anon;
revoke execute on function public.app_workspace_owner_id() from public, anon;
grant execute on function public.app_is_operator() to authenticated;
grant execute on function public.app_workspace_owner_id() to authenticated;
