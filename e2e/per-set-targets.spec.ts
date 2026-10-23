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
  // Item 11: after each set, the next one, recalculated from it (no learned drop here: as the targets step), and the Reps field
  // starts there; past the sets, an extra one.
  for (const [i, next, label] of [[1, '12', 'Next set'], [2, '9', 'Next set'], [3, '9', 'Extra set']] as const) {
    await card.getByRole('button', { name: /^Add set/ }).click();
    await expect(rows).toHaveCount(i);
    await expect(reps).toHaveValue(next);
    await expect(card.getByLabel(label)).toContainText(`${label} ${next} @ 120 lb`);
  }
});

test('a test single is never the target, and the next set comes from what was just done (owner, 2026-10-23)', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-23T18:00:00') });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await goto(page, 'Backup');
  const rows12 = ['2026-10-12,DB Curl,,1,45,1,0,test,,sample,,', '2026-10-12,DB Curl,,2,35,9,,,,sample,,', '2026-10-12,DB Curl,,3,35,7,,,,sample,,'];
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...rows12].join('\n')) });
  await expect(page.getByText(`✓ Imported ${rows12.length} new sets`)).toBeVisible();
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('DB Curl');
  await page.getByRole('button', { name: /^DB Curl/ }).first().click();
  const card = page.locator('[data-card="db curl"]');
  await expect(card.getByLabel('Target')).toContainText('10 · 8 @ 35 lb');
  await expect(card.getByLabel('Target')).not.toContainText('45 lb');
  await expect(card.getByRole('textbox', { name: 'Weight' })).toHaveValue('35');
  const reps = card.getByRole('textbox', { name: 'Reps' });
  await expect(reps).toHaveValue('10');
  await expect(card.getByLabel('Next set')).toHaveCount(0);
  await reps.fill('9');
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(card.getByLabel('Next set')).toContainText('Next set 7 @ 35 lb');
  await expect(reps).toHaveValue('7');
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(card.getByLabel('Extra set')).toContainText('Extra set 7 @ 35 lb');
  await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'screenshots/r29-next-set.png' });
});
