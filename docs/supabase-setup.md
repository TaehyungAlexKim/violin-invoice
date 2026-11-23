# Supabase Setup

1. Create a Canada-adjacent Supabase Free project.
2. Disable public self-signup. Create exactly two trusted operator accounts (teacher and project owner/admin); do not create or enroll student accounts.
3. Set Auth Site URL to `https://<account>.github.io/violin-invoice/` and add exact Pages redirect URLs.
   Add `https://<account>.github.io/violin-invoice/#/reset-password` to the allowed Redirect URLs.
   It must match the Pages origin, Vite `BASE_URL`, and HashRouter route exactly.
4. For a fresh project, apply `supabase/migrations/202611220001_initial.sql` with the Supabase CLI.
   For the existing production database that already ran the initial migration, apply
   `supabase/migrations/202611220002_shared_workspace_followup.sql` instead.
5. Choose one operator Auth UID as the canonical workspace owner. Enroll both operator UIDs with that same `workspace_owner_id`:
   ```sql
   insert into public.app_operators(user_id,workspace_owner_id) values
     ('<teacher-auth.users.id>','<canonical-workspace-owner-auth.users.id>'),
     ('<admin-auth.users.id>','<canonical-workspace-owner-auth.users.id>')
   on conflict (user_id) do update
     set workspace_owner_id = excluded.workspace_owner_id;
   ```
   The owner UID can belong to the teacher or admin. Both operators see and manage exactly the same
   settings, students, lessons, drafts, finalized snapshots, claims, and counter.
6. Run `supabase test db`.
7. Enable MFA for both trusted operators and configure English Auth email templates.

Use only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the browser build.

## Password invitation and recovery

- Supabase invite/recovery email links open the `/reset-password` HashRouter route.
- The app requires a new password of at least 6 characters and matching confirmation.
- A recovery link is accepted only while Supabase establishes a `PASSWORD_RECOVERY`/recovery session.
- After a successful update, the temporary session is signed out and the operator returns to `/login`.
- The app does not create, assign, or communicate a temporary application password. No agent-generated app password is part of this flow.

The migration installs `pgcrypto` in the `extensions` schema. Finalization hashes the canonical JSON text with `extensions.digest(convert_to(snapshot::text, 'UTF8'), 'sha256')`. It does not rely on an unqualified `digest()` lookup.
