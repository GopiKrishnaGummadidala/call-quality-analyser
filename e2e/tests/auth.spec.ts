import { apiLogin, expect, signInAs, signInWithForm, test } from './fixtures';

test.describe('authentication', () => {
  test('protected pages show the sign-in screen and land on the requested page afterwards', async ({ page }) => {
    await page.goto('/evaluation');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await signInWithForm(page, 'alice', 'wrong-password');
    await expect(page.getByRole('alert')).toHaveText('Invalid username or password.');
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');

    await signInWithForm(page, 'alice');
    await expect(page.getByRole('heading', { name: 'Model evaluation' })).toBeVisible();
    await expect(page).toHaveURL(/\/evaluation/);
  });

  test('demo accounts fill the form', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /use demo account bob/i }).click();
    await expect(page.getByLabel('Username')).toHaveValue('bob');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Task queue' })).toBeVisible();
    await expect(page.getByText(/You are\s+reviewer/)).toBeVisible();
  });

  test('signing out clears the session', async ({ page }) => {
    await signInAs(page, 'erik');
    await page.getByRole('button', { name: /account menu for erik/i }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('cqa.token'))).toBeNull();
    // back button does not bring the app back
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('a rejected token sends the user back to sign-in', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('cqa.token', 'not.a.valid-token');
      localStorage.setItem('cqa.session', JSON.stringify({
        user: { id: 'u-alice', username: 'alice', displayName: 'Alice Becker', tenantId: 'tenant-1', tenantName: 'Northbridge Bank (demo)', globalRole: 'USER' },
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }));
    });
    await page.reload();
    await expect(page.getByText('Your session ended. Please sign in again.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});

test.describe('roles', () => {
  test('admins manage accounts of their own tenant only', async ({ page }) => {
    await signInAs(page, 'admin', '/admin');
    await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
    const accounts = page.getByRole('table').first();
    for (const username of ['@alice', '@bob', '@admin', '@erik']) await expect(accounts.getByText(username, { exact: true })).toBeVisible();
    await expect(accounts.getByText('@carol')).toHaveCount(0); // other tenant
    await expect(accounts.getByText('@ops')).toHaveCount(0); // the platform operator belongs to no customer tenant
    await expect(page.getByRole('link', { name: 'Users & roles' })).toBeVisible();
  });

  test('non-admins cannot open administration', async ({ page }) => {
    await signInAs(page, 'bob', '/admin');
    await expect(page.getByText('You need the admin role to open this page.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Users & roles' })).toHaveCount(0);
    // and the API agrees
    const session = await page.evaluate(() => localStorage.getItem('cqa.token'));
    const res = await page.request.get('/api/admin/users', { headers: { Authorization: `Bearer ${session}` } });
    expect(res.status()).toBe(403);
  });

  test('only the platform operator resets the demo, and it sees counts, not customer data', async ({ page, request }) => {
    await signInAs(page, 'admin', '/admin');
    await expect(page.getByRole('button', { name: 'Reset demo data' })).toHaveCount(0);
    const admin = await apiLogin(request, 'admin');
    expect((await request.post('/api/demo/reset', { headers: { Authorization: `Bearer ${admin.token}` } })).status()).toBe(403);

    await signInAs(page, 'ops', '/platform');
    const orgs = page.getByRole('table', { name: 'Organisations' });
    await expect(orgs.getByRole('row', { name: /Northbridge Bank \(demo\)/ })).toBeVisible();
    await expect(orgs.getByRole('row', { name: /Other Bank/ })).toBeVisible();
    await page.getByRole('button', { name: 'Reset demo data' }).click();
    await expect(page.getByRole('dialog')).toContainText('for all organisations');
    await page.getByRole('dialog').getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByText('Demo data was reset for every organisation.')).toBeVisible();

    await page.goto('/');
    await expect(page.getByText('The platform operator belongs to no organisation and sees no customer tasks.')).toBeVisible();
    await page.goto('/admin');
    await expect(page.getByText('You need the admin role to open this page.')).toBeVisible();
  });
});
