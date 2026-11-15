import { expect, signInAs, test } from './fixtures';

test.describe('tenant and project isolation', () => {
  test('a user from another organisation cannot see or open these tasks', async ({ page }) => {
    await signInAs(page, 'carol');
    await expect(page.getByRole('row', { name: /Other tenant task/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Call 1|Personal loan/ })).toHaveCount(0);

    await page.goto('/tasks/t-audio-1');
    await expect(page.getByRole('alert')).toHaveText('Task not found, or you do not have access to it.');
  });

  test('roles are per project: Alice annotates one project and reviews another', async ({ page }) => {
    await signInAs(page, 'alice', '/?project=proj-c');
    await expect(page.getByText(/You are\s+reviewer/)).toBeVisible();
    await page.getByRole('row', { name: /Mortgage rate follow-up/ }).getByRole('link', { name: /Review/ }).click();
    await expect(page.getByRole('region', { name: 'Review', exact: true })).toBeVisible();

    await page.goto('/?project=proj-a');
    await expect(page.getByText(/You are\s+annotator/)).toBeVisible();
    await page.goto('/tasks/t-call-07'); // Erik's submitted task in the project where Alice is only an annotator
    await expect(page.getByRole('heading', { name: 'Repayment holiday request' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Review', exact: true })).toHaveCount(0);
  });
});
