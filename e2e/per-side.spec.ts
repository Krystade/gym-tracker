import { expect, test, type Page } from '@playwright/test';
import { goto } from './nav';

// Round 31: More → Bar sets logged per side, a one-off review. Bar sets from before the app, logged as the weight a side, become
// totals; old Smith sets are kept and marked not used; a session imported twice over loses its repeat. Through the store's own
// edit and delete, so it syncs. Synthetic lifts and numbers only.
test.use({ serviceWorkers: 'block' });

const ROWS: [string, string, string, number, number][] = [
  ['xlsx', '2024-03-02', 'Smith Incline Press', 20, 10], ['xlsx', '2024-03-02', 'Smith Incline Press', 20, 9],
  ...[110, 95, 85, 110, 95, 85].map((w, i) => ['xlsx', '2024-09-11', 'Smith Flat Press', w, [5, 8, 8][i % 3]] as [string, string, string, number, number]),
  ['notes', '2025-03-04', 'Bench Press', 30, 12], ['notes', '2025-03-04', 'Bench Press', 40, 9],
  ['notes', '2025-03-11', 'Bench Press', 105, 12], ['notes', '2025-03-11', 'Bench Press', 125, 8],
  ['notes', '2025-05-06', 'Bench Press', 0, 12], ['notes', '2025-05-06', 'Bench Press', 30, 12],
  ['app', '2025-10-02', 'Smith Incline Press', 105, 10], ['app', '2025-10-02', 'Smith Flat Press', 125, 8],
];
const csv = () => {
  const n = new Map<string, number>();
  return ['date,exercise,set,weight_lb,reps,source', ...ROWS.map(([src, d, ex, w, r]) => {
    const k = `${src}|${d}|${ex}`; n.set(k, (n.get(k) ?? 0) + 1);
    return `${d},${ex},${n.get(k)},${w},${r},${src}`;
  })].join('\n') + '\n';
};
const row = (page: Page) => page.getByRole('main').getByRole('button', { name: /^Bar sets logged per side/ });
const review = (page: Page) => page.getByRole('region', { name: 'Bar sets logged per side' });
type Stored = { date: string; exercise: string; weight: number; excluded?: boolean; editedAt?: number; restoredAt?: number };
const stored = (page: Page) => page.evaluate(() => new Promise<{ sets: Stored[]; tombs: string[] }>((ok, no) => {
  const r = indexedDB.open('gym-tracker');
  r.onerror = () => no(r.error);
  r.onsuccess = () => {
    const tx = r.result.transaction(['sets', 'config']);
    const sets = tx.objectStore('sets').getAll(), tomb = tx.objectStore('config').get('deleted');
    tx.oncomplete = () => ok({ sets: sets.result as Stored[], tombs: (tomb.result as { ids?: string[] } | undefined)?.ids ?? [] });
  };
}));
const weights = (xs: Stored[], ex: string, d: string) => xs.filter((x) => x.exercise === ex && x.date === d).map((x) => x.weight).sort((a, b) => a - b);

async function seed(page: Page) {
  await page.clock.install({ time: new Date('2026-10-20T18:00:00') });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'log.csv', mimeType: 'text/csv', buffer: Buffer.from(csv()) });
  await expect(page.getByText(`✓ Imported ${ROWS.length} new sets`)).toBeVisible();
  await goto(page, 'More');
}

test('offered once on More: Apply converts, marks and removes through the store, Undo puts it all back', async ({ page }) => {
  await seed(page);
  await row(page).click();
  const r = review(page);
  const totals = r.getByRole('list', { name: 'To totals' });
  await expect(totals.getByRole('listitem')).toHaveCount(3);
  await expect(totals.getByRole('listitem').filter({ hasText: '30 × 12 · 40 × 9' })).toContainText('→ 105 × 12 · 125 × 9');
  await expect(totals.getByRole('listitem').filter({ hasText: '0 × 12 · 30 × 12' })).toContainText('→ 45 × 12 · 105 × 12');
  const already = totals.getByRole('listitem').filter({ hasText: '105 × 12 · 125 × 8' });
  await expect(already).toContainText('Reads as totals already');
  await expect(already.getByRole('checkbox')).not.toBeChecked();
  await expect(r).toContainText('Smith machine sets from before 2025');
  await expect(r.getByRole('list', { name: 'Logged twice' })).toContainText('110 × 5 · 95 × 8 · 85 × 8, then the same again');

  await r.getByRole('button', { name: 'Apply' }).click();
  await expect(r.getByRole('status')).toContainText('✓ Converted 4 sets to totals, marked 5 not used, removed 3 repeats');
  let s = await stored(page);
  expect(weights(s.sets, 'Bench Press', '2025-03-04')).toEqual([105, 125]);
  expect(weights(s.sets, 'Bench Press', '2025-05-06')).toEqual([45, 105]);
  expect(weights(s.sets, 'Bench Press', '2025-03-11')).toEqual([105, 125]);
  expect(s.sets.filter((x) => x.excluded).map((x) => `${x.exercise} ${x.weight}`).sort()).toEqual(['Smith Flat Press 110', 'Smith Flat Press 85', 'Smith Flat Press 95', 'Smith Incline Press 20', 'Smith Incline Press 20']);
  expect(s.sets.filter((x) => x.editedAt).length).toBe(9); // stamped: it syncs
  expect(s.tombs).toHaveLength(3);
  expect(s.sets).toHaveLength(ROWS.length - 3);

  await r.getByRole('button', { name: /^Undo/ }).click();
  await expect(page.getByText('Put back as logged.')).toBeVisible();
  s = await stored(page);
  expect(weights(s.sets, 'Bench Press', '2025-03-04')).toEqual([30, 40]);
  expect(s.sets.filter((x) => x.excluded)).toHaveLength(0);
  expect(s.sets).toHaveLength(ROWS.length);

  // Applied again, it's done: History shows the old Smith sets marked, and More no longer offers it, after a reload too.
  await review(page).getByRole('button', { name: 'Apply' }).click();
  await expect(review(page).getByRole('status')).toContainText('✓ Converted 4 sets');
  await goto(page, 'More');
  await expect(row(page)).toHaveCount(0);
  await goto(page, 'History');
  await page.getByText('September 2024 · 1 session').click();
  await page.getByText('Sep 11, 2024', { exact: true }).click();
  await expect(page.getByRole('button', { name: /^Smith Flat Press 110/ })).toContainText('110 × 5, 95 × 8, 85 × 8Not used for learning or records');
  await page.reload();
  await goto(page, 'More');
  await expect(page.getByRole('heading', { name: 'More' })).toBeVisible();
  await expect(row(page)).toHaveCount(0);
});

test('dismissed, it leaves the log as logged and isn’t offered again', async ({ page }) => {
  await seed(page);
  await row(page).click();
  await review(page).getByRole('button', { name: 'Leave as logged, don’t ask again' }).click();
  await expect(page.getByRole('heading', { name: 'More' })).toBeVisible();
  await expect(row(page)).toHaveCount(0);
  const s = await stored(page);
  expect(weights(s.sets, 'Bench Press', '2025-03-04')).toEqual([30, 40]);
  expect(s.sets.filter((x) => x.excluded || x.editedAt)).toHaveLength(0);
  await page.reload();
  await goto(page, 'More');
  await expect(page.getByRole('heading', { name: 'More' })).toBeVisible();
  await expect(row(page)).toHaveCount(0);
});
