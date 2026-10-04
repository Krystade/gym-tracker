import { expect, test, type Page } from '@playwright/test';

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source';
const day = (i: number) => new Date(Date.UTC(2026, 7, 19 + i * 3)).toISOString().slice(0, 10); // Aug 19 … Sep 30, every 3 days

// Synthetic history: n sessions of one working set each, the weight (or hold time) rising so every session is a PR.
async function seed(page: Page, name: string, n: number, hold = false) {
  const rows = Array.from({ length: n }, (_, i) => `${day(i)},${name},,1,${hold ? 0 : 135 + 5 * i},${hold ? 20 + i : 8},,${hold ? 'hold' : ''},,sample`);
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...rows].join('\n')) });
  await expect(page.getByText(`✓ Imported ${n} new sets`)).toBeVisible();
}

async function open(page: Page) {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
}

async function openLift(page: Page, name: string) {
  await page.getByRole('button', { name: 'Lifts' }).click();
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

test('the chart sits above History, and History shows ten sessions until you ask for all', async ({ page }) => {
  await open(page);
  await seed(page, 'Bench Press', 15);
  await openLift(page, 'Bench Press');
  await page.screenshot({ path: 'screenshots/42-exercise-top.png' });
  const chart = page.getByRole('img', { name: /Estimated 1RM/ });
  const docTop = (l: typeof chart) => l.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  expect(await docTop(chart)).toBeLessThan(1000); // about one screen down; a bottom-of-page chart is ~4000
  expect(await docTop(chart)).toBeLessThan(await docTop(page.getByRole('heading', { name: 'History' })));
  await page.evaluate(() => window.scrollBy(0, 400));
  await expect(chart).toBeInViewport();
  const cards = page.locator('section.card:has(ol.sets)');
  await expect(cards).toHaveCount(10);
  await page.getByRole('button', { name: 'Show all 15 sessions' }).click();
  await expect(cards).toHaveCount(15);
  await expect(page.getByRole('button', { name: /Show all/ })).toHaveCount(0);
});

test('the chart reads out a point, defaulting to the latest, and a tap selects another', async ({ page }) => {
  await open(page);
  await seed(page, 'Bench Press', 15);
  await openLift(page, 'Bench Press');
  const readout = page.locator('.readout');
  await expect(readout).toContainText('Sep 30');
  await expect(readout).toContainText('lb e1RM');
  await expect(readout).toContainText('PR');
  await page.locator('.chart circle.pt').first().scrollIntoViewIfNeeded();
  await page.locator('.chart circle.pt').first().click();
  await expect(readout).toContainText('Aug 19');
  await expect(readout).not.toContainText('Sep 30');
  await expect(page.locator('.chart .pt.sel')).toHaveCount(1);
  // A thumb rarely lands on a dot: a tap anywhere picks the point nearest in x, even far above the line.
  const pts = page.locator('.chart circle.pt');
  const [a, b] = [(await pts.nth(2).boundingBox())!, (await pts.nth(3).boundingBox())!];
  const svg = (await page.locator('svg.chart').boundingBox())!;
  await page.mouse.click(a.x + a.width / 2 + 0.4 * (b.x - a.x), svg.y + 6);
  await expect(readout).toContainText('Aug 25');
  await page.mouse.click(a.x + a.width / 2 + 0.6 * (b.x - a.x), svg.y + svg.height - 4);
  await expect(readout).toContainText('Aug 28');
  // Gridlines at the bottom, middle and top, with the unit on the top label only.
  await expect(page.locator('.chart .grid')).toHaveCount(3);
  await expect(page.locator('.chart text.lbl', { hasText: /^\d+ lb$/ })).toHaveCount(1);
  // The same numbers are in a table for screen readers.
  await page.locator('details.chart-table summary').click();
  await expect(page.getByRole('table', { name: /Estimated 1RM/ }).getByRole('row')).toHaveCount(16);
  await page.screenshot({ path: 'screenshots/43-exercise-chart.png' });
});

test('a hold lift charts seconds, not pounds', async ({ page }) => {
  await open(page);
  await seed(page, 'Plank', 6, true);
  await openLift(page, 'Plank');
  await expect(page.locator('.readout')).toHaveText(/Sep 3 · 25 s/);
  await expect(page.locator('.readout')).not.toContainText(/lb|e1RM/);
  await expect(page.locator('.chart text.lbl', { hasText: /^\d+ s$/ })).toHaveCount(1);
  await expect(page.locator('.chart text.lbl', { hasText: /lb/ })).toHaveCount(0);
  await page.locator('.chart').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/42b-exercise-hold.png' });
});

test('the tiles say lb, and the best set is dated like the rest of the app', async ({ page }) => {
  await open(page);
  await seed(page, 'Bench Press', 15);
  await openLift(page, 'Bench Press');
  const tiles = page.locator('.screen'); // the tiles come in two rows: the estimates, then best set and sessions
  await expect(tiles.locator('.tile', { hasText: /\d{4}-\d{2}-\d{2}/ })).toHaveCount(0);
  await expect(tiles.locator('.tile', { hasText: 'Best set' })).toContainText(/Best set · .*Sep 30/);
  await expect(tiles.locator('.tile', { hasText: 'Est. 1RM' })).toHaveText(/Est\. 1RM\s*\d+ lb$/);
  await expect(tiles.locator('.tile', { hasText: 'Est. 6RM' })).toHaveText(/Est\. 6RM\s*\d+ lb$/);
  await expect(tiles.locator('.tile', { hasText: 'Sessions' })).toHaveText(/Sessions\s*15$/);
});

test('"Not now" quiets the test banner for this lift, and it stays quiet after a reload', async ({ page }) => {
  await open(page);
  await seed(page, 'Bench Press', 15);
  await openLift(page, 'Bench Press');
  const banner = page.getByText('Time for a test');
  await expect(banner).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await openLift(page, 'Bench Press');
  await expect(page.locator('.tiles').first()).toBeVisible(); // loaded, so a missing banner is not just a slow render
  await expect(banner).toHaveCount(0);
  // Fourteen days on, it is due again.
  await page.clock.setFixedTime(new Date('2026-10-16T18:00:00'));
  await page.reload();
  await openLift(page, 'Bench Press');
  await expect(banner).toBeVisible();
});
