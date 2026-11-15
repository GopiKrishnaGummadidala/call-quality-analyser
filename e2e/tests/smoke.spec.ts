import { expect, signInWithForm, test } from './fixtures';

/** Runs on desktop and on a phone viewport (see playwright.config.ts). */
test('sign in, open a task and reach the submit button', async ({ page }) => {
  await page.goto('/');
  await signInWithForm(page, 'alice');
  await expect(page.getByRole('heading', { name: 'Task queue' })).toBeVisible();
  await page.getByRole('row', { name: /Personal loan: eligibility/ }).getByRole('link', { name: /Open/ }).click();
  await expect(page.getByRole('heading', { name: 'Personal loan: eligibility check' })).toBeVisible();
  await expect(page.getByRole('button', { name: /submit for review/i })).toBeInViewport();
  // no horizontal page scroll
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
