import { expect, test, type Browser, type Page } from '@playwright/test';
import { goto } from './nav';
import { DOCS } from './emu';

// Two phones on one account, against the local Auth and Firestore emulators (round 10). Synthetic users only.
const T = new Date('2026-10-02T18:00:00');
const MONTH = '2026-10';
const PASSWORD = 'synthetic-pass-1';
let n = 0;
const email = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${n++}@test.local`; // unique across parallel workers
const account = (page: Page) => page.getByRole('region', { name: 'Account' });
const rows = (page: Page) => page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');

async function phone(browser: Browser) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
  const page = await ctx.newPage();
  await page.clock.install({ time: T });
  await page.goto('/');
  return page;
}
async function enter(page: Page, mail: string, how: 'Create account' | 'Sign in') {
  await goto(page, 'More');
  await account(page).getByRole('textbox', { name: 'Email' }).fill(mail);
  await account(page).getByLabel('Password').fill(PASSWORD);
  await account(page).getByRole('button', { name: how }).click();
  await expect(account(page).getByRole('status')).toHaveText(/^Synced/);
}
async function logBench(page: Page, weight: string, reps: string) {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await page.getByRole('textbox', { name: 'Weight' }).first().fill(weight);
  await page.getByRole('textbox', { name: 'Reps' }).first().fill(reps);
  await page.getByRole('button', { name: 'Add set' }).first().click();
  await expect(rows(page)).toHaveCount(1);
}
async function editWeight(page: Page, weight: string) {
  await goto(page, 'Today');
  await rows(page).first().getByRole('button').click();
  await page.getByRole('textbox', { name: 'Weight' }).first().fill(weight);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(rows(page).first()).toContainText(`${weight} × 8`);
}
async function syncNow(page: Page) {
  await goto(page, 'More');
  await account(page).getByRole('button', { name: 'Sync now' }).click();
  await expect(account(page).getByRole('status')).toHaveText(/^Synced/);
}

/** A document of this account, read past the rules (the emulator's owner token). */
async function cloudDoc(page: Page, path: string): Promise<Record<string, unknown> | null> {
  const uid = await page.evaluate(() => new Promise<string>((ok, no) => {
    const r = indexedDB.open('gym-tracker-shared');
    r.onerror = () => no(r.error);
    r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('cloud'); g.onsuccess = () => ok((g.result as { uid: string }).uid); g.onerror = () => no(g.error); };
  }));
  const res = await page.request.get(`${DOCS}/users/${uid}/${path}`, { headers: { Authorization: 'Bearer owner' } });
  return res.ok() ? ((await res.json()) as { fields: Record<string, unknown> }).fields : null;
}
type Value = { integerValue?: string; doubleValue?: number; mapValue?: { fields?: Record<string, Value> }; arrayValue?: { values?: Value[] } };
const cloudWeights = async (page: Page) => ((await cloudDoc(page, `months/${MONTH}`))?.sets as Value | undefined)?.arrayValue?.values
  ?.map((s) => { const w = s.mapValue!.fields!.weight; return Number(w.integerValue ?? w.doubleValue); }) ?? [];
const cloudMetaKeys = async (page: Page) => Object.keys(((await cloudDoc(page, 'meta/profile'))?.items as Value | undefined)?.mapValue?.fields ?? {}).sort();
/** The lift settings saved on this phone, by key. */
const phoneSettings = (page: Page) => page.evaluate(() => new Promise<string[]>((ok, no) => {
  const r = indexedDB.open('gym-tracker');
  r.onerror = () => no(r.error);
  r.onsuccess = () => { const g = r.result.transaction('settings').objectStore('settings').getAllKeys(); g.onsuccess = () => ok((g.result as string[]).sort()); g.onerror = () => no(g.error); };
}));

test('two phones edit the same set: both end on the later edit, through syncs and a reload', async ({ browser }) => {
  const mail = email();
  const [a, b] = await Promise.all([phone(browser), phone(browser)]);
  await logBench(a, '135', '8');
  await enter(a, mail, 'Create account');
  await enter(b, mail, 'Sign in');
  await goto(b, 'Today');
  await expect(rows(b).first()).toContainText('135 × 8');

  // A corrects the set; B, after it, corrects it again (both clocks run from the same start in real time).
  await editWeight(a, '140');
  await editWeight(b, '145');
  for (let i = 0; i < 2; i++) { await syncNow(a); await syncNow(b); }
  await expect.poll(() => cloudWeights(a)).toEqual([145]);

  for (const p of [a, b]) {
    await p.reload();
    await syncNow(p);
    await goto(p, 'Today');
    await expect(rows(p)).toHaveCount(1);
    await expect(rows(p).first()).toContainText('145 × 8');
  }
  await expect.poll(() => cloudWeights(b)).toEqual([145]);
});

test('an edit on one phone after a delete on the other brings the set back on both; deleting it again sticks', async ({ browser }) => {
  const mail = email();
  const [a, b] = await Promise.all([phone(browser), phone(browser)]);
  await logBench(a, '135', '8');
  await enter(a, mail, 'Create account');
  await enter(b, mail, 'Sign in');
  await goto(b, 'Today');
  await expect(rows(b)).toHaveCount(1);

  const remove = async (p: Page) => {
    await goto(p, 'Today');
    await rows(p).first().getByRole('button').click();
    await p.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(rows(p)).toHaveCount(0);
  };
  await remove(a);
  await syncNow(a);
  // Both clocks run from the same start in real time, so B's edit is after A's delete. (A fast-forward here would tick Today's
  // minute timers and set off a sync on B that takes the delete before B edits.)
  await editWeight(b, '140'); // B hasn't heard of the delete, and edits after it
  for (let i = 0; i < 2; i++) { await syncNow(b); await syncNow(a); }
  for (const p of [a, b]) { await goto(p, 'Today'); await expect(rows(p)).toHaveCount(1); await expect(rows(p).first()).toContainText('140 × 8'); }

  await remove(a);
  for (let i = 0; i < 2; i++) { await syncNow(a); await syncNow(b); }
  for (const p of [a, b]) { await p.reload(); await syncNow(p); await goto(p, 'Today'); await expect(rows(p)).toHaveCount(0); }
  await expect.poll(() => cloudWeights(a)).toEqual([]);
});

test('a lift renamed on one phone: the other drops its old settings, and they stay gone', async ({ browser }) => {
  const mail = email();
  const [a, b] = await Promise.all([phone(browser), phone(browser)]);
  await logBench(a, '135', '8');
  await a.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await a.getByRole('textbox', { name: 'Min reps' }).fill('6');
  await a.getByRole('textbox', { name: 'Max reps' }).fill('8');
  await a.getByRole('button', { name: 'Save settings' }).click();
  await expect(a.getByRole('button', { name: 'Saved' })).toBeVisible();
  await enter(a, mail, 'Create account');
  await enter(b, mail, 'Sign in');
  await expect.poll(() => phoneSettings(b)).toEqual(['bench press']);

  await goto(a, 'Lifts');
  await a.getByRole('button', { name: /^Bench Press/ }).click();
  const box = a.getByRole('group', { name: 'Rename or merge' });
  await box.getByRole('combobox', { name: 'New name' }).fill('Flat Bench');
  await box.getByRole('button', { name: 'Rename' }).click();
  await box.getByRole('button', { name: /^Tap again/ }).click();
  await expect(a.getByRole('heading', { level: 1 })).toHaveText('Flat Bench');
  expect(await phoneSettings(a)).toEqual(['flat bench']);

  for (let i = 0; i < 2; i++) { await syncNow(a); await syncNow(b); }
  await expect.poll(() => cloudMetaKeys(a)).not.toContain('settings:bench press');
  expect(await cloudMetaKeys(a)).toContain('settings:flat bench');
  for (const p of [a, b]) {
    await p.reload();
    await syncNow(p);
    await expect.poll(() => phoneSettings(p)).toEqual(['flat bench']);
  }
  expect(await cloudMetaKeys(b)).not.toContain('settings:bench press');
});

// Round 10, owner answer 12: where nothing tells two copies apart, the cloud's wins, and the phone keeps what it lost.
const replacedList = (page: Page) => account(page).getByRole('list', { name: 'Replaced by sync' });

test('two phones with different copies of a set from before edit times: both take the cloud’s, the replaced one waits under More, and “Keep this phone’s” wins on both', async ({ browser }) => {
  const mail = email();
  const [a, b] = await Promise.all([phone(browser), phone(browser)]);
  // The same set (day, lift, set number) logged on each phone before either had the account: no edit time on either copy.
  await Promise.all([logBench(a, '135', '8'), logBench(b, '140', '8')]);
  await enter(a, mail, 'Create account');
  await enter(b, mail, 'Sign in');
  for (let i = 0; i < 2; i++) { await syncNow(a); await syncNow(b); }
  await expect.poll(() => cloudWeights(a)).toEqual([135]);
  for (const p of [a, b]) { await goto(p, 'Today'); await expect(rows(p)).toHaveCount(1); await expect(rows(p).first()).toContainText('135 × 8'); }

  // B's own copy waits under More beside the one that replaced it. A lost nothing, so A shows nothing.
  await goto(b, 'More');
  await expect(account(b).getByRole('heading', { name: 'Replaced by sync (1)' })).toBeVisible();
  const item = replacedList(b).getByRole('listitem');
  await expect(item).toHaveCount(1);
  await expect(item.getByText('Bench Press')).toBeVisible();
  await expect(item.locator('.replaced-pair p')).toHaveText(['This phone had 140 × 8', 'Synced copy 135 × 8']);
  await goto(a, 'More');
  await expect(replacedList(a)).toHaveCount(0);

  await item.getByRole('button', { name: /^Keep this phone/ }).click();
  await expect(replacedList(b)).toHaveCount(0); // nothing left: the section goes
  await expect(account(b).getByRole('heading', { name: /^Replaced by sync/ })).toHaveCount(0);
  for (let i = 0; i < 2; i++) { await syncNow(b); await syncNow(a); }
  await expect.poll(() => cloudWeights(a)).toEqual([140]);
  for (const p of [a, b]) {
    await p.reload();
    await syncNow(p);
    await goto(p, 'Today');
    await expect(rows(p)).toHaveCount(1);
    await expect(rows(p).first()).toContainText('140 × 8');
  }
  await expect.poll(() => cloudWeights(b)).toEqual([140]);

  // A's copy was replaced in its turn, and waits under A's More through the reload; B's list stays empty.
  await goto(a, 'More');
  await expect(replacedList(a).getByRole('listitem').locator('.replaced-pair p')).toHaveText(['This phone had 135 × 8', 'Synced copy 140 × 8']);
  await goto(b, 'More');
  await expect(account(b).getByRole('heading', { name: /^Replaced by sync/ })).toHaveCount(0);
});
