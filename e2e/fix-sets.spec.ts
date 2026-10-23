import { expect, test, type Page } from '@playwright/test';
import { goto } from './nav';

// History → a day → Fix sets: a lift renamed for that day's sets, and one weight for ticked sets (an empty bar logged as BW),
// both saved as edits (editedAt) and undone. Synthetic lifts and numbers only.
test.use({ serviceWorkers: 'block' });

const D = '2026-04-05';
const CSV = ['date,exercise,set,weight_lb,reps,flags,source',
  `${D},Bench Press,1,0,15,bodyweight;warmup,notes`, `${D},Bench Press,2,0,12,bodyweight,notes`, `${D},Bench Press,3,135,8,,notes`,
  `${D},Cable Pushdown,1,80,11,unsure,notes`, `${D},Cable Pushdown,2,85,10,,notes`, `${D},Cable Pushdown,3,85,9,,notes`].join('\n');

type Row = { id: string; exercise: string; setNo: number; weight: number; flags: string[]; editedAt?: number };
const stored = (page: Page) => page.evaluate(() => new Promise<Row[]>((ok, no) => {
  const r = indexedDB.open('gym-tracker');
  r.onerror = () => no(r.error);
  r.onsuccess = () => { const q = r.result.transaction('sets').objectStore('sets').getAll(); q.onsuccess = () => ok((q.result as Row[]).sort((a, b) => (a.id < b.id ? -1 : 1))); };
}));

test('Fix sets: Change lift moves a day’s sets to the picked lift, Set weight puts ticked BW sets on the bar, Undo puts them back', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-05-01T18:00:00') });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'log.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(page.getByText('✓ Imported 6 new sets')).toBeVisible();
  const ids = (await stored(page)).map((e) => e.id);

  await goto(page, 'History');
  const day = page.locator(`details.day[data-date="${D}"]`);
  await expect(day).toHaveAttribute('open', '');
  // The day's actions are behind its "⋯" (a small sheet), not on the card.
  await expect(page.getByRole('button', { name: 'Fix sets' })).toHaveCount(0);
  await page.locator('.day-item', { has: day }).getByRole('button', { name: /^More for / }).click();
  const menu = page.getByRole('dialog');
  await expect(menu.getByRole('button')).toHaveText(['Add to this day', 'Fix sets', 'Done']);
  await menu.getByRole('button', { name: 'Fix sets' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // While fixing, the day has its Done, not a "⋯".
  await expect(page.locator('.day-item', { has: day }).getByRole('button', { name: /^More for / })).toHaveCount(0);
  await day.getByRole('group', { name: 'Cable Pushdown' }).getByRole('button', { name: 'Change lift' }).click();
  await expect(page.getByRole('heading', { name: /^Change Cable Pushdown on .* to$/ })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Incline Bench Pushdown');
  await page.getByRole('button', { name: /^Incline Bench Pushdown/ }).first().click();
  await expect(day.getByRole('status')).toContainText('Changed 3 sets: Cable Pushdown → Incline Bench Pushdown');
  let db = await stored(page);
  expect(db.map((e) => e.id)).toEqual(ids); // edited in place: same sets, no new ones
  const moved = db.filter((e) => e.id.includes('cable pushdown'));
  expect(moved.map((e) => [e.exercise, e.setNo, e.weight])).toEqual([['Incline Bench Pushdown', 1, 80], ['Incline Bench Pushdown', 2, 85], ['Incline Bench Pushdown', 3, 85]]);
  for (const e of moved) expect(e.editedAt).toBeGreaterThan(0);

  // Still fixing the day: tick the two BW bench sets and put them on an empty 45 lb bar.
  const bench = day.getByRole('group', { name: 'Bench Press' });
  await expect(bench.getByRole('checkbox')).toHaveCount(3);
  await bench.getByRole('checkbox').nth(0).check();
  await bench.getByRole('checkbox').nth(1).check();
  await day.getByLabel('Weight for 2 ticked sets (lb)').fill('45');
  await day.getByRole('button', { name: 'Set weight' }).click();
  await expect(day.getByRole('status')).toContainText('Changed 2 sets to 45 lb');
  db = await stored(page);
  expect(db.filter((e) => e.exercise === 'Bench Press').map((e) => [e.setNo, e.weight, e.flags])).toEqual([[1, 45, ['warmup']], [2, 45, []], [3, 135, []]]);

  // Undo: the bench sets back at BW, flags and all, stamped again so the undo syncs too; the lift change stays.
  await day.getByRole('button', { name: 'Undo' }).click();
  await expect(day.getByRole('status')).toHaveCount(0);
  db = await stored(page);
  const benchBack = db.filter((e) => e.exercise === 'Bench Press');
  expect(benchBack.map((e) => [e.setNo, e.weight, e.flags])).toEqual([[1, 0, ['bodyweight', 'warmup']], [2, 0, ['bodyweight']], [3, 135, []]]);
  expect(benchBack[0].editedAt).toBeGreaterThan(0);
  expect(db.filter((e) => e.exercise === 'Incline Bench Pushdown')).toHaveLength(3);

  await day.getByRole('button', { name: 'Done' }).click();
  await expect(day.getByRole('button', { name: /^Incline Bench Pushdown/ })).toContainText('80 × 11');
  await expect(day.getByRole('button', { name: /^Bench Press/ })).toContainText('135 × 8');
});
