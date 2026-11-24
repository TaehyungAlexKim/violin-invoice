# Frontend modernization work order

## Lesson notes and student archive contract

- Lesson notes are optional, UTF-16-size? Limited to a database/UI cap of 300 characters. The UI trims leading/trailing whitespace and stores `NULL` for an empty note. The snapshot preserves the complete normalized note scalar; PDF rendering is display-only and clamps it to at most three visual lines with deterministic ellipsis.
- Finalized snapshots use PDF template `2.0` and include a `note` line field when present. Template `1.0` snapshots remain downloadable without note rows.
- Students use `archived_at timestamptz` soft archive semantics. Archived students remain in existing lesson/invoice relationships and snapshots, but are filtered from active selectors and lists. Database triggers reject new lessons or drafts owned by archived students. No student hard delete is exposed by the UI.

## Objective

Improve the violin lesson invoice application for mobile use, reliability, accessibility, and maintainability without changing its established product rules.

Preserve:

- English-only UI
- CAD and `America/Vancouver`
- GitHub Pages + HashRouter
- Supabase Auth/Postgres + shared admin/teacher workspace
- Required TOTP MFA and database-enforced AAL2
- RLS, immutable finalized invoices, actual entered lesson charges, and snapshot-only PDF downloads
- No paid service, privileged browser key, customer-data fixture, database dump, or secret in source/build

Do the work on a new feature branch. Validate before any merge or Pages deployment. A pull request must run all frontend and Supabase tests before this work reaches `main`.

## Required scope

### 1. Query and route reliability

Replace ambiguous loading behavior with explicit states:

- `idle`, `loading`, `success`, `empty`, `error`, and `not-found` as applicable
- Display a recoverable English error and Retry action for network, RLS, or service failures
- Never render a successful empty state while a query is loading or failed
- Distinguish unauthenticated, denied, AAL1, and transient authorization-check failure
- Expired sessions return to login
- A temporary Supabase/MFA/operator lookup failure shows Retry without falsely displaying Access denied or signing out
- Remove the Settings `user!` assertion and handle a missing/stale user safely

Prevent stale route races:

- Clear scoped detail state when `:id` changes
- Cancel/guard superseded student and invoice requests
- Rapid navigation A → B → A must only render the final route's data

### 2. Mutation safety

Add synchronous pending state and disabled controls for:

- Teacher settings
- Student add/edit/delete
- Lesson add/edit/delete
- Invoice draft create/save/delete
- Invoice finalization

Prevent duplicate submissions from double taps/retries. Preserve and reuse stable operation identity/idempotency keys where retrying can create a duplicate lesson or draft.

Validate successful Supabase RPC payloads at runtime. Wrap the complete invoice finalization flow in `try/catch/finally`; if Supabase committed but a later UI/PDF action fails, refetch the persisted invoice and retain a usable finalized detail/download state.

### 3. Mobile and responsive UX

Target tested widths: 320, 375, 390, 430, 768, and 1280 pixels.

Required behavior:

- No horizontal document/page overflow
- Lesson table becomes a mobile card/list presentation at narrow widths, or an equivalent accessible pattern without off-screen actions
- Date, student, minutes, charge, status, Edit, and Delete remain discoverable
- Mobile navigation keeps all destinations immediately discoverable
- Inputs and action targets are at least 44×44 CSS pixels
- Student/account/invoice cards and form grids handle long names, emails, addresses, and invoice numbers with safe wrapping
- Preserve native date controls and numeric input modes
- Use visible focus indicators
- Keep English-only content and CAD formatting

### 4. Destructive and irreversible actions

Use a reusable confirmation pattern instead of bare destructive buttons:

- Lesson deletion
- Student deletion
- Draft deletion
- Invoice finalization

Invoice finalization confirmation must summarize:

- Student
- Inclusive service period
- Eligible lesson count
- Total CAD amount

Use a visually distinct danger treatment and keyboard-accessible confirmation. Native `window.confirm` is not the final UX.

### 5. Component and design-system cleanup

Consolidate the current one-file UI into clear boundaries:

- Auth/recovery/MFA provider and components
- Route shell and navigation
- Pages: Settings, Students, StudentDetail, Lessons, Invoices, InvoiceDetail
- Shared components: Button, Field, StatusMessage, Loading, EmptyState, Card, PageHeader, ConfirmationDialog
- Data repositories/query hooks
- Domain validators and Supabase error normalization
- PDF service and browser download adapter

Do not make abstractions that hide simple behavior or duplicate a framework. Start with page-level extraction, then extract shared behavior proven to repeat.

Add generated or explicit Supabase `Database` row/RPC types. Validate external JSON instead of asserting arbitrary successful Supabase responses as `InvoiceSnapshot`.

### 6. Styles and accessibility

Consolidate the current global and starter-template styles:

- One documented token system
- Consistent colors, typography, spacing, borders, status, danger, and interaction states
- Remove dead dark-mode/starter styles if not part of the product
- Add `:focus-visible`, disabled, hover, active, error, success, danger, loading, and empty-state styles
- Error messages use `role="alert"`; progress/success uses `role="status"`
- Give scroll regions accessible names and keyboard focus only if scrolling remains
- Add `aria-current="page"` for active navigation
- Add appropriate autocomplete tokens to name, email, phone, and address fields
- Keep form labels visible

Display dates:

- Keep database/input values as ISO `YYYY-MM-DD`
- Add one shared `en-CA` visible-date formatter for cards, lists, details, and supporting PDF text
- Format audit timestamps for `America/Vancouver`
- Do not create timezone shifts

### 7. PDF/mobile performance

Preserve exact snapshot-only invoice rendering and the version/font manifest safeguards.

Measure and reduce the PDF first-use cost:

- Current pdfmake chunk is approximately 833 KB
- Current Korean font is approximately 10 MB
- Investigate a licensed, legally distributable subset or smaller Unicode font covering required Korean/Latin/glyph cases
- Preserve normal/bold and Korean/English correctness or explicitly record the supported font-weight contract
- Keep a deterministic manifest/hash and version registry
- Do not silently swap historical snapshot assets
- Keep finalization success separate from PDF delivery and retry
- Do not start a 10 MB font transfer unnoticed; show preparation progress

At minimum, provide a measured 375px slow-3G behavior with documented transfer time/size and a usable progress/retry state.

### 8. CI and end-to-end coverage

Add PR CI:

- Frontend unit/component/interaction tests
- Typecheck
- Lint
- Production build
- Artifact secret scan
- Supabase migration/RLS/finalization tests

Keep Pages deployment separate:

- PR jobs must not deploy
- `main` deployment needs all checks
- Preserve `dist`-only Pages publishing and minimum permissions
- Pin Actions dependencies

Add browser/E2E coverage:

- Login, MFA enrollment/challenge, recovery, and logout
- Shared admin/teacher operator access
- Students, lessons, draft creation, range preview, finalization, and PDF download
- AAL1/denied/transient-error states
- Rapid route changes and stale-response protection
- Double taps and pending-state behavior
- Draft deletion and finalized deletion refusal
- Mobile viewports and keyboard/focus behavior

At least one test must exercise actual pdfmake browser VFS registration, Blob generation, and download path. Existing tests for this remain and must not be mocked away.

### 9. Refactoring acceptance constraints

Do not combine refactoring with product-rule redesign. Do not add a student portal, email sending, tax, payments, or new persistence provider.

Do not let a refactor:

- weaken AAL2, RLS, grants, immutability, or finalized-period protections
- expose `sb_secret`, service-role, DB passwords, tokens, recovery codes, or TOTP secrets
- move PII into repository fixtures, Actions artifacts, logs, or Pages source
- replace Supabase snapshot JSON with live-row PDF rendering
- make finalized invoices editable

## Suggested implementation order

1. Add behavioral/query/mutation test scaffolding.
2. Introduce explicit data states, request guards, and error normalization.
3. Add safe mutation pending/idempotency behavior.
4. Extract auth router/providers without changing semantics.
5. Extract pages and shared UI components.
6. Implement mobile cards/navigation/confirmation/accessibility styles.
7. Add PDF payload validation and recoverable finalization/PDF behavior.
8. Add date formatter and long-content handling.
9. Measure and optimize font/PDF transfer.
10. Add PR/CI separation and browser E2E.
11. Update runbooks and README.

## Required verification

Before completion:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:db
node scripts/check-dist.mjs
git diff --check
```

Also verify:

- No secrets or PII in `dist`, source fixtures, logs, or artifacts
- 320, 375, 390, 430, 768, and 1280px viewport checks
- Keyboard-only navigation and visible focus
- No horizontal page scrolling
- 44px minimum interactive targets
- English-only UI/PDF
- Slow-3G PDF behavior and measured transfer size/time
- All existing AAL2/RLS/concurrency/immutability tests remain passing

## Handoff prompt

Implement the full scope in this document for `/Users/taehyungkim/violin-invoice` on a new feature branch. Do not change the product's documented security/data rules. Do not commit, push, merge, or deploy until the parent agent reviews the implementation. Follow the implementation order and provide exact tests and validation results. Report any decision that genuinely requires product-owner input; do not silently redesign.
