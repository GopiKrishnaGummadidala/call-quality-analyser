#!/usr/bin/env node
/**
 * Dependency-free HTTP load test for the Call Quality Analyser API (Node 18+, uses global fetch).
 *
 * Simulates annotators and reviewers working concurrently against a running stack:
 *   - every virtual user (VU) signs in once (login latency is reported separately: bcrypt is slow on purpose)
 *   - then loops over a weighted mix of real UI calls with a short think time:
 *       list tasks 35% · task detail 25% · audit history 10% · evaluation 5% · autosave 25% (annotators only)
 *   - autosaves deliberately contend: several annotators save the same few tasks, so optimistic-concurrency
 *     conflicts (409 STALE_VERSION) happen as in real two-tab / two-person editing; a 409 is counted as an
 *     expected outcome, followed by a reload of the latest version.
 *
 * Usage:  node load/load-test.mjs [--vus 20] [--duration 30] [--think 100] [--base https://localhost:8443]
 * The demo data is reset (platform operator) before and after the run. Results: console + load/results/<timestamp>.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
  return acc;
}, []));
const BASE = args.base ?? process.env.E2E_BASE_URL ?? 'https://localhost:8443';
// The local stack uses a self-signed certificate: accept it for localhost only.
if (/^https:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';
const VUS = Number(args.vus ?? 20);
const DURATION_S = Number(args.duration ?? 30);
const THINK_MS = Number(args.think ?? 100);
const WARMUP_S = 5;
const PASSWORD = 'Test123';

const ANNOTATOR_TASKS = { alice: ['t-call-01', 't-call-02', 't-audio-1'], erik: ['t-call-06'] };
const READ_TASKS = ['t-call-01', 't-call-03', 't-call-04', 't-call-07', 't-score-02', 't-audio-2'];

// ---- metrics -------------------------------------------------------------------------------------
const samples = new Map(); // name -> number[] (ms)
const outcomes = new Map(); // name -> { ok, conflict, error }
const errorReasons = new Map(); // "endpoint: reason" -> count
let recording = false;
function record(name, ms, kind, reason) {
  if (!recording && name !== 'login') return;
  if (kind === 'error') errorReasons.set(`${name}: ${reason}`, (errorReasons.get(`${name}: ${reason}`) ?? 0) + 1);
  if (!samples.has(name)) { samples.set(name, []); outcomes.set(name, { ok: 0, conflict: 0, error: 0 }); }
  samples.get(name).push(ms);
  outcomes.get(name)[kind]++;
}
const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0;

async function call(name, method, path, token, body) {
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const ms = performance.now() - t0;
    const kind = res.ok ? 'ok' : res.status === 409 ? 'conflict' : 'error';
    record(name, ms, kind, `HTTP ${res.status}`);
    return { status: res.status, data: text ? JSON.parse(text) : undefined };
  } catch (e) {
    record(name, performance.now() - t0, 'error', `${e?.cause?.code ?? e?.name ?? 'Error'}: ${e?.cause?.message ?? e?.message}`);
    return { status: 0, data: undefined, error: e };
  }
}

async function login(username) {
  const r = await call('login', 'POST', '/api/auth/login', null, { username, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login ${username} failed: ${r.status}`);
  return r.data.token;
}

async function resetData() {
  const token = await login('ops'); // the demo reset is a platform-operator action
  const r = await fetch(`${BASE}/api/demo/reset`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (r.status !== 204) throw new Error(`reset failed: ${r.status}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

// ---- virtual user --------------------------------------------------------------------------------
async function virtualUser(id, deadline) {
  const roles = ['alice', 'erik', 'bob', 'alice', 'bob'];
  const username = roles[id % roles.length];
  const token = await login(username);
  const writable = ANNOTATOR_TASKS[username] ?? [];
  const versions = new Map();
  let iteration = 0;
  while (performance.now() < deadline) {
    const r = Math.random();
    if (r < 0.35) {
      await call('GET tasks (list)', 'GET', '/api/projects/proj-a/tasks', token);
    } else if (r < 0.60) {
      await call('GET task (detail)', 'GET', `/api/tasks/${pick(READ_TASKS)}`, token);
    } else if (r < 0.70) {
      await call('GET audit', 'GET', `/api/tasks/${pick(READ_TASKS)}/audit`, token);
    } else if (r < 0.75) {
      await call('GET evaluation', 'GET', '/api/projects/proj-a/evaluation', token);
    } else if (writable.length) {
      const taskId = pick(writable);
      if (!versions.has(taskId)) {
        const t = await call('GET task (detail)', 'GET', `/api/tasks/${taskId}`, token);
        if (t.status !== 200) continue;
        versions.set(taskId, { version: t.data.annotation.version, payload: t.data.annotation.payload });
      }
      const current = versions.get(taskId);
      const payload = structuredClone(current.payload);
      if (payload.segments?.length) payload.segments[0].text = `load test ${id}-${iteration}`;
      const s = await call('PUT annotation (autosave)', 'PUT', `/api/tasks/${taskId}/annotation`, token, { expectedVersion: current.version, payload });
      if (s.status === 200) versions.set(taskId, { version: s.data.version, payload });
      else versions.delete(taskId); // 409: someone else saved first -> reload before the next save
    } else {
      await call('GET tasks (list)', 'GET', '/api/projects/proj-a/tasks', token);
    }
    iteration++;
    if (THINK_MS) await sleep(THINK_MS * (0.5 + Math.random()));
  }
  return iteration;
}

// ---- run -----------------------------------------------------------------------------------------
console.log(`Load test against ${BASE}: ${VUS} virtual users, ${DURATION_S}s (+${WARMUP_S}s warm-up), think time ~${THINK_MS}ms`);
await resetData();
samples.clear(); outcomes.clear();
const start = performance.now();
const deadline = start + (WARMUP_S + DURATION_S) * 1000;
setTimeout(() => { recording = true; }, WARMUP_S * 1000);
const recordStart = start + WARMUP_S * 1000;
const iterations = await Promise.all(Array.from({ length: VUS }, (_, i) => virtualUser(i, deadline)));
const measuredS = (performance.now() - recordStart) / 1000;
await resetData();

const rows = [...samples.entries()].map(([name, xs]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const o = outcomes.get(name);
  return {
    endpoint: name, requests: xs.length, 'req/s': name === 'login' ? '-' : +(xs.length / measuredS).toFixed(1),
    p50: +pct(sorted, 50).toFixed(1), p95: +pct(sorted, 95).toFixed(1), p99: +pct(sorted, 99).toFixed(1), max: +sorted.at(-1).toFixed(1),
    ok: o.ok, '409': o.conflict, errors: o.error,
  };
});
const measured = rows.filter((r) => r.endpoint !== 'login');
const total = measured.reduce((n, r) => n + r.requests, 0);
const errors = measured.reduce((n, r) => n + r.errors, 0);
const allLatencies = [...samples.entries()].filter(([n]) => n !== 'login').flatMap(([, xs]) => xs).sort((a, b) => a - b);
const summary = {
  base: BASE, vus: VUS, durationS: DURATION_S, warmupS: WARMUP_S, thinkMs: THINK_MS,
  totalRequests: total, throughputRps: +(total / measuredS).toFixed(1), errorRate: total ? +(errors / total).toFixed(4) : 0,
  p50: +pct(allLatencies, 50).toFixed(1), p95: +pct(allLatencies, 95).toFixed(1), p99: +pct(allLatencies, 99).toFixed(1),
  iterations: iterations.reduce((a, b) => a + b, 0),
  errorReasons: Object.fromEntries(errorReasons),
  machine: { platform: `${os.type()} ${os.release()}`, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, memGb: +(os.totalmem() / 2 ** 30).toFixed(1), node: process.version },
  finishedAt: new Date().toISOString(),
};
console.table(rows);
console.log(summary);

const dir = join(dirname(fileURLToPath(import.meta.url)), 'results');
mkdirSync(dir, { recursive: true });
const file = join(dir, `${summary.finishedAt.replace(/[:.]/g, '-')}-vus${VUS}.json`);
writeFileSync(file, JSON.stringify({ summary, endpoints: rows }, null, 2));
console.log(`saved ${file}`);
if (summary.errorRate > 0.01) { console.error('FAIL: error rate above 1%'); process.exitCode = 1; }
