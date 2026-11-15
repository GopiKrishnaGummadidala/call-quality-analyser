import { expect, saveStatus, signInAs, test } from './fixtures';

test.describe('concurrent editing', () => {
  test('a stale tab is stopped with a conflict instead of overwriting newer work', async ({ browser }) => {
    const tabA = await (await browser.newContext()).newPage();
    const tabB = await (await browser.newContext()).newPage();
    await signInAs(tabA, 'alice', '/tasks/t-call-02');
    await signInAs(tabB, 'alice', '/tasks/t-call-02'); // both loaded the same annotation version

    await tabA.getByLabel('Segment 2 text', { exact: true }).fill('Edited in tab A');
    await expect(saveStatus(tabA)).toHaveText('All changes saved');

    await tabB.getByLabel('Segment 3 text', { exact: true }).fill('Edited in tab B');
    await expect(tabB.getByRole('alert').filter({ hasText: 'was changed elsewhere' })).toBeVisible();
    await expect(saveStatus(tabB)).toHaveText('Out of date');

    await tabB.getByRole('button', { name: /Reload latest/ }).click();
    await expect(tabB.getByLabel('Segment 2 text', { exact: true })).toHaveValue('Edited in tab A');
    await expect(tabB.getByLabel('Segment 3 text', { exact: true })).toHaveValue('');
  });

  test('two reviewers cannot both decide on the same submission', async ({ browser }) => {
    // Bob reviews in two tabs at once: the second decision is rejected server-side.
    const first = await (await browser.newContext()).newPage();
    const second = await (await browser.newContext()).newPage();
    await signInAs(first, 'bob', '/tasks/t-score-02');
    await signInAs(second, 'bob', '/tasks/t-score-02');
    await first.getByRole('region', { name: 'Review', exact: true }).getByRole('button', { name: 'Approve' }).click();
    await expect(first.getByRole('status').filter({ hasText: 'Approved' })).toBeVisible(); // back on the review queue

    const review = second.getByRole('region', { name: 'Review', exact: true });
    await review.getByLabel('Reason / comment').fill('Too late');
    await review.getByRole('button', { name: 'Request changes' }).click();
    await expect(review.getByRole('alert')).toBeVisible();
  });
});
