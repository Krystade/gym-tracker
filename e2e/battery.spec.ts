import { expect, test, type Page } from '@playwright/test';
import { goto } from './nav';
import { account, PASSWORD, signedIn } from './seed';

// Battery (audit 2026-10-23): what keeps waking the phone when nothing is happening. Every repeating timer's callbacks are
// counted, by the period it was set with; the minute tick (60 s) is left out, as a window of a few seconds may or may not hold it.

function countTimers() {
  const w = window as unknown as { __fired: number; __vis: (v: DocumentVisibilityState) => void };
  w.__fired = 0;
  let vis: DocumentVisibilityState = 'visible';
  // The page's visibility, as the app reads it: a test can put it in the background without a second tab.
  w.__vis = (v) => { vis = v; document.dispatchEvent(new Event('visibilitychange')); };
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => vis });
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => vis === 'hidden' });
  const si = window.setInterval;
  window.setInterval = ((f: TimerHandler, ms?: number, ...a: unknown[]) =>
    si(typeof f === 'function' && (ms ?? 0) < 60_000 ? (...b: unknown[]) => { w.__fired++; (f as (...x: unknown[]) => void)(...b); } : f, ms, ...a)) as typeof setInterval;
}
const fired = (page: Page) => page.evaluate(() => (window as unknown as { __fired: number }).__fired);
/** Repeating callbacks fired over `ms` of real time. */
async function over(page: Page, ms: number) {
  const a = await fired(page);
  await page.waitForTimeout(ms);
  return (await fired(page)) - a;
}

test('signed in and left alone, nothing repeats: no cross-tab poll of the sign-in every 800 ms', async ({ page, request }) => {
  const me = await account(request);
  await page.addInitScript(countTimers);
  await page.goto('/');
  await goto(page, 'Friends');
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  const acct = page.getByRole('region', { name: 'Account' });
  await acct.getByRole('textbox', { name: 'Email' }).fill(me.email);
  await acct.getByLabel('Password').fill(PASSWORD);
  await acct.getByRole('button', { name: 'Sign in' }).click();
  await expect(acct.getByRole('status')).toHaveText(/^Synced/, { timeout: 20_000 });
  await goto(page, 'Today');
  // The tab bar's pin looks at the screen twice a second for 5 s after a tap (ui/viewportPin), then stops.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(6000);
  expect(await over(page, 5000)).toBe(0);
  // Still signed in, the account working: a sync now.
  await goto(page, 'Account');
  await acct.getByRole('button', { name: 'Sync now' }).click();
  await expect(acct.getByRole('status')).toHaveText(/^Synced/, { timeout: 20_000 });
  await expect(acct).toContainText(`Signed in as ${me.email}`);
});

test('signed in, a reload keeps you signed in (the sign-in still kept in IndexedDB)', async ({ page, request }) => {
  const me = await account(request);
  await page.goto('/');
  await goto(page, 'Friends');
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  const acct = page.getByRole('region', { name: 'Account' });
  await acct.getByRole('textbox', { name: 'Email' }).fill(me.email);
  await acct.getByLabel('Password').fill(PASSWORD);
  await acct.getByRole('button', { name: 'Sign in' }).click();
  await expect(acct.getByRole('status')).toHaveText(/^Synced/, { timeout: 20_000 });
  const keys = await page.evaluate(() => new Promise<number>((done) => {
    const r = indexedDB.open('firebaseLocalStorageDb');
    r.onsuccess = () => { const q = r.result.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').count(); q.onsuccess = () => done(q.result); };
  }));
  expect(keys).toBeGreaterThan(0);
  await page.reload();
  await goto(page, 'Account');
  await expect(acct).toContainText(`Signed in as ${me.email}`, { timeout: 20_000 });
});

/** Changes to the rest bar's progress line over `ms` of real time: a frame drawn for each. */
async function lineMoves(page: Page, ms: number) {
  return page.evaluate((ms) => new Promise<number>((done) => {
    let n = 0;
    const o = new MutationObserver((rs) => { n += rs.length; });
    o.observe(document.querySelector('.rest-timer')!, { attributes: true, attributeFilter: ['style'], subtree: true, characterData: true, childList: true });
    setTimeout(() => { o.disconnect(); done(n); }, ms);
  }), ms);
}
const restIn = async (page: Page) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Cable Curl');
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  const card = page.locator('[data-card="cable curl"]');
  await card.getByRole('textbox', { name: 'Weight' }).fill('50');
  await card.getByRole('textbox', { name: 'Reps' }).fill('10');
  await card.getByRole('button', { name: /^Add set/ }).click();
  return page.getByRole('timer', { name: 'Rest' });
};

test('the rest bar draws once a second, as the seconds turn, and not at all in the background; the right time on coming back', async ({ page }) => {
  await page.addInitScript(countTimers);
  await page.goto('/');
  const timer = await restIn(page);
  await expect(timer).toContainText(/[12]:\d\d/);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // In view: the digits and the line, once a second (it was 4 times: 12 changes in 3 s).
  const seen = await lineMoves(page, 3000);
  expect(seen).toBeGreaterThanOrEqual(2);
  expect(seen).toBeLessThanOrEqual(8); // each second: the line's style and the digits' text
  const before = await timer.locator('b').innerText();
  await page.evaluate(() => (window as unknown as { __vis: (v: string) => void }).__vis('hidden'));
  await page.waitForTimeout(300); // a tick from just before, still rendering
  expect(await lineMoves(page, 3000)).toBe(0);
  // Back: the time read at once, 3 s and more on from where it was, and drawing again.
  await page.evaluate(() => (window as unknown as { __vis: (v: string) => void }).__vis('visible'));
  const secs = (t: string) => { const [m, s] = t.split(':').map(Number); return m * 60 + s; };
  await expect.poll(async () => secs(before) - secs(await timer.locator('b').innerText())).toBeGreaterThanOrEqual(3);
  expect(await lineMoves(page, 2000)).toBeGreaterThanOrEqual(1);
});

test('the screen is kept on for the rest’s last 15 s only: taken in the tap and let go, taken again 15 s from the end', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { locks: string[] };
    w.locks = [];
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      w.locks.push('on');
      const s = { released: false, release: async () => { if (!s.released) { s.released = true; w.locks.push('off'); } }, addEventListener() {} };
      return s;
    } } });
  });
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-10-16T18:30:00'));
  const timer = await restIn(page);
  await expect(timer).toContainText('2:00');
  const locks = () => page.evaluate(() => (window as unknown as { locks: string[] }).locks.join(' '));
  await expect.poll(locks).toBe('on off'); // the tap's grant, nothing held
  await page.clock.fastForward(100_000);
  await expect(timer).toContainText('0:20');
  expect(await locks()).toBe('on off');
  await page.clock.fastForward(5_500);
  await expect(timer).toContainText('0:1');
  await expect.poll(locks).toBe('on off on'); // held from 0:15
  // Done: let go.
  await page.clock.fastForward(16_000);
  await expect(timer).toContainText('Rest done');
  await expect.poll(locks).toBe('on off on off');
});

test('signed in, the account syncs every 5 minutes while open, not every 2', async ({ browser, request }) => {
  const me = await account(request);
  const page = await signedIn(browser, me, new Date('2026-10-16T18:00:00'));
  await goto(page, 'Today');
  let reads = 0;
  page.on('request', (r) => { if (/databases\/\(default\)\/documents/.test(r.url())) reads++; });
  await page.clock.runFor(10_000);
  reads = 0;
  // Four and a half minutes open on Today, nothing changed: no sync (every 2 minutes, that was two).
  await page.clock.runFor(270_000);
  expect(reads).toBe(0);
  // At 5 minutes it does.
  await page.clock.runFor(40_000);
  await expect.poll(() => reads).toBeGreaterThan(0);
});
