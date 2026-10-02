// e2e/progression.spec.ts
import { expect, test } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

test('target, estimated RIR, PR banner and settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();

  // Sample: last Cable Curl session 70×12, 80×8, 80×? → top working weight 80, weakest 8 → 80 lb × 9+
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  await expect(page.getByLabel('Target')).toContainText('× 9+ @ 80 lb');
  await expect(page.getByRole('textbox', { name: 'Weight' })).toHaveValue('80');
  await expect(page.getByRole('textbox', { name: 'Reps' })).toHaveValue('9');

  await page.getByRole('textbox', { name: 'Reps' }).fill('10');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'PR' })).toBeVisible();

  await page.getByRole('button', { name: 'Cable Curl', exact: true }).click();
  await expect(page.getByTitle('Estimated').first()).toBeVisible();
  // A 6–8 range makes last session's weakest top set (8) the top of the range → go up by the increment.
  await page.getByRole('textbox', { name: 'Min reps' }).fill('6');
  await page.getByRole('textbox', { name: 'Max reps' }).fill('8');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(page.getByLabel('Target')).toContainText(/Go up: \d × 6\+ @ 85 lb/);
});
