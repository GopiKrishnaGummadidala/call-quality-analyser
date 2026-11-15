# Assumptions

What this demo takes for granted, why, and what would change if an assumption turns out to be wrong.

## Product and workflow

| # | Assumption | Why | If wrong |
|---|---|---|---|
| P1 | A task has exactly **one assignee**; tasks are pre-assigned (no claiming). | Matches a managed annotation team; keeps ownership and the four-eyes rule simple. | Add a claim/release endpoint with a lease and a compare-and-set on `assignee_id`. |
| P2 | **One reviewer decision** per submission (approve or request changes), with a reason for changes. | Mirrors a simple QA gate. | Multi-review (consensus, adjudication) needs a review table keyed by round and a quorum rule. |
| P3 | Annotators work in **short sessions with autosave**; losing more than ~1 s of typing is unacceptable. | Annotation is long, repetitive work. | Offline support would need a local queue and merge on reconnect. |
| P4 | **Overlapping speech exists** and must be representable (not forced into a single timeline). | Real calls overlap (co-applicants, interruptions, transfers). | n/a, this is why segments are lane-assigned and labelled `CROSSTALK`. |
| P5 | Admins **manage**, they do not annotate or review. | Separation of duties. | Give the admin a project membership; nothing else changes. |
| P6 | Evaluation is **corpus-level WER** on a small fixed set. | Simple, explainable, deterministic. | Add CER/semantic metrics, per-speaker breakdowns and a larger, versioned dataset. |

## Data and privacy

| # | Assumption | Why | If wrong |
|---|---|---|---|
| D1 | All data is **synthetic**: invented people and situations, speech produced by text-to-speech. | No real customer data may enter a demo. | Real data needs a DPA, call-recording consent, EU hosting, encryption, retention and access reviews before anything else. |
| D2 | Names and numbers in seeded text are **pseudonymised on ingest** (`[PERSON_…]`, `[NUMBER_…]`). | Demonstrates the masking step a real pipeline needs. | A real pipeline would pseudonymise in a dedicated service with an audited re-identification key. |
| D3 | Clips are **short (≈10-20 s)**, stored with the backend and served only through an authorised, access-logged endpoint. | Typical utterance-level work units. | Long recordings need chunking, streaming and signed object-storage URLs. |
| D4 | One **language (English)** in the realistic set. | Only one English TTS voice is installed on the build machine. | Add `language` per task; the Windows German voice (Hedda) is available for a German set. |
| D5 | First drafts are **real Whisper output** produced offline; the two benchmark "model outputs" stay **hand-written samples**, clearly labelled. | No inference service runs inside the demo. | Run the draft model as a service per incoming recording and record model/version/provenance per run (the `model_draft` table already does). |

## Users, security and tenancy

| # | Assumption | Why | If wrong |
|---|---|---|---|
| S1 | **Local username/password** with a shared demo password (`Test123`). | Requested for testing; keeps the demo self-contained. | Use OIDC/SSO (the API already only depends on a verified subject). |
| S1a | Admins **set an initial password** for new users (at least 7 characters with a letter and a digit, the demo policy). Changing a user's password or account role ends their open sessions; tokens issued in the same second as the change stay valid (issued-at has one-second resolution). | Self-contained demo, no mail server. | Invitation links with a one-time token and a stronger policy, or SSO with SCIM provisioning so accounts come from the customer's identity provider. |
| S2 | An **8 h token** without refresh is acceptable. | One working shift. | Short access tokens + refresh tokens, server-side revocation list. |
| S3 | Tokens live in **localStorage** (all tabs share the session). | Needed for the two-tab conflict demo; no cookies means no CSRF surface. | For higher XSS risk tolerance, move to an `HttpOnly` cookie + CSRF protection. |
| S4 | **Tenants are strictly isolated**; nobody works across organisations. | Banks are separate legal entities and competitors. | Cross-tenant roles would need explicit, audited grants. |
| S5 | Project roles change rarely but must apply **immediately**. | Removing access must not wait for token expiry. | n/a, this is why project roles are read per request instead of being put in the token. |

## Scale and operations

| # | Assumption | Why | If wrong |
|---|---|---|---|
| O1 | Tens to low hundreds of **concurrent annotators** per deployment. | Internal tooling. | The load test shows ~1.4k req/s over HTTPS on one laptop; beyond that add pagination, caching of evaluation, read replicas. |
| O2 | **Offset pagination** (page and size, most recently modified first) is enough for task lists. | Projects of hundreds to a few thousand tasks; people page a few pages deep. | Keyset pagination on `(project_id, status, updated_at, id)` with an index, for projects of tens of thousands of tasks. |
| O3 | A single API instance; correctness must not depend on it. | Simplicity. | Already safe for N instances: all concurrency control is in the database (row locks, version CAS). |
| O4 | Synchronous evaluation is fine. | Fixtures are tiny. | Model runs belong in a durable job queue with results stored per run. |

## Technical

- The backend test suite uses **H2 in PostgreSQL mode**, so migrations stay portable SQL and payloads are `TEXT`
  (validated in the application) rather than `JSONB`. Testcontainers against PostgreSQL is the next step.
- **Docker Desktop** (or any Compose v2) is available for the full stack; Windows is only needed to regenerate audio.
- End-to-end tests run against a **real stack** with a resettable database; they are not run against production.
