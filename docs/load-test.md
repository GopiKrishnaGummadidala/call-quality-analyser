# Load test

How the API behaves with many annotators and reviewers working at once, measured against the real Docker stack.

## Method

Tool: [`e2e/load/load-test.mjs`](../e2e/load/load-test.mjs), a dependency-free Node script that replays the same
HTTP calls the UI makes.

- **Virtual users (VUs)** cycle through the roles alice, erik (annotators) and bob (reviewer). Each VU signs in
  once through `POST /api/auth/login`, then loops until the end of the run.
- **Workload mix** per iteration: list tasks 35 % · task detail 25 % · audit history 10 % · evaluation 5 % ·
  autosave 25 % (annotators; reviewers list tasks instead). A random think time of 0.5-1.5 × `--think` ms
  separates iterations.
- **Contention on purpose:** annotators autosave the same few tasks (`t-call-01`, `t-call-02`, `t-audio-1`,
  `t-call-06`), so optimistic-concurrency conflicts occur as in real two-tab editing. A 409 is an expected outcome:
  the VU reloads the task and continues.
- **Warm-up** of 5 s is excluded from the numbers. Logins are reported separately (bcrypt is slow by design).
- The demo data is reset before and after each run; results are written to `e2e/load/results/*.json`.

Path under test: client → nginx over HTTPS (frontend container) → Spring Boot → PostgreSQL, i.e. including TLS, the
proxy hop, JWT verification, the read-access log, project-role lookup, the row lock and the audit/validation code.

## Environment

| | |
|---|---|
| Machine | Windows 11, AMD Ryzen AI 7 445 (12 logical CPUs), 31 GB RAM |
| Stack | Docker Desktop, `docker compose` (nginx with TLS/HTTP-2, Spring Boot 3.4 on Java 21, PostgreSQL 16), Hikari pool 10 |
| Client | Node 26 on the same machine (client and server compete for the CPU) |
| Date | 2026-11-09 |

## Results

Current stack: HTTPS (TLS 1.3, HTTP/2) through nginx, read-access logging on every task view.

| Profile | VUs | Think | Requests | Throughput | p50 | p95 | p99 | Errors | 409 on autosave |
|---|---|---|---|---|---|---|---|---|---|
| Normal team | 10 | ~100 ms | 2,846 | **94 req/s** | 5.5 ms | 8.0 ms | 20.8 ms | 0 | 141 / 405 (35 %) |
| Busy team | 50 | ~100 ms | 14,836 | **492 req/s** | 5.8 ms | 10.4 ms | 27.3 ms | 0 | 1,018 / 2,031 (50 %) |
| Saturation | 50 | 0 ms | 41,935 | **1,396 req/s** | 34.4 ms | 50.8 ms | 75.1 ms | 0 | 3,566 / 5,255 (68 %) |

Per endpoint (50 VUs, ~100 ms think time):

| Endpoint | req/s | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| `GET /api/projects/{id}/tasks` | 208.2 | 4.8 ms | 8.5 ms | 25.9 ms | 60.3 ms |
| `GET /api/tasks/{id}` (+ access-log insert) | 148.2 | 6.8 ms | 11.5 ms | 28.9 ms | 63.4 ms |
| `GET /api/tasks/{id}/audit` | 47.0 | 4.8 ms | 9.0 ms | 28.4 ms | 49.2 ms |
| `PUT /api/tasks/{id}/annotation` | 67.4 | 6.8 ms | 11.3 ms | 24.9 ms | 54.1 ms |
| `GET /api/projects/{id}/evaluation` | 21.3 | 5.0 ms | 9.1 ms | 31.2 ms | 49.9 ms |
| `POST /api/auth/login` (51 concurrent) | – | 334 ms | 448 ms | 455 ms | 455 ms |

Before TLS (plain HTTP/1.1 to nginx, no read-access log) the same profiles measured 95 / 501 / 1,893 req/s with p95
of 8.5 / 7.8 / 40.2 ms: TLS and the access-log insert cost ~25 % of peak throughput on this laptop and about 2 ms per
task view; at team-sized load the difference is a few milliseconds.

## Analysis

- **Comfortable headroom.** A realistic team of 50 people clicking and autosaving produces ~500 req/s at a p95 of
  about 10 ms. Saturation on one laptop is ~1.4k req/s over HTTPS with p99 under 80 ms and no errors.
- **Correctness under contention.** Zero 5xx and zero unexpected statuses in every run. The 409 share rises with
  contention (35 % → 68 %) exactly as optimistic concurrency should: the losing save is rejected, nothing is
  overwritten, and the client recovers with one extra GET. Real annotators rarely share a task, so production
  conflict rates are expected to be near zero; the test is intentionally pessimistic.
- **Found and fixed: HTTP/2 connection rotation.** The first HTTPS runs failed 0.4 % of requests at saturation with
  `HTTP/2: "GOAWAY" frame received` / `stream closed before the response was complete`. nginx closes an HTTP/2
  connection after `keepalive_requests` (default 1,000) requests, and Node's HTTP client does not replay in-flight
  requests on a new connection (browsers do). Raising `keepalive_requests` to 100,000 removed every error; the load
  tool now records the reason of each failed request (`errorReasons` in the result JSON) so such issues are visible.
- **Writes cost ~2 ms more than reads** (row lock, schema validation, version compare-and-set, JSON serialization).
- **Login is the slowest call by design**: bcrypt (cost 10) takes ~90 ms on one core; 51 simultaneous logins queue
  on the CPU (p50 322 ms). Tokens last 8 h, so this happens once per shift per person.
- **Likely next bottlenecks** if load grows: the Hikari pool (10 connections) during write bursts, the per-request
  log line, and evaluation if fixtures grow (it is recomputed per request; cache it per model run).

## Limitations

- Client and server share one machine and Docker Desktop's VM; absolute numbers will differ in a cluster.
- Short runs (30 s); no soak test for memory growth or connection leaks.
- Small dataset (≈20 tasks). The task list is paged (25 a page by default); very large projects would need keyset pagination and an index on `(project_id, updated_at)`.
- Audio files are static and served by nginx; they were not part of the API load.

## How to run

```bash
docker compose up --build -d
cd e2e && npm install
node load/load-test.mjs --vus 10 --duration 30
node load/load-test.mjs --vus 50 --duration 30
node load/load-test.mjs --vus 50 --duration 30 --think 0
```

Options: `--vus`, `--duration` (seconds), `--think` (ms), `--base` (default `https://localhost:8443`, or
`E2E_BASE_URL`; the self-signed localhost certificate is accepted automatically). The script exits non-zero if more than 1 % of requests fail, so it can gate a CI job.
