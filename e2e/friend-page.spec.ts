import { mkdirSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { account, befriend, iso, log, put, session, signedIn, type Seeded } from './seed';
import { FIRESTORE } from './emu';
import { statsSheet } from './nav';

// A friend's page inside Friends (round 18) against the local emulators: synthetic accounts and numbers only (e2e/seed.ts).
// Today at 18:00 (Sunday when today is a Monday, so yesterday is in the same week).
const now = new Date(new Date().setHours(18, 0, 0, 0));
const T = new Date(now.getDay() === 1 ? now.getTime() - 864e5 : now.getTime());
const at = (daysAgo: number, h: number, m = 0) => { const d = new Date(T.getTime() - daysAgo * 864e5); d.setHours(h, m, 0, 0); return d; };
const SHOTS = 'screenshots/friend-page';
mkdirSync(SHOTS, { recursive: true });
const crew = (page: Page) => page.getByRole('region', { name: 'Crew' });
const TOP = 47;
test.use({ serviceWorkers: 'block' });
async function notched(page: Page) {
  const inset = (s: string) => s.replace(/env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,[^)]*)?\)/g, (_, side: string) => `${side === 'top' ? TOP : side === 'bottom' ? 34 : 0}px`);
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (!req.url().startsWith('http://127.0.0.1')) return route.abort();
    if (!['document', 'stylesheet'].includes(req.resourceType())) return route.continue();
    const res = await route.fetch();
    return route.fulfill({ response: res, body: inset(await res.text()) });
  });
}
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);

/** You, and a friend who's stronger at nothing in particular: you both squat and bench over the 8 weeks, each from your own start. */
async function pair(request: APIRequestContext) {
  const [me, fr] = await Promise.all([account(request, `me${Math.random().toString(36).slice(2, 8)}`), account(request, `fr${Math.random().toString(36).slice(2, 8)}`)]);
  const mine = [
    ...session(at(40, 17), [['Barbell Squat', [[185, 5], [185, 5]]], ['Bench Press', [[155, 5]]]]),
    ...session(at(20, 17), [['Barbell Squat', [[195, 5], [195, 5]]], ['Bench Press', [[160, 5]]]]),
    ...session(at(3, 17), [['Barbell Squat', [[205, 5], [205, 5]]], ['Bench Press', [[160, 5]]]]),
  ];
  const theirs = [
    ...session(at(41, 9), [['Barbell Squat', [[95, 5], [95, 5]]], ['Bench Press', [[65, 8]]]]),
    ...session(at(27, 9), [['Barbell Squat', [[105, 5]]], ['Pull Up', [[0, 6]]]]),
    ...session(at(12, 9), [['Barbell Squat', [[110, 5]]]]),
    ...session(at(1, 9), [['Barbell Squat', [[115, 5], [115, 5]]], ['Bench Press', [[75, 8]]]]),
    ...session(at(0, 17, 40), [['Bench Press', [[75, 8], [80, 6]]], ['Cable Fly', [[20, 12], [20, 12]]]]),
  ];
  const month = iso(T).slice(0, 7);
  await Promise.all([
    log(request, me, mine),
    // Each month written by a current app, carrying its PR ids (none before this month): their phone's word, not 8 weeks' guess.
    log(request, fr, theirs, { goal: 2, status: 'Deload week', prs: Object.fromEntries([...new Set(theirs.map((x) => x.date.slice(0, 7)))].map((m) => [m, m === month ? [`app|${iso(T)}|bench press|2`] : []])) }),
  ]);
  await befriend(request, me, fr);
  return { me, fr };
}
const open = (browser: Browser, who: Seeded, width = 375) => signedIn(browser, who, T, async (page) => {
  await page.setViewportSize({ width, height: 812 });
  await notched(page);
});

test('a friend’s page opens inside Friends from what the phone keeps, compares only each one’s own change, and its whole log is a tap away', async ({ browser, request }, info) => {
  const { me, fr } = await pair(request);
  const page = await open(browser, me);
  const card = crew(page).getByTestId(`crew-${fr.name}`);
  await expect(card).toContainText('Cable Fly', { timeout: 15_000 });

  // Opening the page reads nothing: it's built from the line the list already has.
  const reads: string[] = [];
  page.on('request', (r) => { if (r.url().startsWith(`${FIRESTORE}/`)) reads.push(`${r.url()} ${r.postData() ?? ''}`); });
  await card.getByRole('button', { name: `@${fr.name}`, exact: true }).click();
  const fp = page.getByRole('region', { name: `@${fr.name}`, exact: true });
  await expect(fp.getByRole('heading', { name: `@${fr.name}`, level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Friends' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Viewing a friend' })).toHaveCount(0);
  expect((await fp.getByRole('heading', { level: 1 }).boundingBox())!.y).toBeGreaterThanOrEqual(TOP);

  await expect(fp.getByRole('list', { name: 'This week' })).toContainText('2 of 2 this week');
  await expect(fp.getByRole('list', { name: 'This week' })).toContainText('PR1 this week');
  await expect(fp).toContainText('Deload week');
  // LIVE: their last set was at 17:49.
  const pill = fp.locator('.fp-live');
  await expect(pill).toHaveText('LIVE');
  expect((await pill.boundingBox())!.y).toBeGreaterThanOrEqual((await fp.locator('.fp-ring').boundingBox())!.y + 92);
  await expect(fp.getByRole('article', { name: /^Now, Push/ })).toContainText('80 × 6');
  // 75 × 8 then 80 × 6: the top set is the best of two, never “2 sets” of 80 × 6; Cable Fly's two were the same.
  await expect(fp.getByRole('article', { name: /^Now, Push/ }).getByRole('listitem').filter({ hasText: 'Bench Press' })).toContainText('80 × 6best of 2 sets');
  await expect(fp.getByRole('article', { name: /^Now, Push/ }).getByRole('listitem').filter({ hasText: 'Cable Fly' })).toContainText('20 × 12all 2 sets');

  // You and them: percentages against each one's own start, and no load at all.
  const shared = fp.getByRole('region', { name: `You and @${fr.name}` });
  // Shown without a tap: the two lifts both do, then their Cable Fly (too new for a change) is left out.
  await expect(shared.locator('.fp-vs')).toHaveCount(2);
  await expect(shared.locator('.fp-vs').first()).toContainText('Barbell Squat');
  await expect(shared.getByRole('img', { name: 'You +11%' })).toBeVisible();
  await expect(shared.getByRole('img', { name: `@${fr.name} +21%` })).toBeVisible();
  await expect(shared).not.toContainText(/\b(95|115|185|205|lb)\b/);

  // Their Stats, on the page without a tap (owner: "their whole stats page"): your Stats' tiles, from the same line, 8 weeks.
  const st = fp.getByRole('region', { name: `@${fr.name}’s stats` });
  await expect(st.getByRole('heading', { level: 2 })).toHaveText('Stats last 8 weeks');
  for (const id of ['prs', 'calendar', 'sessions', 'tonnage', 'rate']) await expect(st.locator(`[data-tile="${id}"]`)).toBeVisible();
  await expect(st.locator('[data-tile^="lift:"]')).not.toHaveCount(0);
  // The comparison stays on top: their Stats come after it.
  expect((await st.boundingBox())!.y).toBeGreaterThan((await shared.boundingBox())!.y);
  // Left out: what only its owner sees (energy), what their line can't fill (muscles need their priorities, rest their timers,
  // lifts in rotation the log before the 8 weeks); no week tile (the page's head is their week), no range to pick.
  for (const id of ['energy', 'muscles', 'rest', 'lifts']) await expect(st.locator(`[data-tile="${id}"]`)).toHaveCount(0);
  await expect(st.locator('.st-week')).toHaveCount(0);
  await expect(st.getByRole('group', { name: 'Range' })).toHaveCount(0);
  await expect(st.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  // PRs are the one their phone wrote (bench 80 × 6 today), not every first set that 8 weeks of sets would call a PR.
  await expect(st.locator('[data-tile="prs"] .st-t-val')).toHaveText(/^1\s*in 8 wk$/);
  await expect(st.locator('[data-tile="calendar"] .st-t-val')).toHaveText(/^5\s*days trained$/);
  await expect(st.locator('[data-tile="sessions"]')).toContainText('goal 2');
  await expect(st).not.toContainText(/\byours?\b/i);
  await page.waitForTimeout(800);
  await st.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/friend-stats-inline-375.png` });
  let d = await statsSheet(page, 'prs');
  await expect(d.getByRole('list', { name: 'PRs' }).getByRole('listitem')).toHaveCount(1);
  await expect(d.getByRole('list', { name: 'PRs' })).toContainText('Bench Press 80 × 6');
  // Which record it broke isn't in their line: no kinds, and no newest-PR card worked out from 8 weeks.
  await expect(d.getByRole('region', { name: 'PRs by kind' })).toHaveCount(0);
  await expect(d.getByRole('region', { name: 'New PR' })).toHaveCount(0);
  await expect(d).not.toContainText(/\byours?\b/i);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/friend-stats-sheet-375.png` });
  // A lift's sheet: no rep maxes (records are all-time; 8 weeks would pass a best-in-8-weeks off as one).
  d = await statsSheet(page, (await st.locator('[data-tile^="lift:"]').first().getAttribute('data-tile'))!);
  await expect(d.locator('.st-cells3')).toContainText('Best set');
  await expect(d).not.toContainText('Rep maxes');
  await d.getByRole('button', { name: 'Done' }).click();
  await expect(d).toHaveCount(0);

  // No board and no Recent PRs (owner, 2026-10-21): the page is this week, the comparison and their sessions; the whole log is a tap.
  await expect(fp.getByRole('region', { name: 'Last 8 weeks' })).toHaveCount(0);
  await expect(fp.getByRole('region', { name: 'Recent PRs' })).toHaveCount(0);
  const whole = fp.getByRole('group', { name: 'Whole log' });
  await expect(whole.getByRole('button')).toHaveText(['History', 'Lifts', 'Stats']);
  // Nothing of their log or settings is read to open it (what the app reads anyway for lists and news isn't the page's).
  expect(reads.filter((r) => r.includes(`users/${fr.uid}/`)), 'their log read on opening the page').toEqual([]);
  expect(await noSideScroll(page)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/friend-375.png` });
  await page.screenshot({ path: `${SHOTS}/friend-375-full.png`, fullPage: true });
  await info.attach('friend', { path: `${SHOTS}/friend-375.png`, contentType: 'image/png' });

  // Their whole log only when asked for: Stats reads it, Back comes back to the page, Friends back to the list.
  await fp.getByRole('button', { name: 'Stats', exact: true }).click();
  // Their Stats names them; nothing on it says “your”.
  await expect(page.getByRole('heading', { name: `@${fr.name}’s stats`, level: 1 })).toBeVisible();
  await statsSheet(page, 'sessions');
  await expect(page.getByText(`The line: @${fr.name}’s goal of 2 sessions.`, { exact: false })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('main')).not.toContainText(/\byours?\b/i);
  await expect(page.getByRole('combobox', { name: 'Chest' })).toBeDisabled();
  expect(reads.some((u) => u.includes(fr.uid))).toBe(true);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/friend-stats-375-full.png`, fullPage: true });
  await page.getByRole('button', { name: `@${fr.name}` }).first().click();
  await fp.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('heading', { name: `@${fr.name}’s history`, level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /Bench Press/ }).first()).toBeVisible();
  await page.getByRole('button', { name: `@${fr.name}` }).first().click();
  await fp.getByRole('button', { name: 'Friends', exact: true }).click();
  await expect(crew(page)).toBeVisible();
  // Another tab leaves their page; Friends then shows the list.
  await card.getByRole('button', { name: `@${fr.name}`, exact: true }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Today' }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Friends' }).click();
  await expect(crew(page)).toBeVisible();
});

test('a friend with one session: their Stats show what one session can say, and nothing else', async ({ browser, request }) => {
  const [me, fr] = await Promise.all([account(request, `me${Math.random().toString(36).slice(2, 8)}`), account(request, `fr${Math.random().toString(36).slice(2, 8)}`)]);
  await Promise.all([
    log(request, me, session(at(3, 17), [['Barbell Squat', [[185, 5]]]])),
    log(request, fr, session(at(2, 9), [['Goblet Squat', [[40, 10], [40, 10]]]]), { goal: 3 }),
  ]);
  await befriend(request, me, fr);
  const page = await open(browser, me);
  const card = crew(page).getByTestId(`crew-${fr.name}`);
  await expect(card).toContainText('2 sets', { timeout: 15_000 });
  await card.getByRole('button', { name: `@${fr.name}`, exact: true }).click();
  const st = page.getByRole('region', { name: `@${fr.name}’s stats` });
  await expect(st.locator('[data-tile="calendar"] .st-t-val')).toHaveText(/^1\s*day trained$/);
  await expect(st.locator('[data-tile="sessions"]')).toContainText('goal 3');
  // No PR, no trend, no rate from one session: those tiles aren't there rather than zeros.
  for (const id of ['prs', 'rate', 'plateaus', 'energy', 'muscles']) await expect(st.locator(`[data-tile="${id}"]`)).toHaveCount(0);
  expect(await noSideScroll(page)).toBe(true);
  await page.waitForTimeout(800);
  await st.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/friend-sparse-375.png` });
});

test('a friend’s page at 320 wide: nothing spills sideways', async ({ browser, request }) => {
  const { me, fr } = await pair(request);
  const page = await open(browser, me, 320);
  const card = crew(page).getByTestId(`crew-${fr.name}`);
  await expect(card).toContainText('Cable Fly', { timeout: 15_000 });
  await card.getByRole('button', { name: `@${fr.name}`, exact: true }).click();
  await expect(page.getByRole('group', { name: 'Whole log' })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/friend-320-full.png`, fullPage: true });
});

// Friends never see a friend's body weight (owner, 2026-10-21). The friend's month documents carry their weigh-ins (as a phone
// writes them); nothing of them reaches their page or their whole Stats: no Body section, no Weight tile, none of the numbers.
test('a friend’s weigh-ins never show: no Body on their Stats, none of their weights anywhere', async ({ browser, request }) => {
  const [me, fr] = await Promise.all([account(request, `me${Math.random().toString(36).slice(2, 8)}`), account(request, `fr${Math.random().toString(36).slice(2, 8)}`)]);
  const theirs = [...session(at(9, 9), [['Barbell Squat', [[135, 5], [135, 5]]]]), ...session(at(2, 9), [['Barbell Squat', [[140, 5], [140, 5]]]])];
  await Promise.all([log(request, me, session(at(3, 17), [['Barbell Squat', [[185, 5]]]])), log(request, fr, theirs, { goal: 2 })]);
  // Their weigh-ins, in the month documents beside their sets: three weeks of them, enough for a trend and a rate.
  const body = [20, 13, 9, 6, 2, 0].map((d, i) => ({ date: iso(new Date(T.getTime() - d * 864e5)), weight: [171.3, 171.9, 172.6, 172.8, 173.7, 174.1][i] }));
  const months = [...new Set([...theirs, ...body].map((x) => x.date.slice(0, 7)))];
  for (const m of months) {
    await put(request, `users/${fr.uid}/months/${m}`, { sets: theirs.filter((x) => x.date.startsWith(m)), body: body.filter((x) => x.date.startsWith(m)), deleted: {}, updatedAt: Date.now() });
  }
  await put(request, `users/${fr.uid}/meta/index`, { months: Object.fromEntries(months.map((m) => [m, Date.now()])) });
  await befriend(request, me, fr);
  const page = await open(browser, me);
  const card = crew(page).getByTestId(`crew-${fr.name}`);
  await expect(card).toContainText('2 sets', { timeout: 15_000 });
  await card.getByRole('button', { name: `@${fr.name}`, exact: true }).click();
  const fp = page.getByRole('region', { name: `@${fr.name}`, exact: true });
  const st = page.getByRole('region', { name: `@${fr.name}’s stats` });
  await expect(st.locator('[data-tile="sessions"]')).toBeVisible();
  await expect(st.locator('[data-tile="weight"]')).toHaveCount(0);
  await fp.getByRole('group', { name: 'Whole log' }).getByRole('button', { name: 'Stats' }).click();
  await expect(page.getByRole('heading', { name: `@${fr.name}’s stats`, level: 1 })).toBeVisible();
  // Their log is loaded (their squat tile is there) and still no Body.
  await expect(page.locator('[data-tile^="lift:"]').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Body' })).toHaveCount(0);
  await expect(page.locator('[data-tile="weight"]')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(/17[1-4]\.\d|Body weight|lb trend|weigh-in/i);
});
