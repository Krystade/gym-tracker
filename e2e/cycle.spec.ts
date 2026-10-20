import { expect, test, type Browser, type Page } from '@playwright/test';
import { goto as tab } from './nav';
import { DOCS, FIRESTORE } from './emu';

// Cycle phase: opt-in per profile, one tap under Energy, private. Synthetic data only.
const DATA = 'More';
const cycle = (page: Page) => page.getByRole('group', { name: 'Cycle' });
const PHASES = ['Period', 'Follicular', 'Ovulation', 'Luteal'];

async function turnOn(page: Page, who = 'Me') {
  await tab(page, DATA);
  const sw = page.getByRole('switch', { name: `Track cycle phase for ${who}` });
  await expect(sw).toBeEnabled(); // loaded: what it shows now is what's saved
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await tab(page, 'Today');
}

test('off by default: no Cycle row; turned on, one tap saves and survives a reload; tapping again clears it', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { (window as unknown as { copied: string }).copied = t; } } });
  });
  await page.clock.install({ time: new Date('2026-03-12T12:00:00') });
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'Energy' })).toBeVisible();
  await expect(cycle(page)).toHaveCount(0);

  await turnOn(page);
  await expect(cycle(page).getByRole('button')).toHaveText(PHASES);
  for (const p of PHASES) await expect(cycle(page).getByRole('button', { name: p })).toHaveAttribute('aria-pressed', 'false');
  await cycle(page).getByRole('button', { name: 'Luteal' }).click();
  await expect(cycle(page).getByRole('button', { name: 'Luteal' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(cycle(page).getByRole('button', { name: 'Luteal' })).toHaveAttribute('aria-pressed', 'true');
  await expect(cycle(page).getByRole('button', { name: 'Period' })).toHaveAttribute('aria-pressed', 'false');

  // Not in the body CSV, even on a day with a weigh-in.
  const weigh = page.getByRole('group', { name: 'Weigh-in' });
  await weigh.getByRole('textbox', { name: 'Weigh-in (lb)' }).fill('150');
  await weigh.getByRole('button', { name: 'Save weight' }).click();
  await expect(weigh).toContainText('150 lb');
  await tab(page, DATA);
  await page.getByRole('button', { name: 'Export body CSV' }).click();
  await expect(page.getByText(/Copied the CSV/)).toBeVisible();
  const csv = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(csv).toContain('150');
  expect(csv).not.toMatch(/luteal|cycle|phase/i);

  // Off hides the row and keeps the day; on again, it's still there.
  await page.getByRole('switch', { name: 'Track cycle phase for Me' }).click();
  await tab(page, 'Today');
  await expect(cycle(page)).toHaveCount(0);
  await tab(page, DATA);
  await page.getByRole('switch', { name: 'Track cycle phase for Me' }).click();
  await tab(page, 'Today');
  await expect(cycle(page).getByRole('button', { name: 'Luteal' })).toHaveAttribute('aria-pressed', 'true');

  await cycle(page).getByRole('button', { name: 'Luteal' }).click();
  await expect(cycle(page).getByRole('button', { name: 'Luteal' })).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(cycle(page).getByRole('button', { name: 'Luteal' })).toHaveAttribute('aria-pressed', 'false');
});

test('opt-in per profile: on for one, the other stays off with no Cycle row, and switching back finds it on', async ({ page }) => {
  await page.goto('/');
  await tab(page, 'More');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sam');
  await page.getByRole('button', { name: 'Add Sam' }).click();
  const bar = page.getByRole('group', { name: 'Who’s training' });
  await expect(bar.getByRole('button', { name: /Sam/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Track cycle phase for Sam' })).toBeVisible();
  await turnOn(page, 'Sam');
  await expect(cycle(page)).toBeVisible();

  await bar.getByRole('button', { name: /Me/ }).click();
  await expect(page.getByRole('group', { name: 'Energy' })).toBeVisible();
  await expect(cycle(page)).toHaveCount(0);
  await tab(page, 'More');
  const me = page.getByRole('switch', { name: 'Track cycle phase for Me' });
  await expect(me).toBeEnabled(); // loaded, so off here is Me's own setting, not the state before it loads
  await expect(me).toHaveAttribute('aria-checked', 'false');
  await page.locator('section[aria-labelledby="cycle-h"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/cycle-setting-me.png' });
  await tab(page, 'Today');
  await expect(page.getByRole('group', { name: 'Energy' })).toBeVisible();
  await expect(cycle(page)).toHaveCount(0);

  await bar.getByRole('button', { name: /Sam/ }).click();
  await expect(cycle(page)).toBeVisible();
  await tab(page, 'More');
  await expect(page.getByRole('switch', { name: 'Track cycle phase for Sam' })).toHaveAttribute('aria-checked', 'true');
  await tab(page, 'Today');
  await expect(cycle(page)).toBeVisible();
  await page.screenshot({ path: 'screenshots/cycle-today.png' });
});

test('Delete cycle data says other phones put back what they still have, and clears the day', async ({ page }) => {
  await page.goto('/');
  await turnOn(page);
  await cycle(page).getByRole('button', { name: 'Period' }).click();
  await expect(cycle(page).getByRole('button', { name: 'Period' })).toHaveAttribute('aria-pressed', 'true');
  await tab(page, 'More');
  await page.getByRole('button', { name: 'Delete cycle data' }).click();
  await expect(page.getByText('Deletes every cycle day on this phone and in your account (other phones put back what they still have)')).toBeVisible();
  await page.screenshot({ path: 'screenshots/cycle-delete.png', fullPage: true });
  await page.locator('.confirm-delete').getByRole('button', { name: 'Delete cycle data' }).click();
  await tab(page, 'Today');
  await expect(cycle(page).getByRole('button', { name: 'Period' })).toHaveAttribute('aria-pressed', 'false');
});

/** Three synthetic periods 28 days apart (two cycle lengths), straight into the cycle store, with the setting on. */
async function seedHistory(page: Page) {
  await page.evaluate(async () => {
    const add = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const days = ['2026-01-04', '2026-02-01', '2026-03-01'].flatMap((s) => [0, 1, 2, 3, 4].map((i) => ({ date: add(s, i), phase: 'period' })));
    const db: IDBDatabase = await new Promise((ok, no) => { const r = indexedDB.open('gym-tracker'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const tx = db.transaction(['cycle', 'config'], 'readwrite');
    for (const d of days) tx.objectStore('cycle').put(d);
    tx.objectStore('config').put({ key: 'cycle', tracking: true, rev: 1 });
    await new Promise((ok, no) => { tx.oncomplete = ok; tx.onerror = () => no(tx.error); });
    db.close();
  });
}

test('with enough logged cycles, the predicted phase is outlined, not pressed, and nothing is saved until it is tapped', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-03-12T12:00:00') }); // day 12 of a 28-day cycle: ovulation
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'Energy' })).toBeVisible();
  await seedHistory(page);
  await page.reload();
  const ov = cycle(page).getByRole('button', { name: 'Ovulation' });
  await expect(ov).toHaveClass(/\bpredicted\b/);
  await expect(ov).toHaveAttribute('aria-pressed', 'false');
  await expect(cycle(page).locator('.predicted')).toHaveCount(1);
  await page.reload();
  await expect(ov).toHaveAttribute('aria-pressed', 'false'); // the guess saved nothing

  await ov.click();
  await expect(ov).toHaveAttribute('aria-pressed', 'true');
  await expect(cycle(page).locator('.predicted')).toHaveCount(0);
  await page.reload();
  await expect(ov).toHaveAttribute('aria-pressed', 'true');
});

// ---- A friend's view, against the local Auth and Firestore emulators ----

const PASSWORD = 'synthetic-pass-1';
const rand = () => Math.random().toString(36).slice(2, 10);
const friends = (page: Page) => page.getByRole('region', { name: 'Friends', exact: true });
const EMU = DOCS;

async function person(browser: Browser) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date(new Date().setHours(18, 0, 0, 0)) });
  await page.goto('/');
  const name = `u${rand()}`;
  await tab(page, 'Friends');
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  const account = page.getByRole('region', { name: 'Account' });
  await account.getByRole('textbox', { name: 'Email' }).fill(`${name}@test.local`);
  await account.getByLabel('Password').fill(PASSWORD);
  await account.getByRole('button', { name: 'Create account' }).click();
  await expect(account.getByRole('status')).toHaveText(/^Synced/);
  await tab(page, 'Friends');
  await friends(page).getByRole('textbox', { name: 'Username' }).fill(name);
  await friends(page).getByRole('button', { name: 'Save username' }).click();
  await expect(friends(page)).toContainText(`You’re @${name}`);
  const uid = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((ok, no) => { const r = indexedDB.open('gym-tracker-shared'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const link: { uid: string } = await new Promise((ok, no) => { const r = db.transaction('kv').objectStore('kv').get('cloud'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    db.close();
    return link.uid;
  });
  return { page, name, uid };
}

test('a friend’s view shows no cycle data and never asks for it', async ({ browser, request }) => {
  const [a, b] = await Promise.all([person(browser), person(browser)]); // two sign-ups side by side
  await tab(a.page, 'Today');
  await turnOn(a.page);
  await cycle(a.page).getByRole('button', { name: 'Period' }).click();
  await expect(cycle(a.page).getByRole('button', { name: 'Period' })).toHaveAttribute('aria-pressed', 'true');
  // The cloud copy, put there as an admin, so the check holds whichever rules this emulator was started with.
  const put = await request.patch(`${EMU}/users/${a.uid}/private/cycle`, {
    headers: { Authorization: 'Bearer owner' },
    data: { fields: { days: { mapValue: { fields: { '2026-01-04': { stringValue: 'period' }, '2026-01-20': { stringValue: 'luteal' } } } }, tracking: { booleanValue: true }, updatedAt: { integerValue: '1' } } },
  });
  expect(put.ok()).toBe(true);

  const asked: string[] = [];
  b.page.on('request', (r) => { if (r.url().startsWith(`${FIRESTORE}/`)) asked.push(`${decodeURIComponent(r.url())} ${r.postData() ?? ''}`); });
  await friends(b.page).getByRole('textbox', { name: 'Their username' }).fill(`@${a.name}`);
  await friends(b.page).getByRole('button', { name: 'Send request' }).click();
  await expect(friends(b.page).getByRole('status')).toHaveText(`Request sent to @${a.name}.`);
  await tab(a.page, 'Friends');
  await friends(a.page).getByRole('region', { name: 'Requests' }).getByRole('button', { name: 'Accept' }).click();
  await expect(friends(a.page).getByRole('status')).toHaveText(`You and @${b.name} are now friends.`);

  await tab(b.page, 'Today');
  await tab(b.page, 'Friends');
  await b.page.getByRole('region', { name: 'Crew' }).getByRole('button', { name: `@${a.name}`, exact: true }).click();
  const page = b.page.getByRole('region', { name: `@${a.name}`, exact: true });
  await expect(page.getByRole('heading', { name: `@${a.name}`, level: 1 })).toBeVisible();
  await expect(b.page.locator('body')).not.toContainText(/period|follicular|ovulation|luteal|cycle/i);
  for (const t of ['Stats', 'History', 'Lifts'] as const) {
    await page.getByRole('button', { name: t, exact: true }).click();
    await expect(b.page.getByRole('heading', { name: t, level: 1 })).toBeVisible();
    await expect(b.page.locator('body')).not.toContainText(/period|follicular|ovulation|luteal|cycle/i);
    await b.page.getByRole('button', { name: `@${a.name}`, exact: true }).click();
  }
  expect(asked.some((x) => x.includes(`users/${a.uid}/`))).toBe(true); // the view did read a's log
  expect(asked.filter((x) => x.includes(`users/${a.uid}/private`))).toEqual([]);
});

test('a new phone that takes the account’s setting turns it on where it stands, with no days to bring', async ({ browser }) => {
  // The shared emulator may run rules without /private, so the account's copy is answered here: setting on, no days.
  // No service worker, or the app's requests would go round the route.
  const ctx = await browser.newContext({ serviceWorkers: 'block', storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
  const page = await ctx.newPage();
  await page.route(/:batchGet/, async (route) => {
    const m = (route.request().postData() ?? '').match(/"(projects\/[^"]*\/private\/cycle)"/);
    if (!m) return route.continue();
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ found: { name: m[1], fields: { days: { mapValue: {} }, tracking: { booleanValue: true }, updatedAt: { integerValue: '1' } }, createTime: '2026-01-01T00:00:00Z', updateTime: '2026-01-01T00:00:00Z' }, readTime: '2026-01-01T00:00:00Z' }]) });
  });
  await page.goto('/');
  await tab(page, 'Friends');
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  const sw = page.getByRole('switch', { name: 'Track cycle phase for Me' });
  await expect(sw).toBeEnabled();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  const account = page.getByRole('region', { name: 'Account' });
  await account.getByRole('textbox', { name: 'Email' }).fill(`u${rand()}@test.local`);
  await account.getByLabel('Password').fill(PASSWORD);
  await account.getByRole('button', { name: 'Create account' }).click();
  await expect(account.getByRole('status')).toHaveText(/^Synced/);
  await expect(sw).toHaveAttribute('aria-checked', 'true'); // no reload, no leaving More
  await ctx.close();
});
