# Operations Runbook

## Shared trusted-operator workspace

- Enroll the invited project owner/admin first, then add the teacher when that account exists; only trusted operators belong in `public.app_operators`.
- Give both rows the same `workspace_owner_id`, choosing one trusted operator's Auth UID as the canonical owner.
- Both accounts may read/write the same settings, students, lessons, draft invoices, and immutable PDF snapshots.
- Do not add a student or parent account to `app_operators`; the application has no student login.
- Before production changes, verify the two rows and helper result:
  ```sql
  select user_id, workspace_owner_id from public.app_operators order by user_id;
  ```
- An unrelated Auth UID, or an operator with only AAL1, must return no application rows and cannot call `finalize_invoice`.

## Deployment

Pages must use Source **GitHub Actions**. Public repository Pages are the clearest zero-cost path; private repositories may consume Actions allowance.

## Supabase inactivity

Check Supabase warning email and dashboard weekly. Free projects can pause after inactivity or quota conditions. Keep account recovery codes, email recovery, and the backup decryption key separately.

## Auth email templates

Set Confirmation, Magic Link, and Recovery subject/body/footer text to English. For implicit recovery,
verify callbacks return to the exact Pages base URL (for example
`https://<account>.github.io/violin-invoice/`) rather than a URL containing `#/reset-password`.

### Password invite/recovery operations

1. Invite or recover only an enrolled operator account.
2. Supabase sends an English email that opens `https://<account>.github.io/violin-invoice/` with an
   implicit recovery token in the fragment. The app parses that token before protected routing and
   moves the `PASSWORD_RECOVERY` session to `/reset-password`.
3. The operator chooses a password of at least 6 characters and confirms it; the app signs out the temporary recovery session after a successful update.
4. Do not create or send a separate app password: this agent does not generate temporary passwords.
5. If the reset page says a recovery link is absent or expired, use **Send reset email** or **Forgot password?** on the login screen.
6. The next sign-in still requires MFA. A first-time operator scans the TOTP QR code or enters the manual secret, verifies the six-digit code, and stores authenticator recovery information securely. Later logins require the authenticator code.

If an operator signs out, the app removes the Supabase session with local scope. If removal fails, it
shows an error, retains the current screen/session, and does not claim success. A 429 reset response
means the operator must wait a few minutes before requesting another email.

## Finalized periods and drafts

- Database trigger enforcement rejects a new lesson, date move, or student move into any finalized
  invoice period for the same workspace owner and student. This is independent of the UI and is in
  migration `202611230005_lesson_period_and_draft_delete.sql`.
- Finalized lessons and invoices remain immutable. Finalization can still claim eligible unlocked
  lessons during its existing transaction.
- Draft invoices can be deleted. Finalized invoice deletion and all finalized mutations remain
  rejected with `Finalized invoices are immutable.`

The password-recovery session and password by themselves never authorize application data. The app re-checks AAL2 before looking up `app_operators`, and database helpers require an AAL2 JWT for every protected table and `finalize_invoice`. No `service_role` key is used; enabling TOTP in the Supabase Auth dashboard is a separate production setting.

## Rollback

Revert the GitHub commit and redeploy Pages. Review database migrations explicitly; never rewrite finalized invoice snapshots.
