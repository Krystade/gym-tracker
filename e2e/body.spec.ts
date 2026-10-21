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

  // Body is hidden on Stats for now (owner, 2026-10-20; Stats v2 S4 brings it back): the import and the export stay.
  await goto(page, 'Stats');
  await expect(page.getByRole('region', { name: 'Body weight' })).toHaveCount(0);

  await goto(page, 'Backup');
  await page.getByRole('button', { name: 'Export body CSV' }).click();
  await expect(page.getByText('Copied the CSV to the clipboard')).toBeVisible();
  const text = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(text).toContain('date,weight_lb,calories,protein_g');
  expect(text).toContain('2026-09-12,,2230,149');
  expect(text).toContain('2026-08-03,180.2');
});
