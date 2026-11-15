# Call Quality Analyser

Call transcription and quality assurance for a bank's recorded customer calls (loan eligibility, affordability,
fees, mortgage follow-ups). A speech model drafts each transcript and people correct it; QA analysts score each
call against conduct checks; reviewers approve both; approved work measures the speech model (WER) and becomes
de-identified training data. **Seeded task queue → call transcription → autosave → submit → four-eyes review →
audit history**, plus a second task type (the QA scorecard) and a reproducible model-evaluation page.

*React + TypeScript SPA · Kotlin / Spring Boot API · PostgreSQL · Flyway · Docker Compose · Playwright*

**Docs:** [data flow (customer data → model)](docs/data-flow.md) · [architecture](docs/architecture.md) · [assumptions](docs/assumptions.md) ·
[concurrency](docs/concurrency.md) · [design rationale](docs/design-rationale.md) · [testing](docs/testing.md) ·
[load test](docs/load-test.md) · ADRs: [task types](docs/adr/0001-task-type-extensibility.md),
[optimistic concurrency](docs/adr/0002-optimistic-concurrency.md), [transactional audit](docs/adr/0003-transactional-audit.md)

> **Honesty notes.** Data is fully synthetic and seeded: an invented bank, customers, amounts and accounts. The
> calls are real speech produced by text-to-speech from scripts in `data/calls.json` (the two oldest clips are
> placeholder tones). First drafts are **real model output** from Whisper (`base.en`, run offline by
> `scripts/draft_with_whisper.py`, never edited by hand). The two "model" outputs in
> `backend/src/main/resources/fixtures/model-outputs` are **hand-written samples, not real model output**, and the UI says so. Sign-in is local username/password with a self-issued JWT,
> and every demo account shares the password `Test123`. Not OIDC/SSO.
> It is not GDPR or PCI DSS compliant merely because the data is synthetic.

## Prerequisites
JDK 21, Node 22+, Docker (for PostgreSQL / the one-command start).

## Run it

**One command (everything in containers)**
```
docker compose up --build        # UI: https://localhost:8443 (self-signed: accept the warning once)
                                 # http://localhost:8080 only redirects; the API is not exposed directly
```

**Local development**
```
docker compose up db                         # PostgreSQL only
cd backend  && ./gradlew bootRun             # API on :8080, runs Flyway + seeds demo data
cd frontend && npm install && npm run dev    # UI on http://localhost:5173 (proxies /api to :8080)
```

## Sign in
Every seeded account uses the password **`Test123`** (configurable with `DEMO_PASSWORD`; stored only as a bcrypt hash).
The sign-in page lists the demo accounts; click one to fill it in.

| Username | Name | Tenant | Account role | Project role |
|---|---|---|---|---|
| `alice` | Alice Becker | Northbridge Bank (demo) | user | ANNOTATOR on "Loan calls", REVIEWER on "Mortgage follow-ups" |
| `bob` | Bob Novak | Northbridge Bank (demo) | user | REVIEWER on "Loan calls (demo)" |
| `erik` | Erik Hansen | Northbridge Bank (demo) | user | ANNOTATOR on both projects |
| `carol` | Carol Diaz | Other Bank | user | ANNOTATOR on a different project (shows cross-tenant denial) |
| `admin` | Dana Fischer | Northbridge Bank (demo) | **ADMIN** | none (users, access log, training data of the bank) |
| `ops` | Platform Ops | Platform operator | **OPERATOR** | none (tenant overview and demo reset; no customer data) |

**How it works.** `POST /api/auth/login` checks the bcrypt hash and returns an HS256 JWT (8 h, issuer
`call-quality-analyser`, account role in the `roles` claim). The SPA keeps it in `localStorage` (shared by tabs, so the
two-tab conflict demo still works) and sends it as `Authorization: Bearer …`; a 401 returns the user to the sign-in
screen. Spring Security validates the token on every `/api/**` call (stateless, no cookies, so CSRF is off).
Project roles are **not** in the token: they are read from `project_membership` on every request.
Set `JWT_SECRET` (at least 32 bytes) for anything beyond a local demo.

**Roles.** *Annotator* and *reviewer* are per-project; *admin* and *operator* are account roles. A tenant admin
manages only their own organisation (*Users & roles*, access log, training data). The platform **operator** lives
in its own tenant, sees tenant sizes but no customer content, and is the only one who may reset the demo data
(`POST /api/demo/reset` re-seeds every tenant; disable entirely with `app.demo-endpoints.enabled=false`). The UI hides what a role cannot do, but every rule is
enforced by the server (401 without a valid token, 403 for the wrong role, 404 outside your projects).

## Test data
Nine recorded bank calls (agent, customer, sometimes a co-applicant) with **real synthesised speech** and exact
segment timings, five QA scorecards for those calls, and tasks in every status with matching reviews and audit
history (details in [docs/testing.md](docs/testing.md#test-data)). Edit `data/calls.json` and regenerate the
recordings (Windows text-to-speech):
```
powershell -ExecutionPolicy Bypass -File scripts/generate-audio.ps1
```
The platform operator (`ops`) restores the dataset at any time from *Platform → Reset demo data*.

## Model-assisted annotation
A speech model writes the first draft and the annotator listens and corrects it. Drafts come from Whisper
(`base.en` via faster-whisper), run offline over every segment; they are stored unchanged in `model_draft` with the
model name, version and provenance, pseudonymised on ingest, and pre-fill *Personal loan: eligibility check* and the *joint application call*.
The editor marks each segment **model draft** until a human changes it, then **edited** with the original draft
underneath. The evaluation page measures the drafts against what reviewers **approved** (words corrected,
segments accepted as-is), so the numbers are real and grow with every approval. Regenerate the drafts:
```
python -m venv .venv-whisper && .venv-whisper/Scripts/python -m pip install faster-whisper==1.2.1
.venv-whisper/Scripts/python scripts/draft_with_whisper.py
```

## Tests
```
cd backend  && ./gradlew test                # 54 integration/unit tests on H2 (PostgreSQL mode), no Docker needed
                                             #   report: backend/build/reports/tests/test/index.html
cd frontend && npm run lint && npm run typecheck && npm test && npm run build    # 29 tests
cd frontend && npm run test:report                                               #   HTML report of the last run
docker compose up --build -d && cd e2e && npm install && npm test               # 35 Playwright end-to-end tests
cd e2e && npx playwright show-report                                            #   HTML report of the last run
cd e2e && node load/load-test.mjs --vus 50 --duration 30                        # load test
```
What each layer covers, the test data and how to debug failures: [docs/testing.md](docs/testing.md).
Load-test method and measured results: [docs/load-test.md](docs/load-test.md).

**CI:** `.github/workflows/ci.yml` runs the backend and frontend suites, then the end-to-end tests and a short
load test against `docker compose` on every push and pull request.

## QA scorecard
A QA analyst scores a transcribed call against seven conduct checks, each **pass**, **fail** or **not applicable**:
identity verified, purpose of the call stated, affordability checked, costs disclosed, right to withdraw explained,
no pressure selling, next steps confirmed; plus an overall outcome (*compliant*, *needs coaching*, *breach*) and
notes. Every check needs an answer, a failed check needs notes, and a call with a failed check cannot be scored
compliant: the same rules in the editor and on the server (`CallScorecardTaskType`). Scorecards go through the
same review, audit and release pipeline as transcripts.

## Demo flow (7–8 min)
1. Alice → open *Personal loan: eligibility check* (real speech, Whisper draft) → correct "€15,000" to the spoken words, try `K` (play/pause) outside a field, watch autosave states.
2. Click *Submit* with an empty segment → the field turns red with an actionable message. Fix it, submit: you are back on the task queue with a confirmation and pick the next task yourself.
3. Bob → *Review queue* → request changes with a reason (reason is mandatory) or approve. Inspect *Audit history*.
4. Open *QA: loan eligibility call*: score the conduct checks; same lifecycle, different editor (task-type registry).
5. *Evaluation*: WER from committed fixtures, definition, dataset size and the "illustrative only" disclaimer.
6. Show the tests: concurrency (409), authorization (cross-tenant 404), transactional audit.

To show the **409 flow**: open *Loan application: missing documents* in two tabs as Alice, edit in tab A (autosaves), then edit in tab B.

## Architecture
```
frontend/src/{app,features/{tasks,annotation,review,audit,evaluation},task-editors,shared}
backend/src/main/kotlin/com/callquality/analyser/{auth,tasks,annotations,audit,datasets,drafts,evaluation,demo,common}
```
- **Task types** – `task_type` + `schema_version` on every task; payload validated against a JSON Schema
  (`resources/schemas`) plus per-type rules (`TaskTypeDefinition`); frontend resolves the editor from a registry.
  Lifecycle code never mentions a concrete type. ([ADR 0001](docs/adr/0001-task-type-extensibility.md))
- **Concurrency** – `annotation.version` compare-and-set on save/submit, row lock on the task serializes
  save/submit/review. ([ADR 0002](docs/adr/0002-optimistic-concurrency.md))
- **Audit** – inserted in the same transaction as the state change. ([ADR 0003](docs/adr/0003-transactional-audit.md))
- **Authentication** – bcrypt passwords, stateless JWT bearer tokens validated by Spring Security; the token
  subject is resolved to a live user on every request.
- **Authorization** – user → project membership (inside the user's tenant) → role, resolved server-side on every
  endpoint. Non-members get 404 (existence is not revealed); wrong role gets 403; reviewers cannot review their own tasks.
- **Privacy** – seed data passes through a pseudonymizer; logs contain ids, status, duration and `correlationId`
  (ECS JSON format) but never transcript text, audio or tokens.

## API
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/login` | `{username, password}` → `{token, expiresAt, user}`; 401 on bad credentials |
| GET | `/api/auth/me` | The signed-in user and account role |
| GET | `/api/admin/users` | ADMIN: accounts and project roles in the admin's tenant |
| POST | `/api/demo/reset` | OPERATOR: re-seed the demo data of every tenant |
| GET | `/api/platform/tenants` | OPERATOR: tenants with user, project, task and release counts (no content) |
| GET | `/api/me/projects` | Projects + role of the caller |
| GET | `/api/projects/{id}/tasks?status=&type=&q=&page=&size=` | Authorized task list, newest change first, paged |
| GET | `/api/tasks/{id}` | Task, schema, annotation + version, viewer permissions |
| PUT | `/api/tasks/{id}/annotation` | Save `{expectedVersion, payload}`; 409 `STALE_VERSION` |
| POST | `/api/tasks/{id}/submit` | `{expectedVersion}`; 409 `INVALID_TRANSITION`, 422 on incomplete |
| POST | `/api/tasks/{id}/review` | `{decision: APPROVE\|REQUEST_CHANGES, comment}` |
| GET | `/api/tasks/{id}/audit` | Audit history |
| GET | `/api/tasks/{id}/audio` | The task's recording (members only, access-logged, `no-store`) |
| GET | `/api/admin/projects` | ADMIN: projects of the tenant with approved-task counts |
| POST | `/api/admin/projects/{id}/datasets` | ADMIN: create the next de-identified release (422 if nothing is approved) |
| GET | `/api/admin/projects/{id}/datasets` · `/api/admin/datasets/{id}` | ADMIN: releases, one release with a preview |
| GET | `/api/admin/datasets/{id}/manifest.jsonl` | ADMIN: the manifest (JSON Lines, `X-Manifest-SHA256`), audited |
| GET | `/api/admin/access-log` | ADMIN: who viewed which task or recording, incl. denied attempts |
| GET | `/api/projects/{id}/evaluation` | WER from fixtures |

## Training data releases
Admins turn **approved** transcripts and scorecards into versioned, de-identified, immutable releases (*Training
data* page): names re-keyed to release-local surrogates, IBANs, card numbers, phones, dates, e-mails, IDs and URLs removed, stable train/val/test splits,
lineage per record, SHA-256 per manifest, release and every download audited. Recordings are referenced by hash and
flagged `contains_identifiers` (audio is not de-identified). Details and open risks: [docs/data-flow.md](docs/data-flow.md).

## Security controls
| Control | How |
|---|---|
| Encryption in transit | nginx terminates TLS (1.2/1.3, HTTP/2) on :8443; port 8080 only redirects. Self-signed locally, mount a real certificate at `/etc/nginx/certs`. The API has no published port. |
| Recordings | Never public files: `GET /api/tasks/{id}/audio` serves them to project members only (`no-store`); the browser plays them from memory (`blob:`). |
| Read-access log | Every task view and recording fetch, allowed or denied, is written to `access_log` **before** data is returned (no unlogged access). Admins see it under *Users & roles*. |
| Browser hardening | Content-Security-Policy (no inline or third-party script), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, Permissions-Policy. |
| Access control | Bearer JWT, project roles checked per request, tenant isolation, 404 outside your projects, four-eyes review. |
| Tenancy | Shared schema with `tenant_id` on users and projects; every query scoped to the caller's tenant. Tenant admins act only in their own tenant; platform operations (tenant overview, demo reset) belong to an operator outside every tenant who cannot read customer content. |
| Data minimisation | Names and numbers pseudonymised on ingest; logs never contain transcripts, audio or tokens. |

Still missing for real customer calls: encryption at rest, retention/deletion, SSO + MFA, HSTS on the real domain,
a DPA with every processor, PCI DSS scoping of card data in recordings; see *Production hardening* below.

## Known limitations
No uploads, claiming, real inference or realtime collaboration. The task queue is paged on the server (offset
pages, most recently modified first); the admin tables page in the browser over the newest 50-100 entries. Autosaves are not
audited individually (only state transitions are). Backend tests use H2 in PostgreSQL mode; payloads are stored as
`TEXT` (not `JSONB`) so the same migrations run on both.

## Production hardening (not implemented)
OIDC/SSO instead of local passwords, token refresh/revocation, login rate limiting and password policy; object storage for recordings with encryption at rest; durable job queue for model runs;
EU hosting, encryption at rest, HSTS, least privilege, retention/deletion, backups, secrets management,
access reviews and incident response; DPAs, DPIA and call-recording consent; metrics + tracing + audit monitoring; Testcontainers
against real PostgreSQL in CI; keyset pagination for very large projects; rate limiting.
