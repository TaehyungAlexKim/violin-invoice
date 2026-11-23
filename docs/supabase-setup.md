# Supabase Setup

1. Create a Canada-adjacent Supabase Free project.
2. Disable public self-signup and configure one operator account.
3. Set Auth Site URL to `https://<account>.github.io/violin-invoice/` and add exact Pages redirect URLs.
4. Apply `supabase/migrations/202611220001_initial.sql` with the Supabase CLI.
5. Insert the immutable operator UID:
   ```sql
   insert into public.app_operators(user_id) values ('<auth.users.id>');
   ```
6. Run `supabase test db`.
7. Enable MFA for the operator and configure English Auth email templates.

Use only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the browser build.

The migration installs `pgcrypto` in the `extensions` schema. Finalization hashes the canonical JSON text with `extensions.digest(convert_to(snapshot::text, 'UTF8'), 'sha256')`. It does not rely on an unqualified `digest()` lookup.
