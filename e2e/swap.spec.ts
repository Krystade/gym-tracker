import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

const buildProgram = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('textbox', { name: 'Days per week' }).fill('2');
  await page.getByRole('textbox', { name: 'Sets per session' }).fill('14');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A/ })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
};

const openSwap = async (page: Page) => {
  await buildProgram(page);
  const row = page.getByRole('list', { name: 'Planned exercises' }).getByRole('listitem').first();
  const lift = (await row.locator('.plan-name').getAttribute('data-exercise'))!;
  await row.getByRole('button', { name: /^Swap/ }).click();
  return lift;
};

test('the swap picker names the lift being replaced', async ({ page }) => {
  const lift = await openSwap(page);
  await expect(page.getByRole('heading', { name: `Swap ${lift}`, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await page.screenshot({ path: 'screenshots/38-swap-picker.png' });
  // The search must stay pinned (and fully on screen) when the list is scrolled.
  await page.evaluate(() => window.scrollTo(0, 600));
  const box = (await page.getByRole('searchbox', { name: 'Search exercises' }).boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeLessThan(60);
  await page.screenshot({ path: 'screenshots/38b-swap-picker-scrolled.png' });
});

test('the add row is bold and the placeholder fits', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  const box = page.getByRole('searchbox', { name: 'Search exercises' });
  await expect(box).toHaveAttribute('placeholder', 'Search or add new');
  await box.fill('Zercher Squat');
  const add = page.getByRole('button', { name: 'Add “Zercher Squat”' });
  await expect(add).toBeVisible();
  expect(await add.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('700');
  await page.screenshot({ path: 'screenshots/39-picker-add.png' });
});

test('the swap reasons are not all the same', async ({ page }) => {
  await openSwap(page);
  const reasons = await page.locator('.swaps li .muted').allInnerTexts();
  expect(reasons.length).toBeGreaterThan(0);
  for (const r of reasons) expect(r).not.toMatch(/similar muscles|same muscles/);
});

test('on a notched phone the title sits just above the search, with no empty band', async ({ page }) => {
  await openSwap(page);
  await page.addStyleTag({ content: ':root { --sat: 47px !important; }' });
  const title = (await page.locator('.picker-title').boundingBox())!;
  const search = (await page.getByRole('searchbox', { name: 'Search exercises' }).boundingBox())!;
  const gap = search.y - (title.y + title.height);
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(24);
});
