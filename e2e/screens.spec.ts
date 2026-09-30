import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');
async function check(page: Page, name: string) {
  await page.evaluate(() => { document.documentElement.style.setProperty('--sat', '47px'); document.documentElement.style.setProperty('--sab', '34px'); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const small = await page.evaluate(() => [...document.querySelectorAll('button, input:not([type=file]), label.button')]
    .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height < 44).length);
  expect(small).toBe(0);
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: name !== '0-picker' });
}

test('screens at iPhone 13 mini size', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText('Imported 6 new, 0 updated')).toBeVisible();
  await check(page, '4-data');
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.evaluate(() => window.scrollTo(0, 900));
  await check(page, '0-picker');
  await page.getByRole('button', { name: 'Cable Curl' }).first().click();
  await page.getByRole('button', { name: 'Add set' }).click();
  await check(page, '1-today');
  await page.getByRole('button', { name: 'History' }).click();
  await check(page, '2-history');
  await page.getByRole('button', { name: 'Lifts' }).click();
  await check(page, '3-lifts');
  await page.getByRole('button', { name: /Cable Curl/ }).click();
  await check(page, '5-exercise');
  await page.getByRole('button', { name: 'Stats' }).click();
  await check(page, '6-stats');
});
