# Operations Runbook

## Shared trusted-operator workspace

- Enroll exactly the teacher and project owner/admin in `public.app_operators`.
- Give both rows the same `workspace_owner_id`, choosing one trusted operator's Auth UID as the canonical owner.
- Both accounts may read/write the same settings, students, lessons, draft invoices, and immutable PDF snapshots.
- Do not add a student or parent account to `app_operators`; the application has no student login.
- Before production changes, verify the two rows and helper result:
  ```sql
  select user_id, workspace_owner_id from public.app_operators order by user_id;
  ```
- An unrelated Auth UID must return no application rows and cannot call `finalize_invoice`.

## Deployment

Pages must use Source **GitHub Actions**. Public repository Pages are the clearest zero-cost path; private repositories may consume Actions allowance.

## Supabase inactivity

Check Supabase warning email and dashboard weekly. Free projects can pause after inactivity or quota conditions. Keep account recovery codes, email recovery, and the backup decryption key separately.

## Auth email templates

Set Confirmation, Magic Link, and Recovery subject/body/footer text to English. Verify callbacks return to the exact Pages hash route.

### Password invite/recovery operations

1. Invite or recover only an enrolled operator account.
2. Supabase sends an English email that opens `https://<account>.github.io/violin-invoice/#/reset-password`.
3. The operator chooses a password of at least 6 characters and confirms it; the app signs out the temporary recovery session after a successful update.
4. Do not create or send a separate app password: this agent does not generate temporary passwords.
5. If the reset page says a recovery link is absent or expired, use **Send reset email** or **Forgot password?** on the login screen.

## Rollback

Revert the GitHub commit and redeploy Pages. Review database migrations explicitly; never rewrite finalized invoice snapshots.
