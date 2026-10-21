import { expect, test } from '@playwright/test';
import { goto, statsSheet, openProgram } from './nav';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

test('pain region and severity, care card, back block, swap suggestions', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();

  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  await page.getByRole('button', { name: 'Details' }).click();
  await page.getByRole('button', { name: 'Pain', exact: true }).click();
  await page.getByRole('group', { name: 'Pain region' }).getByRole('button', { name: 'Elbow' }).click();
  await page.getByRole('group', { name: 'Pain severity' }).getByRole('button', { name: 'Moderate' }).click();
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem').first()).toContainText('pain · elbow');

  await goto(page, 'Stats');
  await statsSheet(page, 'pain');
  const care = page.getByRole('region', { name: 'Joint & back care' });
  await expect(care).toContainText('Elbow');
  await expect(care).toContainText('Cable Curl');
  await expect(care).toContainText('Not medical advice');

  await goto(page, 'Today');
  await openProgram(page);
  await page.getByRole('button', { name: 'Build program' }).click();
  await page.getByRole('button', { name: 'Add back-resilience block' }).click();
  await expect(page.getByRole('list', { name: 'Day A exercises' })).toContainText('Bird Dog');
  await expect(page.getByRole('list', { name: 'Day A exercises' })).toContainText('20–40 s hold');

  await goto(page, 'Lifts');
  await page.getByRole('button', { name: /Cable Curl/ }).click();
  const swaps = page.getByRole('list', { name: 'Suggested swaps' });
  await expect(swaps.getByRole('listitem')).toHaveCount(5);
  await expect(swaps.locator('b', { hasText: /^Cable Curl$/ })).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
