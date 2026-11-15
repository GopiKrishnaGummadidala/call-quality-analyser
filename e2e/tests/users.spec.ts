import { expect, signInAs, signInWithForm, test } from './fixtures';

test.describe('user management', () => {
  test('an admin adds a user, who signs in and sees only the project given', async ({ page, browser }) => {
    await signInAs(page, 'admin', '/admin');
    await page.getByRole('button', { name: 'Add user' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add user' });
    await dialog.getByRole('button', { name: 'Add user' }).click(); // nothing filled in yet
    for (const label of ['Username', 'Full name']) {
      await expect(dialog.getByRole('textbox', { name: label })).toHaveAttribute('aria-invalid', 'true');
    }

    await dialog.getByRole('textbox', { name: 'Username' }).fill('frank');
    await dialog.getByRole('textbox', { name: 'Full name' }).fill('Frank Weber');
    await dialog.getByLabel('Password', { exact: false }).fill('Welcome1');
    await dialog.getByRole('combobox', { name: 'Mortgage follow-ups (demo)' }).click();
    await page.getByRole('option', { name: 'Reviewer' }).click();
    await dialog.getByRole('button', { name: 'Add user' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Frank Weber added' })).toBeVisible();
    await expect(page.getByRole('table').first().getByText('@frank', { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Account changes' }).getByText('Frank Weber')).toBeVisible();

    const frank = await (await browser.newContext()).newPage();
    await frank.goto('/');
    await signInWithForm(frank, 'frank', 'Welcome1');
    await expect(frank.getByText(/You are\s+reviewer\s+on this project/)).toBeVisible();
    await expect(frank.getByText('Mortgage follow-ups (demo)').first()).toBeVisible();
    await expect(frank.getByRole('link', { name: 'Loan calls (demo)' })).toHaveCount(0);
  });

  test('a password reset by the admin signs the user out of open sessions', async ({ page, browser }) => {
    const bob = await (await browser.newContext()).newPage();
    await signInAs(bob, 'bob', '/');
    await expect(bob.getByRole('heading', { name: 'Task queue' })).toBeVisible();
    await bob.waitForTimeout(1100); // token issue time has one-second resolution

    await signInAs(page, 'admin', '/admin');
    await page.getByRole('button', { name: 'Edit Bob Novak' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit Bob Novak' });
    await expect(dialog.getByRole('textbox', { name: 'Username' })).toBeDisabled();
    await dialog.getByLabel('New password').fill('NewPass9');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Bob Novak updated' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Account changes' }).getByText('reset the password of')).toBeVisible();

    await bob.reload();
    await expect(bob.getByRole('note').filter({ hasText: 'Your session ended' })).toBeVisible();
    await signInWithForm(bob, 'bob', 'NewPass9');
    await expect(bob.getByRole('heading', { name: 'Task queue' })).toBeVisible();
  });
});
