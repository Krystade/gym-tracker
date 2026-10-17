import { expect, test } from '@playwright/test';

// A caption wrapped round the buttons pressed the first one (−) when tapped.
test('tapping a stepper caption changes nothing', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  const weight = page.getByRole('textbox', { name: 'Weight' });
  const reps = page.getByRole('textbox', { name: 'Reps' });
  await weight.fill('135');
  await reps.fill('8');
  const form = page.locator('.set-form');
  await form.getByText('Weight', { exact: true }).click();
  await form.getByText('Reps', { exact: true }).click();
  await expect(weight).toHaveValue('135');
  await expect(reps).toHaveValue('8');
});
