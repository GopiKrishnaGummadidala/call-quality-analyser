import { expect, signInAs, test } from './fixtures';

test('evaluation shows WER per model with its caveats', async ({ page }) => {
  await signInAs(page, 'bob', '/evaluation');
  await expect(page.getByRole('heading', { name: 'Model evaluation' })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('Illustrative only');
  await expect(page.getByText('Sample model A (baseline)', { exact: true })).toBeVisible();
  await expect(page.getByText('9.8%', { exact: true })).toBeVisible();
  await expect(page.getByText('2.0%', { exact: true })).toBeVisible();

  // real model drafts measured against approved transcripts
  const drafts = page.getByRole('region', { name: 'Draft model in production' });
  await expect(drafts).toContainText('whisper-');
  await expect(drafts.getByRole('table', { name: 'Draft corrections' })).toContainText('Identity check before discussing the account');

  await page.getByRole('button', { name: /Sample model A \(baseline\): per-clip results/ }).click();
  // model A's details are first in the page; model B's stay collapsed (hidden)
  await expect(page.getByText(/NOT produced by a real model/).first()).toBeVisible();
});
