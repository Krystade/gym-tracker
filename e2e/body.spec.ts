import { expect, test } from '@playwright/test';
import { goto } from './nav';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, 'fixtures', n);

test('weigh in, import MyFitnessPal, see the trend, export body CSV', async ({ page }) => {
  // Capture what the export copies; the share sheet isn't available headless.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { (window as unknown as { copied: string }).copied = t; } } });
  });
  // The fixtures end mid-September: pin the clock near them, so the 4-week rate has recent weigh-ins whatever today is.
  await page.clock.install({ time: new Date('2026-09-20T12:00:00') });
  await page.goto('/');
  const weigh = page.getByRole('group', { name: 'Weigh-in' });
  await weigh.getByRole('textbox', { name: 'Weigh-in (lb)' }).fill('183.4');
  await weigh.getByRole('button', { name: 'Save weight' }).click();
  await expect(weigh).toContainText('183.4 lb');

  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles([fx('mfp-weight.sample.csv'), fx('mfp-nutrition.sample.csv')]);
  await expect(page.getByText('MyFitnessPal weight: 6 days')).toBeVisible();
  await expect(page.getByText('MyFitnessPal nutrition: 3 days')).toBeVisible();

  // Stats › Body (IA A5, owner 2026-10-21): with weigh-ins, one Weight tile (the trend, its 4-week rate and band); no sets needed.
  await goto(page, 'Stats');
  const bodySec = page.getByRole('region', { name: 'Body' });
  const tile = bodySec.locator('[data-tile="weight"]');
  await expect(tile).toBeVisible();
  await expect(tile).toContainText('lb trend');
  await expect(tile).toContainText(/lb\/wk · Lean gain/);
  await tile.click();
  const sheet = page.getByRole('dialog', { name: 'Body weight' });
  await expect(sheet.getByRole('img', { name: /^Body weight, last .*: trend \d+\.\d lb$/ })).toBeVisible();
  await expect(sheet).toContainText('Lean gain');
  await expect(sheet).toContainText('Weigh-ins7');
  await expect(sheet).toContainText('Only you see this; friends never do.');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  // No progress photos on Stats (owner, 2026-10-21): they live in More.
  await expect(page.getByText('Progress photos')).toHaveCount(0);

  await goto(page, 'Backup');
  await page.getByRole('button', { name: 'Export body CSV' }).click();
  await expect(page.getByText('Copied the CSV to the clipboard')).toBeVisible();
  const text = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(text).toContain('date,weight_lb,calories,protein_g');
  expect(text).toContain('2026-09-12,,2230,149');
  expect(text).toContain('2026-08-03,180.2');
});
