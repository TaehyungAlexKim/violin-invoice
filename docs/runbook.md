# Operations Runbook

## Deployment

Pages must use Source **GitHub Actions**. Public repository Pages are the clearest zero-cost path; private repositories may consume Actions allowance.

## Supabase inactivity

Check Supabase warning email and dashboard weekly. Free projects can pause after inactivity or quota conditions. Keep account recovery codes, email recovery, and the backup decryption key separately.

## Auth email templates

Set Confirmation, Magic Link, and Recovery subject/body/footer text to English. Verify callbacks return to the exact Pages hash route.

## Rollback

Revert the GitHub commit and redeploy Pages. Review database migrations explicitly; never rewrite finalized invoice snapshots.
