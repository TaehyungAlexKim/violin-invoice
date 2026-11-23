# Supabase Setup

1. Create a Canada-adjacent Supabase Free project.
2. Disable public self-signup. Create only invited trusted operator accounts (currently the project owner/admin, then the teacher when ready); do not create or enroll student accounts.
3. Set Auth Site URL to `https://<account>.github.io/violin-invoice/` and add exact Pages redirect URLs.
   Add `https://<account>.github.io/violin-invoice/#/reset-password` to the allowed Redirect URLs.
   It must match the Pages origin, Vite `BASE_URL`, and HashRouter route exactly.
4. For a fresh project, apply the complete migration sequence with the Supabase CLI.
   For the existing production database, review and apply migrations not yet present through
   `202611220004_require_aal2.sql`; `004` is the production AAL2 delta.
5. Choose one operator Auth UID as the canonical workspace owner. Enroll the invited administrator now and the teacher later with the same `workspace_owner_id`:
   ```sql
   insert into public.app_operators(user_id,workspace_owner_id) values
     ('<teacher-auth.users.id>','<canonical-workspace-owner-auth.users.id>'),
     ('<admin-auth.users.id>','<canonical-workspace-owner-auth.users.id>')
   on conflict (user_id) do update
     set workspace_owner_id = excluded.workspace_owner_id;
   ```
   The owner UID can belong to the admin until a teacher account is added. All enrolled operators see and manage exactly the same
   settings, students, lessons, drafts, finalized snapshots, claims, and counter.
6. Run `supabase test db`.
7. In **Authentication → Providers**, confirm TOTP/MFA is enabled for the project. This repository cannot change dashboard/provider state.
8. Configure English Auth email templates and keep public self-signup disabled.

Use only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the browser build.

## Password invitation and recovery

- Supabase invite/recovery email links open the `/reset-password` HashRouter route.
- The app requires a new password of at least 6 characters and matching confirmation.
- A recovery link is accepted only while Supabase establishes a `PASSWORD_RECOVERY`/recovery session.
- After a successful update, the temporary session is signed out and the operator returns to `/login`.
- The app does not create, assign, or communicate a temporary application password. No agent-generated app password is part of this flow.
- On the first password login with no verified TOTP factor, the operator scans the Violin Invoice QR code (or enters its manual secret) in an authenticator app and verifies a six-digit code. Save the authenticator account and any recovery information securely.
- After enrollment, password-only sign-ins stop at MFA. The app verifies the TOTP challenge, re-checks AAL2, and only then queries `app_operators`.
- If an enrollment or challenge expires, the English UI offers a restart or a fresh challenge without exposing the Supabase error response.

The migration installs `pgcrypto` in the `extensions` schema. Finalization hashes the canonical JSON text with `extensions.digest(convert_to(snapshot::text, 'UTF8'), 'sha256')`. It does not rely on an unqualified `digest()` lookup. Supabase Auth MFA uses GoTrue APIs; there are no new public database grants and no `service_role` key in this flow. RLS/RPC authorization independently rejects any JWT below AAL2.
