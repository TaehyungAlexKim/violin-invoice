# Violin Lesson Invoices

English-only, single-operator invoice SPA for GitHub Pages and Supabase.

## Local setup

1. Copy `.env.example` to `.env.local` and use only a public Supabase URL/publishable key.
2. Run `npm ci`.
3. Run `npm run dev`.

Never put a service role key, secret, database credential, or signing key in Vite environment variables.

## GitHub Pages variables

In the repository, open **Settings → Secrets and variables → Actions → Variables** and add:

- `VITE_SUPABASE_URL`: the Supabase project URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the public `sb_publishable_...` key.

Do not add these as Secrets or use `sb_secret_...`, `service_role`, database passwords, or signing keys. Repository Variables are public in the built Pages bundle. A missing variable fails the deployment build.

## Password recovery

The login screen provides **Forgot password?**, and invitation/recovery links open `/reset-password` inside the HashRouter app. Supabase must allow the exact Pages redirect `https://<account>.github.io/violin-invoice/#/reset-password`. Password updates require at least 6 characters. The app creates no temporary or random application password.

## Validation

```bash
npm test
npm run typecheck
npm run lint
npm run build
node scripts/check-dist.mjs
supabase test db
```
