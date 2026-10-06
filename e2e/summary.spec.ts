import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');
const nav = (page: Page, t: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: t, exact: true }).click();

test('a PR stays marked on its row, in the day summary and in History', async ({ page }) => {
  await page.goto('/');
  await nav(page, 'Data');
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE); // Cable Curl, last 70 × 12 · 80 × 8
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await nav(page, 'Today');
  await expect(page.getByRole('region', { name: 'Today so far' })).toHaveCount(0); // nothing logged yet
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Cable Curl');
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  const card = page.locator('[data-card="cable curl"]');
  await card.getByRole('textbox', { name: 'Weight' }).fill('85');
  await card.getByRole('textbox', { name: 'Reps' }).fill('8');
  await card.getByRole('button', { name: /^Add set/ }).click();
  await card.getByRole('textbox', { name: 'Weight' }).fill('75');
  await card.getByRole('button', { name: /^Add set/ }).click(); // a later, lighter set: no PR, and it clears the banner
  const rows = card.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem');
  await expect(rows.nth(0)).toContainText('PR');
  await expect(rows.nth(1)).not.toContainText('PR');

  const sum = page.getByRole('region', { name: 'Today so far' });
  await expect(sum).toContainText('Cable Curl');
  await expect(sum).toContainText('85 × 8');
  await expect(sum).toContainText('PR');
  await expect(sum).toContainText('↑ last 80 × 8');
  await expect(sum.getByLabel('Sets per muscle')).toContainText('Biceps 2');

  await nav(page, 'History');
  await expect(page.locator('details.day').first().locator('summary')).toContainText('PR');
});
