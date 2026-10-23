import { mkdirSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { addFriend, goto } from './nav';
import { account, befriend, EMU, iso, log, ping, session, signedIn, type Seeded } from './seed';
import { FIRESTORE } from './emu';

// Friends as a feed (round 18) against the local Auth and Firestore emulators: synthetic accounts and numbers, put there as an
// admin (e2e/seed.ts). Today at 18:00 (Sunday when today is a Monday, so the day before is in the same week); the emulator's
// tokens use the real clock.
const now = new Date(new Date().setHours(18, 0, 0, 0));
const T = new Date(now.getDay() === 1 ? now.getTime() - 864e5 : now.getTime());
const at = (daysAgo: number, h: number, m = 0) => { const d = new Date(T.getTime() - daysAgo * 864e5); d.setHours(h, m, 0, 0); return d; };
const SHOTS = 'screenshots/crew';
mkdirSync(SHOTS, { recursive: true });
const friends = (page: Page) => page.getByRole('region', { name: 'Friends', exact: true });
const crew = (page: Page) => page.getByRole('region', { name: 'Crew' });
const TOP = 47, BOTTOM = 34;

// The notched phone's insets, served into the CSS (headless browsers report 0).
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
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);

/**
 * You and four friends, and a stranger: Live (training now, last set 4 minutes ago), Done (trained this morning, a PR, goal of 2
 * met today, a status), Rest (trained 2 days ago), Gone (9 days ago). Done reacted 🔥 to your session. The stranger trained today.
 */
async function crewOf(request: APIRequestContext) {
  const [me, live, done, rest, gone, stranger] = await Promise.all(['me', 'live', 'done', 'rest', 'gone', 'x'].map((p) => account(request, `${p}${Math.random().toString(36).slice(2, 8)}`)));
  const history = (d: number) => session(at(d, 17), [['Barbell Squat', [[185, 5], [185, 5], [185, 5]]], ['Romanian Deadlift', [[155, 8], [155, 8]]]]);
  await Promise.all([
    log(request, me, [...history(9), ...history(4), ...session(at(0, 16), [['Bench Press', [[135, 8], [135, 8], [135, 7]]], ['Lat Pulldown', [[100, 10], [100, 10]]]])]),
    log(request, live, [...history(6), ...session(at(0, 17, 26), [['Barbell Squat', [[135, 5], [155, 5], [175, 5]]], ['Leg Press', [[200, 10], [200, 10], [220, 8]]], ['Leg Curl', [[60, 12], [60, 12], [60, 12]]], ['Calf Raise', [[90, 15]]]])], { goal: 3 }),
    log(request, done, [...session(at(1, 8), [['Lat Pulldown', [[90, 10], [90, 10]]]]), ...session(at(0, 7), [['Bench Press', [[95, 8], [105, 6]]], ['Cable Fly', [[20, 12], [20, 12]]]])],
      { goal: 2, status: 'Deload week', prs: { [iso(T).slice(0, 7)]: [`app|${iso(T)}|bench press|2`] } }),
    log(request, rest, session(at(2, 18), [['Barbell Squat', [[95, 8], [95, 8]]]]), { goal: 4 }),
    log(request, gone, session(at(9, 18), [['Bench Press', [[65, 10]]]])),
    log(request, stranger, session(at(0, 9), [['Lat Pulldown', [[80, 10]]]]), { status: 'stranger danger' }),
  ]);
  for (const f of [live, done, rest, gone]) await befriend(request, me, f);
  await ping(request, done, me, 'fire', at(0, 16, 40).getTime());
  return { me, live, done, rest, gone, stranger };
}
const open = (browser: Browser, who: Seeded, opts: { reduce?: boolean; width?: number } = {}) => signedIn(browser, who, T, async (page) => {
  await page.setViewportSize({ width: opts.width ?? 375, height: 812 });
  if (opts.reduce) await page.emulateMedia({ reducedMotion: 'reduce' });
  await notched(page);
});

test('the feed: rings for today, a card per session, the rest below; LIVE is a solid pill under the ring; a stranger never shows', async ({ browser, request }, info) => {
  const c = await crewOf(request);
  const page = await open(browser, c.me);
  const feed = crew(page);
  await expect(feed.getByTestId(`crew-${c.live.name}`)).toBeVisible({ timeout: 15_000 });
  await expect(feed.getByTestId(`crew-${c.gone.name}`)).toContainText('9 days since a session');

  // Who trained today, in words.
  await expect(feed.locator('.fd-dateline')).toHaveText('3 of 5 trained today · 1 training now');
  // The rail: you first; then by each one's week against their own goal (Done met theirs), never by what anyone lifts.
  const rail = feed.getByRole('list', { name: 'Everyone today' }).getByRole('button');
  await expect(rail).toHaveCount(5);
  await expect(rail.first()).toHaveAccessibleName(/^You, trained today/);
  await expect(rail.nth(1)).toHaveAccessibleName(`@${c.done.name}, trained today, 2 of 2 this week, goal met`);
  await expect(feed.getByTestId(`ring-${c.live.name}`)).toHaveAccessibleName(/training now, [12] of 3 this week$/);

  // LIVE: opaque, 12px bold, wholly under the ring (never over the avatar), and inside the rail button.
  const pill = feed.getByTestId(`ring-${c.live.name}`).locator('.fd-live');
  await expect(pill).toHaveText('LIVE');
  const look = await pill.evaluate((el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, size: parseFloat(s.fontSize), weight: Number(s.fontWeight), opacity: s.opacity }; });
  expect(look).toEqual({ bg: 'rgb(105, 217, 141)', size: 12, weight: 700, opacity: '1' });
  const [pb, rb] = [await pill.boundingBox(), await feed.getByTestId(`ring-${c.live.name}`).locator('.fd-ringwrap').boundingBox()];
  expect(pb!.y).toBeGreaterThanOrEqual(rb!.y + rb!.height);
  // Names stay on one row: a live friend's slot is reserved for everyone (measured once the rail has faded in).
  await page.waitForTimeout(1200);
  const names = await rail.locator('.fd-nm').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(names).size).toBe(1);

  // The live card: first among today's, its lift going now marked, the last three shown and the rest one tap away.
  const cards = feed.locator('article.fd-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toHaveAttribute('data-testid', `crew-${c.live.name}`);
  const live = feed.getByTestId(`crew-${c.live.name}`);
  await expect(live).toContainText('since');
  await expect(live.locator('.fd-lifts li').filter({ hasText: 'Calf Raise' })).toContainText('now');
  await expect(live.locator('.fd-lifts li:not(.fd-more-row)')).toHaveCount(3);
  await live.getByRole('button', { name: '+1 more lift' }).click();
  await expect(live.locator('.fd-lifts li')).toHaveCount(4);
  await expect(live.locator('.fd-lifts li').first()).toContainText('175 × 5');

  // Done's card: their goal hit today, their status, their PR as their phone wrote it, and React buttons.
  const done = feed.getByTestId(`crew-${c.done.name}`);
  await expect(done.locator('.fd-goalrib')).toHaveText('Weekly goal hit · 2 of 2');
  await expect(done.locator('.fd-status')).toHaveText('Deload week');
  await expect(done.locator('.fd-lifts li').filter({ hasText: 'Bench Press' }).locator('.fd-pr')).toHaveText('PR');
  await expect(done.locator('.fd-lifts li').filter({ hasText: 'Cable Fly' }).locator('.fd-pr')).toHaveCount(0);
  await expect(done.getByRole('button', { name: `@${c.done.name}`, exact: true })).toBeVisible();
  await expect(done.getByRole('button', { name: `Message @${c.done.name}` })).toBeVisible();

  // Your card: what came back to you today.
  await expect(feed.getByTestId('crew-me').locator('.fd-meta')).toContainText('Push · 4:00');
  const got = feed.getByTestId('crew-me').locator('.fd-got');
  await expect(got).toHaveText(`Reactions today: 🔥 @${c.done.name}`);
  await expect(got.getByRole('img', { name: 'On fire' })).toBeVisible();

  // Below: the friends with no session today.
  await expect(feed.getByTestId(`crew-${c.rest.name}`)).toContainText(/Legs · 2 sets · [01] of 4 this week/);
  await expect(feed.getByTestId(`crew-${c.rest.name}`).getByRole('button', { name: `Message @${c.rest.name}` })).toBeVisible();
  await expect(feed).not.toContainText(c.stranger.name);
  await expect(feed).not.toContainText('stranger danger');

  // Fewer than three friends? Four here: no Invite in the page.
  await expect(feed.getByRole('button', { name: 'Invite a friend' })).toHaveCount(0);
  expect(await noSideScroll(page)).toBe(true);
  // Tap targets: reactions and Message 44px tall at least.
  for (const b of await done.locator('.fd-react button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.evaluate(() => window.scrollTo(0, 0));
  expect((await page.getByRole('heading', { name: 'Friends', level: 1 }).boundingBox())!.y).toBeGreaterThanOrEqual(TOP);
  await page.waitForTimeout(900); // the rings' first draw
  await page.screenshot({ path: `${SHOTS}/feed-375.png` });
  await page.screenshot({ path: `${SHOTS}/feed-375-full.png`, fullPage: true });
  await info.attach('feed', { path: `${SHOTS}/feed-375.png`, contentType: 'image/png' });

  // Your own ring opens your History.
  await feed.getByTestId('ring-me').click();
  await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible();
});

test('a reaction is the ping that already exists: it reaches their inbox, bursts, and the card says you sent it', async ({ browser, request }) => {
  const c = await crewOf(request);
  const page = await open(browser, c.me);
  // Live: nothing from them in your inbox, so the card's line is free to say what you sent.
  const done = crew(page).getByTestId(`crew-${c.live.name}`);
  await expect(done.getByRole('group', { name: `React to @${c.live.name}` })).toBeVisible({ timeout: 15_000 });
  await done.getByRole('button', { name: `Send 💪 Strong to @${c.live.name}` }).click();
  await expect(done.locator('.fd-particles span')).toHaveCount(7);
  await expect(done.getByRole('status')).toContainText('Sent 💪');
  // The ping itself, in their inbox.
  await expect.poll(async () => {
    const res = await request.get(`${EMU}/users/${c.live.uid}/inbox`, { headers: { Authorization: 'Bearer owner' } });
    return ((await res.json()).documents ?? []).map((d: { fields: { from: { stringValue: string }; e?: { stringValue: string } } }) => `${d.fields.from.stringValue === c.me.uid ? 'me' : 'other'}:${d.fields.e?.stringValue}`);
  }).toEqual(['me:strong']);
  // After the burst: "You sent 💪", from the thread this phone keeps (no read).
  await expect(done.getByRole('status')).toContainText('You sent 💪', { timeout: 15_000 });
  await expect(done.getByRole('button', { name: `Send 💪 Strong to @${c.live.name}` })).toHaveClass(/sent/);
});

test('live means a set in the last 20 minutes: the pill goes by itself, with no read', async ({ browser, request }) => {
  const c = await crewOf(request);
  const page = await open(browser, c.me);
  const pill = crew(page).getByTestId(`ring-${c.live.name}`).locator('.fd-live');
  await expect(pill).toBeVisible({ timeout: 15_000 });
  const reads: string[] = [];
  page.on('request', (r) => { if (r.url().startsWith(`${FIRESTORE}/`)) reads.push(r.url()); });
  // Their last set was at 17:53; at 18:12 it's 19 minutes old, at 18:14 it's 21.
  await page.clock.runFor(12 * 60_000);
  await expect(pill).toBeVisible();
  await page.clock.runFor(2 * 60_000);
  await expect(pill).toHaveCount(0);
  await expect(crew(page).locator('.fd-dateline')).toHaveText('3 of 5 trained today');
  await expect(crew(page).getByTestId(`crew-${c.live.name}`)).not.toHaveClass(/live/);
  expect(reads.filter((u) => u.includes(c.live.uid))).toEqual([]);
});

test('a set landing on a live card slides in on the next refresh', async ({ browser, request }) => {
  const c = await crewOf(request);
  const page = await open(browser, c.me);
  const live = crew(page).getByTestId(`crew-${c.live.name}`);
  await expect(live).toContainText('10 sets', { timeout: 15_000 });
  await log(request, c.live, [...session(at(6, 17), [['Barbell Squat', [[185, 5], [185, 5], [185, 5]]], ['Romanian Deadlift', [[155, 8], [155, 8]]]]),
    ...session(at(0, 17, 26), [['Barbell Squat', [[135, 5], [155, 5], [175, 5]]], ['Leg Press', [[200, 10], [200, 10], [220, 8]]], ['Leg Curl', [[60, 12], [60, 12], [60, 12]]], ['Calf Raise', [[90, 15]]], ['Leg Extension', [[70, 12]]]])], { goal: 3 });
  await page.getByRole('button', { name: 'Refresh friends' }).focus();
  await page.keyboard.press('Enter');
  await expect(live).toContainText('11 sets');
  await expect(live.locator('.fd-lifts li.new')).toHaveText(/Leg Extension/);
  await expect(live.locator('.fd-lifts li').filter({ hasText: 'Leg Extension' })).toContainText('now');
});

test('under reduced motion nothing moves: no draw, no pulse, no burst, and LIVE still says it in words', async ({ browser, request }) => {
  const c = await crewOf(request);
  const page = await open(browser, c.me, { reduce: true });
  const feed = crew(page);
  await expect(feed.getByTestId(`ring-${c.live.name}`).locator('.fd-live')).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await feed.getByTestId(`crew-${c.done.name}`).getByRole('button', { name: `Send 👏 Nice work to @${c.done.name}` }).click();
  await expect(feed.getByTestId(`crew-${c.done.name}`).getByRole('status')).toContainText('Sent 👏');
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await page.screenshot({ path: `${SHOTS}/feed-375-reduced.png` });
});

test('with motion, the rings draw and the live ring pulses', async ({ browser, request }) => {
  const c = await crewOf(request);
  const page = await open(browser, c.me);
  await expect(crew(page).getByTestId(`ring-${c.live.name}`).locator('.fd-live')).toBeVisible({ timeout: 15_000 });
  const names = await page.evaluate(() => document.getAnimations().map((a) => (a as CSSAnimation).animationName));
  expect(names).toContain('fd-pulse');
  // Three times, then a still ring (battery: it pulsed for as long as they trained, 48 frames a second).
  const pulse = page.locator('.pulse').first();
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((a) => (a as CSSAnimation).animationName === 'fd-pulse' && a.playState === 'running').length), { timeout: 10_000 }).toBe(0);
  expect(await pulse.evaluate((el) => Number(getComputedStyle(el, '::after').opacity))).toBeGreaterThan(0.5);
});

test('at 320 wide nothing spills sideways; the rail scrolls on its own', async ({ browser, request }) => {
  const c = await crewOf(request);
  const page = await open(browser, c.me, { width: 320 });
  await expect(crew(page).getByTestId(`crew-${c.live.name}`)).toBeVisible({ timeout: 15_000 });
  expect(await noSideScroll(page)).toBe(true);
  for (const card of await crew(page).locator('article.fd-card').all()) {
    const b = (await card.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(320);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/feed-320.png` });
  await page.screenshot({ path: `${SHOTS}/feed-320-full.png`, fullPage: true });
});

// ---- Friends made through the app's own flow: your status, Invite, and what the phone keeps ----

const PASSWORD = 'synthetic-pass-1';
const rand = () => Math.random().toString(36).slice(2, 10);
async function lift(page: Page, name: string, sets: [number, number][]) {
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name, exact: true }).click();
  // A set's row shows once its save has landed: wait for it before the next tap or a reload. A tap while a save is still out is
  // dropped as a double tap (SetForm), and a reload then can lose the save; the last set's numbers can't tell one 185 × 5 from two.
  const rows = page.getByRole('list', { name: `Sets for ${name}` }).getByRole('listitem');
  for (const [i, [w, r]] of sets.entries()) {
    await page.getByRole('textbox', { name: 'Weight' }).first().fill(String(w));
    await page.getByRole('textbox', { name: 'Reps' }).first().fill(String(r));
    await page.getByRole('button', { name: 'Add set' }).first().click();
    await expect(rows).toHaveCount(i + 1);
    await expect(rows.nth(i)).toContainText(`${w} × ${r}`);
  }
}
/** A phone with a new account and a username, having logged `sets` today first. */
async function person(browser: Browser, today: { lift: string; sets: [number, number][] } | null = null) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
  const page = await ctx.newPage();
  await notched(page);
  await page.clock.install({ time: T });
  await page.goto('/');
  if (today) await lift(page, today.lift, today.sets);
  const name = `u${rand()}`;
  await goto(page, 'Friends');
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  const acct = page.getByRole('region', { name: 'Account' });
  await acct.getByRole('textbox', { name: 'Email' }).fill(`${name}@test.local`);
  await acct.getByLabel('Password').fill(PASSWORD);
  await acct.getByRole('button', { name: 'Create account' }).click();
  await expect(acct.getByRole('status')).toHaveText(/^Synced/);
  await goto(page, 'Friends');
  await friends(page).getByRole('textbox', { name: 'Username' }).fill(name);
  await friends(page).getByRole('button', { name: 'Save username' }).click();
  await expect(friends(page)).toContainText(`You’re @${name}`);
  return { page, name };
}
async function setStatus(page: Page, text: string) {
  await crew(page).getByTestId('my-status').getByRole('button', { name: 'Status', exact: true }).click();
  const input = crew(page).getByRole('textbox', { name: 'Your status' });
  // 16px or more, so iOS doesn't zoom the page when it's focused.
  expect(parseFloat(await input.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await input.fill(text);
  await crew(page).getByRole('button', { name: 'Save' }).click();
  await expect(crew(page).getByRole('button', { name: `Your status: ${text}. Change it` })).toBeVisible();
}

test('your status: set inline, capped at 24, seen on your friend’s feed; Invite sits in the page; your session card is yours', async ({ browser }, info) => {
  const [b, a] = await Promise.all([person(browser, { lift: 'Bench Press', sets: [[135, 8], [135, 8], [135, 7]] }), person(browser)]);
  await expect(crew(b.page).getByTestId('crew-me')).toContainText('Push');
  await expect(crew(b.page).getByTestId('crew-me')).toContainText('3 sets');
  await crew(b.page).getByTestId('my-status').getByRole('button', { name: 'Status', exact: true }).click();
  await crew(b.page).getByRole('textbox', { name: 'Your status' }).fill('x'.repeat(25));
  await expect(crew(b.page).getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(crew(b.page)).toContainText('25/24');
  await crew(b.page).getByRole('textbox', { name: 'Your status' }).press('Escape');
  await setStatus(b.page, 'Leg day survivor 🦵');

  const add = await addFriend(b.page);
  await add.getByRole('textbox', { name: 'Their username' }).fill(a.name);
  await add.getByRole('button', { name: 'Send request' }).click();
  await expect(add.getByRole('status')).toHaveText(`Request sent to @${a.name}.`);
  await a.page.reload();
  await goto(a.page, 'Friends');
  await friends(a.page).getByRole('region', { name: 'Requests' }).getByRole('button', { name: 'Accept' }).click();
  await expect(friends(a.page).getByRole('status')).toHaveText(`You and @${b.name} are now friends.`);

  const card = crew(a.page).getByTestId(`crew-${b.name}`);
  // B's status syncs a few seconds after it's saved: refresh until it's there.
  await expect(async () => {
    await a.page.getByRole('button', { name: 'Refresh friends' }).focus();
    await a.page.keyboard.press('Enter');
    await expect(card.locator('.fd-status')).toHaveText('Leg day survivor 🦵', { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(card.locator('.fd-lifts')).toContainText('Bench Press');
  await expect(card.locator('.fd-lifts')).toContainText('135 × 8');
  await expect(crew(a.page).locator('.fd-dateline')).toHaveText('1 of 2 trained today · 1 training now'); // B's sets were logged at 18:00

  // Fewer than three friends: an Invite button in the page, above the tab bar, and it opens the Add a friend sheet.
  const invite = crew(a.page).getByRole('button', { name: 'Invite a friend' });
  await invite.evaluate((e) => e.scrollIntoView({ block: 'nearest' })); // the browser's own scroll, which keeps its scroll-margin clear of the tab bar
  const [ib, tabs] = [await invite.boundingBox(), await a.page.getByRole('navigation', { name: 'Sections' }).boundingBox()];
  expect(ib!.y + ib!.height).toBeLessThanOrEqual(tabs!.y);
  await a.page.screenshot({ path: `${SHOTS}/crew-a.png` });
  await info.attach('crew-a', { path: `${SHOTS}/crew-a.png`, contentType: 'image/png' });
  await invite.click();
  const sheet = a.page.getByRole('dialog', { name: 'Add a friend' });
  await expect(sheet.getByRole('textbox', { name: 'Their username' })).toBeInViewport();
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toHaveCount(0);

  // Tapping B's name opens B's page.
  await card.getByRole('button', { name: `@${b.name}`, exact: true }).click();
  await expect(a.page.getByRole('heading', { name: `@${b.name}`, level: 1 })).toBeVisible();

  // B's own status: editable and clearable.
  await b.page.reload();
  await goto(b.page, 'Friends');
  await crew(b.page).getByRole('button', { name: 'Your status: Leg day survivor 🦵. Change it' }).click();
  await crew(b.page).getByRole('button', { name: 'Clear' }).click();
  await expect(crew(b.page).getByTestId('my-status').getByRole('button', { name: 'Status', exact: true })).toBeVisible();
});

/** Whether this phone has saved Friends for its account (friends' lists, lines and news), as src/state/friendCache.ts keeps them. */
const saved = (page: Page, name: string) => page.evaluate(async (name) => {
  const db: IDBDatabase = await new Promise((ok, no) => { const r = indexedDB.open('gym-tracker-shared'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const all: { key: string }[] = await new Promise((ok, no) => { const r = db.transaction('kv').objectStore('kv').getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  db.close();
  return all.some((x) => x.key.startsWith('friends:') && JSON.stringify(x).includes(name) && JSON.stringify(x).includes('"windows":{"'));
}, name);

test('Friends opens from what the phone saved: with Firestore unreachable, friends and their sessions show at once, never Loading', async ({ browser }) => {
  const [b, a] = await Promise.all([person(browser, { lift: 'Bench Press', sets: [[135, 8]] }), person(browser)]);
  const add = await addFriend(b.page);
  await add.getByRole('textbox', { name: 'Their username' }).fill(a.name);
  await add.getByRole('button', { name: 'Send request' }).click();
  await expect(add.getByRole('status')).toHaveText(`Request sent to @${a.name}.`);
  await a.page.reload();
  await goto(a.page, 'Friends');
  await friends(a.page).getByRole('region', { name: 'Requests' }).getByRole('button', { name: 'Accept' }).click();
  const card = crew(a.page).getByTestId(`crew-${b.name}`);
  await expect(card.locator('.fd-lifts')).toContainText('135 × 8');
  await expect.poll(() => saved(a.page, b.name), { message: 'Friends saved on the phone' }).toBe(true);

  // Next time, offline from Firestore: everything comes from the phone, at once.
  await a.page.route((u) => u.origin === FIRESTORE, (r) => r.abort());
  await a.page.reload();
  await expect(a.page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
  await a.page.evaluate(() => {
    const w = window as unknown as { sawLoading: boolean };
    w.sawLoading = false;
    new MutationObserver(() => { if (document.querySelector('main.screen')?.textContent?.includes('Loading…')) w.sawLoading = true; })
      .observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await goto(a.page, 'Friends');
  await expect(card.locator('.fd-lifts')).toContainText('135 × 8');
  // Your username, from what was saved too: in the Add a friend sheet.
  const mine = await addFriend(a.page);
  await expect(mine).toContainText(`You’re @${a.name}`);
  await mine.getByRole('button', { name: 'Done' }).click();
  await expect(crew(a.page).getByRole('button', { name: `@${b.name}`, exact: true })).toBeVisible();
  await a.page.waitForTimeout(500); // the quiet refresh fails meanwhile; what was saved stays
  await expect(card.locator('.fd-lifts')).toContainText('135 × 8');
  await expect(a.page.locator('main.screen')).not.toContainText('Couldn’t load');
  expect(await a.page.evaluate(() => (window as unknown as { sawLoading: boolean }).sawLoading), 'Loading… showed').toBe(false);
  await expect(crew(a.page).getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(0);
  await expect(a.page.getByRole('button', { name: 'Refresh friends' })).toHaveCount(1);
});
