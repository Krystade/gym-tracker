// e2e/import.spec.ts
import { expect, test } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

test('import is idempotent and feeds history, lifts and chart', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText('✓ Imported 6 new sets')).toBeVisible();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText('Nothing new: 6 sets already in your log')).toBeVisible();

  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.locator('details.day > summary').first()).toContainText(/\d+ sets?/); // the short date drops the year, so the day summary is the signal
  await expect(page.getByText('elbow "twinge"')).toBeAttached();

  await page.getByRole('button', { name: 'Lifts' }).click();
  await page.getByRole('button', { name: /Cable Curl/ }).click();
  const chart = page.getByRole('img', { name: 'Estimated 1RM over time' });
  await expect(chart.locator('circle.pt')).toHaveCount(2);
  await expect(page.getByText('80 × ?')).toBeVisible();
});

test('a failed import write shows an error instead of doing nothing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
  });
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByRole('alert')).toContainText(/Import failed/);
});

test('imports a priority profile file and rejects a bad one', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(path.join(import.meta.dirname, 'fixtures', 'profile.sample.json'));
  await expect(page.getByText('Profile imported: 2 muscles prioritised')).toBeVisible();
  await page.getByLabel('Import CSV').setInputFiles(path.join(import.meta.dirname, 'fixtures', 'bad-profile.sample.json'));
  await expect(page.getByText('Profile not imported: Unknown muscle "Wings"')).toBeVisible();
});
