import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto, statsSheet } from './nav';

// Owner, 2026-11-22, small gaps: the week's rings on Today open the week; a folded card and a cardio card show their points pill;
// the care card's "worst" counts a tingle. Synthetic log; today Wednesday 18 Nov 2026.
const SHOTS = 'screenshots/small-gaps';
mkdirSync(SHOTS, { recursive: true });
test.use({ serviceWorkers: 'block' });

const H = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,pain_region,pain_severity,duration_s';
const ROWS = [
  '2026-11-09,Bench Press,,1,135,8,,,,sample,,,', '2026-11-11,Lat Pulldown,,1,120,10,,,,sample,,,',
  '2026-11-16,Cable Curl,,1,40,10,,pain,,sample,elbow,0,', '2026-11-16,Cable Curl,,2,40,10,,,,sample,,,',
  '2026-11-18,Bench Press,,1,135,8,,,,sample,,,', '2026-11-18,Bench Press,,2,135,8,,,,sample,,,', '2026-11-18,Bench Press,,3,135,8,,,,sample,,,',
  '2026-11-18,Treadmill,,1,0,,,cardio,,sample,,,1200',
];

async function seed(page: Page) {
  await page.clock.install({ time: new Date('2026-11-18T19:00:00') });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([H, ...ROWS].join('\n')) });
  await expect(page.getByText(`✓ Imported ${ROWS.length} new sets`)).toBeVisible();
  await goto(page, 'Today');
}

test('the week’s rings on Today open the week: its sessions against the goal, like Stats’ This week', async ({ page }) => {
  await seed(page);
  const rings = page.getByRole('button', { name: 'This week' });
  await expect(rings).toBeVisible();
  const box = (await rings.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  await page.screenshot({ path: `${SHOTS}/0-today-rings.png` });
  await rings.click();
  const sheet = page.getByRole('dialog', { name: 'This week' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Week of Nov 16');
  await expect(sheet).toContainText(/Sessions\s*2 of 2/);
  await page.screenshot({ path: `${SHOTS}/1-week-sheet.png` });
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toHaveCount(0);
});

test('a folded card keeps its points pill, and a cardio card has one: a point per set, one per 3 cardio minutes', async ({ page }) => {
  await seed(page);
  const bench = page.locator('[data-card="bench press"]');
  await expect(bench.locator('.card-head .pts-pill')).toHaveText('+3 pts');
  await bench.getByRole('button', { name: 'Fold Bench Press' }).click();
  await expect(bench.locator('.fold-line .pts-pill')).toHaveText('+3 pts');
  const fold = (await bench.locator('.fold-line').boundingBox())!, pill = (await bench.locator('.fold-line .pts-pill').boundingBox())!;
  expect(pill.x + pill.width).toBeLessThanOrEqual(fold.x + fold.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const tread = page.locator('[data-card="treadmill"]');
  await expect(tread.getByLabel('6 points from Treadmill today')).toHaveText('+6 pts');
  await bench.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/2-folded-and-cardio.png` });
});

test('the care card’s worst pain counts a tingle', async ({ page }) => {
  await seed(page);
  await goto(page, 'Stats');
  await statsSheet(page, 'pain');
  const care = page.getByRole('region', { name: 'Joint & back care' });
  await expect(care).toContainText('Cable Curl');
  await expect(care).toContainText('worst tingle');
  await care.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/3-care-tingle.png` });
});
