import { expect, test } from '@playwright/test';
import { goto } from './nav';

// Item 14 (2026-10-20): a lift whose load is the body. Help on an assisted machine is a weight below 0 ("BW − 30"), the range
// topped takes a step less help, and the lift's screen reads its level as the reps it leaves fresh at bodyweight. Synthetic log.
test.use({ serviceWorkers: 'block' });
const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,duration_s,distance_mi';
const row = (date: string, set: number, w: number, reps: number) => `${date},Forward-Lean Dips,,${set},${w},${reps},,${w <= 0 ? 'bodyweight' : ''},,sample,,`;
const ROWS = [
  row('2026-09-20', 1, 0, 7), row('2026-09-20', 2, 0, 6), row('2026-09-20', 3, -30, 10),
  row('2026-09-25', 1, 0, 8), row('2026-09-25', 2, 0, 6), row('2026-09-25', 3, -30, 11),
  row('2026-10-01', 1, -30, 12), row('2026-10-01', 2, -30, 12), row('2026-10-01', 3, -30, 12),
];

test('help is a weight below bodyweight: less of it once the range is topped, logged and shown as BW−N', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-04T18:00:00') });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...ROWS].join('\n')) });
  await expect(page.getByText(`✓ Imported ${ROWS.length} new sets`)).toBeVisible();
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Forward-Lean Dips');
  await page.getByRole('button', { name: /^Forward-Lean Dips/ }).first().click();
  const card = page.locator('[data-card="forward-lean dips"]');
  // 12 · 12 · 12 at BW − 30 tops 8–12: a step less help.
  await expect(card.getByLabel('Target')).toContainText('Go up: 3 × 8+ @ BW − 25 lb');
  await expect(card.getByLabel('Target').locator('.target-why')).toHaveCount(0);
  const weight = card.getByRole('textbox', { name: 'Weight' });
  await expect(weight).toHaveValue('-25');
  await expect(card.getByLabel('Load')).toHaveText('BW − 25 lb: help');
  // The stepper goes through bodyweight and below it, and says what each side means.
  for (let i = 0; i < 5; i++) await card.getByRole('button', { name: 'Weight up' }).click();
  await expect(weight).toHaveValue('0');
  await expect(card.getByLabel('Load')).toHaveCount(0);
  await card.getByRole('button', { name: 'Weight up' }).click();
  await expect(card.getByLabel('Load')).toHaveText('BW + 5 lb');
  await card.getByRole('button', { name: 'Weight down' }).click();
  await card.getByRole('button', { name: 'Weight down' }).click();
  await expect(weight).toHaveValue('-5');
  await expect(card.getByLabel('Load')).toHaveText('BW − 5 lb: help');
  await card.getByRole('textbox', { name: 'Reps' }).fill('9');
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(card.getByRole('list', { name: 'Sets for Forward-Lean Dips' })).toContainText('BW−5 × 9');
  await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'screenshots/r19-bodyweight-card.png' });
  // A bench press still can't go below 0.
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: /^Bench Press/ }).first().click();
  const bench = page.locator('[data-card="bench press"]');
  await bench.getByRole('textbox', { name: 'Weight' }).fill('0');
  await bench.getByRole('button', { name: 'Weight down' }).click();
  await expect(bench.getByRole('textbox', { name: 'Weight' })).toHaveValue('0');

  // The lift's screen: its level as reps at bodyweight, no 1RM.
  await card.getByRole('button', { name: 'Forward-Lean Dips', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Forward-Lean Dips', level: 1 })).toBeVisible();
  await expect(page.locator('.tile', { hasText: 'Max reps at BW' })).toContainText(/≈ \d+/);
  await expect(page.locator('.tile', { hasText: 'Body weight moved' })).toContainText('96%');
  await expect(page.getByText(/^Fresh, fatigue-adjusted · ±[0-9.]+ reps · /)).toBeVisible();
  await expect(page.getByText('Est. 1RM')).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Max reps at bodyweight over time' })).toBeVisible();
  await page.screenshot({ path: 'screenshots/r19-bodyweight-screen.png', fullPage: true });
});
