# Design rationale

The main decisions, the alternatives considered, and why this one was taken. Architecture decision records
with more detail: [ADR 0001](adr/0001-task-type-extensibility.md) (task types),
[ADR 0002](adr/0002-optimistic-concurrency.md) (concurrency), [ADR 0003](adr/0003-transactional-audit.md) (audit).

## Domain and data

**Task-type registry instead of type-specific endpoints.** Every task carries `task_type` + `schema_version`; the
payload is validated against a JSON Schema plus per-type rules on the server, and the frontend resolves the editor
from a registry. Lifecycle, autosave, review and audit never mention a concrete type. *Alternative:* one table and
controller per type, which duplicates the lifecycle and makes every new type a cross-cutting change.
*Trade-off:* payloads are less queryable than columns.

**`TEXT` payloads validated in the application, not `JSONB`.** Keeps migrations portable so the integration suite
runs on H2 without Docker. *Alternative:* `JSONB` with GIN indexes once analytics on payloads are needed (and
Testcontainers for tests).

**Explicit status machine with compare-and-set transitions.** A small enum with `canTransitionTo` is easy to
review and test; the database guarantees each transition happens once ([concurrency.md](concurrency.md)).

**Audit in the same transaction.** An audit trail that can disagree with the data is worse than none.
*Alternative:* outbox/event stream, needed later for analytics, but still written transactionally.

**Pseudonymise on ingest.** Seeded text passes through the pseudonymizer before it is stored, so the database
and logs never hold the original names. *Alternative:* masking at display time leaves raw data at rest.

**Realistic test data from synthesised speech.** Clips are generated utterance by utterance with text-to-speech
and stitched on a timeline the generator controls, so every segment boundary and transcript is exact ground truth,
overlapping speech is real (mixed audio), and no real person's voice or data is involved. *Alternatives:* public
speech corpora (licensing, not banking conversations, no reliable segment timings) or recordings of staff (personal data).

## Security

**Stateless JWT bearer tokens.** Easy to scale horizontally, no session store, works the same for the SPA, tests
and the load tool. HS256 with a server-side secret is enough for one issuer/one audience. *Alternative:* server
sessions with cookies (simpler revocation, needs CSRF protection), or OIDC (the right production choice; the API
already only depends on "a verified subject").

**Only the account role in the token; project roles read per request.** Removing someone from a project takes
effect on their next request instead of when the token expires. Costs one indexed lookup per request.

**404 for non-members, 403 for the wrong role.** Non-members cannot probe which projects or tasks exist; members
get a clear message when a role is missing.

**bcrypt via `DelegatingPasswordEncoder`.** Industry default, stored as `{bcrypt}…` so the algorithm can be
upgraded transparently. Same error and similar timing for unknown users and wrong passwords.

**Token in `localStorage`.** All tabs share the session, required for the two-tab conflict workflow, and with no
cookies there is no CSRF surface. *Trade-off:* readable by injected script, mitigated by React's escaping, no
`dangerouslySetInnerHTML`, and a short-ish lifetime. The production path is OIDC with `HttpOnly` cookies.

**Recordings through the API, played from memory.** The browser fetches the clip with the Bearer token and plays
a `blob:` URL, so recordings never have a public or guessable address and every fetch is access-logged.
*Alternative:* short-lived signed URLs from object storage, the production choice for long recordings (streaming,
range requests), with the same authorisation check before signing.

**A separate read-access log, written before data is returned.** GDPR accountability and banking audits expect "who saw what" to be answerable;
mixing reads into the task's audit trail would bury the state changes. Denied attempts are logged too, and a
failed log write fails the read. *Trade-off:* one insert per task view (about +2 ms, see the load test).

**TLS at the edge, API not exposed.** nginx terminates TLS and sends a strict Content-Security-Policy; the API and
database have no published ports, so the only way in is HTTPS through the proxy. HSTS is left to the real domain
because on `localhost` it would pin every local dev server to HTTPS.

**Releases are immutable snapshots of approved work.** Training must be reproducible: a model card names a release
version and hash, and that release can never change. Only `APPROVED` annotations enter (the four-eyes gate is the
quality gate). *Alternative:* exporting live tables on demand, which makes "what was this model trained on?"
unanswerable.

**Release-local surrogates instead of the ingest tokens.** Ingest tokens are derived from the name and so
linkable and reversible; surrogates numbered per release keep "same person within a conversation" for the model
without carrying identity or linking releases.

**Splits from a hash of the task id.** Stable across releases without storing state, so evaluation data never
drifts into training when a new version adds tasks.

**Tenant administration and platform operation are different roles.** A tenant admin acts only inside their own
organisation; anything that spans tenants (the demo reset, the tenant overview) belongs to an operator who lives in
a separate platform tenant and cannot read customer content. *Found in review:* the reset was first ADMIN-only, which
let one customer's admin wipe every customer's data.

**Model-assisted annotation measured on approved work.** The model's draft is stored unchanged next to the
annotation, so the app can show what the model wrote and measure what humans changed. Corrections are computed only
on APPROVED tasks, where a reviewer confirmed the final text, which turns everyday annotation into a real evaluation
signal. *Alternative:* comparing drafts with in-progress text, which would count unfinished work as model errors.

## Concurrency

**Optimistic versions + a short row lock** rather than edit locks: see [concurrency.md](concurrency.md).

## Frontend

**React Query for server state, local state for the editor.** Caching, invalidation after transitions and
loading/error states come for free; the editor's undo stack and autosave stay local and explicit.

**Autosave with explicit states** (`idle → dirty → saving → saved | error | conflict`) shown to the user. People
need to trust that their work is safe; a silent background save is not enough.

**Keyboard-first, but never while typing.** `K`/`N` only fire outside text fields; `Ctrl+S`/`Ctrl+Enter` work
everywhere. Tested so that typing "n" in a transcript never creates a segment.

**MUI with CSS-variable colour schemes.** Accessible components, a consistent look, light/dark/system modes with
one source of truth that plain CSS can use too.

**Waveform drawn from the real audio** (Web Audio decode in the browser) instead of a decorative image, coloured
by speaker so mistakes such as a wrong speaker are visible at a glance.

## Testing and tooling

**Integration tests through HTTP (MockMvc) with real sign-in.** They exercise security, serialization,
validation, transactions and SQL together, and catch more than mocked unit tests for a CRUD-plus-rules service.

**Playwright end-to-end tests against the real stack**, each test starting from re-seeded data. Locators are
accessibility-first (roles, labels), which doubles as an accessibility check. Tests drive Google Chrome through
Playwright's `chrome` channel, locally and in CI, so both run the same browser. *Alternative:* Cypress (single tab only,
the two-tab conflict test needs two browser contexts).

**A small dependency-free load tool** instead of k6/Gatling: it reuses the real API flows (login, autosave with
version handling and 409 recovery), runs anywhere Node runs, and writes JSON results. k6 is the natural upgrade
for distributed or long soak tests.
