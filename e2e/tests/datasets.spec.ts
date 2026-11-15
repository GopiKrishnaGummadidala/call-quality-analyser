import { createHash } from 'node:crypto';
import { apiLogin, expect, signInAs, test } from './fixtures';

test.describe('training-data releases', () => {
  test('an admin releases approved work as a de-identified, hashed dataset', async ({ page, request }) => {
    await signInAs(page, 'admin', '/admin');
    await page.getByRole('link', { name: 'Training data' }).click();
    await expect(page.getByRole('heading', { name: 'Training data' })).toBeVisible();
    await expect(page.getByText('Ready for release v1')).toBeVisible();
    await expect(page.getByText(/2 approved tasks/)).toBeVisible();

    await page.getByRole('button', { name: 'Create release v1' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create release' }).click();
    const releases = page.getByRole('table', { name: 'Releases' });
    await expect(releases.getByRole('row', { name: /v1/ })).toContainText('2'); // items
    await expect(page.getByText('Ready for release v2')).toBeVisible();

    await releases.getByRole('button', { name: 'Preview' }).click();
    const preview = page.getByLabel('Preview of release v1');
    await expect(preview).toContainText('[PERSON_1]');
    await expect(preview).toContainText('"contains_identifiers": true');
    await expect(preview).not.toContainText('Keller');

    // the manifest a training job downloads matches its published hash and holds no names
    const { token } = await apiLogin(request, 'admin');
    const auth = { Authorization: `Bearer ${token}` };
    const list = await (await request.get('/api/admin/projects/proj-a/datasets', { headers: auth })).json();
    const res = await request.get(`/api/admin/datasets/${list[0].id}/manifest.jsonl`, { headers: auth });
    expect(res.status()).toBe(200);
    const body = await res.body();
    expect(createHash('sha256').update(body).digest('hex')).toBe(res.headers()['x-manifest-sha256']);
    expect(body.toString()).not.toMatch(/Keller|\[PERSON_[0-9a-f]{6}]/);
    expect(body.toString().trim().split('\n')).toHaveLength(2);
  });

  test('annotators and reviewers cannot see or export training data', async ({ page, request }) => {
    await signInAs(page, 'bob', '/admin/datasets');
    await expect(page.getByText('You need the admin role to open this page.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Training data' })).toHaveCount(0);
    const { token } = await apiLogin(request, 'bob');
    expect((await request.post('/api/admin/projects/proj-a/datasets', { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(403);
  });
});
