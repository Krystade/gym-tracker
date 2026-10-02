import { expect, test } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

test('stats: empty state, then charts after import, and priorities edit', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Stats' }).click();
  await expect(page.getByText('No sessions yet')).toBeVisible();

  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await page.getByRole('button', { name: 'Stats' }).click();
  for (const h of ['This week', 'Muscle volume', 'Sessions per week', 'Weekly tonnage', 'Calendar', 'Priorities']) {
    await expect(page.getByRole('heading', { name: h })).toBeVisible();
  }
  await page.getByRole('combobox', { name: 'Biceps' }).selectOption('1');
  await expect(page.getByRole('heading', { name: 'Priority 1' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('exercise screen: rep-max picker, calibration note, and a logged test set', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Lifts' }).click();
  await page.getByRole('button', { name: /Cable Curl/ }).click();
  await expect(page.getByText('Epley · no tests yet')).toBeVisible();
  await expect(page.getByText('Est. 6RM')).toBeVisible();
  await page.getByRole('button', { name: '10RM' }).click();
  await expect(page.getByText('Est. 10RM')).toBeVisible();

  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await page.getByRole('button', { name: 'Add set' }).click();
  const row = page.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem');
  await expect(row).toContainText('RIR 0');
  await expect(row).toContainText('test');
  await page.getByRole('button', { name: 'Cable Curl', exact: true }).click();
  await expect(page.getByText(/calibrated · 1 test/)).toBeVisible();
});
