import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

// A generated image: no photo file is ever committed to this public repo.
async function png(page: Page, colour: string): Promise<Buffer> {
  const url = await page.evaluate((c) => {
    const cv = document.createElement('canvas'); cv.width = 300; cv.height = 400;
    const g = cv.getContext('2d')!; g.fillStyle = c; g.fillRect(0, 0, 300, 400);
    return cv.toDataURL('image/png');
  }, colour);
  return Buffer.from(url.split(',')[1], 'base64');
}

async function addPhoto(page: Page, date: string, colour: string) {
  await page.getByLabel('Photo date').fill(date);
  await page.getByLabel('From library').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: await png(page, colour) });
  await expect(page.getByRole('img', { name: `Front, ${date}` }).first()).toBeVisible();
}

test('photos stay on the device: add, compare, delete, never exported', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { (window as unknown as { copied: string }).copied = t; } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(path.join(import.meta.dirname, 'fixtures', 'history.sample.csv'));
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();

  await page.getByRole('button', { name: 'Stats' }).click();
  await page.getByRole('region', { name: 'Progress photos' }).getByRole('button', { name: 'Open photos' }).click();
  await addPhoto(page, '2026-08-01', '#446');
  await addPhoto(page, '2026-09-20', '#664');

  const tl = page.getByRole('region', { name: 'Timeline' });
  await expect(tl.getByRole('img')).toHaveCount(2);
  const cmp = page.getByRole('region', { name: 'Compare' });
  await expect(cmp.getByRole('img', { name: 'Front, 2026-08-01' })).toBeVisible();
  await expect(cmp.getByRole('img', { name: 'Front, 2026-09-20' })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'screenshots/11-photos.png', fullPage: true });
  await tl.getByRole('button', { name: 'Front, 2026-08-01' }).click();
  await expect(page.getByRole('button', { name: 'Delete photo' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Front, 2026-08-01' })).toBeVisible();
  await page.screenshot({ path: 'screenshots/12-photo-view.png', fullPage: true });
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete photo' }).click();
  await expect(tl.getByRole('img')).toHaveCount(1);

  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  await expect(page.getByText('Copied the CSV to the clipboard')).toBeVisible();
  const text = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(text).not.toMatch(/blob:|data:image|2026-09-20/);
});
