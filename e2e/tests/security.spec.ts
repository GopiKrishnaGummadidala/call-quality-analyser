import { request as playwrightRequest } from '@playwright/test';
import { apiLogin, expect, signInAs, test } from './fixtures';

const httpsBase = () => process.env.E2E_BASE_URL ?? 'https://localhost:8443';
const httpBase = () => process.env.E2E_HTTP_URL ?? 'http://localhost:8080';

test.describe('transport and headers', () => {
  test('plain HTTP only redirects to HTTPS', async () => {
    const http = await playwrightRequest.newContext();
    const res = await http.get(`${httpBase()}/tasks/t-call-01`, { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers().location).toBe(`${httpsBase()}/tasks/t-call-01`);
    await http.dispose();
  });

  test('pages carry security headers and the app runs under the content security policy', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (m) => { if (/content security policy/i.test(m.text())) violations.push(m.text()); });
    const res = await page.goto('/');
    const h = res!.headers();
    expect(h['content-security-policy']).toContain("default-src 'self'");
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('no-referrer');

    await signInAs(page, 'erik', '/tasks/t-call-06'); // fonts, styles, API calls, blob audio, Web Audio decode
    await expect(page.getByText('Waveform unavailable')).toHaveCount(0, { timeout: 10_000 });
    expect(violations, violations.join('\n')).toEqual([]);
  });
});

test.describe('recordings are protected', () => {
  test('no public audio files; the API serves recordings to project members only', async ({ request }) => {
    const legacy = await request.get('/audio/call-01.wav');
    expect(legacy.headers()['content-type']).not.toContain('audio'); // the SPA page, not a recording

    expect((await request.get('/api/tasks/t-call-01/audio')).status()).toBe(401);
    const carol = await apiLogin(request, 'carol');
    const denied = await request.get('/api/tasks/t-call-01/audio', { headers: { Authorization: `Bearer ${carol.token}` } });
    expect(denied.status()).toBe(404);

    const alice = await apiLogin(request, 'alice');
    const ok = await request.get('/api/tasks/t-call-01/audio', { headers: { Authorization: `Bearer ${alice.token}` } });
    expect(ok.status()).toBe(200);
    expect(ok.headers()['content-type']).toBe('audio/wav');
    expect(ok.headers()['cache-control']).toContain('no-store');
    expect((await ok.body()).subarray(0, 4).toString()).toBe('RIFF');
  });

  test('the editor plays the recording from memory, not from a URL', async ({ page }) => {
    await signInAs(page, 'alice', '/tasks/t-call-01');
    const audio = page.locator('audio[aria-label="Task audio"]');
    await expect(audio).toHaveAttribute('src', /^blob:/);
  });
});

test.describe('access log', () => {
  test('admins see who opened which task and recording, including denied attempts', async ({ page, request }) => {
    await signInAs(page, 'alice', '/tasks/t-call-01');
    await expect(page.getByText('Waveform unavailable')).toHaveCount(0, { timeout: 10_000 });
    const carol = await apiLogin(request, 'carol');
    await request.get('/api/tasks/t-call-01', { headers: { Authorization: `Bearer ${carol.token}` } });

    await signInAs(page, 'admin', '/admin');
    const log = page.getByRole('table', { name: 'Access log' });
    await expect(log.getByRole('row', { name: /Alice Becker.*viewed task.*Personal loan: eligibility.*allowed/ })).toBeVisible();
    await expect(log.getByRole('row', { name: /Alice Becker.*played recording.*Personal loan: eligibility.*allowed/ })).toBeVisible();
    await expect(log.getByRole('row', { name: /User from another organisation.*viewed task.*denied/ })).toBeVisible();
    await expect(log.getByText('Carol Diaz')).toHaveCount(0); // outsiders are not named
  });
});
