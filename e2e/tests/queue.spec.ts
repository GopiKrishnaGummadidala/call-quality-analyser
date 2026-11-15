import { expect, saveStatus, signInAs, test } from './fixtures';

test.describe('task queue', () => {
  test('pages through tasks, newest change first, and an edited task moves to the top', async ({ page }) => {
    await signInAs(page, 'alice', '/');
    const rows = page.getByRole('table').getByRole('row');
    await expect(page.getByText('newest changes first')).toBeVisible();

    await page.getByRole('combobox', { name: /Tasks per page/ }).click();
    await page.getByRole('option', { name: '10' }).click();
    await expect(page.getByText('1–10 of 14')).toBeVisible();
    await expect(rows).toHaveCount(11); // header + 10
    await page.getByRole('button', { name: 'Go to next page' }).click();
    await expect(page.getByText('11–14 of 14')).toBeVisible();
    await expect(rows).toHaveCount(5);
    await expect(page).toHaveURL(/page=2/);

    await signInAs(page, 'alice', '/tasks/t-call-02');
    await page.getByLabel('Segment 2 text', { exact: true }).fill('Edited just now');
    await expect(saveStatus(page)).toHaveText('All changes saved');
    await page.goto('/');
    await expect(rows.nth(1)).toContainText('Loan application: missing documents');
    await expect(rows.nth(1).getByRole('cell').nth(5)).toHaveText('now'); // Updated column
  });
});
