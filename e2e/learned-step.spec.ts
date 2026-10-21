import { expect, test } from '@playwright/test';
import { goto } from './nav';

// Items 01–02 (2026-10-20): going up takes the next rung of the lift's learned steps, and each set aims at last time's less the
// reps his own increases cost. Synthetic log: a cable stack in 2.5s, every increase costing 2 reps.
test.use({ serviceWorkers: 'block' });
const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,duration_s,distance_mi';
const ROWS = ['2026-09-01,Cable Pushdown,,1,50,15,,,,sample,,', '2026-09-01,Cable Pushdown,,2,50,15,,,,sample,,', '2026-09-01,Cable Pushdown,,3,50,14,,,,sample,,', '2026-09-05,Cable Pushdown,,1,52.5,13,,,,sample,,', '2026-09-05,Cable Pushdown,,2,52.5,13,,,,sample,,', '2026-09-05,Cable Pushdown,,3,52.5,12,,,,sample,,', '2026-09-09,Cable Pushdown,,1,52.5,15,,,,sample,,', '2026-09-09,Cable Pushdown,,2,52.5,15,,,,sample,,', '2026-09-09,Cable Pushdown,,3,52.5,14,,,,sample,,', '2026-09-13,Cable Pushdown,,1,55,13,,,,sample,,', '2026-09-13,Cable Pushdown,,2,55,13,,,,sample,,', '2026-09-13,Cable Pushdown,,3,55,12,,,,sample,,', '2026-09-17,Cable Pushdown,,1,55,15,,,,sample,,', '2026-09-17,Cable Pushdown,,2,55,15,,,,sample,,', '2026-09-17,Cable Pushdown,,3,55,14,,,,sample,,', '2026-09-21,Cable Pushdown,,1,57.5,13,,,,sample,,', '2026-09-21,Cable Pushdown,,2,57.5,13,,,,sample,,', '2026-09-21,Cable Pushdown,,3,57.5,12,,,,sample,,', '2026-09-25,Cable Pushdown,,1,57.5,15,,,,sample,,', '2026-09-25,Cable Pushdown,,2,57.5,15,,,,sample,,', '2026-09-25,Cable Pushdown,,3,57.5,14,,,,sample,,', '2026-09-29,Cable Pushdown,,1,60,13,,,,sample,,', '2026-09-29,Cable Pushdown,,2,60,13,,,,sample,,', '2026-09-29,Cable Pushdown,,3,60,12,,,,sample,,', '2026-10-03,Cable Pushdown,,1,60,15,,,,sample,,', '2026-10-03,Cable Pushdown,,2,60,15,,,,sample,,', '2026-10-03,Cable Pushdown,,3,60,14,,,,sample,,'];

test('going up: the learned 2.5 lb rung, each set less the learned drop, and why in one muted line', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-19T18:00:00') });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...ROWS].join('\n')) });
  await expect(page.getByText(`✓ Imported ${ROWS.length} new sets`)).toBeVisible();
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Cable Pushdown');
  await page.getByRole('button', { name: /^Cable Pushdown/ }).first().click();
  const card = page.locator('[data-card="cable pushdown"]');
  const target = card.getByLabel('Target');
  // 60 → 62.5 (not +5), and 15 · 15 · 14 less about 2 each.
  await expect(target).toContainText(/Go up: 1[23] · 1[23] · 1[12] @ 62\.5 lb/);
  await expect(target.locator('.target-why')).toHaveText(/^\+2\.5 lb, your cable steps · jumps cost you [0-9.]+$/);
  await expect(card.getByRole('textbox', { name: 'Weight' })).toHaveValue('62.5');
  await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'screenshots/r19-learned-step.png' });
  // The why is one line at 375 px.
  const why = (await target.locator('.target-why').boundingBox())!;
  expect(why.height).toBeLessThan(30);
  const box = (await target.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(375 - 16);
  // The stepper moves by the learned 2.5.
  await card.getByRole('button', { name: 'Weight up' }).click();
  await expect(card.getByRole('textbox', { name: 'Weight' })).toHaveValue('65');
});
