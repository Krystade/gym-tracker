import { expect, test } from '@playwright/test';
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

  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles([fx('mfp-weight.sample.csv'), fx('mfp-nutrition.sample.csv')]);
  await expect(page.getByText('MyFitnessPal weight: 6 days')).toBeVisible();
  await expect(page.getByText('MyFitnessPal nutrition: 3 days')).toBeVisible();

  await page.getByRole('button', { name: 'Stats' }).click();
  const card = page.getByRole('region', { name: 'Body weight' });
  await expect(card).toContainText('Trend');
  await expect(card).toContainText(/lb\/week/);
  await expect(card.getByRole('img', { name: /Body weight/ })).toBeVisible();

  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('button', { name: 'Export body CSV' }).click();
  await expect(page.getByText('Copied the CSV to the clipboard')).toBeVisible();
  const text = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(text).toContain('date,weight_lb,calories,protein_g');
  expect(text).toContain('2026-09-12,,2230,149');
  expect(text).toContain('2026-08-03,180.2');
});
