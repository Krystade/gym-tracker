import { expect, test } from '@playwright/test';
import { goto, openProgram } from './nav';

test('a new user sets priorities before logging anything, from Stats or from Program’s note', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'Priorities');
  // An empty log still has the Priorities card, Cardio included.
  await expect(page.getByRole('heading', { name: 'Muscle priorities' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Biceps' }).selectOption('1');
  await page.getByRole('combobox', { name: 'Cardio' }).selectOption('2');
  await expect(page.getByLabel('Cardio this week')).toHaveText('This week: 0 of 40–60 min');
  await page.screenshot({ path: 'screenshots/r7-first-run-stats.png' });
  await page.reload();
  await goto(page, 'Priorities');
  await expect(page.getByRole('combobox', { name: 'Biceps' })).toHaveValue('1'); // saved
  await expect(page.getByRole('combobox', { name: 'Cardio' })).toHaveValue('2');
});

test('Program’s “Priorities aren’t set” note opens them', async ({ page }) => {
  await page.goto('/');
  // One set logged, so Stats is long and Priorities is far down it.
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  await page.getByRole('textbox', { name: 'Weight' }).fill('50');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem')).toHaveCount(1);
  await openProgram(page);
  const note = page.locator('.note-card', { hasText: 'Priorities aren’t set' });
  await expect(note).toBeVisible();
  await page.screenshot({ path: 'screenshots/r7-program-priorities-note.png' });
  await note.getByRole('button', { name: 'Set priorities' }).click();
  await expect(page.getByRole('heading', { name: 'Muscle priorities' })).toBeInViewport();
  await expect(page.getByRole('combobox', { name: 'Chest' })).toBeVisible();
  await page.screenshot({ path: 'screenshots/r7-first-run-priorities.png' });
});
