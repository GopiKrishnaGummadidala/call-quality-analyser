import { expect, expectBackInQueue, saveStatus, signInAs, test } from './fixtures';

test.describe('annotator workflow', () => {
  test('queue shows counts per status and filters by tab and search', async ({ page }) => {
    await signInAs(page, 'alice');
    await expect(page.getByRole('heading', { name: 'Task queue' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^All/ })).toContainText('14');

    await page.getByRole('tab', { name: /^Changes requested/ }).click();
    await expect(page).toHaveURL(/status=CHANGES_REQUESTED/);
    await expect(page.getByRole('row', { name: /Early repayment fee question/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Personal loan: eligibility/ })).toHaveCount(0);

    await page.getByRole('tab', { name: /^All/ }).click();
    await page.getByLabel('Search tasks').fill('mortgage');
    await expect(page.getByText('No tasks match these filters.')).toBeVisible(); // mortgage calls live in another project
  });

  test('incomplete transcripts cannot be submitted; the empty field turns red until it is filled', async ({ page }) => {
    await signInAs(page, 'alice', '/tasks/t-audio-1');
    await expect(page.getByRole('heading', { name: 'Call 1: balance enquiry' })).toBeVisible();

    await page.getByRole('button', { name: /submit for review/i }).click();
    const problems = page.getByRole('alert').filter({ hasText: 'Fix these before submitting' });
    await expect(problems).toContainText('Segment 2: transcript text is required');
    // the empty transcript box is marked red, not only listed; the filled one is not
    await expect(page.getByLabel('Segment 2 text', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Segment 1 text', { exact: true })).not.toHaveAttribute('aria-invalid', 'true');

    await page.getByLabel('Segment 2 text', { exact: true }).fill('I would also like to know my card limit.');
    await expect(page.getByLabel('Segment 2 text', { exact: true })).toHaveAttribute('aria-invalid', 'false');
    await expect(problems).toHaveCount(0);
    await expect(saveStatus(page)).toHaveText('All changes saved');

    await page.getByRole('button', { name: /submit for review/i }).click();
    await expectBackInQueue(page, 'Task queue', 'Call 1: balance enquiry'); // back on the list; Alice picks her next task
    await page.goto('/?status=SUBMITTED');
    await expect(page.getByRole('row', { name: /Call 1: balance enquiry/ })).toBeVisible();
  });

  test('model-assisted: the annotator listens and corrects the speech model draft', async ({ page }) => {
    await signInAs(page, 'alice', '/tasks/t-call-01');
    await expect(page.getByRole('heading', { name: 'Personal loan: eligibility check' })).toBeVisible();
    const banner = page.getByLabel('Model draft', { exact: true });
    await expect(banner).toContainText('First draft by whisper-');
    await expect(banner).toContainText('4 of 4 unchanged');
    await expect(page.getByText('model draft', { exact: true })).toHaveCount(4);

    // Whisper wrote "€15,000"; the style guide (and the reviewer) want the amount as spoken
    const seg2 = page.getByLabel('Segment 2 text', { exact: true });
    await expect(seg2).toHaveValue(/€15,000/);
    await page.getByRole('button', { name: 'Play segment 2' }).click(); // listen before correcting
    await seg2.fill('Yes, I would like to borrow fifteen thousand euros for a car.');
    await expect(page.getByLabel('Segment 2 model draft')).toContainText('Model draft:');
    await expect(page.getByText('edited', { exact: true })).toHaveCount(1);
    await expect(banner).toContainText('3 of 4 unchanged');
    await expect(saveStatus(page)).toHaveText('All changes saved');

    await page.getByRole('button', { name: /submit for review/i }).click();
    await expectBackInQueue(page, 'Task queue', 'Personal loan: eligibility check');
  });

  test('edits survive a reload (autosaved to the server)', async ({ page }) => {
    await signInAs(page, 'alice', '/tasks/t-call-02');
    await page.getByLabel('Segment 2 text', { exact: true }).fill('Could I upload the payslips in the app instead?');
    await expect(saveStatus(page)).toHaveText('All changes saved');
    await page.reload();
    await expect(page.getByLabel('Segment 2 text', { exact: true })).toHaveValue('Could I upload the payslips in the app instead?');
  });

  test('reviewer feedback is shown and the annotator can fix and resubmit', async ({ page }) => {
    await signInAs(page, 'alice', '/tasks/t-call-05');
    await expect(page.getByRole('note').filter({ hasText: 'requested changes' })).toContainText('Segment 2 is the customer speaking');
    await page.getByRole('group', { name: 'Segment 2 speaker' }).getByRole('button', { name: 'Customer' }).click();
    await expect(saveStatus(page)).toHaveText('All changes saved');
    await page.getByRole('button', { name: /submit for review/i }).click();
    await expectBackInQueue(page, 'Task queue', 'Early repayment fee question');
  });

  test('real speech: waveform decodes, segments play from their start, overlap is flagged', async ({ page }) => {
    await signInAs(page, 'erik', '/tasks/t-call-06');
    await expect(page.getByRole('heading', { name: /Joint application call/ })).toBeVisible();
    await expect(page.getByText('Waveform unavailable')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(/5 segments · 1 overlapping/)).toBeVisible();

    await page.getByRole('button', { name: 'Play segment 3' }).click();
    await expect(page.getByText(/^0:(0[8-9]|1\d)\.\d\d \/ 0:21\.\d\d$/)).toBeVisible(); // playhead jumped to 8.08 s (and may be playing on)

    // N adds a segment at the playhead (outside text fields only)
    await page.getByRole('heading', { name: /Joint application call/ }).click();
    await page.keyboard.press('n');
    const added = page.getByLabel('Segment 6 text', { exact: true });
    await expect(added).toBeVisible();
    await added.pressSequentially('no new segment');
    await expect(page.getByLabel('Segment 7 text', { exact: true })).toHaveCount(0); // typing "n" in a field did not add another
  });

  test('a QA scorecard uses the same lifecycle, with its own rules', async ({ page }) => {
    await signInAs(page, 'alice', '/tasks/t-score-01');
    await expect(page.getByRole('list', { name: 'Call transcript' })).toContainText('personal loan enquiry');
    await page.getByRole('button', { name: /submit for review/i }).click();
    const problems = page.getByRole('alert').filter({ hasText: 'Fix these before submitting' });
    await expect(problems).toContainText('Answer every check (7 still open)');
    await expect(page.getByRole('radio', { name: /Compliant/ })).toHaveAttribute('aria-invalid', 'true');

    for (const check of ['Identity verified', 'Purpose of the call stated', 'Costs disclosed', 'No pressure selling', 'Next steps confirmed']) {
      await page.getByRole('button', { name: `${check}: pass` }).click();
    }
    await page.getByRole('button', { name: 'Affordability checked: fail' }).click();
    await page.getByRole('button', { name: 'Right to withdraw explained: fail' }).click();
    await page.getByRole('radio', { name: /Compliant/ }).check();
    await expect(problems).toContainText('A call with a failed check cannot be compliant');
    await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveAttribute('aria-invalid', 'true');

    await page.getByRole('radio', { name: /Needs coaching/ }).check();
    await page.getByRole('textbox', { name: 'Notes' }).fill('Rate given before income was asked; no cooling-off period mentioned.');
    await expect(problems).toHaveCount(0);
    await expect(saveStatus(page)).toHaveText('All changes saved');
    await page.getByRole('button', { name: /submit for review/i }).click();
    await expectBackInQueue(page, 'Task queue', 'QA: loan eligibility call');
  });
});
