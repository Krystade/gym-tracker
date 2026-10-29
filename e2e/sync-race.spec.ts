import { expect, test, type Browser, type Page } from '@playwright/test';
import { goto } from './nav';
import { DOCS } from './emu';

// A set edited on a phone while that phone's sync is out (round 10): the sync's import or delete was worked out before the edit,
// so it must not land on it. The phone's Firestore commit is held, as a slow connection would hold it, while the edit is made.
// Two phones on one account, against the local Auth and Firestore emulators. Synthetic users only.
const T = new Date('2026-10-02T18:00:00');
const MONTH = '2026-10';
const PASSWORD = 'synthetic-pass-1';
let n = 0;
const email = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${n++}@test.local`; // unique across parallel workers
const account = (page: Page) => page.getByRole('region', { name: 'Account' });
const rows = (page: Page) => page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');

async function phone(browser: Browser) {
  // Service workers blocked: a request the worker makes is out of page.route's reach.
  const ctx = await browser.newContext({ serviceWorkers: 'block', storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
  const page = await ctx.newPage();
  await page.clock.install({ time: T });
  await page.goto('/');
  return page;
}
async function enter(page: Page, mail: string, how: 'Create account' | 'Sign in') {
  await goto(page, 'Account');
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
  await goto(page, 'Account');
  await account(page).getByRole('button', { name: 'Sync now' }).click();
  await expect(account(page).getByRole('status')).toHaveText(/^Synced/);
}
/** Starts a sync on this phone and holds its first commit to the cloud; `release` lets it through. */
async function syncHeld(page: Page) {
  let release!: () => void, reached!: () => void, armed = true;
  const gate = new Promise<void>((r) => { release = r; }), held = new Promise<void>((r) => { reached = r; });
  await page.route((url) => url.pathname.endsWith('/documents:commit'), async (route) => {
    if (armed) { armed = false; reached(); await gate; }
    await route.continue();
  });
  await goto(page, 'Account');
  await account(page).getByRole('button', { name: 'Sync now' }).click();
  await held;
  await expect(account(page).getByRole('status')).toHaveText('Syncing…');
  return release;
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
const replacedHeading = (page: Page) => account(page).getByRole('heading', { name: /^Replaced by sync/ });

/** Both phones on one new account with one bench set, 135 × 8, in sync. */
async function twoPhones(browser: Browser) {
  const mail = email();
  const [a, b] = await Promise.all([phone(browser), phone(browser)]);
  await logBench(a, '135', '8');
  await enter(a, mail, 'Create account');
  await enter(b, mail, 'Sign in');
  await goto(b, 'Today');
  await expect(rows(b).first()).toContainText('135 × 8');
  // Signing in changed each phone's log, and a change syncs 3 s later (useCloud QUIET_MS): run that sync now and let it finish,
  // so it can't be the one a test's syncHeld catches (round 33: after a quick delete on A, B's own caught the hold).
  for (const p of [a, b]) {
    await p.clock.runFor(3500);
    await goto(p, 'Account');
    await expect(account(p).getByRole('button', { name: 'Sync now' })).toBeEnabled();
    await expect(account(p).getByRole('status')).toHaveText(/^Synced/);
  }
  return [a, b];
}

test('an edit made while the sync brings another phone’s older edit of that set: the phone keeps its own, and both phones end on it', async ({ browser }) => {
  const [a, b] = await twoPhones(browser);
  await editWeight(a, '140');
  await syncNow(a);
  await expect.poll(() => cloudWeights(a)).toEqual([140]);

  const release = await syncHeld(b); // B's sync has read the cloud's 140 and is about to take it
  await editWeight(b, '150');
  release();
  await goto(b, 'Account');
  await expect(account(b).getByRole('status')).toHaveText(/^Synced/);
  await expect.poll(() => cloudWeights(b)).toEqual([150]); // its follow-up sync sent the edit up
  await goto(b, 'Today');
  await expect(rows(b)).toHaveCount(1);
  await expect(rows(b).first()).toContainText('150 × 8');
  // Nothing of B's was replaced: no copy of the 135 it had before the edit claims the sync took it.
  await goto(b, 'Account');
  await expect(replacedHeading(b)).toHaveCount(0);

  await syncNow(a);
  for (const p of [a, b]) { await p.reload(); await syncNow(p); await goto(p, 'Today'); await expect(rows(p)).toHaveCount(1); await expect(rows(p).first()).toContainText('150 × 8'); }
  await expect.poll(() => cloudWeights(a)).toEqual([150]);
});

test('an edit made while the sync brings another phone’s delete of that set: the set stays, and comes back on the other phone', async ({ browser }) => {
  const [a, b] = await twoPhones(browser);
  await goto(a, 'Today');
  await rows(a).first().getByRole('button').click();
  await a.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(rows(a)).toHaveCount(0);
  await syncNow(a);
  await expect.poll(() => cloudWeights(a)).toEqual([]);

  const release = await syncHeld(b); // B's sync has read A's delete and is about to make it here
  await editWeight(b, '150');
  release();
  await goto(b, 'Account');
  await expect(account(b).getByRole('status')).toHaveText(/^Synced/);
  await expect.poll(() => cloudWeights(b)).toEqual([150]);
  await goto(b, 'Today');
  await expect(rows(b)).toHaveCount(1);
  await expect(rows(b).first()).toContainText('150 × 8');

  for (const p of [a, b]) { await p.reload(); await syncNow(p); await goto(p, 'Today'); await expect(rows(p)).toHaveCount(1); await expect(rows(p).first()).toContainText('150 × 8'); }
});
