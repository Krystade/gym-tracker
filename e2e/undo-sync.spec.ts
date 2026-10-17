import { expect, test, type Page } from '@playwright/test';
import { goto } from './nav';

// Undo after a delete that has already synced, against the local Auth and Firestore emulators. Synthetic users only.
const T = new Date(new Date().setHours(18, 0, 0, 0));
const MONTH = `${T.getFullYear()}-${String(T.getMonth() + 1).padStart(2, '0')}`;
const account = (page: Page) => page.getByRole('region', { name: 'Account' });
const rows = (page: Page) => page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');

/** The cloud copy of this month, read past the rules (the emulator's owner token). */
async function cloudMonth(page: Page): Promise<{ sets: number; deleted: string[] }> {
  const uid = await page.evaluate(() => new Promise<string>((ok, no) => {
    const r = indexedDB.open('gym-tracker-shared');
    r.onerror = () => no(r.error);
    r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('cloud'); g.onsuccess = () => ok((g.result as { uid: string }).uid); g.onerror = () => no(g.error); };
  }));
  const res = await page.request.get(`http://127.0.0.1:8080/v1/projects/demo-gym-tracker/databases/(default)/documents/users/${uid}/months/${MONTH}`, { headers: { Authorization: 'Bearer owner' } });
  if (!res.ok()) return { sets: 0, deleted: [] };
  const f = ((await res.json()) as { fields: { sets?: { arrayValue: { values?: unknown[] } }; deleted?: { mapValue: { fields?: Record<string, unknown> } } } }).fields;
  return { sets: f.sets?.arrayValue.values?.length ?? 0, deleted: Object.keys(f.deleted?.mapValue.fields ?? {}) };
}
async function syncNow(page: Page) {
  await goto(page, 'More');
  await account(page).getByRole('button', { name: 'Sync now' }).click();
  await expect(account(page).getByRole('status')).toHaveText(/^Synced/);
}

test('Undo after a synced delete keeps the set through the next syncs and a reload', async ({ page }) => {
  await page.clock.install({ time: T });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await page.getByRole('textbox', { name: 'Weight' }).first().fill('135');
  await page.getByRole('textbox', { name: 'Reps' }).first().fill('8');
  await page.getByRole('button', { name: 'Add set' }).first().click();
  await expect(rows(page)).toHaveCount(1);

  await goto(page, 'More');
  await account(page).getByRole('textbox', { name: 'Email' }).fill(`u${Math.random().toString(36).slice(2, 10)}@test.local`);
  await account(page).getByLabel('Password').fill('synthetic-pass-1');
  await account(page).getByRole('button', { name: 'Create account' }).click();
  await expect(account(page).getByRole('status')).toHaveText(/^Synced/);
  await expect.poll(() => cloudMonth(page)).toEqual({ sets: 1, deleted: [] });

  // Delete, and let the sync a few seconds later carry the delete up while the Undo offer is still there.
  await goto(page, 'Today');
  await rows(page).first().getByRole('button').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(rows(page)).toHaveCount(0);
  await page.clock.runFor(3100);
  await expect.poll(() => cloudMonth(page)).toMatchObject({ sets: 0, deleted: [expect.any(String)] });
  await page.getByRole('status').filter({ hasText: 'Set 1 deleted' }).getByRole('button', { name: 'Undo' }).click();
  await expect(rows(page)).toHaveCount(1);

  await page.clock.runFor(3100);
  await expect.poll(() => cloudMonth(page)).toEqual({ sets: 1, deleted: [] });
  await syncNow(page);
  await page.reload();
  await syncNow(page);
  await goto(page, 'Today');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('135 × 8');
});
