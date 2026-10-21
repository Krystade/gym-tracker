import { expect, test } from '@playwright/test';
import { goto } from './nav';

// Owner, 2026-10-19: each set aims at last time's same set, and its Reps field starts there.
test.use({ serviceWorkers: 'block' });
const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,duration_s,distance_mi';
const ROWS = ['2026-10-15,Cable Pushdown,,1,120,11,,,,sample,,', '2026-10-15,Cable Pushdown,,2,120,11,,,,sample,,', '2026-10-15,Cable Pushdown,,3,120,8,,,,sample,,'];

test('the card lists each set’s target and the rule, and each set’s Reps starts at its own', async ({ page }) => {
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
  await expect(target).toContainText('12 · 12 · 9 @ 120 lb');
  await expect(target.locator('.target-why')).toHaveText('Last time +1 rep a set');
  const reps = card.getByRole('textbox', { name: 'Reps' });
  await expect(reps).toHaveValue('12');
  await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'screenshots/r16-per-set-target.png' });
  // The target line wraps inside the card at 375 px.
  const box = (await target.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(375 - 16);
  const rows = card.getByRole('list', { name: 'Sets for Cable Pushdown' }).getByRole('listitem');
  for (const [i, next] of [[1, '12'], [2, '9']] as const) {
    await card.getByRole('button', { name: /^Add set/ }).click();
    await expect(rows).toHaveCount(i);
    await expect(reps).toHaveValue(next);
  }
});
