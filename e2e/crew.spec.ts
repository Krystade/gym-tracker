import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { goto } from './nav';

// Crew against the local Auth and Firestore emulators. Synthetic users only.
// Today at 18:00 (Sunday when today is a Monday, so the day before is in the same week); the emulator's tokens use the real clock.
const now = new Date(new Date().setHours(18, 0, 0, 0));
const T = new Date(now.getDay() === 1 ? now.getTime() - 864e5 : now.getTime());
const Y = new Date(T.getTime() - 864e5);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const PASSWORD = 'synthetic-pass-1';
const SHOTS = 'screenshots/crew';
mkdirSync(SHOTS, { recursive: true });
const rand = () => Math.random().toString(36).slice(2, 10);
const friends = (page: Page) => page.getByRole('region', { name: 'Friends', exact: true });
const crew = (page: Page) => page.getByRole('region', { name: 'Crew' });
const TOP = 47, BOTTOM = 34;

// The notched phone's insets, served into the CSS (headless browsers report 0); a service worker would answer past the rewrite.
test.use({ serviceWorkers: 'block' });
async function notched(page: Page) {
  const inset = (s: string) => s.replace(/env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,[^)]*)?\)/g, (_, side: string) => `${side === 'top' ? TOP : side === 'bottom' ? BOTTOM : 0}px`);
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (!req.url().startsWith('http://127.0.0.1')) return route.abort();
    if (!['document', 'stylesheet'].includes(req.resourceType())) return route.continue();
    const res = await route.fetch();
    return route.fulfill({ response: res, body: inset(await res.text()) });
  });
}

async function lift(page: Page, name: string, sets: [number, number][]) {
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name, exact: true }).click();
  for (const [w, r] of sets) {
    await page.getByRole('textbox', { name: 'Weight' }).first().fill(String(w));
    await page.getByRole('textbox', { name: 'Reps' }).first().fill(String(r));
    await page.getByRole('button', { name: 'Add set' }).first().click();
  }
  await expect(page.getByText(`${sets.at(-1)![0]} × ${sets.at(-1)![1]}`).first()).toBeVisible();
}

/** A phone with an account and a username; `days` are logged first, oldest first, each on its own day. */
async function person(browser: Browser, days: { at: Date; lift: string; sets: [number, number][] }[] = []) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
  const page = await ctx.newPage();
  await notched(page);
  await page.clock.install({ time: days[0]?.at ?? T });
  await page.goto('/');
  for (const d of days) {
    if (d !== days[0]) { await page.clock.setSystemTime(d.at); await page.reload(); }
    await lift(page, d.lift, d.sets);
  }
  if (days.length && days.at(-1)!.at !== T) { await page.clock.setSystemTime(T); await page.reload(); }
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
  return { page, name };
}

async function setStatus(page: Page, text: string) {
  await crew(page).getByTestId('crew-me').getByRole('button', { name: '+ Status' }).click();
  const input = crew(page).getByRole('textbox', { name: 'Your status' });
  // 16px or more, so iOS doesn't zoom the page when it's focused.
  expect(parseFloat(await input.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await input.fill(text);
  await crew(page).getByRole('button', { name: 'Save' }).click();
  await expect(crew(page).getByTestId('crew-me').getByRole('button', { name: `Your status: ${text}. Change it` })).toBeVisible();
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);

test('Crew shows a friend’s week as kinds, their status and numbers, at 375×812; a stranger never appears', async ({ browser }, info) => {
  // Three phones at once: each is independent until B asks A.
  const [b, a, c] = await Promise.all([
    person(browser, [
      { at: Y, lift: 'Barbell Squat', sets: [[185, 5], [185, 5]] },
      { at: T, lift: 'Bench Press', sets: [[135, 8], [135, 8], [135, 7]] },
    ]),
    person(browser),
    person(browser, [{ at: T, lift: 'Lat Pulldown', sets: [[100, 10]] }]),
  ]);

  // B: their own row first, with this week's numbers; a status phrase set inline, capped at 24 characters.
  await expect(crew(b.page).getByTestId('crew-me')).toContainText('2 sessions · 5 sets');
  await crew(b.page).getByTestId('crew-me').getByRole('button', { name: '+ Status' }).click();
  await crew(b.page).getByRole('textbox', { name: 'Your status' }).fill('x'.repeat(25));
  await expect(crew(b.page).getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(crew(b.page)).toContainText('25/24');
  await crew(b.page).getByRole('textbox', { name: 'Your status' }).press('Escape');
  await setStatus(b.page, 'Leg day survivor 🦵');
  await setStatus(c.page, 'stranger danger');

  // A and B become friends; C stays a stranger.
  await friends(b.page).getByRole('textbox', { name: 'Their username' }).fill(a.name);
  await friends(b.page).getByRole('button', { name: 'Send request' }).click();
  await a.page.reload();
  await goto(a.page, 'Friends');
  await friends(a.page).getByRole('region', { name: 'Requests' }).getByRole('button', { name: 'Accept' }).click();
  await expect(friends(a.page).getByRole('status')).toHaveText(`You and @${b.name} are now friends.`);

  const row = crew(a.page).getByTestId(`crew-${b.name}`);
  // B's status syncs a few seconds after it's saved: refresh until it's there, by the keyboard's Refresh (touch pulls down).
  await expect(async () => {
    await a.page.getByRole('button', { name: 'Refresh friends' }).focus();
    await a.page.keyboard.press('Enter');
    await expect(row.locator('.crew-bubble')).toHaveText('Leg day survivor 🦵', { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(row.getByRole('button', { name: `@${b.name}`, exact: true })).toBeVisible();
  await expect(row).toContainText('2 sessions · 5 sets');
  await expect(row.locator(`[data-date="${iso(Y)}"]`)).toHaveAttribute('data-kind', 'legs');
  await expect(row.locator(`[data-date="${iso(T)}"]`)).toHaveAttribute('data-kind', 'push');
  await expect(row.locator('[data-date]')).toHaveCount(2);
  // The same, not by colour: the table names each day's kind.
  await crew(a.page).getByText('Table').click();
  const tableRow = crew(a.page).getByRole('row', { name: new RegExp(`@${b.name}`) });
  await expect(tableRow).toContainText(/Legs, .* Push$/);
  // You first, then B; never C, who isn't a friend.
  await expect(crew(a.page).locator('.crew-row')).toHaveCount(2);
  await expect(crew(a.page).locator('.crew-row').first()).toHaveAttribute('data-testid', 'crew-me');
  await expect(crew(a.page)).not.toContainText(c.name);
  await expect(crew(a.page)).not.toContainText('stranger danger');
  // Fewer than three friends: an Invite button in the page, under the lines (not floating: devices.spec checks what's under it).
  const fab = crew(a.page).getByRole('button', { name: 'Invite a friend' });
  await fab.scrollIntoViewIfNeeded();
  const [fb, tabs] = [await fab.boundingBox(), await a.page.getByRole('navigation', { name: 'Sections' }).boundingBox()];
  expect(fb!.y + fb!.height).toBeLessThanOrEqual(tabs!.y);
  expect(await noSideScroll(a.page)).toBe(true);
  // The heading starts below the notch.
  expect((await a.page.getByRole('heading', { name: 'Friends', level: 1 }).boundingBox())!.y).toBeGreaterThanOrEqual(TOP);
  await crew(a.page).getByText('Table').click();
  await a.page.screenshot({ path: `${SHOTS}/crew-a.png` });
  await info.attach('crew-a', { path: `${SHOTS}/crew-a.png`, contentType: 'image/png' });

  // Invite brings the invite controls up.
  await fab.click();
  await expect(friends(a.page).getByRole('region', { name: 'Add a friend' })).toBeInViewport();

  // Tapping B's row opens B's log; your own row opens your History.
  await row.getByRole('button', { name: `@${b.name}`, exact: true }).click();
  await expect(a.page.getByRole('region', { name: 'Viewing a friend' })).toContainText(`Viewing @${b.name}`);
  await a.page.getByRole('button', { name: 'Back to you' }).click();
  await crew(a.page).getByTestId('crew-me').getByRole('button', { name: 'You', exact: true }).click();
  await expect(a.page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible();

  // B's own Crew: their bubble, editable and clearable.
  await b.page.reload();
  await goto(b.page, 'Friends');
  await b.page.screenshot({ path: `${SHOTS}/crew-b-status.png` });
  await crew(b.page).getByRole('button', { name: 'Your status: Leg day survivor 🦵. Change it' }).click();
  await b.page.screenshot({ path: `${SHOTS}/crew-b-editing.png` });
  await crew(b.page).getByRole('button', { name: 'Clear' }).click();
  await expect(crew(b.page).getByTestId('crew-me').getByRole('button', { name: '+ Status' })).toBeVisible();
  await b.page.screenshot({ path: `${SHOTS}/crew-b.png` });
});

test('the lines scroll back together by dragging, up to 8 weeks, and Today jumps back', async ({ browser }) => {
  const b = await person(browser, [{ at: T, lift: 'Bench Press', sets: [[135, 8]] }]);
  const page = b.page;
  const me = crew(page).getByTestId('crew-me');
  const seg = me.locator(`[data-date="${iso(T)}"]`);
  await expect(seg).toHaveCount(1);
  await expect(crew(page).getByRole('button', { name: 'Today' })).toHaveCount(0);
  const box = (await crew(page).locator('.crew-rows').boundingBox())!;
  const x0 = (await seg.boundingBox())!.x;
  const col = box.width / 14;

  // Drag right three days: the line moves with it, snapped to whole days.
  await page.mouse.move(box.x + 40, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 40 + col * 1.5, box.y + 62, { steps: 4 });
  await page.mouse.move(box.x + 40 + col * 3, box.y + 62, { steps: 4 });
  await page.mouse.up();
  await expect(crew(page).getByRole('button', { name: 'Today' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/crew-dragged.png` });
  // Today's segment is now off the right edge.
  await expect(seg).toHaveCount(0);
  // Dragging never scrolls the page sideways, and a drag isn't a tap: still on Friends.
  expect(await noSideScroll(page)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Friends', level: 1 })).toBeVisible();

  // Way further back stops at 8 weeks: the oldest day shown is 55 days ago.
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(box.x + 20, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 10, box.y + 60, { steps: 6 });
    await page.mouse.up();
  }
  const oldest = new Date(T.getTime() - 55 * 864e5);
  await crew(page).getByText('Table').click();
  await expect(crew(page).locator('caption')).toContainText(oldest.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }));

  await crew(page).getByRole('button', { name: 'Today' }).click();
  await expect(crew(page).getByRole('button', { name: 'Today' })).toHaveCount(0);
  await expect(seg).toHaveCount(1);
  expect(Math.abs((await seg.boundingBox())!.x - x0)).toBeLessThan(1);

  // The keyboard moves a week at a time.
  await crew(page).locator('.crew-rows').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(crew(page).getByRole('button', { name: 'Today' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(crew(page).getByRole('button', { name: 'Today' })).toHaveCount(0);
});

/** Whether this phone has saved Friends for its account (friends' lists, lines and news), as src/state/friendCache.ts keeps them. */
const saved = (page: Page, name: string) => page.evaluate(async (name) => {
  const db: IDBDatabase = await new Promise((ok, no) => { const r = indexedDB.open('gym-tracker-shared'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const all: { key: string }[] = await new Promise((ok, no) => { const r = db.transaction('kv').objectStore('kv').getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  db.close();
  return all.some((x) => x.key.startsWith('friends:') && JSON.stringify(x).includes(name) && JSON.stringify(x).includes('"windows":{"'));
}, name);

test('Friends opens from what the phone saved: with Firestore unreachable, friends and their lines show at once, never Loading', async ({ browser }) => {
  const [b, a] = await Promise.all([person(browser, [{ at: T, lift: 'Bench Press', sets: [[135, 8]] }]), person(browser)]);
  await friends(b.page).getByRole('textbox', { name: 'Their username' }).fill(a.name);
  await friends(b.page).getByRole('button', { name: 'Send request' }).click();
  await a.page.reload();
  await goto(a.page, 'Friends');
  await friends(a.page).getByRole('region', { name: 'Requests' }).getByRole('button', { name: 'Accept' }).click();
  const row = crew(a.page).getByTestId(`crew-${b.name}`);
  await expect(row.locator(`[data-date="${iso(T)}"]`)).toHaveAttribute('data-kind', 'push');
  await expect.poll(() => saved(a.page, b.name), { message: 'Friends saved on the phone' }).toBe(true);

  // Next time, offline from Firestore: everything comes from the phone, at once.
  await a.page.route(/127\.0\.0\.1:8080/, (r) => r.abort());
  await a.page.reload();
  await expect(a.page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
  await a.page.evaluate(() => {
    const w = window as unknown as { sawLoading: boolean };
    w.sawLoading = false;
    new MutationObserver(() => { if (document.querySelector('main.screen')?.textContent?.includes('Loading…')) w.sawLoading = true; })
      .observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await goto(a.page, 'Friends');
  await expect(row.locator(`[data-date="${iso(T)}"]`)).toHaveAttribute('data-kind', 'push');
  await expect(row).toContainText('1 session · 1 set');
  await expect(friends(a.page)).toContainText(`You’re @${a.name}`);
  await expect(friends(a.page).getByRole('region', { name: 'Your friends' }).getByRole('button', { name: `@${b.name}`, exact: true })).toBeVisible();
  await a.page.waitForTimeout(500); // the quiet refresh fails meanwhile; what was saved stays
  await expect(row.locator(`[data-date="${iso(T)}"]`)).toHaveAttribute('data-kind', 'push');
  await expect(a.page.locator('main.screen')).not.toContainText('Couldn’t load');
  expect(await a.page.evaluate(() => (window as unknown as { sawLoading: boolean }).sawLoading), 'Loading… showed').toBe(false);
  // No Refresh button: a pull at the top reads again. A screen reader or keyboard still has one.
  await expect(crew(a.page).getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(0);
  await expect(a.page.getByRole('button', { name: 'Refresh friends' })).toHaveCount(1);
});
