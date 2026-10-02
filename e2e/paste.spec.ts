import { expect, test } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');
// Synthetic notes: one day already in the sample history, one broken line, one unknown name, one non-lift line.
const NOTES = ['1/12/26', 'Cable curls: 70x12 80x8', '1/14/26', 'Lat pull down: 100x12 100x10', 'Pushdowns: 50 for 12', 'Zercher thing: 135x5', 'Run: 2 miles'].join('\n');

test('paste from notes: review, fix a line, map a name, add once', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText('✓ Imported 6 new sets')).toBeVisible();

  await page.getByRole('button', { name: 'Paste from notes' }).click();
  await page.getByLabel('Workout notes').fill(NOTES);
  await page.getByRole('button', { name: 'Read notes' }).click();
  await expect(page.getByRole('heading', { name: 'Check before adding' })).toBeVisible();
  await expect(page.getByText('2 lines couldn’t be read.')).toBeVisible();
  await expect(page.getByText('Already in your log — add anyway')).toBeVisible();
  await expect(page.getByLabel('Exercise on line 4')).toHaveValue('Lat Pulldown');
  await page.screenshot({ path: 'screenshots/14-paste-review.png', fullPage: true });

  // Nothing is saved yet.
  await page.getByRole('button', { name: '‹ Edit the text' }).click();
  await page.getByRole('button', { name: 'Read notes' }).click();

  await page.getByRole('button', { name: 'Edit line 5' }).click();
  await page.getByLabel('Line 5 text').fill('Pushdowns: 50x12 50x10');
  await expect(page.getByText('50×12  50×10')).toBeVisible();
  await page.screenshot({ path: 'screenshots/15-paste-edit.png', fullPage: true });
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Ignore line 7' }).click();
  await page.getByLabel('Exercise on line 6').fill('Barbell Squat');

  await page.getByRole('button', { name: 'Add 5 sets from 1 day' }).click();
  await expect(page.getByRole('status')).toContainText('Added 5 sets from 1 day (5 new, 0 updated)');
  await page.getByRole('button', { name: 'Paste more' }).click();

  // The same paste again adds nothing, and the mapping was remembered.
  await page.getByLabel('Workout notes').fill(NOTES);
  await page.getByRole('button', { name: 'Read notes' }).click();
  await expect(page.getByLabel('Exercise on line 6')).toHaveValue('Barbell Squat');
  await expect(page.getByRole('button', { name: 'Nothing to add' })).toBeDisabled();

  await page.getByRole('button', { name: 'Data' }).click();
  await expect(page.getByText(/^11 sets/)).toBeVisible();
  await page.getByRole('button', { name: 'Lifts' }).click();
  await page.getByRole('button', { name: /Barbell Squat/ }).click();
  await expect(page.getByText('135 × 5').first()).toBeVisible();
});

test('paste review shows every date a set lands on, and the notes it read', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('button', { name: 'Paste from notes' }).click();
  await page.getByLabel('Workout notes').fill('9/28/26\nBench: 135x8 felt heavy\n9/29/26 Row 100x10\nCurl 30x10');
  await page.getByRole('button', { name: 'Read notes' }).click();
  await expect(page.getByRole('heading', { name: /Sep 28, 2026/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Sep 29, 2026/ })).toBeVisible();
  await expect(page.getByText('felt heavy')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add 3 sets from 2 days' })).toBeVisible();
});
