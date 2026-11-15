import { test as base, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

export const PASSWORD = 'Test123';
export type Username = 'alice' | 'bob' | 'carol' | 'erik' | 'admin' | 'ops';

const baseURL = () => process.env.E2E_BASE_URL ?? 'https://localhost:8443';

/** Signs in through the real API and returns the response body ({ token, expiresAt, user }). */
export async function apiLogin(api: APIRequestContext, username: Username) {
  const res = await api.post('/api/auth/login', { data: { username, password: PASSWORD } });
  expect(res.status(), `login as ${username}`).toBe(200);
  return res.json() as Promise<{ token: string; expiresAt: string; user: { id: string; displayName: string } }>;
}

/** Restores the seeded dataset (platform-operator endpoint) so every test starts from the same state. */
export async function resetDemoData() {
  const api = await playwrightRequest.newContext({ baseURL: baseURL(), ignoreHTTPSErrors: true });
  try {
    const { token } = await apiLogin(api, 'ops');
    const res = await api.post('/api/demo/reset', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status(), 'demo reset').toBe(204);
  } finally {
    await api.dispose();
  }
}

/**
 * Fast sign-in for tests that are not about the sign-in screen: obtain a token from the API and place the
 * session where the SPA keeps it, exactly as a UI sign-in would.
 */
export async function signInAs(page: Page, username: Username, path = '/') {
  const session = await apiLogin(page.request, username);
  await page.goto('/');
  await page.evaluate((s) => {
    localStorage.setItem('cqa.token', s.token);
    localStorage.setItem('cqa.session', JSON.stringify({ user: s.user, expiresAt: s.expiresAt }));
  }, session);
  await page.goto(path);
  return session;
}

/** Signs in through the UI form, as a person would. */
export async function signInWithForm(page: Page, username: string, password = PASSWORD) {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** After submitting or reviewing, the user is back on the list (no auto-advance) with a confirmation naming the task. */
export async function expectBackInQueue(page: Page, heading: 'Task queue' | 'Review queue', title: string) {
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  await expect(page).toHaveURL(/\/\?project=/);
  await expect(page.getByRole('status').filter({ hasText: title })).toBeVisible();
}

/** The autosave indicator in the task header ("All changes saved", "Saving…", …). */
export const saveStatus = (page: Page) => page.getByRole('status').filter({ hasText: /changes|saving|save failed|out of date/i });

export const test = base.extend<{ freshData: void }>({
  freshData: [async ({}, use) => { // eslint-disable-line no-empty-pattern
    await resetDemoData();
    await use();
  }, { auto: true }],
});

export { expect };
