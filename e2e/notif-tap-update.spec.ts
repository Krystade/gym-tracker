import { expect, test, type Browser, type Page } from '@playwright/test';
import { goto, sendRequest } from './nav';

// A deploy that lands just after a notification tap (the app checks for one each time it comes to the front, and
// switches to it with a reload) must not close what the tap opened: it waits until the app is next in the background.
// Chromium, with the service worker on: the deploy is a real one taking over.
test.use({ browserName: 'chromium', isMobile: false, serviceWorkers: 'block', reducedMotion: 'reduce' });

const PASSWORD = 'synthetic-pass-1';
const APP = `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}/`;
const rand = () => Math.random().toString(36).slice(2, 10);
const friends = (page: Page) => page.getByRole('region', { name: 'Friends', exact: true });
const sheetOf = (page: Page, name: string) => page.getByRole('dialog', { name: `Messages with @${name}` });
const fresh = { storageState: { cookies: [], origins: [{ origin: APP.slice(0, -1), localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } };

async function person(browser: Browser) {
  const page = await (await browser.newContext(fresh)).newPage();
  await page.goto('/');
  const name = `u${rand()}`;
  await goto(page, 'Friends');
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  const account = page.getByRole('region', { name: 'Account' });
  await account.getByRole('textbox', { name: 'Email' }).fill(`${name}@test.local`);
  await account.getByLabel('Password').fill(PASSWORD);
  await account.getByRole('button', { name: 'Create account' }).click();
  await expect(account.getByRole('status')).toHaveText(/^Synced/);
  await goto(page, 'Friends');
  await friends(page).getByRole('textbox', { name: 'Username' }).fill(name);
  await friends(page).getByRole('button', { name: 'Save username' }).click();
  await expect(friends(page)).toContainText(`You’re @${name}`);
  const uid = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((r) => { const q = indexedDB.open('firebaseLocalStorageDb'); q.onsuccess = () => r(q.result); });
    const all = await new Promise<{ value: { uid?: string } }[]>((r) => { const q = db.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll(); q.onsuccess = () => r(q.result); });
    return all.find((x) => x.value?.uid)!.value.uid!;
  });
  return { page, name, uid };
}

/**
 * A phone with the app installed a deploy behind: the service worker it installs is marked as the deploy before, and once
 * the route is gone the next update check reads the real file, a new deploy. (With the route left on, Chromium leaves
 * the new worker waiting.) sessionStorage counts, across reloads, the page's loads and whether a new deploy took over.
 */
async function installed(browser: Browser) {
  const ctx = await browser.newContext({ ...fresh, serviceWorkers: 'allow' });
  await ctx.route('**/sw.js', async (route) => {
    const res = await route.fetch();
    return route.fulfill({ response: res, body: `${await res.text()}\n// the deploy before` });
  });
  await ctx.addInitScript(() => {
    navigator.serviceWorker?.addEventListener('controllerchange', () => sessionStorage.setItem('took-over', '1'));
    sessionStorage.setItem('loads', String(Number(sessionStorage.getItem('loads') ?? 0) + 1));
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.evaluate(() => sessionStorage.removeItem('took-over')); // the install taking its first page isn't a deploy
  await ctx.unrouteAll();
  return page;
}
const loads = (page: Page) => page.evaluate(() => Number(sessionStorage.getItem('loads'))).catch(() => null);
const tookOver = (page: Page) => page.evaluate(() => sessionStorage.getItem('took-over') === '1').catch(() => null);
/**
 * Lets the deploy take over as Chromium does with no debugger attached. A new worker that skips waiting takes over once
 * Chromium has stopped the old one, which it does as soon as that one is idle. But coming to the front also starts the
 * sync and the thread's reload, and if one of their requests lands just as the old worker stops, it starts again to
 * handle it. Playwright's debugger is attached to every worker, and a worker under a debugger is never stopped for being
 * idle, so the new one waits behind it for as long as the test runs. So whenever the new deploy is waiting on an old
 * worker that is running, this stops the old one, as its idle timer would have.
 */
async function stopsOldWorker(page: Page) {
  type Version = { versionId: string; status: string; runningStatus: string };
  const cdp = await page.context().newCDPSession(page);
  const versions = new Map<string, Version>();
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: changed }: { versions: Version[] }) => {
    for (const v of changed) versions.set(v.versionId, v);
    const all = [...versions.values()];
    const old = all.find((v) => v.status === 'activated' && v.runningStatus === 'running');
    if (old && all.some((v) => v.status === 'installed')) void cdp.send('ServiceWorker.stopWorker', { versionId: old.versionId }).catch(() => {});
  });
  await cdp.send('ServiceWorker.enable');
}
/** The app goes to the background or comes back to the front, as iOS tells it (headless pages are always visible). */
const visibility = (page: Page, state: 'hidden' | 'visible') => page.evaluate((s) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
  document.dispatchEvent(new Event('visibilitychange'));
}, state);

test('a deploy taking over just after a tap keeps the thread it opened, and switches once the app is in the background', async ({ browser }) => {
  const [a, b] = await Promise.all([person(browser), person(browser)]);
  await sendRequest(b.page, a.name);
  await a.page.reload();
  await goto(a.page, 'Friends');
  await friends(a.page).getByRole('region', { name: 'Requests' }).getByRole('button', { name: 'Accept' }).click();
  await expect(friends(a.page).getByRole('status')).toHaveText(`You and @${b.name} are now friends.`);

  // B's phone, signed in.
  const page = await installed(browser);
  await goto(page, 'Account');
  const account = page.getByRole('region', { name: 'Account' });
  await account.getByRole('textbox', { name: 'Email' }).fill(`${b.name}@test.local`);
  await account.getByLabel('Password').fill(PASSWORD);
  await account.getByRole('button', { name: 'Sign in' }).click();
  await expect(account.getByRole('status')).toHaveText(/^Synced/);
  await goto(page, 'Stats');

  // The tap: A's thread opens.
  await page.goto(new URL(`#open=friend.${a.uid}`, APP).href);
  const sheet = sheetOf(page, a.name);
  await expect(sheet).toBeVisible();
  const before = await loads(page);
  // Back at the front, the app looks for a deploy (main.tsx), finds one, and it takes over.
  await stopsOldWorker(page);
  await visibility(page, 'visible');
  await expect.poll(() => tookOver(page), { timeout: 15_000 }).toBe(true);
  // Without a tap the reload follows at once (the next test); a second is plenty to see one.
  await page.waitForTimeout(1000);
  await expect(sheet).toBeVisible();
  expect(await loads(page)).toBe(before);

  // In the background, it switches: the next time the app comes up it's the new deploy.
  await visibility(page, 'hidden');
  await expect.poll(() => loads(page)).toBe(before! + 1);
  await Promise.all([a.page.context().close(), b.page.context().close(), page.context().close()]);
});

test('once the app has been in the background since the tap, a deploy switches at once again', async ({ browser }) => {
  const page = await installed(browser);
  await page.goto(new URL('#open=friends', APP).href);
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Friends', exact: true })).toHaveAttribute('aria-current', 'page');
  const before = await loads(page);
  // Away and back: what the tap opened is no longer what was just opened, so the deploy found now reloads straight away.
  await visibility(page, 'hidden');
  await visibility(page, 'visible');
  await expect.poll(() => loads(page), { timeout: 15_000 }).toBe(before! + 1);
  expect(await tookOver(page)).toBe(true);
  await page.context().close();
});
