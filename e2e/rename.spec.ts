import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv'); // Cable Curl on Jan 5 and 12, Pull-up on Jan 5
const nav = (page: Page, t: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: t, exact: true }).click();
const seed = async (page: Page) => {
  await page.goto('/');
  await nav(page, 'Data');
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await nav(page, 'Lifts');
};
const rows = (page: Page) => page.locator('.row-button b');

test('renaming a lift moves its whole history to the new name', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: /^Cable Curl/ }).click();
  const box = page.getByRole('group', { name: 'Rename or merge' });
  await box.getByRole('combobox', { name: 'New name' }).fill('Cable Biceps Curl');
  await box.getByRole('button', { name: 'Rename' }).click();
  await box.getByRole('button', { name: /^Tap again/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cable Biceps Curl');
  await page.reload();
  await nav(page, 'Lifts');
  await expect(rows(page)).toHaveText(['Cable Biceps Curl', 'Pull-up']);
  await expect(page.getByRole('button', { name: /^Cable Biceps Curl/ })).toContainText('2 sessions');
});

test('merging a lift into another keeps every set, numbered after the ones already there', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: /^Pull-up/ }).click();
  const box = page.getByRole('group', { name: 'Rename or merge' });
  await box.getByRole('combobox', { name: 'New name' }).fill('cable curl');
  await box.getByRole('button', { name: 'Merge into Cable Curl' }).click();
  await expect(box).toContainText('1 set moves to Cable Curl');
  await box.getByRole('button', { name: /^Tap again/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cable Curl');
  await page.reload();
  await nav(page, 'History');
  const jan5 = page.locator('details.day').filter({ hasText: 'Jan 5' });
  await jan5.locator('summary').click();
  await expect(jan5.getByRole('button', { name: /^Cable Curl/ })).toContainText(/60 × 12, 70 × 10( PR)?, BW × 8/);
  await nav(page, 'Lifts');
  await expect(rows(page)).toHaveText(['Cable Curl']);
});
