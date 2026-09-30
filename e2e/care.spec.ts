import { expect, test } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

test('pain region and severity, care card, back block, swap suggestions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();

  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  await page.getByRole('button', { name: 'Pain', exact: true }).click();
  await page.getByRole('group', { name: 'Pain region' }).getByRole('button', { name: 'Elbow' }).click();
  await page.getByRole('group', { name: 'Pain severity' }).getByRole('button', { name: 'Moderate' }).click();
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem').first()).toContainText('pain · elbow');

  await page.getByRole('button', { name: 'Stats' }).click();
  const care = page.getByRole('region', { name: 'Joint & back care' });
  await expect(care).toContainText('Elbow');
  await expect(care).toContainText('Cable Curl');
  await expect(care).toContainText('Not medical advice');

  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Build program' }).click();
  await page.getByRole('button', { name: 'Add back-resilience block' }).click();
  await expect(page.getByRole('list', { name: 'Day A exercises' })).toContainText('Bird Dog');
  await expect(page.getByRole('list', { name: 'Day A exercises' })).toContainText('20–40 s hold');

  await page.getByRole('button', { name: 'Lifts' }).click();
  await page.getByRole('button', { name: /Cable Curl/ }).click();
  const swaps = page.getByRole('list', { name: 'Suggested swaps' });
  await expect(swaps.getByRole('listitem')).toHaveCount(5);
  await expect(swaps.locator('b', { hasText: /^Cable Curl$/ })).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
