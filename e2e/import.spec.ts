// e2e/import.spec.ts
import { expect, test } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

test('import is idempotent and feeds history, lifts and chart', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText('Imported 6 new, 0 updated')).toBeVisible();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText('Imported 0 new, 6 updated')).toBeVisible();

  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText(/2026/).first()).toBeVisible();
  await expect(page.getByText('elbow "twinge"')).toBeAttached();

  await page.getByRole('button', { name: 'Lifts' }).click();
  await page.getByRole('button', { name: /Cable Curl/ }).click();
  const chart = page.getByRole('img', { name: 'Estimated 1RM over time' });
  await expect(chart.locator('circle')).toHaveCount(2);
  await expect(page.getByText('80 × ?')).toBeVisible();
});
