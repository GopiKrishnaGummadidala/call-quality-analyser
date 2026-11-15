import { expect, expectBackInQueue, signInAs, test } from './fixtures';

test.describe('reviewer workflow', () => {
  test('review queue lists submitted work', async ({ page }) => {
    await signInAs(page, 'bob');
    await page.getByRole('link', { name: 'Review queue' }).click();
    await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
    for (const title of ['Affordability review', 'Repayment holiday request', 'QA: affordability review']) {
      await expect(page.getByRole('row', { name: new RegExp(title) }).getByRole('link', { name: /Review/ })).toBeVisible();
    }
  });

  test('requesting changes needs a reason and is recorded in the audit history', async ({ page }) => {
    await signInAs(page, 'bob', '/tasks/t-call-03');
    const review = page.getByRole('region', { name: 'Review', exact: true });
    await review.getByRole('button', { name: 'Request changes' }).click();
    await expect(review.getByRole('alert')).toHaveText('A reason is required when requesting changes');
    await expect(review.getByLabel('Reason / comment')).toHaveAttribute('aria-invalid', 'true');

    await review.getByLabel('Reason / comment').fill('Segment 2: the amount is three thousand two hundred, please check.');
    await review.getByRole('button', { name: 'Request changes' }).click();
    // back on the review queue with a confirmation; the reviewer picks the next submission
    await expectBackInQueue(page, 'Review queue', 'Sent back for changes');
    await expect(page.getByRole('row', { name: /Affordability review/ })).toHaveCount(0);

    await page.goto('/tasks/t-call-03');
    await expect(page.getByRole('region', { name: 'Review', exact: true })).toHaveCount(0); // no longer reviewable
    const audit = page.getByRole('region', { name: 'Audit history' });
    await expect(audit).toContainText('Alice Becker submitted the task');
    await expect(audit).toContainText('Bob Novak requested changes');

    // the annotator sees the reason
    await signInAs(page, 'alice', '/tasks/t-call-03');
    await expect(page.getByRole('note').filter({ hasText: 'requested changes' })).toContainText('the amount is three thousand two hundred');
  });

  test('approving makes the task read-only for everyone', async ({ page }) => {
    await signInAs(page, 'bob', '/tasks/t-call-07');
    await page.getByRole('region', { name: 'Review', exact: true }).getByRole('button', { name: 'Approve' }).click();
    await expectBackInQueue(page, 'Review queue', 'Approved: “Repayment holiday request”');
    await page.goto('/tasks/t-call-07');
    await expect(page.getByRole('region', { name: 'Audit history' })).toContainText('Bob Novak approved the task');

    await signInAs(page, 'erik', '/tasks/t-call-07');
    await expect(page.getByText(/Read-only/)).toBeVisible();
    await expect(page.getByRole('button', { name: /submit for review/i })).toHaveCount(0);
    await expect(page.getByLabel('Segment 1 text', { exact: true })).toHaveAttribute('readonly', '');
  });

  test('reviewers cannot review their own or not-yet-submitted work', async ({ page }) => {
    await signInAs(page, 'bob', '/tasks/t-call-01'); // in progress
    await expect(page.getByRole('region', { name: 'Review', exact: true })).toHaveCount(0);
  });
});
