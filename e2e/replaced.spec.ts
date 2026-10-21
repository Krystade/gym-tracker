import { expect, test, type Page } from '@playwright/test';
import { goto } from './nav';

// What a sync replaced on this phone (round 10, owner answer 12), seeded straight into the phone's store, no account needed:
// signed out, the list sits under the backup card. Synthetic data only.
const T = new Date('2026-10-02T18:00:00');
const DAY = 864e5;
const backup = (page: Page) => page.getByRole('region', { name: 'Private backup' });
const list = (page: Page) => backup(page).getByRole('list', { name: 'Replaced by sync' });
const heading = (page: Page) => backup(page).getByRole('heading', { name: /^Replaced by sync/ });
const rows = (page: Page) => page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');

/** This phone's database, one store read whole. */
const stored = <T,>(page: Page, store: string) => page.evaluate((store) => new Promise<unknown[]>((ok, no) => {
  const r = indexedDB.open('gym-tracker');
  r.onerror = () => no(r.error);
  r.onsuccess = () => { const g = r.result.transaction(store).objectStore(store).getAll(); g.onsuccess = () => { r.result.close(); ok(g.result); }; g.onerror = () => no(g.error); };
}), store) as Promise<T[]>;

/** Records as a sync would have left them: one past the 30 days, a set (this phone's had a note; the synced copy more reps), two body days. */
async function seed(page: Page) {
  const [set] = await stored<{ date: string; exercise: string }>(page, 'sets');
  const now = await page.evaluate(() => Date.now());
  const recs = [
    { key: 'old', kind: 'body', at: now - 31 * DAY, date: '2026-09-01', mine: { weight: 170 }, theirs: { weight: 171 } },
    { key: 'set', kind: 'set', at: now - DAY, date: set.date, exercise: set.exercise, mine: { ...set, reps: 8, note: 'felt easy' }, theirs: set },
    { key: 'weigh-in', kind: 'body', at: now - 2 * DAY, date: '2026-10-02', mine: { weight: 180.4 }, theirs: { weight: 181 } },
    { key: 'energy', kind: 'body', at: now - 3 * DAY, date: '2026-09-30', mine: { energy: 2 }, theirs: { energy: 4 } },
  ];
  await page.evaluate((recs) => new Promise<void>((ok, no) => {
    const r = indexedDB.open('gym-tracker');
    r.onerror = () => no(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction('replaced', 'readwrite');
      for (const x of recs) tx.objectStore('replaced').put(x);
      tx.oncomplete = () => { r.result.close(); ok(); };
      tx.onerror = () => no(tx.error);
    };
  }), recs);
}

test('copies a sync replaced: past 30 days they go at startup; Combine, Keep and Dismiss each clear one; nothing shows once none are left', async ({ page }) => {
  await page.clock.install({ time: T });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await page.getByRole('textbox', { name: 'Weight' }).first().fill('135');
  await page.getByRole('textbox', { name: 'Reps' }).first().fill('10');
  await page.getByRole('button', { name: 'Add set' }).first().click();
  await expect(rows(page)).toHaveCount(1);
  await goto(page, 'Backup');
  await expect(heading(page)).toHaveCount(0); // nothing replaced: no section at all

  await seed(page);
  await page.reload();
  await goto(page, 'Backup');
  await expect(backup(page).getByRole('heading', { name: 'Replaced by sync (3)' })).toBeVisible();
  // Pruned from the phone, not only hidden.
  await expect.poll(async () => (await stored<{ key: string }>(page, 'replaced')).map((r) => r.key).sort()).toEqual(['energy', 'set', 'weigh-in']);

  const item = (what: string) => list(page).getByRole('listitem').filter({ hasText: what });
  await expect(item('Bench Press').locator('.replaced-pair p')).toHaveText(['This phone had 135 × 8 · “felt easy”', 'Synced copy 135 × 10']);
  await expect(item('Weight').locator('.replaced-pair p')).toHaveText(['This phone had 180.4 lb', 'Synced copy 181 lb']);
  await expect(item('Energy').locator('.replaced-pair p')).toHaveText(['This phone had energy 2', 'Synced copy energy 4']);
  await expect(item('Weight').getByRole('button', { name: 'Combine' })).toHaveCount(0); // a body field has nothing to add in

  // Every button 16px text and a 44px target, nothing off the side of a 375px screen.
  for (const b of await list(page).getByRole('button').all()) {
    const m = await b.evaluate((el) => { const r = el.getBoundingClientRect(); return { font: parseFloat(getComputedStyle(el).fontSize), w: r.width, h: r.height, left: r.left, right: r.right }; });
    expect(m.font).toBeGreaterThanOrEqual(16);
    expect(Math.min(m.w, m.h)).toBeGreaterThanOrEqual(44);
    expect(m.left).toBeGreaterThanOrEqual(0);
    expect(m.right).toBeLessThanOrEqual(375);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await item('Bench Press').getByRole('button', { name: 'Combine' }).click();
  await expect(item('Bench Press')).toHaveCount(0);
  await item('Weight').getByRole('button', { name: /^Keep this phone/ }).click();
  await expect(item('Weight')).toHaveCount(0);
  await item('Energy').getByRole('button', { name: 'Dismiss' }).click();
  await expect(heading(page)).toHaveCount(0);

  // Combine: the synced copy's reps with this phone's note; Keep: this phone's weigh-in back, stamped as entered now; Dismiss: no change.
  await page.reload();
  await goto(page, 'Today');
  await expect(rows(page).first()).toContainText('135 × 10');
  await expect(rows(page).first()).toContainText('felt easy');
  const body = await stored<{ date: string; weight?: number; energy?: number; at?: Record<string, number> }>(page, 'body');
  expect(body.map(({ date, weight, energy }) => ({ date, weight, energy }))).toEqual([{ date: '2026-10-02', weight: 180.4, energy: undefined }]);
  expect(body[0].at?.weight).toBeGreaterThanOrEqual(T.getTime());
  const [set] = await stored<{ editedAt?: number }>(page, 'sets');
  expect(set.editedAt).toBeGreaterThanOrEqual(T.getTime());
  await goto(page, 'Backup');
  await expect(heading(page)).toHaveCount(0);
});
