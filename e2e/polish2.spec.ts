import { expect, test, type Page } from '@playwright/test';

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source';

// Synthetic: Thu Oct 1 trained Lat Pulldown, then Bench Press, then Cable Curl.
async function seed(page: Page, rows: string[] = [
  '2026-10-01,Lat Pulldown,,1,100,10,,,,sample', '2026-10-01,Lat Pulldown,,2,100,9,,,,sample',
  '2026-10-01,Bench Press,,1,135,8,,,,sample', '2026-10-01,Cable Curl,,1,40,12,,,,sample',
]) {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...rows].join('\n')) });
  await expect(page.getByText(`✓ Imported ${rows.length} new sets`)).toBeVisible();
  await page.getByRole('button', { name: 'Today' }).click();
}
const order = (page: Page) => page.locator('[data-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')));

test('adding a set to a lift done earlier in the day keeps its card in place', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect.poll(() => order(page)).toEqual(['lat pulldown', 'bench press', 'cable curl']);
  const lat = page.locator('[data-card="lat pulldown"]');
  await lat.getByRole('button', { name: 'Add set' }).click();
  await expect(lat.locator('.sets li')).toHaveCount(3);
  expect(await order(page)).toEqual(['lat pulldown', 'bench press', 'cable curl']);
});
