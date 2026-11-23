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

## Rollback

Revert the GitHub commit and redeploy Pages. Review database migrations explicitly; never rewrite finalized invoice snapshots.
