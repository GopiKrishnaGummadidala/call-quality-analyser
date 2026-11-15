# Testing

| Layer | Where | Runs against | Count | Command |
|---|---|---|---|---|
| Backend unit + integration | `backend/src/test` | Spring context, MockMvc, H2 (PostgreSQL mode) | 54 | `cd backend && ./gradlew test` |
| Frontend unit / component | `frontend/src/__tests__` | Vitest + Testing Library (jsdom) | 29 | `cd frontend && npm test` (HTML report: `npm run test:report`) |
| Frontend static checks | `frontend` | ESLint, TypeScript | – | `npm run lint && npm run typecheck` |
| End-to-end | `e2e/tests` | Google Chrome + the running Docker stack (HTTPS) | 35 | `cd e2e && npm test` |
| Load | `e2e/load` | The running Docker stack | – | `cd e2e && node load/load-test.mjs` ([load-test.md](load-test.md)) |

## Test data

All layers share one realistic, fully synthetic dataset, re-created on every reset (`POST /api/demo/reset`, platform
operator only) and before every backend and end-to-end test.

**Accounts** (password `Test123` for everyone):

| Username | Name | Account | Loan calls (demo) | Mortgage follow-ups (demo) |
|---|---|---|---|---|
| `alice` | Alice Becker | user | ANNOTATOR | REVIEWER |
| `bob` | Bob Novak | user | REVIEWER | – |
| `erik` | Erik Hansen | user | ANNOTATOR | ANNOTATOR |
| `carol` | Carol Diaz | user | other tenant ("Other bank project") | – |
| `admin` | Dana Fischer | ADMIN | – | – |
| `ops` | Platform Ops (own *Platform operator* tenant) | OPERATOR | – | – |

**Speech.** Nine recorded bank calls (13-22 s each) are generated from `data/calls.json` by
`scripts/generate-audio.ps1` with Windows text-to-speech. Each utterance is synthesised separately (speaker roles
get different pitch and rate) and placed on a timeline, so the manifest holds the **exact** segment boundaries and
transcripts. The joint-application call contains real overlapping speech (700 ms mixed). Regenerate after editing the
scripts:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/generate-audio.ps1
```

**Scenarios.** Every task status is present with a matching history (saves, submit, review, audit events written
in the same shape as the real lifecycle):

| Task | State | Purpose |
|---|---|---|
| `t-call-01` Personal loan: eligibility check | in progress, Whisper draft | model-assisted correction ("€15,000" → words as spoken) |
| `t-call-02` Loan application: missing documents | in progress, first segment drafted | autosave, two-tab conflict |
| `t-call-03` Affordability review | submitted | reviewer request-changes / approve |
| `t-call-04` Identity check before discussing the account | approved | read-only view, audit trail, pseudonymised name and account digits |
| `t-call-05` Early repayment fee question | changes requested, wrong speaker on segment 2 | annotator fixes reviewer feedback |
| `t-call-06` Joint application call (Erik) | in progress, Whisper draft, overlapping co-applicant | lanes, CROSSTALK, waveform |
| `t-call-07` Repayment holiday request (Erik) | submitted | approval makes it read-only |
| `t-call-08/09` Mortgage calls (Erik) | submitted / in progress, project *Mortgage follow-ups* | per-project roles (Alice reviews) |
| `t-score-01…05` QA scorecards | all states | scorecard lifecycle: checks, outcome, notes rules; one scores a breach |
| `t-audio-1/2`, `t-score-1`, `t-b-1` | original core set | stable fixtures for the backend integration tests |

## Backend tests (54)

- `WorkflowIntegrationTest` (12): save + submit, read-only after submit with exactly one audit event, incomplete
  submission rejected with actionable messages, invalid transitions, reviewer role/state/own-work rules,
  cross-project and cross-tenant denial (404), missing/invalid/legacy auth (401), stale write 409 without overwrite,
  stale editor after review, audit and transition roll back together, schema validation, second task type, WER.
- `ModelDraftIntegrationTest` (4): drafted tasks start from the stored model draft with provenance, drafts are
  pseudonymised, corrections are measured on approved transcripts only and grow with approvals, undrafted tasks
  have no draft.
- `TenantIsolationIntegrationTest` (3): only the platform operator resets (every tenant restored), the operator
  sees tenant counts but no tasks, recordings or admin pages, tenant admins cannot use platform endpoints.
- `AuthIntegrationTest` (6): every account signs in, bcrypt-only storage, identical failure for wrong password and
  unknown user, forged token rejected, project roles come from memberships, admin-only endpoints (403/401).
- `TaskListIntegrationTest` (2): tasks come most recently modified first, page by page with whole-project counts,
  status filter, case-insensitive search with literal wildcards and a capped page size; saving an edit moves the
  task to the top.
- `UserManagementIntegrationTest` (5): an admin creates a user who signs in and sees exactly the projects given
  (bcrypt, audited without the password); invalid input reports every reason and other organisations' projects
  look unknown, duplicate usernames 409; project-role edits apply on the next request; a password reset or new
  account role ends open sessions; admins cannot remove their own admin role or reach other organisations, users
  get 403.
- `SeedDataIntegrationTest` (4): every status present and every seeded payload valid for its schema and duration,
  seeded history equals what the lifecycle writes, seeded tasks keep working through review/fix/resubmit, roles per
  project.
- `AccessControlIntegrationTest` (4): recordings only for project members (401/404/200, `no-store`, real WAV),
  task detail exposes the API URL not the storage path, views/recording reads/denied attempts logged in order,
  admin access log is tenant-scoped with outsiders unnamed.
- `DatasetIntegrationTest` (5): only approved work released with lineage, splits and audio checksums; text
  de-identified and person tokens release-local; releases immutable with stable splits; admin-only, tenant-scoped,
  audited; nothing to release → 422 and no empty release.
- Unit: `DeidentifierTest` (3), `WerCalculatorTest` (3), `PseudonymizerTest` (2), `TaskStatusTest` (1).

## Frontend tests (29)

Editor registry resolution and unsupported types; validation blocking submit; autosave states, retry and
conflict; read-only mode; shortcuts not firing while typing; reviewer reason required; sign-in error, success and
expired sessions; invalid fields marked red (`aria-invalid`) with their message after a submit attempt and cleared as they are fixed (transcript, review reason, sign-in), and validation messages mapped to fields; the admin overview for admins without a project; the add/edit user dialog (red fields, nothing sent while invalid, payload with project roles, fixed username and own admin role locked when editing); client-side paging (ten rows a page, no pager for one page). QA scorecard rules shared with the server, recording check results and the outcome, red notes and outcome with the reason.

## End-to-end tests (35)

Playwright, accessibility-first locators (roles and labels), one test at a time against freshly reset data.

| Spec | Covers |
|---|---|
| `auth.spec.ts` | sign-in screen for deep links and return to them, wrong password, demo-account shortcut, sign-out, rejected token; admin page for admins only (UI and API 403), demo reset only by the platform operator (admin gets 403), operator sees organisations but no customer tasks |
| `annotation.spec.ts` | queue counts/tabs/search, submit validation (empty field red until filled) then autosave + submit + back to the queue with a confirmation, correcting the speech model's draft (model draft → edited, original shown, unchanged count), edits survive reload, fixing reviewer feedback, real-speech waveform/segment playback/overlap/`N` shortcut, a QA scorecard (every check answered, a failed check needs notes and cannot be compliant) |
| `review.spec.ts` | review queue, reason required, audit entries, annotator sees the reason, approval makes the task read-only, no review on unsubmitted work |
| `access.spec.ts` | other tenant cannot see or open tasks, per-project roles (Alice reviews in one project, annotates in the other) |
| `concurrency.spec.ts` | stale second tab gets a conflict and reloads, two simultaneous review decisions |
| `evaluation.spec.ts` | WER per model and the honesty notes, real draft corrections measured on approved work |
| `security.spec.ts` | HTTP redirects to HTTPS, security headers, no Content-Security-Policy violations while a real task loads, no public audio URLs, recordings only via the API and played from `blob:`, access log incl. denied attempts |
| `datasets.spec.ts` | admin creates a release in the UI, preview shows surrogates and the audio flag, downloaded manifest matches its SHA-256 and contains no names; reviewers cannot see or export |
| `queue.spec.ts` | queue pages (10 per page, page 2 in the address bar), newest change first, a task edited just now moves to the top |
| `users.spec.ts` | admin adds a user (empty fields red first), the new user signs in with the form and sees only the project and role given; an admin password reset signs the user's open tab out and the new password works |
| `smoke.spec.ts` | sign-in to submit button, no horizontal scroll, on desktop **and** a phone viewport |

### Running

```bash
docker compose up --build -d          # stack on https://localhost:8443 (self-signed)
cd e2e
npm install
npm test                              # runs in the installed Google Chrome
npx playwright test --headed          # watch it
npx playwright show-report            # HTML report with traces and screenshots of failures
```

- `E2E_BASE_URL=http://localhost:5173` runs against `npm run dev` instead (the local certificate is accepted
  automatically for the default https://localhost:8443).
- No Chrome on the machine? Run `npx playwright install chrome` once (CI does this with `--with-deps`).
- `E2E_VIDEO=1` records videos of failures (needs `npx playwright install ffmpeg`).
- The suite resets the demo data before every test; do not point it at an environment with data you need.

## CI

`.github/workflows/ci.yml` runs backend tests, frontend lint/typecheck/tests/build, and the end-to-end suite
against `docker compose` on every push and pull request; Playwright reports are uploaded when it fails.

## Conventions

- Test behaviour through the public surface (HTTP for the backend, roles/labels for the UI).
- Every bug fix gets a test at the lowest layer that can reproduce it.
- Never assert on exact timestamps or generated ids; seed data ids (`t-call-…`) are stable on purpose.
- Keep end-to-end tests independent: the auto fixture resets data, tests never rely on each other's state.
