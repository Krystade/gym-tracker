import { expect, test, type APIRequestContext, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { addFriend, goto, openProgram } from './nav';
import { audit, check, clean, lines, notched, renderCheck, TOP } from './layout';
import { deloadLog, SIM_LIFTS, simDay } from '../src/domain/learn/deloadSim.sample';
import { account, atGym, befriend, boardPost, iso, log, named, onBoard, ownerAccount, ping, put, rand, session, signedIn, Ts, verify, type Seeded } from './seed';
import { convertedRows, pasteRows, toCsv as dupesCsv, TWINS } from './fixtures/dupes';
import { friendLog, publish, summaryOf } from './fixtures/compare';
import { sixWeeks, WED } from './fixtures/today';
import { WHY, whyCsv } from './fixtures/whyWeight';

// The layout audit (e2e/layout.ts) over every screen and state, at the 13 mini's 375×812 with its notch, in WebKit and Chromium.
// Each test walks a part of the app with synthetic data (long names, big numbers) and fails listing every finding at once; the
// full-page PNGs land in screenshots/layout/<browser>/. Synthetic accounts and numbers only.
test.use({ serviceWorkers: 'block' });

// Today at 18:00; Sunday when today is a Monday, so yesterday is in the same week (the board's tiles sit side by side).
const now = new Date(new Date().setHours(18, 0, 0, 0));
const T = new Date(now.getDay() === 1 ? now.getTime() - 864e5 : now.getTime());
const at = (daysAgo: number, h: number, m = 0) => { const d = new Date(T.getTime() - daysAgo * 864e5); d.setHours(h, m, 0, 0); return d; };
/** A username at the 20-character cap. */
const long = (p: string) => `${p}_${rand()}${rand()}`.slice(0, 20);

/**
 * You and three friends. Medal trained yesterday with a PR and not today (the board's today ring beside a PR tile: the owner's
 * screenshot). Live is training now, heavy, with long lift names. Rest last trained 9 days ago. Medal has sent you messages.
 */
async function crewOf(request: APIRequestContext) {
  const [me, medal, live, rest] = await Promise.all([long('me'), long('medal'), long('live'), long('rest')].map((n) => account(request, n)));
  const legs = (d: number, h = 17) => session(at(d, h), [['Barbell Squat', [[405, 5], [405, 5], [425, 3]]], ['Romanian Deadlift', [[315, 8], [315, 8]]]]);
  const push = (d: number, h = 17) => session(at(d, h), [['Bench Press', [[275, 5], [275, 5]]], ['Single Arm Cable Lateral Raise Behind Back', [[22.5, 15], [22.5, 15]]]]);
  // A lift only Medal does, coming on: the comparison's row with a dash for you, under a long name.
  const curl = (d: number, w: number) => session(at(d, 19), [['Single Leg Seated Leg Curl Machine', [[w, 12], [w - 10, 12]]]]);
  const medalSets = [...legs(29), ...curl(29, 90), ...push(22), ...legs(15), ...curl(15, 100), ...push(8), ...legs(4), ...curl(4, 110), ...push(1, 9)];
  const yest = iso(at(1, 9));
  await Promise.all([
    log(request, me, [...legs(30), ...push(23), ...legs(16), ...push(9), ...legs(2), ...push(1)]),
    log(request, medal, medalSets, { goal: 3, status: 'Deload week, then heavy', prs: { [yest.slice(0, 7)]: [`app|${yest}|bench press|2`, `app|${yest}|single arm cable lateral raise behind back|2`] } }),
    log(request, live, [...legs(7), ...push(3), ...session(at(0, 17, 30), [['Barbell Squat', [[495, 3], [515, 2], [535, 1]]], ['Single Leg Romanian Deadlift With Dumbbells', [[1225, 12], [1225, 12]]], ['Leg Curl', [[160, 12]]]])], { goal: 6, status: 'Comp prep: 12 weeks out, cutting' }),
    log(request, rest, legs(9), { goal: 2 }),
  ]);
  for (const f of [medal, live, rest]) await befriend(request, me, f);
  await ping(request, medal, me, 'fire', at(0, 16, 40).getTime());
  const LONG = 'Are you going tomorrow at 6? I was thinking squats then a long walk on the incline treadmill, 1,000,000 steps 😅';
  await put(request, `users/${me.uid}/inbox/m${rand()}`, { from: medal.uid, kind: 'm', t: LONG, at: new Ts(at(0, 16, 45).getTime()) });
  await put(request, `users/${me.uid}/inbox/m${rand()}`, { from: medal.uid, kind: 'm', t: 'supercalifragilisticexpialidocious_with_no_spaces_at_all_123456789', at: new Ts(at(0, 16, 46).getTime()) });
  await put(request, `users/${medal.uid}/inbox/m${rand()}`, { from: me.uid, kind: 'm', t: 'Yes! 6 sharp. Bring chalk.', at: new Ts(at(0, 16, 50).getTime()) });
  return { me, medal, live, rest };
}
/** The installed Home Screen app with notifications on for this phone (the Worker itself is out of reach, as in any local build). */
async function notifying(page: Page) {
  await page.addInitScript(() => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => (q.includes('display-mode: standalone') ? { ...mm(q), matches: true, media: q } as MediaQueryList : mm(q));
    Object.defineProperty(navigator, 'standalone', { value: true });
    const w = window as unknown as Record<string, unknown>;
    if (!('PushManager' in window)) w.PushManager = function PushManager() {};
    if (!('Notification' in window)) w.Notification = function Notification() {};
    Object.defineProperty(w.Notification as object, 'permission', { get: () => 'granted', configurable: true });
    localStorage.setItem('gym-tracker:push', JSON.stringify({ device: 'layout-audit-phone', prefs: null, synced: Date.now() }));
  });
}
const open = (browser: Browser, who: Seeded) => signedIn(browser, who, T, async (page) => {
  if (process.env.LAYOUT_LOG) { page.on('console', (m) => console.log('console', m.type(), m.text())); page.on('requestfailed', (r) => console.log('failed', r.url(), r.failure()?.errorText)); }
  await notched(page);
  await notifying(page);
});
const crew = (page: Page) => page.getByRole('region', { name: 'Crew' });

test('Friends: the feed, a friend’s page and its 8-week board, a thread', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const { me, medal, live } = await crewOf(request);
  const page = await open(browser, me);
  const found: string[] = [];
  await expect(crew(page).getByTestId(`crew-${live.name}`)).toContainText('Single Leg', { timeout: 20_000 });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sat').trim())).toBe(`${TOP}px`);
  await check(page, info, found, 'friends-feed');

  // Medal's page (no board since IA A7, owner 2026-10-21; the whole log is three buttons).
  await crew(page).getByTestId(`crew-${medal.name}`).getByRole('button', { name: `@${medal.name}`, exact: true }).click();
  const fp = page.getByRole('region', { name: `@${medal.name}`, exact: true });
  await expect(fp.getByRole('group', { name: 'Whole log' })).toBeVisible();
  // The comparison is there without a tap: the lifts both do, then Medal's own with a dash for you.
  const vs = fp.getByRole('region', { name: `You and @${medal.name}` });
  await expect(vs.locator('.fp-vs').last()).toContainText('Single Leg Seated Leg Curl Machine');
  await expect(vs.getByRole('img', { name: 'You no change yet' })).toBeVisible();
  // Their Stats tiles, built to the stat-tile contract, under the render check's stricter rules too (renderCheck over .fp-stats).
  await check(page, info, found, 'friend-page', [], '.fp-stats');
  // Their Stats tiles in view, and a tile's sheet over the page (the check then reads the sheet).
  await fp.locator('.fp-stats').scrollIntoViewIfNeeded();
  await check(page, info, found, 'friend-page-stats', [], '.fp-stats');
  await fp.locator('.fp-stats [data-tile="prs"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await check(page, info, found, 'friend-page-stats-sheet', [], '.fp-stats');
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The page's foot: Whole log and its three buttons, under the render check's rules.
  await fp.getByRole('group', { name: 'Whole log' }).scrollIntoViewIfNeeded();
  await check(page, info, found, 'friend-page-foot', [], '.fp-links');

  // The thread over it.
  await fp.getByRole('button', { name: /^Message @/ }).click();
  const sheet = page.getByRole('dialog', { name: `Messages with @${medal.name}` });
  await expect(sheet.getByRole('list', { name: 'Messages' })).toContainText('Bring chalk');
  await check(page, info, found, 'thread');
  await sheet.getByRole('button', { name: 'Close' }).click();

  // Live's page: training now, the live ring on today's tile.
  await page.locator('.fp-back').click();
  await crew(page).getByTestId(`crew-${live.name}`).getByRole('button', { name: `@${live.name}`, exact: true }).click();
  const lp = page.getByRole('region', { name: `@${live.name}`, exact: true });
  await expect(lp.locator('.fp-live')).toHaveText('LIVE');
  // Nothing of Live's has two sessions two weeks apart: the comparison still shows, saying so.
  await expect(lp.getByRole('region', { name: `You and @${live.name}` })).toContainText('No change to show yet');
  await check(page, info, found, 'friend-page-live');

  // More, signed in, from the Home Screen with notifications on: every switch, the reminder's days and time.
  await goto(page, 'Notifications');
  await expect(page.getByRole('checkbox', { name: /Workout reminder/ })).toBeVisible();
  await check(page, info, found, 'more-notifications', [], 'main');
  // Account and sync, signed in: the account, its username, the hub's row with the handle.
  await goto(page, 'Account');
  await expect(page.getByRole('region', { name: 'Username' })).toContainText(`You’re @${me.name}.`);
  await check(page, info, found, 'more-account', [], 'main');
  await goto(page, 'More');
  await check(page, info, found, 'more-signed-in', [], 'main');
  // The Add a friend sheet (IA plan A4), over Friends; the check reads the sheet.
  await goto(page, 'Friends');
  await addFriend(page);
  await check(page, info, found, 'friends-add', [], 'main');
  await page.getByRole('dialog', { name: 'Add a friend' }).getByRole('button', { name: 'Make an invite link' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a friend' }).getByRole('textbox', { name: 'Your invite link' })).toBeVisible();
  await check(page, info, found, 'friends-add-link', [], 'main');
  await page.getByRole('dialog', { name: 'Add a friend' }).getByRole('button', { name: 'Done' }).click();

  // Live's whole Stats, named for them. Last: the full-page shot of a page this tall leaves a gap in the chrome's pin (a
  // screenshot artefact; the phone takes none) that a shorter page after it keeps.
  await goto(page, 'Friends');
  await crew(page).getByTestId(`crew-${live.name}`).getByRole('button', { name: `@${live.name}`, exact: true }).click();
  await page.getByRole('region', { name: `@${live.name}`, exact: true }).getByRole('button', { name: 'Stats', exact: true }).click();
  await expect(page.getByRole('heading', { name: `@${live.name}’s stats`, level: 1 })).toBeVisible();
  await check(page, info, found, 'friend-stats');
  clean(found);
});

// ---- Display names and the ✓ (social S1, S2): at the 30-character cap beside a 20-character @username, everywhere they show ----

test('Display names and the ✓: the feed, a request, the ✓’s sheet, a friend’s page, a thread, Compare, Account, the owner’s switch', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  // You, verified, with a display name at the cap and an emoji in it; Medal, verified, 30 characters with an accent; Jo, short and
  // training today; a stranger, verified, asking to be friends. All usernames at the 20-character cap.
  const [me, medal, jo, stranger] = await Promise.all([long('me'), long('medal'), long('jo'), long('ask')].map((n) => account(request, n)));
  await Promise.all([
    named(request, me, 'Alexandra Montgomery-Okafor 🏋️‍♀️'), named(request, medal, 'Maximiliana Rodríguez-Castillo'),
    named(request, jo, 'Jo'), named(request, stranger, 'Sam K.'),
  ]);
  for (const v of [me, medal, stranger]) await verify(request, v);
  await log(request, me, friendLog(0, T, { rate: 2 }));
  await publish(request, medal, summaryOf(friendLog(1, T, {}), T, 3));
  await log(request, jo, session(at(0, 17, 30), [['Barbell Squat', [[225, 5], [245, 3]]], ['Bench Press', [[185, 5]]]]), { goal: 3 });
  await befriend(request, me, medal);
  await befriend(request, me, jo);
  await put(request, `users/${me.uid}/requests/${stranger.uid}`, { username: stranger.name, sent: Date.now() });

  const page = await open(browser, me);
  const found: string[] = [];
  /** The render check's stricter rules over `scope`, beside the audit `check` already ran for `state`. */
  const strictly = async (state: string, scope: string) => { found.push(...lines(await renderCheck(page, scope)).map((l) => `${state}: ${l}`)); };
  const M = `Maximiliana Rodríguez-Castillo · @${medal.name}`;
  const medalName = (p: Page) => crew(p).getByTestId(`crew-${medal.name}`).locator('.fd-name');

  // The feed: Jo's card today, Medal's row with the ✓ after a name that wraps.
  await expect(medalName(page)).toHaveText(M, { timeout: 20_000 });
  await expect(crew(page).getByTestId(`crew-${jo.name}`)).toContainText('Barbell Squat');
  await check(page, info, found, 'names-feed');
  await strictly('names-feed', '.fd-name-line');
  // A request from someone verified, by display name with the @username beside it.
  const reqs = page.getByRole('region', { name: 'Requests' });
  await reqs.scrollIntoViewIfNeeded();
  await expect(reqs).toContainText(`Sam K. @${stranger.name} wants to be friends`);
  await check(page, info, found, 'names-request');
  await strictly('names-request', '.friend-list');

  // Medal's page: the long name and the ✓ in the heading; not the owner, so no switch.
  await medalName(page).click();
  const fp = page.getByRole('region', { name: `@${medal.name}`, exact: true });
  await expect(fp.getByRole('heading', { level: 1 }).getByRole('button', { name: 'Verified' })).toBeVisible();
  await check(page, info, found, 'names-friend-page');
  await strictly('names-friend-page', '.fp-hero');
  // The ✓'s sheet, from the heading.
  await fp.getByRole('heading', { level: 1 }).getByRole('button', { name: 'Verified' }).click();
  await expect(page.getByRole('dialog', { name: 'Verified' })).toContainText(`this is the real @${medal.name}.`);
  await check(page, info, found, 'names-verified-sheet', [], 'main');
  await page.getByRole('dialog', { name: 'Verified' }).getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Their thread: the name wraps in its head beside the buttons.
  await fp.getByRole('button', { name: /^Message @/ }).click();
  const sheet = page.getByRole('dialog', { name: `Messages with ${M}` });
  await expect(sheet.getByRole('heading', { level: 2 })).toContainText('Maximiliana');
  await check(page, info, found, 'names-thread');
  await strictly('names-thread', '.thread-sheet .sheet-head');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await page.locator('.fp-back').click();

  // Compare: the display names lead, the ✓ drawn after them (every name there is inside a button).
  await crew(page).getByRole('button', { name: /^Compare/ }).click();
  const c = page.getByRole('region', { name: 'Compare' });
  await expect(c.locator('.cmp-tg', { hasText: 'Maximiliana' }).first()).toBeVisible({ timeout: 20_000 });
  await check(page, info, found, 'names-compare', [], '.cmp');

  // Account: your display name, its card, how others see you; then a refused one as typed.
  await goto(page, 'Account');
  const card = page.getByRole('region', { name: 'Display name' });
  await expect(card.getByRole('textbox', { name: 'Display name' })).toHaveValue('Alexandra Montgomery-Okafor 🏋️‍♀️');
  await expect(page.getByRole('region', { name: 'How others see you' }).getByRole('button', { name: 'Verified' })).toBeVisible();
  await check(page, info, found, 'names-account', [], 'main');
  await card.getByRole('textbox', { name: 'Display name' }).fill('Admin ✓ @everyone');
  await expect(card.getByRole('status')).toHaveText('No @: your @username already shows beside it.');
  await check(page, info, found, 'names-account-refused', [], 'main');

  // The owner (the uid firestore.rules names, an emulator account): the switch on Medal's page and on their own Account.
  const owner = await ownerAccount(request);
  await befriend(request, owner, medal);
  const po = await open(browser, owner);
  await medalName(po).click();
  const op = po.getByRole('region', { name: `@${medal.name}`, exact: true });
  await expect(op.getByRole('button', { name: 'Remove the ✓' })).toBeVisible();
  await op.locator('.fp-tag').scrollIntoViewIfNeeded();
  await check(po, info, found, 'names-owner-friend-page', [], '.fp-tag');
  await goto(po, 'Account');
  await expect(po.getByRole('region', { name: 'How others see you' }).getByRole('button', { name: /Give the ✓|Remove the ✓/ })).toBeVisible();
  await check(po, info, found, 'names-owner-account', [], 'main');
  clean(found);
});

// ---- The board (social S3, S4) ----

test('The board: posts with long names and the ✓, a held post, your own, ⋯, Report, the composer, the gate, Board review, the removed notice', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  // You past the gate, with a long display name; Medal verified, 30 characters with an accent; a stranger at the username cap;
  // a newcomer not yet through the gate. All usernames at the 20-character cap. Synthetic words only.
  const [me, medal, stranger, newcomer] = await Promise.all([long('me'), long('medal'), long('ask'), long('new')].map((n) => account(request, n)));
  await onBoard(request, me, 'Alexandra Montgomery-Okafor 🏋️‍♀️');
  await onBoard(request, medal, 'Maximiliana Rodríguez-Castillo');
  await verify(request, medal);
  const ids = {
    long: await boardPost(request, medal, `Anyone tried 5/3/1 with a deload every 3rd week instead of 4th? Elbows feel better already. ${'Long words like supercalifragilisticexpialidocious and 💪🏋️‍♀️🔥 wrap too. '.repeat(2)}`.slice(0, 280), 3, { name: 'Maximiliana Rodríguez-Castillo', likes: 12 }),
    held: await boardPost(request, stranger, 'DM me for cheap gear, ships anywhere', 9, { reports: 3 }),
    plain: await boardPost(request, stranger, 'First 100 kg bench today after 14 months.\nSlow and ugly but it went up.', 38, { likes: 1 }),
    mine: await boardPost(request, me, 'Does anyone else’s gym turn the AC off at 9pm?', 120, { name: 'Alexandra Montgomery-Okafor 🏋️‍♀️' }),
  };
  await put(request, `board/${ids.held}/reports/r${rand()}`, { why: 'spam', at: new Ts(Date.now()) });

  const page = await open(browser, me);
  const found: string[] = [];
  const strictly = async (state: string, scope: string) => { found.push(...lines(await renderCheck(page, scope)).map((l) => `${state}: ${l}`)); };
  await page.getByRole('tab', { name: 'Board' }).click();
  const b = page.locator('.board');
  await expect(b.locator(`[data-post="${ids.long}"]`)).toContainText('Maximiliana', { timeout: 20_000 });
  await expect(b.locator(`[data-post="${ids.held}"]`)).toHaveText('Hidden after reports, waiting for review');
  await check(page, info, found, 'board');
  await strictly('board', '.bd-list');
  // ⋯ on someone else's post, then Report.
  await b.locator(`[data-post="${ids.plain}"]`).getByRole('button', { name: /^More for the post by/ }).click();
  await expect(page.getByRole('dialog', { name: `@${stranger.name}` })).toContainText('Block');
  await check(page, info, found, 'board-post-actions', [], 'main');
  await page.getByRole('dialog').getByRole('button', { name: 'Report post…' }).click();
  await expect(page.getByRole('dialog', { name: 'Report post' })).toContainText('Sexual content, or a minor at risk');
  await check(page, info, found, 'board-report', [], 'main');
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  // The composer, with a warning and the count.
  await b.getByRole('button', { name: 'Post', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'New post' });
  await sheet.getByRole('textbox', { name: 'Your post' }).fill('Does anyone else’s gym turn the AC off at 9pm? Text me 555 123 4567');
  await expect(sheet.getByRole('status')).toContainText('phone number');
  await check(page, info, found, 'board-compose');
  await strictly('board-compose', '.bd-compose');
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await page.context().close();

  // The gate, for someone new to it.
  const pn = await open(browser, newcomer);
  await pn.getByRole('tab', { name: 'Board' }).click();
  const gate = pn.getByRole('region', { name: 'Join the board' });
  // No email step since cdbbd3e: the rules to accept, and a new account waits a day.
  await expect(gate).toContainText('Posting opens once your account is a day old');
  await expect(gate.getByRole('button', { name: 'Join the board' })).toBeVisible();
  await check(pn, info, found, 'board-gate');
  await pn.context().close();

  // The owner's review, with the held post first.
  const owner = await ownerAccount(request);
  const po = await open(browser, owner);
  await goto(po, 'More');
  await po.getByRole('main').getByRole('button', { name: /^Board review/ }).click();
  await expect(po.getByRole('region', { name: `Reported post by @${stranger.name}` }).first()).toContainText('Spam or selling ×1', { timeout: 20_000 });
  await check(po, info, found, 'board-owner-review', [], 'main');
  await po.context().close();

  // The quiet line telling an author a post was removed.
  await put(request, `notices/${medal.uid}`, { removed: 1, banned: false, at: new Ts(Date.now()) });
  const pm = await open(browser, medal);
  await pm.getByRole('tab', { name: 'Board' }).click();
  await expect(pm.locator('.board').getByRole('status').filter({ hasText: 'removed a post of yours' })).toBeVisible({ timeout: 20_000 });
  await check(pm, info, found, 'board-removed-notice');
  await pm.context().close();
  clean(found);
});

// ---- Compare (round 22): each view with 2, 5 and 12 friends, who's shown, a friend not updated yet, Firsts ----

test('Compare: Ranks, Table and Chart with 12, 5 and 2 friends, the People sheet, a friend not updated yet, Firsts', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  // You and 13 friends at the 20-character username cap: 12 publish a summary, one's phone hasn't yet. Three carry your tag for
  // them (one long), one changed their username yesterday ("formerly").
  const me = await account(request, long('me'));
  const friends = await Promise.all(Array.from({ length: 13 }, (_, k) => account(request, long(`f${k}`))));
  const mine = friendLog(0, T, { rate: 2 });
  await log(request, me, mine);
  await Promise.all(friends.slice(0, 12).map((f, k) => publish(request, f, summaryOf(friendLog(k + 1, T, { pull: k % 3 === 0 }), T, 2 + (k % 5)))));
  for (const f of friends) await befriend(request, me, f, Date.now() - 864e5 * (20 - friends.indexOf(f)));
  const tagged = { [friends[0].uid]: 'Sam (gym)', [friends[3].uid]: 'Maya from work, Tuesdays', [friends[12].uid]: 'Jun' };
  await put(request, `users/${me.uid}/private/tags`, { tags: tagged, updatedAt: Date.now() });
  await put(request, `users/${friends[5].uid}`, { username: friends[5].name, displayName: friends[5].name, prev: 'old_name_was_long_20', changedAt: new Ts(Date.now() - 864e5) });

  const page = await open(browser, me);
  const found: string[] = [];
  await page.getByRole('region', { name: 'Crew' }).getByRole('button', { name: /^Compare/ }).click();
  const c = page.getByRole('region', { name: 'Compare' });
  await expect(c.getByRole('list', { name: 'Ranked by Strength' }).getByRole('listitem')).toHaveCount(13, { timeout: 20_000 });
  await expect(c.getByRole('list', { name: 'Not updated yet' })).toContainText('Not updated yet');
  const strict = (state: string) => check(page, info, found, state, [], '.cmp');
  // The audit reads boxes, not SVG: every line on the chart must also sit inside the chart, under the text above it.
  const inside = async (state: string) => {
    for (const out of await c.locator('svg.cmp-chart').evaluateAll((svgs) => svgs.flatMap((svg) => {
      const s = svg.getBoundingClientRect();
      return [...svg.querySelectorAll('path')].map((p) => p.getBoundingClientRect())
        .filter((b) => b.top < s.top - 1 || b.bottom > s.bottom + 1).map((b) => `[${b.top.toFixed(0)}..${b.bottom.toFixed(0)}] out of [${s.top.toFixed(0)}..${s.bottom.toFixed(0)}]`);
    }))) found.push(`${state}: a chart line leaves the chart: ${out}`);
  };
  await strict('compare-not-updated');

  const people = async (hide: Seeded[], state?: string) => {
    await c.getByRole('button', { name: /^People:/ }).click();
    const d = page.getByRole('dialog', { name: 'People' });
    for (const f of hide) await d.getByRole('button', { name: new RegExp(`@${f.name}`) }).click();
    if (state) await strict(state);
    await d.getByRole('button', { name: 'Done' }).click();
    await expect(d).toHaveCount(0);
  };
  const views = async (n: number) => {
    await c.getByRole('tab', { name: 'Ranks' }).click();
    await expect(c.getByRole('list', { name: 'Ranked by Strength' }).getByRole('listitem')).toHaveCount(n + 1);
    await strict(`compare-ranks-${n}`);
    await c.getByRole('tab', { name: 'Table' }).click();
    await expect(c.getByRole('table').getByRole('row')).toHaveCount(n + 2);
    await strict(`compare-table-${n}`);
    await c.getByRole('tab', { name: 'Chart' }).click();
    await expect(c.getByRole('group', { name: /^Lines/ }).getByRole('button')).toHaveCount(n + 1);
    await strict(`compare-chart-${n}`);
    await inside(`compare-chart-${n}`);
  };
  await people([friends[12]], 'compare-people');
  await views(12);
  // The other metrics at 12: Goal's weeks as dots, the chart's PRs, a line picked out, the year's range.
  await c.getByRole('tab', { name: 'Chart' }).click();
  await c.getByRole('group', { name: /^Lines/ }).getByRole('button').nth(3).click();
  await strict('compare-chart-12-picked');
  await inside('compare-chart-12-picked');
  await c.getByRole('group', { name: 'Compare by' }).getByRole('button', { name: 'PRs' }).click();
  await c.getByRole('group', { name: 'Range' }).getByRole('button', { name: '1 yr' }).click();
  await strict('compare-chart-12-prs-1yr');
  await inside('compare-chart-12-prs-1yr');
  await c.getByRole('tab', { name: 'Ranks' }).click();
  for (const m of ['Goal', 'Volume', 'PRs', 'Streak']) {
    await c.getByRole('group', { name: 'Compare by' }).getByRole('button', { name: m, exact: true }).click();
    await strict(`compare-ranks-12-${m.toLowerCase()}-1yr`);
  }
  await c.getByRole('group', { name: 'Compare by' }).getByRole('button', { name: 'Strength', exact: true }).click();
  await c.getByRole('group', { name: 'Range' }).getByRole('button', { name: '12 wk' }).click();
  const firsts = c.getByRole('region', { name: 'Firsts' });
  await firsts.getByRole('button', { name: /^Show all/ }).click();
  await firsts.scrollIntoViewIfNeeded();
  await strict('compare-firsts');
  await people(friends.slice(5, 12));
  await views(5);
  await people(friends.slice(2, 5));
  await views(2);
  clean(found);
});

// ---- On the phone alone: a realistic log, imported. ----

const DAY0 = '2026-10-20'; // a Tuesday; the clock is held at 18:00
const add = (d: string, n: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,pain_region,pain_severity,logged_at,target_weight_lb,target_reps,target_sets,gym,entered_at,duration_s,distance_mi,incline_pct,level,floors,cardio_aim,tags,edited_at';
/**
 * Ten weeks, three days a week: heavy numbers, a long lift name, a hold, a bodyweight lift, cardio, and an elbow that hurts.
 * `effort`: the weighted sets carry an RIR and the target the app suggested (some missed), as sets logged in the app do.
 */
function history({ effort = false } = {}): string {
  const rows: string[] = [HEADER];
  // Each set 3 min after the day's last, lift after lift, as he logs them: sets of different lifts at the same second would read
  // as a superset whose switches take as long as its rests (learn/switch), and no lift would have a rest of its own.
  const ticks = new Map<string, number>(), tick = (d: string) => { const k = (ticks.get(d) ?? 0) + 1; ticks.set(d, k); return k; };
  const row = (d: string, lift: string, set: number, w: number | '', r: number | '', o: { flags?: string; note?: string; pain?: [string, number]; dur?: number; mi?: number } = {}) => {
    const aimed = effort && typeof w === 'number' && w > 0 && typeof r === 'number' && !o.flags;
    const miss = aimed && set === 3 && rows.length % 4 === 0;
    rows.push([d, lift, '', set, w, r, aimed ? (rows.length + set) % 4 : '', o.flags ?? '', o.note ? `"${o.note}"` : '', 'sample', o.pain?.[0] ?? '', o.pain?.[1] ?? '', `${d}T17:${String(3 * tick(d)).padStart(2, '0')}:00.000Z`,
      aimed ? w : '', aimed ? r + (miss ? 1 : 0) : '', aimed ? 3 : '', '', '', o.dur ?? '', o.mi ?? '', '', '', '', '', '', ''].join(','));
  };
  for (let w = 9; w >= 1; w--) {
    const mon = add('2026-10-19', -7 * w), wed = add(mon, 2), fri = add(mon, 4);
    for (let k = 1; k <= 3; k++) row(mon, 'Bench Press', k, 225 + 5 * (9 - w), 5);
    for (let k = 1; k <= 3; k++) row(mon, 'Single Arm Cable Lateral Raise Behind Back', k, 22.5, 15);
    for (let k = 1; k <= 3; k++) row(mon, 'Cable Pushdown', k, 110, 12, w <= 3 && k === 3 ? { flags: 'pain', pain: ['elbow', 2] } : {});
    for (let k = 1; k <= 3; k++) row(wed, 'Barbell Squat', k, 405 + 5 * (9 - w), 5, k === 1 && w === 2 ? { note: 'Belt on from the second set; knees fine, depth good, 1,000 lb leg press next week?' } : {});
    for (let k = 1; k <= 3; k++) row(wed, 'Leg Press', k, 1185 + 5 * (9 - w), 12);
    for (let k = 1; k <= 2; k++) row(wed, 'Plank', k, 0, 90 + 5 * (9 - w), { flags: 'hold' });
    for (let k = 1; k <= 3; k++) row(fri, 'Pull-up', k, 0, 12, { flags: 'bodyweight' });
    for (let k = 1; k <= 3; k++) row(fri, 'Barbell Row', k, 245, 8);
    row(fri, 'Treadmill', 1, 0, '', { flags: 'cardio', dur: 1800 + 60 * (9 - w), mi: 3.1 });
  }
  return rows.join('\n');
}
const BODY = ['date,weight_lb,calories,protein_g,energy,edited_at', ...Array.from({ length: 30 }, (_, i) => `${add(DAY0, -30 + i)},${(231.4 - i * 0.1).toFixed(1)},3150,215,${3 + (i % 3)},`)].join('\n');

async function phone(page: Page) {
  await notched(page);
  await page.clock.install({ time: new Date(`${DAY0}T18:00:00`) });
  await page.goto('/');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sat').trim())).toBe(`${TOP}px`);
}
async function importLog(page: Page, csv = history(), body: string | null = BODY) {
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles([
    { name: 'sets.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) },
    ...(body ? [{ name: 'body.csv', mimeType: 'text/csv', buffer: Buffer.from(body) }] : []),
  ]);
  await expect(page.getByText(/✓ Imported \d+ new sets/)).toBeVisible();
}
async function addCard(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  return page.locator(`[data-card="${name.toLowerCase()}"]`);
}
async function logSet(page: Page, card: Locator, time: string, weight?: string, reps?: string) {
  if (weight) await card.getByRole('textbox', { name: 'Weight' }).fill(weight);
  if (reps) await card.getByRole('textbox', { name: 'Reps' }).fill(reps);
  await page.clock.pauseAt(new Date(time.includes('T') ? time : `${DAY0}T${time}`));
  await card.getByRole('button', { name: /^Add set/ }).click();
}

test('Today, History, Lifts, a lift, Stats and More with ten weeks of heavy training', async ({ page }, info) => {
  test.setTimeout(180_000);
  await phone(page);
  const found: string[] = [];
  await check(page, info, found, 'today-empty');
  await importLog(page);
  // More and its own screens (IA plan A3), under the render check's stricter rules too.
  await check(page, info, found, 'more-backup', [], 'main');
  await goto(page, 'More');
  await check(page, info, found, 'more', [], 'main');
  for (const [row, state] of [['Weekly goal', 'more-weekly-goal'], ['Cycle', 'more-cycle'], ['People', 'more-people'], ['Account', 'more-account-signed-out']] as const) {
    await goto(page, row);
    await expect(page.getByRole('button', { name: '‹ More' })).toBeVisible();
    await check(page, info, found, state, [], 'main');
  }
  await goto(page, 'Today');
  await check(page, info, found, 'today-history');
  await goto(page, 'History');
  await check(page, info, found, 'history');
  await page.locator('details.day summary').first().click();
  await check(page, info, found, 'history-day');
  await goto(page, 'Lifts');
  await check(page, info, found, 'lifts');
  for (const [lift, state] of [['Bench Press', 'lift-bench'], ['Single Arm Cable Lateral Raise Behind Back', 'lift-long-name'], ['Plank', 'lift-hold'], ['Leg Press', 'lift-leg-press'], ['Treadmill', 'lift-cardio']] as const) {
    await goto(page, 'Lifts');
    await page.getByRole('button', { name: new RegExp(`^${lift}`) }).first().click();
    await expect(page.getByRole('heading', { name: lift, level: 1 })).toBeVisible();
    await check(page, info, found, state);
  }
  await goto(page, 'Stats');
  await expect(page.getByRole('heading', { name: 'Stats', level: 1 })).toBeVisible();
  await check(page, info, found, 'stats', [], 'main');
  for (const screen of ['Priorities', 'Gym', 'Program', 'Photos'] as const) {
    await goto(page, screen);
    await check(page, info, found, `more-${screen.toLowerCase()}`);
  }
  // The training goal set to Strength: its note, and a barbell lift's range on its page.
  await goto(page, 'Priorities');
  await page.getByRole('group', { name: 'Goal' }).getByRole('button', { name: /^Strength/ }).click();
  await expect(page.getByRole('group', { name: 'Training goal' })).toContainText('5–8 reps');
  await check(page, info, found, 'priorities-strength');
  await goto(page, 'Backup');
  await page.getByRole('button', { name: 'Paste from notes' }).click();
  await check(page, info, found, 'more-paste');

  // A second person, with a long name: the profile bar sticks to the top of every screen.
  await goto(page, 'People');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Maximiliana Featherstonehaugh');
  await page.getByRole('button', { name: /^Add Maximiliana/ }).click();
  await expect(page.locator('.profile-bar')).toBeVisible();
  for (const tab of ['Today', 'History', 'Stats'] as const) {
    await goto(page, tab);
    await check(page, info, found, `profiles-${tab.toLowerCase()}`);
  }
  clean(found);
});

test('Today mid-session: big numbers, Details, a superset, the rest bar and its why, the picker, a plan', async ({ page }, info) => {
  test.setTimeout(180_000);
  await phone(page);
  const found: string[] = [];
  await importLog(page);
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await check(page, info, found, 'picker');
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Leg Press');
  await page.getByRole('button', { name: /^Leg Press/ }).first().click();
  const leg = page.locator('[data-card="leg press"]');
  await logSet(page, leg, '18:30:00', '1225', '12');
  await logSet(page, leg, '18:33:00', '1235', '11');
  await check(page, info, found, 'session-rest');
  const rest = page.getByRole('timer', { name: 'Rest' });
  await rest.getByRole('button', { name: /^Why this rest/ }).click();
  await expect(page.getByRole('dialog', { name: /^Why this rest/ })).toBeVisible();
  await check(page, info, found, 'session-rest-why');
  await page.keyboard.press('Escape');
  await leg.getByRole('button', { name: 'Details' }).click();
  await leg.getByRole('button', { name: 'Pain', exact: true }).click();
  await check(page, info, found, 'session-details-pain');

  // A superset: lateral raises and pushdowns alternated.
  const lat = await addCard(page, 'Single Arm Cable Lateral Raise Behind Back'), push = await addCard(page, 'Cable Pushdown');
  await logSet(page, lat, '18:40:00', '22.5', '15');
  await logSet(page, push, '18:41:00', '110', '12');
  await logSet(page, lat, '18:43:30');
  await expect(page.getByRole('timer', { name: 'Switch' })).toBeVisible();
  await expect(lat.locator('.superset-line')).toHaveText(/^Superset with/);
  await check(page, info, found, 'session-superset');
  await logSet(page, push, '18:44:30');
  await check(page, info, found, 'session-superset-round');

  await openProgram(page);
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: 'Weekly volume' })).toBeVisible();
  await check(page, info, found, 'program');
  await page.getByRole('button', { name: '‹ Back' }).click();
  const head = page.getByRole('button', { name: /^Today’s plan/ });
  if ((await head.getAttribute('aria-expanded')) === 'false') await head.click();
  await check(page, info, found, 'today-plan');
  // Quick: sized at his pace, and its header says so.
  await page.getByRole('group', { name: 'Program day' }).getByRole('button', { name: 'Quick' }).click();
  await expect(page.getByLabel('Plan length')).toContainText('at your pace');
  await check(page, info, found, 'today-quick');
  await page.getByRole('group', { name: 'Program day' }).getByRole('button', { name: 'Day A' }).click();
  await page.getByRole('region', { name: 'Today’s plan' }).getByRole('button', { name: 'Swap' }).first().click();
  await expect(page.getByRole('list', { name: 'Suggested swaps' })).toBeVisible();
  await check(page, info, found, 'today-swap');
  clean(found);
});

test('Finishing: the Finish bar, the summary in the plan’s place, and a session that closed while away on the next open', async ({ page }, info) => {
  test.setTimeout(180_000);
  await phone(page);
  const found: string[] = [];
  await importLog(page);
  await goto(page, 'Today');
  await openProgram(page);
  await page.getByRole('textbox', { name: 'Days per week' }).fill('3');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A/ })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
  const rows = page.getByRole('list', { name: 'Planned exercises' }).getByRole('listitem');
  const n = await rows.count();
  for (let i = 1; i < n; i++) await rows.nth(i).getByRole('button', { name: 'Skip' }).click();
  const name = (await rows.first().locator('.plan-name').getAttribute('data-exercise'))!;
  const sets = Number((await rows.first().locator('.plan-count').textContent())!.split('/')[1]);
  await rows.first().locator('.plan-name').click();
  const card = page.locator(`[data-card="${name.toLowerCase()}"]`);
  for (let i = 0; i < sets; i++) {
    const w = card.getByRole('textbox', { name: 'Weight' });
    if ((await w.inputValue()) === '') await w.fill('1225');
    await logSet(page, card, `18:${String(30 + 3 * i).padStart(2, '0')}:00`);
    if (i < sets - 1) await expect(card.getByRole('list', { name: /^Sets for/ }).getByRole('listitem')).toHaveCount(i + 1);
  }
  const bar = page.getByRole('group', { name: 'Plan done' });
  await expect(bar).toBeVisible();
  await check(page, info, found, 'finish-bar');
  await bar.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('region', { name: 'Workout summary' })).toBeVisible();
  // The day's achievements and the closest next one, under the render check's rules too (each row a 44 px button).
  const achSecs = 'section[aria-label="Achievements today"], section[aria-label="Closest achievement"]';
  await expect(page.getByRole('region', { name: 'Achievements today' })).toContainText('Your first session');
  await check(page, info, found, 'finish-summary', [], achSecs);
  if (process.env.STATS_PNG) {
    await page.getByRole('region', { name: 'Achievements today' }).evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `${process.env.STATS_PNG}/${info.project.name}-ach-finish.png` });
    await page.getByRole('region', { name: 'Closest achievement' }).evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `${process.env.STATS_PNG}/${info.project.name}-ach-finish-next.png` });
  }
  // The next day, two sets and away: it closes while the app is gone, and its summary waits for the next open, the morning after.
  const day2 = add(DAY0, 1);
  await page.goto('about:blank');
  await page.clock.setSystemTime(new Date(`${day2}T18:00:00`));
  await page.goto('/');
  const curl = await addCard(page, 'Cable Pushdown');
  for (const t of ['18:30:00', '18:33:00']) { await page.clock.pauseAt(new Date(`${day2}T${t}`)); await curl.getByRole('button', { name: /^Add set/ }).click(); }
  await expect(curl.getByRole('list', { name: /^Sets for/ }).getByRole('listitem')).toHaveCount(2);
  await page.goto('about:blank');
  await page.clock.setSystemTime(new Date(`${add(DAY0, 2)}T09:00:00`));
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Last workout' })).toBeVisible();
  await check(page, info, found, 'finish-next-open');
  clean(found);
});

// ---- Readiness S4: the READY tile at the top of Today, the week strip, the Why sheet (render check's rules too). ----

/** A clock time ("17:40", "7:05", "5pm"): owner Q2, by the day only, so none in the tile, the strip or the sheet (learn/readiness's detector). */
const CLOCK = /\d{1,2}:\d{2}|\b\d{1,2}\s?(am|pm)\b/i;

test('Today: the READY tile (new user, go, tight week, goal met, layoff), folded after a set, the Week row and its strip, the Why sheet to its end', async ({ page }, info) => {
  test.setTimeout(240_000);
  const found: string[] = [];
  // PNGs of the screen as the phone shows it, when asked for (READY_PNG=<dir>).
  const png = async (name: string) => { if (process.env.READY_PNG) await page.screenshot({ path: `${process.env.READY_PNG}/${info.project.name}-${name}.png` }); };
  const tile = page.getByRole('region', { name: 'Ready' });
  const strip = page.getByRole('region', { name: 'Week plan' });
  const noClock = async () => {
    const text = (await tile.innerText()) + (await strip.count() ? await strip.innerText() : '');
    expect(text.match(CLOCK), text).toBeNull();
  };
  // The render check's rules over the tile and the strip (the rest of Today is the plain audit's).
  const look = async (state: string) => { await noClock(); await check(page, info, found, state, [], '.ready-card, .week-strip'); await png(state); };
  const at = async (day: string) => { await page.clock.setSystemTime(new Date(`${day}T18:00:00`)); await page.reload(); await goto(page, 'Today'); };
  const goal = async (n: number) => { await goto(page, 'Weekly goal'); await page.getByRole('textbox', { name: 'Sessions per week goal' }).fill(String(n)); await goto(page, 'Today'); };
  // IA A1: the week is a one-line row inside the tile; a tap opens the strip (its marks, sessions and rest reasons).
  const openWeek = async () => {
    const row = tile.getByRole('button', { name: /^Week/ });
    if ((await row.getAttribute('aria-expanded')) === 'false') await row.click();
    await expect(strip).toBeVisible();
  };
  // Item 12: the folded Week row holds the whole week, 7 days, on one line at 375 and 320 px, inside the card. Owner, 2026-10-23:
  // each day a tap of its own (the day on Today), 44 × 44 on his 375 px phone.
  const oneLine = async () => {
    const row = tile.getByRole('button', { name: /^Week/ });
    if ((await row.getAttribute('aria-expanded')) === 'true') await row.click();
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 812 });
      const m = await tile.evaluate((t) => {
        const r = t.getBoundingClientRect(), w = t.querySelector('.ready-week')!;
        const days = [...w.querySelectorAll('.rw-days > li > button')].map((b) => b.getBoundingClientRect());
        return { n: days.length, tops: new Set(days.map((d) => Math.round(d.top))).size, minW: Math.min(...days.map((d) => d.width)), minH: Math.min(...days.map((d) => d.height)),
          left: Math.min(...days.map((d) => d.left)) - r.left, right: r.right - Math.max(...days.map((d) => d.right)), over: t.scrollWidth - t.clientWidth };
      });
      expect(m, `Week row at ${width}`).toMatchObject({ n: 7, tops: 1, over: 0 });
      expect(m.left, `Week row at ${width}`).toBeGreaterThanOrEqual(0);
      expect(m.right, `Week row at ${width}`).toBeGreaterThanOrEqual(0);
      expect(m.minH, `Week row at ${width}`).toBeGreaterThanOrEqual(44);
      if (width === 375) expect(m.minW, `Week row at ${width}`).toBeGreaterThanOrEqual(44);
      await png(`week-row-${width}`);
    }
    await page.setViewportSize({ width: 375, height: 812 });
  };

  // A new user: a calm line, no number (never a 0), the Energy chips in the tile.
  await phone(page);
  await expect(tile).toContainText('Log a few sessions');
  await expect(tile.locator('.ready-n')).toHaveCount(0);
  await expect(tile.getByRole('group', { name: 'Energy' })).toBeVisible();
  await look('ready-new-user');

  // Ten weeks of Mon/Wed/Fri, a 3-day program built today (Tuesday), the goal 2: Go, the session, its sets, the week strip.
  await importLog(page);
  await goto(page, 'Today');
  await openProgram(page);
  await page.getByRole('textbox', { name: 'Days per week' }).fill('3');
  await page.getByRole('button', { name: 'Build program' }).click();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(tile.locator('.ready-n')).toHaveText(/^(\d+|<1)$/);
  await expect(tile.locator('.ready-verdict')).toHaveText('Go today');
  await expect(tile).toContainText(/\d+ of \d+ sets at full strength/);
  await expect(strip).toHaveCount(0); // folded to the Week row
  await look('ready-go-week-row');
  await oneLine();
  await openWeek();
  // The whole week from Monday (item 12): Monday not trained this week, today Tuesday highlighted.
  await expect(strip.locator('.ws-days > li')).toHaveCount(7);
  await expect(strip.locator('.ws-days > li').first()).toHaveAttribute('data-mark', 'missed');
  await expect(strip.locator('.ws-days > li[data-today]')).toHaveCount(1);
  await expect(strip.locator('.ws-days > li').nth(1)).toHaveAttribute('data-today', 'true');
  await expect(strip.locator('.ws-days > li').nth(1)).toContainText('Today');
  // Today's plan is the week plan's session for today (owner Q3), whichever day that is.
  const planned = (await tile.locator('.ready-line b').first().textContent())!;
  await expect(page.getByRole('region', { name: 'Today’s plan' })).toContainText(planned);
  await look('ready-go');

  // Why ›: the sheet, its muscles, sources, energy, deload, pain and the week's sets, to its end.
  await tile.getByRole('button', { name: /^Why/ }).click();
  const d = page.getByRole('dialog', { name: 'Why' });
  await expect(d).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/sheet-lock/);
  await expect(d.locator('.why-table tbody tr').first()).toBeVisible();
  await expect(d).toContainText(/research \d+% · you \d+%/);
  expect((await d.innerText()).match(CLOCK)).toBeNull();
  await check(page, info, found, 'ready-why', [], '[role=dialog]');
  await png('ready-why');
  await d.locator('.st-sh-body').evaluate((b) => { b.scrollTop = b.scrollHeight; });
  await check(page, info, found, 'ready-why-end', [], '[role=dialog]');
  await png('ready-why-end');
  await d.getByRole('button', { name: 'Done' }).click();
  await expect(d).toHaveCount(0);

  // Goal 6 from Tuesday: 6 days for 6 sessions, no spare day.
  await goal(6);
  await expect(tile.locator('.ready-verdict')).toHaveText('Go today · tight week');
  await openWeek();
  await expect(strip.locator('.ws-days > li')).toHaveCount(7);
  await expect(strip.locator('.ws-days > li[data-mark=rest]')).toHaveCount(0);
  await look('ready-tight');
  await goal(2);

  // The day's first set: the tile folds to one line; a tap opens it again, and folds it.
  const card = await addCard(page, 'Bench Press');
  await logSet(page, card, '18:05:00', '245', '5');
  await expect(tile.getByRole('button', { name: /Ready/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(tile.getByRole('group', { name: 'Energy' })).toHaveCount(0);
  await expect(strip).toHaveCount(0);
  await look('ready-folded');
  await tile.getByRole('button', { name: /Ready/ }).click();
  await expect(tile.getByRole('group', { name: 'Energy' })).toBeVisible();
  await look('ready-reopened');
  await tile.getByRole('button', { name: 'Fold Ready' }).click();
  await expect(tile.getByRole('group', { name: 'Energy' })).toHaveCount(0);

  // Wednesday, goal 1, met on Tuesday: a Go, "extra session optional", never Rest; the days ahead rest, "Goal met".
  await page.clock.resume();
  await goal(1);
  await at(add(DAY0, 1));
  await expect(tile.locator('.ready-verdict')).toHaveText('Goal met · extra session optional');
  await openWeek();
  await expect(strip.locator('.ws-days > li[data-today]')).toHaveAttribute('data-mark', 'optional');
  // Tuesday's session, ticked done; Monday, not trained.
  await expect(strip.locator('.ws-days > li').nth(1)).toHaveAttribute('data-mark', 'done');
  await expect(strip.locator('.ws-days > li').first()).toHaveAttribute('data-mark', 'missed');
  await expect(strip.locator('.ws-why')).toContainText('Goal met');
  await look('ready-goal-met');
  await oneLine();

  // Eight days on from the last session: a layoff, always Go, said calmly.
  await at(add(DAY0, 8));
  await expect(tile.locator('.ready-verdict')).toHaveText('Go today');
  await expect(tile).toContainText('First session in 8 days');
  await look('ready-layoff');
  clean(found);
});

// ---- IA A1 (owner, 2026-10-21): Today's order, Ready's Weight and Week rows, the digest card, the past-workout line, Why's muscles. ----

test('Today (IA A1): before training on a digest week with a ping, the Week row open, Why’s muscles, the digest open, mid-session, a new user', async ({ page: fresh, browser, request }, info) => {
  test.setTimeout(240_000);
  const found: string[] = [];
  // PNGs of the screen as the phone shows it, when asked for (IA_PNG=<dir>).
  const png = async (p: Page, name: string) => { if (process.env.IA_PNG) await p.screenshot({ path: `${process.env.IA_PNG}/${info.project.name}-${name}.png` }); };
  // The render check's rules over everything this stage built (the rest of Today is the plain audit's).
  const STRICT = '.ready-card, .plan, .digest, .past-workout, .no-program';
  // The PNG first: the audit's full-page shot scrolls the page back to the top.
  const look = async (p: Page, state: string) => { await png(p, state); await check(p, info, found, state, [], STRICT); };

  // A new user, signed out, nothing logged: the calm Ready line with Energy and Weight, and Program › where the plan goes.
  await phone(fresh);
  await expect(fresh.getByRole('region', { name: 'Ready' })).toContainText('Log a few sessions');
  await expect(fresh.getByRole('region', { name: 'Ready' }).getByRole('group', { name: 'Weigh-in' })).toBeVisible();
  await expect(fresh.getByRole('button', { name: 'Program', exact: true })).toBeVisible();
  await look(fresh, 'ia-new-user');

  // Six weeks of A/B/C, a friend's ping, Monday's session not yet seen on this phone, a 3-day program built from the line.
  const [me, ana] = await Promise.all([account(request), account(request)]);
  await log(request, me, sixWeeks());
  await befriend(request, me, ana);
  await ping(request, ana, me, 'fire', WED.getTime() - 20 * 60_000);
  const page = await signedIn(browser, me, WED, notched);
  await goto(page, 'Today');
  await expect(page.getByRole('region', { name: 'Last workout' })).toBeVisible();
  await look(page, 'ia-no-program');
  await openProgram(page);
  await page.getByRole('textbox', { name: 'Days per week' }).fill('3');
  await page.getByRole('button', { name: 'Build program' }).click();
  await page.getByRole('button', { name: '‹ Back' }).click();
  const tile = page.getByRole('region', { name: 'Ready' });
  const plan = page.getByRole('region', { name: 'Today’s plan' });
  const digest = page.getByRole('region', { name: 'Last week' });
  await expect(plan.getByRole('button', { name: 'Edit plan' })).toBeVisible();
  await expect(digest.getByRole('button', { name: /^Last week/ })).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(() => window.scrollTo(0, 0));
  await look(page, 'ia-before');

  // The Week row, open: the strip inside the tile, each day's session and the rest days' reasons.
  await tile.getByRole('button', { name: /^Week/ }).click();
  const strip = page.getByRole('region', { name: 'Week plan' });
  await expect(strip.locator('.ws-why li').first()).toBeVisible();
  await look(page, 'ia-week-open');
  await tile.getByRole('button', { name: /^Week/ }).click();
  await expect(strip).toHaveCount(0);

  // Why ›: the muscles today's plan touches, then All muscles › (the Stats Muscles sheet) in its place.
  await tile.getByRole('button', { name: /^Why/ }).click();
  const why = page.getByRole('dialog', { name: 'Why' });
  const mine = why.getByRole('list', { name: 'Today’s muscles' }).getByRole('listitem');
  await expect(mine.first()).toBeVisible();
  expect(await mine.count()).toBeLessThan(18); // not every muscle: those are one tap on
  await why.getByRole('button', { name: /^All muscles/ }).scrollIntoViewIfNeeded();
  await look(page, 'ia-why-muscles');
  await why.getByRole('button', { name: /^All muscles/ }).click();
  const all = page.getByRole('dialog', { name: 'Sets per muscle' });
  await expect(all).toContainText('Fractional sets this week');
  await expect(why).toHaveCount(0);
  await look(page, 'ia-all-muscles');
  await all.getByRole('button', { name: 'Done' }).click();
  await expect(all).toHaveCount(0);

  // Last week, opened in place under the plan.
  await digest.getByRole('button', { name: /^Last week/ }).click();
  await expect(digest.getByRole('button', { name: 'Hide until next week' })).toBeVisible();
  await digest.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await look(page, 'ia-digest-open');
  await digest.getByRole('button', { name: /^Last week/ }).click();

  // Mid-session: two sets of the first planned lift, logged from its row; back at the top, as after a tab switch.
  const first = plan.locator('.plan-name').first();
  const name = (await first.getAttribute('data-exercise'))!;
  await first.click();
  const card = page.locator(`[data-card="${name.toLowerCase()}"]`);
  for (const t of ['17:10:00', '17:13:00']) {
    const w = card.getByRole('textbox', { name: 'Weight' });
    if ((await w.inputValue()) === '') await w.fill('100');
    const r = card.getByRole('textbox', { name: 'Reps' });
    if ((await r.inputValue()) === '') await r.fill('10');
    await page.clock.pauseAt(new Date(`${iso(WED)}T${t}`));
    await card.getByRole('button', { name: /^Add set/ }).click();
  }
  await expect(plan.locator(`[data-exercise="${name}"] .plan-count`)).toHaveText(/^2\//);
  await expect(plan.getByRole('button', { name: /^Today’s plan/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(tile.getByRole('group', { name: 'Energy' })).toHaveCount(0); // Ready folded, as before
  await page.evaluate(() => window.scrollTo(0, 0));
  await look(page, 'ia-mid');
  await page.context().close();
  clean(found);
});

test('More: an import held back, and Duplicate imports with its days, the copies that differ, the confirm and the result', async ({ page }, info) => {
  test.setTimeout(120_000);
  await phone(page);
  const found: string[] = [];
  const csv = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles(csv('pasted.csv', dupesCsv(pasteRows)));
  await expect(page.getByText(/✓ Imported \d+ new sets/)).toBeVisible();
  await page.getByLabel('Import CSV').setInputFiles(csv('converted.csv', dupesCsv(convertedRows)));
  const held = page.getByRole('alert');
  await expect(held).toContainText('held back');
  await held.scrollIntoViewIfNeeded();
  await check(page, info, found, 'more-import-held-back');
  await held.getByRole('button', { name: 'Add anyway' }).click();
  const dupes = page.getByRole('region', { name: 'Duplicate imports' });
  await expect(dupes).toContainText(`${TWINS} sets came in twice`);
  await dupes.getByText(/^\d+ days?$/).click();
  await dupes.getByText(/^\d+ that differ$/).click();
  await expect(dupes.getByRole('list', { name: 'Copies that differ' })).toBeVisible();
  await dupes.scrollIntoViewIfNeeded();
  await check(page, info, found, 'more-duplicates');
  await dupes.getByRole('button', { name: `Remove ${TWINS} duplicates` }).click();
  await expect(dupes.getByRole('alert')).toBeVisible();
  await check(page, info, found, 'more-duplicates-confirm');
  await dupes.getByRole('alert').getByRole('button', { name: `Remove ${TWINS}` }).click();
  await expect(dupes.getByRole('status')).toContainText('Removed');
  await check(page, info, found, 'more-duplicates-removed');
  clean(found);
});

test('History: Fix sets with its lifts to tick, the weight field, the lift picker and the Undo line', async ({ page }, info) => {
  test.setTimeout(120_000);
  await phone(page);
  const found: string[] = [];
  const D = add(DAY0, -1);
  const rows = ['date,exercise,set,weight_lb,reps,flags,source',
    `${D},Incline Bench Press With A Very Long Name,1,0,15,bodyweight;warmup,notes`, `${D},Incline Bench Press With A Very Long Name,2,0,12,bodyweight,notes`,
    `${D},Cable Pushdown,1,1180,11,unsure,notes`, `${D},Cable Pushdown,2,1185.5,10,,notes`];
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'log.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) });
  await expect(page.getByText(/✓ Imported \d+ new sets/)).toBeVisible();
  await goto(page, 'History');
  const day = page.locator(`details.day[data-date="${D}"]`);
  // Each day's "⋯" beside its chevron (a closed day's too), and its sheet, under the render check's stricter rules.
  await check(page, info, found, 'history-day-menus', [], '.day-item');
  await png(page, info, 'history-day-menus');
  await page.locator('.day-item', { has: day }).getByRole('button', { name: /^More for / }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await check(page, info, found, 'history-day-menu-sheet', [], 'main');
  await png(page, info, 'history-day-menu-sheet');
  await page.getByRole('dialog').getByRole('button', { name: 'Fix sets' }).click();
  const bench = day.getByRole('group', { name: 'Incline Bench Press With A Very Long Name' });
  await bench.getByRole('checkbox').nth(0).check();
  await bench.getByRole('checkbox').nth(1).check();
  await day.getByLabel(/^Weight for 2 ticked sets/).fill('45');
  await day.scrollIntoViewIfNeeded();
  await check(page, info, found, 'history-fix-sets');
  await day.getByRole('button', { name: 'Set weight' }).click();
  await expect(day.getByRole('status')).toContainText('Changed 2 sets');
  await check(page, info, found, 'history-fix-sets-undo');
  await day.getByRole('group', { name: 'Cable Pushdown' }).getByRole('button', { name: 'Change lift' }).click();
  await expect(page.getByRole('heading', { name: /^Change Cable Pushdown on/ })).toBeVisible();
  await check(page, info, found, 'history-fix-sets-picker');
  clean(found);
});

// ---- Why this weight: the target's "?" and its sheet, for each kind of target. ----

/** The screen as the phone shows it (not the full page), for looking at: screenshots/why-weight/<browser>-<name>.png. */
async function png(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: path.join('screenshots', 'why-weight', `${info.project.name}-${name}.png`) });
}

test('Why this weight: the target’s “?” and its sheet for a normal progression, a stall, a jump, a pain hold and a brand-new lift', async ({ page }, info) => {
  test.setTimeout(150_000);
  await phone(page);
  const found: string[] = [];
  await importLog(page, whyCsv(DAY0), null);
  await goto(page, 'Today');
  for (const [name, { lift, lines: want }] of Object.entries(WHY)) {
    const card = await addCard(page, lift);
    const q = card.getByLabel('Target').getByRole('button', { name: 'Why this weight' });
    await q.scrollIntoViewIfNeeded();
    if (name === 'normal') await check(page, info, found, 'why-weight-card', [], `[data-card="${lift.toLowerCase()}"]`);
    await q.click();
    const sheet = page.getByRole('dialog', { name: 'Why this weight' });
    await expect(sheet.locator('.why-lines > li')).toHaveCount(want.length);
    expect(await sheet.locator('.why-lines > li').evaluateAll((ls) => ls.map((l) => l.getAttribute('data-input')))).toEqual(want);
    await check(page, info, found, `why-weight-${name}`, [], 'main');
    await png(page, info, name);
    // Its end, scrolled to: the last line and Done.
    await sheet.locator('.st-sh-body').evaluate((b) => b.scrollTo({ top: b.scrollHeight }));
    await check(page, info, found, `why-weight-${name}-end`, [], 'main');
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet).toHaveCount(0);
    // One card at a time: folded, so the next one comes up under the head.
    await card.getByRole('button', { name: `Fold ${lift}` }).click();
  }
  clean(found);
});

// ---- Stats v2: the tiles, each sheet, edit mode, a new user, under the render check's stricter rules too. ----

test('Stats v2: the tiles, the lift, calendar, muscles and week sheets, every range, edit mode, and a new user', async ({ page }, info) => {
  test.setTimeout(180_000);
  await phone(page);
  const found: string[] = [];
  // PNGs to look at, when asked for (STATS_PNG=<dir>): the screen as the phone shows it, not the full page.
  const png = async (name: string) => { if (process.env.STATS_PNG) await page.screenshot({ path: `${process.env.STATS_PNG}/${info.project.name}-${name}.png` }); };
  await goto(page, 'Stats');
  await check(page, info, found, 'stats-v2-new-user', [], 'main');
  await png('new-user');
  await importLog(page, history({ effort: true }));
  await goto(page, 'Stats');
  await expect(page.locator('[data-tile^="lift:"]')).toHaveCount(4);
  await check(page, info, found, 'stats-v2', [], 'main');
  await png('top');
  await page.evaluate(() => scrollTo({ top: 640, behavior: 'instant' }));
  await png('scrolled');
  await page.evaluate(() => scrollTo({ top: 1280, behavior: 'instant' }));
  await png('scrolled-2');
  const sheet = async (tile: string, state: string) => {
    await page.locator(tile).first().click();
    const d = page.getByRole('dialog');
    await expect(d).toBeVisible();
    // The page under the sheet can't scroll; the sheet sits on the screen's foot.
    await expect(page.locator('html')).toHaveClass(/sheet-lock/);
    await check(page, info, found, state, [], 'main');
    await png(state);
    // Its body scrolled to the end: what was below the fold, checked in view.
    if (await d.locator('.st-sh-body').evaluate((b) => { const more = b.scrollHeight > b.clientHeight + 1; b.scrollTop = b.scrollHeight; return more; })) {
      await check(page, info, found, `${state}-end`, [], 'main');
      await png(`${state}-end`);
    }
    await d.getByRole('button', { name: 'Done' }).click();
    await expect(d).toHaveCount(0);
  };
  await sheet('[data-tile^="lift:"]', 'stats-v2-lift');
  await sheet('[data-tile="calendar"]', 'stats-v2-calendar');
  await sheet('[data-tile="muscles"]', 'stats-v2-muscles');
  await sheet('[data-tile="prs"]', 'stats-v2-prs');
  await sheet('[data-tile="pain"]', 'stats-v2-pain');
  await sheet('.st-week', 'stats-v2-week');
  // S2: every new tile there, and its sheet.
  for (const t of ['rate', 'plateaus', 'milestones', 'hitrate', 'effort', 'rest', 'pullpush', 'lifts', 'days', 'start', 'energy', 'weight', 'relstrength']) {
    await expect(page.locator(`[data-tile="${t}"]`)).toBeVisible();
    await page.locator(`[data-tile="${t}"]`).scrollIntoViewIfNeeded();
    await png(`tile-${t}`);
    await sheet(`[data-tile="${t}"]`, `stats-v2-${t}`);
  }
  for (const r of ['4 wk', '1 yr']) {
    await page.getByRole('group', { name: 'Range' }).getByRole('button', { name: r }).click();
    await check(page, info, found, `stats-v2-${r.replace(' ', '')}`, [], 'main');
  }
  await sheet('[data-tile="calendar"]', 'stats-v2-calendar-1yr');
  await page.getByRole('group', { name: 'Range' }).getByRole('button', { name: '12 wk' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Pin Tonnage' }).click();
  await page.getByRole('button', { name: 'Hide Calendar' }).click();
  await check(page, info, found, 'stats-v2-edit', [], 'main');
  await png('edit');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('region', { name: 'Pinned' }).locator('[data-tile="tonnage"]')).toBeVisible();
  await check(page, info, found, 'stats-v2-pinned', [], 'main');
  await png('pinned');
  clean(found);
});

// ---- The body map (owner, 2026-10-22): Stats' Muscles sheet, the Why sheet, a lift from the catalog and one guessed from its name. ----

test('Body map: the Muscles sheet front and back, Why’s recovery, a known lift and a guessed one', async ({ page }, info) => {
  test.setTimeout(180_000);
  await phone(page);
  const found: string[] = [];
  // PNGs of the screen as the phone shows it, when asked for (BODY_PNG=<dir>).
  const png = async (name: string) => { if (process.env.BODY_PNG) await page.screenshot({ path: `${process.env.BODY_PNG}/${info.project.name}-${name}.png` }); };
  const drawn = async (scope: Locator) => { await expect(scope.locator('figure.bodymap svg.bm-side')).toHaveCount(2); await scope.locator('figure.bodymap').scrollIntoViewIfNeeded(); };
  await importLog(page);
  // A lift the catalog doesn't have, its muscles guessed from the words.
  await importLog(page, [HEADER, ...[1, 2].map((k) => [add(DAY0, -1), 'Paused Kroc Row', '', k, 80, 10, '', '', '', 'sample', '', '', `${add(DAY0, -1)}T17:3${k}:00.000Z`, ...Array(13).fill('')].join(','))].join('\n'), null);
  await goto(page, 'Stats');
  await page.locator('[data-tile="muscles"]').click();
  const d = page.getByRole('dialog', { name: 'Sets per muscle' });
  await drawn(d);
  await check(page, info, found, 'bodymap-stats', [], '[role=dialog]');
  await png('bodymap-stats');
  await d.getByRole('button', { name: 'Done' }).click();

  await goto(page, 'Today');
  await page.getByRole('region', { name: 'Ready' }).getByRole('button', { name: /^Why/ }).click();
  const why = page.getByRole('dialog', { name: 'Why' });
  await drawn(why);
  await check(page, info, found, 'bodymap-why', [], '[role=dialog]');
  await png('bodymap-why');
  await why.getByRole('button', { name: 'Done' }).click();

  for (const [lift, state] of [['Bench Press', 'bodymap-lift-known'], ['Paused Kroc Row', 'bodymap-lift-guessed']] as const) {
    await goto(page, 'Lifts');
    await page.getByRole('button', { name: new RegExp(`^${lift}`) }).first().click();
    await expect(page.getByRole('heading', { name: lift, level: 1 })).toBeVisible();
    await drawn(page.getByRole('main'));
    await check(page, info, found, state, [], '.lift-map');
    await png(state);
  }
  clean(found);
});

// ---- Achievements (plan stage 2): the Stats tile, its sheet, a family's levels. Counting starts on the profile's first open. ----

/** Sets logged on DAY0 (a row per set, the import's columns): a new lift at three plates, and one more lift tried. */
const unlockDay = () => [
  ...[1, 2, 3].map((k) => [DAY0, 'Deadlift', '', k, 315, 3, '', '', '', 'sample', '', '', `${DAY0}T17:0${k}:00.000Z`, ...Array(13).fill('')].join(',')),
  ...[1, 2].map((k) => [DAY0, 'Romanian Deadlift', '', k, 225, 8, '', '', '', 'sample', '', '', `${DAY0}T17:1${k}:00.000Z`, ...Array(13).fill('')].join(',')),
].join('\n');

/** PNGs to look at when asked for (STATS_PNG=<dir>), and a sheet's body scrolled to its end, checked in view. */
const achShots = (page: Page, info: TestInfo, found: string[]) => {
  const png = async (name: string) => { if (process.env.STATS_PNG) await page.screenshot({ path: `${process.env.STATS_PNG}/${info.project.name}-ach-${name}.png` }); };
  const sheetEnd = async (state: string) => {
    const d = page.getByRole('dialog');
    if (await d.locator('.st-sh-body').evaluate((b) => { const more = b.scrollHeight > b.clientHeight + 1; b.scrollTop = b.scrollHeight; return more; })) {
      await check(page, info, found, `${state}-end`, [], 'main');
      await png(`${state}-end`);
    }
  };
  return { png, sheetEnd };
};

test('Achievements on day one: a history from before the start counts nothing; the tile shows what’s next, locked', async ({ page }, info) => {
  test.setTimeout(120_000);
  const found: string[] = [];
  const { png, sheetEnd } = achShots(page, info, found);
  const tile = page.locator('[data-tile="achievements"]');
  // Day one: his whole history is from before the start, so nothing counts yet; the tile shows the next ones, locked.
  await phone(page);
  await importLog(page);
  await goto(page, 'Stats');
  await expect(tile).toContainText('0earned');
  await tile.scrollIntoViewIfNeeded();
  await check(page, info, found, 'ach-day-one', [], 'main');
  await png('day-one');
  await tile.click();
  await expect(page.getByRole('dialog', { name: 'Achievements' })).toContainText('Counting from today');
  await check(page, info, found, 'ach-day-one-sheet', [], 'main');
  await png('day-one-sheet');
  await sheetEnd('ach-day-one-sheet');
  clean(found);
});

test('Achievements on an unlock day: the tile first in Progress, the sheet to its end, a family’s levels, a lift’s plates', async ({ page }, info) => {
  test.setTimeout(180_000);
  const found: string[] = [];
  const { png, sheetEnd } = achShots(page, info, found);
  const tile = page.locator('[data-tile="achievements"]');
  // A profile that started counting nine weeks ago (the clock then, on its first open), on a day two lifts unlock things.
  await notched(page);
  await page.clock.install({ time: new Date('2026-08-17T07:00:00') });
  await page.goto('/');
  await goto(page, 'Stats');
  await page.clock.setSystemTime(new Date(`${DAY0}T18:00:00`));
  await page.reload();
  await importLog(page, `${history()}\n${unlockDay()}`);
  await goto(page, 'Stats');
  // News first in Progress, the day something unlocks.
  await expect(page.getByRole('region', { name: 'Progress' }).locator('.st-tile').first()).toHaveAttribute('data-tile', 'achievements');
  await expect(tile).toContainText('today');
  await check(page, info, found, 'ach-tile', [], 'main');
  await png('tile');
  await tile.click();
  const d = page.getByRole('dialog', { name: 'Achievements' });
  await expect(d.getByRole('region', { name: 'New today' })).toContainText('Deadlift: 315 lb, 3 plates a side');
  await expect(d).toContainText('Counting from Aug 17');
  await check(page, info, found, 'ach-sheet', [], 'main');
  await png('sheet');
  await d.locator('.st-sh-body').evaluate((b) => { b.scrollTop = 900; });
  await check(page, info, found, 'ach-sheet-mid', [], 'main');
  await png('sheet-mid');
  await sheetEnd('ach-sheet');
  // A family's levels, and back.
  await d.getByRole('region', { name: 'Showing up' }).getByRole('button', { name: /^Goal weeks/ }).click();
  const g = page.getByRole('dialog', { name: 'Goal weeks' });
  await expect(g.getByRole('region', { name: 'Levels' })).toBeVisible();
  await check(page, info, found, 'ach-detail', [], 'main');
  await png('detail');
  await g.getByRole('button', { name: 'Achievements' }).click();
  // A per-lift family: a section per lift.
  await page.getByRole('dialog', { name: 'Achievements' }).getByRole('region', { name: 'Milestones' }).getByRole('button', { name: /^Plates · Deadlift/ }).click();
  const pl = page.getByRole('dialog', { name: 'Plates' });
  await expect(pl.getByRole('region', { name: 'Deadlift', exact: true })).toBeVisible();
  await expect(pl.getByRole('region', { name: 'Bench Press' })).toBeVisible();
  await check(page, info, found, 'ach-detail-plates', [], 'main');
  await png('detail-plates');
  await sheetEnd('ach-detail-plates');
  clean(found);
});

test('Achievements on Today: what a set unlocked, said under its card, the tier in words and its medal', async ({ page }, info) => {
  test.setTimeout(120_000);
  const found: string[] = [];
  const { png } = achShots(page, info, found);
  // Counting from today, the first open: the ten weeks imported count for nothing, so today's first set is a first session,
  // its first PR (it still has to beat them), and four plates a side from here.
  await phone(page);
  await importLog(page);
  await goto(page, 'Today');
  const card = await addCard(page, 'Barbell Squat');
  await logSet(page, card, '18:30:00', '450', '5');
  // The lines are worked out on a timer once the set is saved (its PR line shown), and logSet holds the clock.
  await expect(card.getByRole('status')).toContainText('PR');
  await page.clock.runFor(100);
  const lines = card.locator('.ach-lines');
  await expect(lines.getByRole('button')).toHaveCount(3);
  await expect(lines).toContainText('Barbell Squat: 405 lb, 4 plates a side');
  await check(page, info, found, 'ach-lines', [], '.ach-lines');
  await card.evaluate((c) => c.scrollIntoView({ block: 'start' }));
  await png('lines');
  clean(found);
});

test('Achievements with friends: a chip on a friend’s session, their page’s newest and tile, its sheet; your switch to show them', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const found: string[] = [];
  const [me, fr] = await Promise.all([long('me'), long('medal')].map((n) => account(request, n)));
  const theirs = [...session(at(9, 9), [['Pull-up', [[0, 10]]]]), ...session(at(0, 17), [['Single Leg Romanian Deadlift With Dumbbells', [[225, 5], [315, 3]]], ['Pull-up', [[0, 12]]]])];
  const d = (n: number) => iso(at(n, 12));
  // Their phone's achievements: two silver-and-up today (the feed's chips, one under the longest lift name), and the rest.
  const ach = [
    { i: 'plates', l: 1, d: d(0), n: 'Single Leg Romanian Deadlift With Dumbbells' }, { i: 'bodyweight', l: 2, d: d(0), n: 'Pull-up' },
    { i: 'sessions', l: 1, d: d(0) }, { i: 'prs', l: 1, d: d(3) }, { i: 'goal-weeks', l: 1, d: d(4) }, { i: 'new-lifts', l: 0, d: d(9) },
  ];
  await Promise.all([log(request, me, session(at(2, 17), [['Barbell Squat', [[185, 5]]]])), log(request, fr, theirs, { goal: 3 })]);
  await publish(request, fr, { ...summaryOf(theirs, T, 3), ach } as never);
  await befriend(request, me, fr);
  const page = await open(browser, me);
  const png = async (name: string) => { if (process.env.STATS_PNG) await page.screenshot({ path: `${process.env.STATS_PNG}/${info.project.name}-achf-${name}.png` }); };
  const card = crew(page).getByTestId(`crew-${fr.name}`);
  await expect(card.getByRole('list', { name: 'Achievements today' }).getByRole('listitem')).toHaveCount(2, { timeout: 20_000 });
  await card.getByRole('list', { name: 'Achievements today' }).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await check(page, info, found, 'achf-feed', [], '.ach-chips');
  await png('feed');

  await card.getByRole('button', { name: `@${fr.name}`, exact: true }).click();
  const fp = page.getByRole('region', { name: `@${fr.name}`, exact: true });
  await expect(fp.locator('.fp-ach')).toContainText('Gold · Bodyweight · Pull-up');
  await check(page, info, found, 'achf-page', [], '.fp-ach');
  await expect(fp.locator('.fp-stats [data-tile="achievements"]')).toContainText('Newest: Bodyweight · Gold, today');
  await png('page');
  await fp.locator('.fp-stats [data-tile="achievements"]').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await check(page, info, found, 'achf-tile', [], '.fp-stats');
  await png('tile');
  await fp.locator('.fp-stats [data-tile="achievements"]').click();
  await expect(page.getByRole('dialog', { name: 'Achievements' })).toContainText('counted from their own start');
  await check(page, info, found, 'achf-sheet', [], '.fp-stats');
  await png('sheet');
  await page.getByRole('dialog').locator('.st-sh-body').evaluate((b) => { b.scrollTop = b.scrollHeight; });
  await check(page, info, found, 'achf-sheet-end', [], '.fp-stats');
  await png('sheet-end');
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

  // Yours, signed in: a family's levels end with the switch to show its group.
  await goto(page, 'Stats');
  await page.locator('[data-tile="achievements"]').click();
  await page.getByRole('dialog', { name: 'Achievements' }).getByRole('region', { name: 'Showing up' }).getByRole('button', { name: /^Goal weeks/ }).click();
  const g = page.getByRole('dialog', { name: 'Goal weeks' });
  await expect(g.getByRole('switch', { name: 'Show Showing up to friends' })).toHaveAttribute('aria-checked', 'true');
  await g.locator('.st-sh-body').evaluate((b) => { b.scrollTop = b.scrollHeight; });
  await check(page, info, found, 'achf-share', [], 'main');
  await png('share');
  await g.getByRole('switch', { name: 'Show Showing up to friends' }).click();
  await expect(g.getByRole('switch', { name: 'Show Showing up to friends' })).toHaveAttribute('aria-checked', 'false');
  await check(page, info, found, 'achf-share-off', [], 'main');
  await png('share-off');
  clean(found);
});

test('Together: the line on a friend’s session, the group in your sheet, Trained together’s With list, Full house’s rings', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const found: string[] = [];
  const [me, f1, f2, f3] = await Promise.all([long('me'), long('medal'), long('live'), long('rest')].map((n) => account(request, n)));
  const gym = 'The Iron Den Strength Club Downtown';
  const bench = (d: number, m: number) => atGym(gym, session(at(d, 17, m), [['Bench Press', Array.from({ length: 10 }, (): [number, number] => [135, 8])]]));
  const since = iso(at(20, 12));
  await Promise.all([
    log(request, me, [...bench(1, 0), ...bench(0, 0)], { since }),
    log(request, f1, [...bench(1, 4), ...bench(0, 4)], { since, goal: 2 }),
    log(request, f2, [...bench(1, 8), ...bench(0, 8)], { since, goal: 2 }),
    log(request, f3, atGym('Gold Barn', session(at(0, 7), [['Barbell Squat', [[185, 5]]]])), { since, goal: 3 }),
  ]);
  await Promise.all([f1, f2, f3].map((f) => befriend(request, me, f)));
  const page = await open(browser, me);
  const png = async (name: string) => { if (process.env.STATS_PNG) await page.screenshot({ path: `${process.env.STATS_PNG}/${info.project.name}-tog-${name}.png` }); };
  const line = crew(page).getByTestId(`crew-${f1.name}`).locator('.fd-together');
  await expect(line).toContainText(`You and @${f1.name} at ${gym}`, { timeout: 20_000 });
  await expect(crew(page).locator('.fd-together')).toHaveCount(2);
  await line.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await check(page, info, found, 'tog-feed', [], '.fd-together');
  await png('feed');

  await goto(page, 'Stats');
  await page.locator('[data-tile="achievements"]').click();
  const sheet = page.getByRole('dialog', { name: 'Achievements' });
  await expect(sheet.getByRole('region', { name: 'Together' })).toContainText('Gym crew');
  await check(page, info, found, 'tog-sheet', [], 'main');
  await png('sheet');
  await sheet.getByRole('region', { name: 'Together' }).evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await check(page, info, found, 'tog-group', [], 'main');
  await png('group');
  await sheet.getByRole('region', { name: 'Together' }).getByRole('button', { name: /^Trained together/ }).click();
  const tt = page.getByRole('dialog', { name: 'Trained together' });
  await expect(tt.getByRole('region', { name: 'With' })).toContainText('2 sessions · last today');
  await check(page, info, found, 'tog-with', [], 'main');
  await png('with');
  await tt.locator('.st-sh-body').evaluate((b) => { b.scrollTop = b.scrollHeight; });
  await check(page, info, found, 'tog-with-end', [], 'main');
  await png('with-end');
  await tt.getByRole('button', { name: 'Achievements' }).click();
  await page.getByRole('dialog', { name: 'Achievements' }).getByRole('region', { name: 'Together' }).getByRole('button', { name: /^Full house/ }).click();
  const fh = page.getByRole('dialog', { name: 'Full house' });
  await expect(fh.getByRole('region', { name: 'This week' })).toContainText('2 friends so far');
  await check(page, info, found, 'tog-house', [], 'main');
  await png('house');
  clean(found);
});

// ---- IA A5 and A8 (owner, 2026-10-21): Stats › Body and its Weight sheet; a lift's Lift settings fold. ----

test('Stats › Body: weigh-ins only, sets without weigh-ins, both and the Weight sheet; a lift’s Lift settings folded and open', async ({ page }, info) => {
  test.setTimeout(180_000);
  await phone(page);
  const found: string[] = [];
  // PNGs to look at, when asked for (IA_PNG=<dir>): the screen as the phone shows it.
  const png = async (name: string) => { if (process.env.IA_PNG) await page.screenshot({ path: `${process.env.IA_PNG}/${info.project.name}-${name}.png` }); };
  // Weigh-ins and no sets yet: Stats is the Body section alone.
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'body.csv', mimeType: 'text/csv', buffer: Buffer.from(BODY) });
  await expect(page.locator('.import-result .ok').first()).toBeVisible();
  await goto(page, 'Stats');
  await expect(page.getByRole('region', { name: 'Body' }).locator('[data-tile="weight"]')).toBeVisible();
  await check(page, info, found, 'stats-body-only', [], 'main');
  await png('stats-body-only');
  // The log too: Body is the last section, its one tile and its sheet.
  await importLog(page, history(), null);
  await goto(page, 'Stats');
  const body = page.getByRole('region', { name: 'Body' });
  await expect(body.locator('[data-tile="weight"]')).toBeVisible();
  expect(await page.locator('.st-sec').last().getAttribute('aria-label')).toBe('Body');
  await body.scrollIntoViewIfNeeded();
  await check(page, info, found, 'stats-body', [], 'main');
  await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await png('stats-body');
  await body.locator('[data-tile="weight"]').click();
  const d = page.getByRole('dialog', { name: 'Body weight' });
  await expect(d.getByRole('img', { name: /^Body weight, last/ })).toBeVisible();
  await check(page, info, found, 'stats-weight-sheet', [], 'main');
  await png('stats-weight-sheet');
  if (await d.locator('.st-sh-body').evaluate((b) => { const more = b.scrollHeight > b.clientHeight + 1; b.scrollTop = b.scrollHeight; return more; })) {
    await check(page, info, found, 'stats-weight-sheet-end', [], 'main');
    await png('stats-weight-sheet-end');
  }
  await d.getByRole('button', { name: 'Done' }).click();
  await expect(d).toHaveCount(0);
  // A lift's page: Lift settings folded at its foot, then open.
  await goto(page, 'Lifts');
  await page.getByRole('button', { name: /^Bench Press/ }).first().click();
  const fold = page.locator('details.lift-settings');
  await fold.scrollIntoViewIfNeeded();
  await check(page, info, found, 'lift-settings-folded');
  await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await png('lift-settings-folded');
  await fold.locator('summary').click();
  await expect(fold.getByRole('group', { name: 'Rename or merge' })).toBeVisible();
  await fold.scrollIntoViewIfNeeded();
  await check(page, info, found, 'lift-settings-open');
  await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await png('lift-settings-open');
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await png('lift-top');
  clean(found);
});

test('Stats with sets and no weigh-ins: no Body section, nothing about photos or priorities', async ({ page }, info) => {
  await phone(page);
  const found: string[] = [];
  await importLog(page, history(), null);
  await goto(page, 'Stats');
  await expect(page.locator('[data-tile^="lift:"]').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Body' })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(/Progress photos|Priorities and goal/);
  await check(page, info, found, 'stats-no-weigh-ins', [], 'main');
  if (process.env.IA_PNG) {
    await page.screenshot({ path: `${process.env.IA_PNG}/${info.project.name}-stats-no-weigh-ins.png` });
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await page.screenshot({ path: `${process.env.IA_PNG}/${info.project.name}-stats-no-weigh-ins-end.png` });
  }
  clean(found);
});

// ---- Stats v2 S4/S5 (plan §4): the learning core's tiles and sheets, relative strength, a muscle's weeks, a lift's two readings ----

/** Weigh-ins over the rest-knee fixture's last 12 weeks (synthetic), 190 lb easing to 186. */
const BODY_2024 = ['date,weight_lb', ...Array.from({ length: 30 }, (_, i) => `${add('2024-06-01', 3 * i)},${(190 - i * 0.14).toFixed(1)}`)].join('\n');

test('Stats v2 S4/S5: fatigue per set, best rest, the next session, carry-over, relative strength, a muscle’s weeks, a lift’s two readings', async ({ page }, info) => {
  test.setTimeout(240_000);
  await notched(page);
  await page.clock.install({ time: new Date('2024-08-28T18:00:00') });
  await page.goto('/');
  const found: string[] = [];
  const png = async (name: string) => { if (process.env.STATS_PNG) await page.screenshot({ path: `${process.env.STATS_PNG}/${info.project.name}-${name}.png` }); };
  // 80 timed sessions of a synthetic lifter (coreSim, the rest-knee fixture), weigh-ins, and a program built for the next day.
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles([
    { name: 'sets.csv', mimeType: 'text/csv', buffer: readFileSync(path.join(import.meta.dirname, 'fixtures', 'rest-knee.sample.csv')) },
    { name: 'body.csv', mimeType: 'text/csv', buffer: Buffer.from(BODY_2024) },
  ]);
  await expect(page.getByText('✓ Imported 1098 new sets')).toBeVisible({ timeout: 60_000 });
  await goto(page, 'Today');
  await openProgram(page);
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: 'Weekly volume' })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await goto(page, 'Stats');
  await expect(page.locator('[data-tile="fatigue"]')).toBeVisible();
  await check(page, info, found, 'stats-core', [], 'main');
  await png('core-top');
  const sheet = async (open: () => Promise<void>, state: string) => {
    await open();
    const d = page.getByRole('dialog');
    await expect(d).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/sheet-lock/);
    await check(page, info, found, state, [], 'main');
    await png(state);
    if (await d.locator('.st-sh-body').evaluate((b) => { const more = b.scrollHeight > b.clientHeight + 1; b.scrollTop = b.scrollHeight; return more; })) {
      await check(page, info, found, `${state}-end`, [], 'main');
      await png(`${state}-end`);
    }
    return d;
  };
  const done = async () => { await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); };
  for (const t of ['fatigue', 'bestrest', 'forecast', 'carry', 'relstrength']) {
    const tile = page.locator(`[data-tile="${t}"]`);
    await expect(tile).toBeVisible();
    await tile.scrollIntoViewIfNeeded();
    await png(`tile-${t}`);
    await sheet(() => tile.click(), `stats-core-${t}`);
    await done();
  }
  // A lift's sheet, read as its best set.
  await sheet(() => page.locator('[data-tile^="lift:"]').first().click(), 'stats-core-lift');
  await page.getByRole('dialog').getByRole('group', { name: 'Reading' }).getByRole('button', { name: 'Best set' }).click();
  await page.getByRole('dialog').locator('.st-sh-body').evaluate((b) => { b.scrollTop = 0; });
  await check(page, info, found, 'stats-core-lift-best', [], 'main');
  await png('stats-core-lift-best');
  await done();
  // The Muscles sheet's list at its foot, then a muscle's weeks against its band.
  const mus = await sheet(() => page.locator('[data-tile="muscles"]').click(), 'stats-core-muscles');
  await mus.getByRole('region', { name: /^Each muscle/ }).getByRole('button', { name: /^Chest/ }).click();
  await expect(page.getByRole('dialog', { name: /^Chest · last 12 weeks$/ })).toBeVisible();
  await check(page, info, found, 'stats-core-muscle-weeks', [], 'main');
  await png('stats-core-muscle-weeks');
  if (await page.getByRole('dialog').locator('.st-sh-body').evaluate((b) => { const more = b.scrollHeight > b.clientHeight + 1; b.scrollTop = b.scrollHeight; return more; })) {
    await check(page, info, found, 'stats-core-muscle-weeks-end', [], 'main');
    await png('stats-core-muscle-weeks-end');
  }
  await done();
  // A year: the muscle's weeks at 53 columns.
  await page.getByRole('group', { name: 'Range' }).getByRole('button', { name: '1 yr' }).click();
  await check(page, info, found, 'stats-core-1yr', [], 'main');
  const mus1 = await sheet(() => page.locator('[data-tile="muscles"]').click(), 'stats-core-muscles-1yr');
  await mus1.getByRole('region', { name: /^Each muscle/ }).getByRole('button', { name: /^Chest/ }).click();
  await expect(page.getByRole('dialog', { name: /^Chest · past year$/ })).toBeVisible();
  await check(page, info, found, 'stats-core-muscle-weeks-1yr', [], 'main');
  await png('stats-core-muscle-weeks-1yr');
  clean(found);
});

// ---- The prompts: a light week, pain, a variation, the volume steps, a test. ----

test('Prompts: the light week offered and started, the volume steps on Stats', async ({ page }, info) => {
  test.setTimeout(180_000);
  const WEEKS = 8, TODAY = simDay(WEEKS * 7);
  const sets = deloadLog(1, SIM_LIFTS, { weeks: WEEKS, shift: (w) => (w === WEEKS - 1 ? -0.06 : 0) })
    .map((e) => `${e.date},${e.exercise},,${e.setNo},${e.weight},${e.reps},,,,sample`);
  const body = ['date,weight_lb,calories,protein_g,energy,edited_at', `${simDay(10)},,,,4,`, `${simDay(20)},,,,4,`, `${simDay(WEEKS * 7 - 3)},,,,2,`].join('\n');
  await notched(page);
  await page.clock.install({ time: new Date(`${TODAY}T18:00:00`) });
  await page.goto('/');
  await importLog(page, ['date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source', ...sets].join('\n'), body);
  const found: string[] = [];
  await goto(page, 'Today');
  await page.getByRole('group', { name: 'Energy' }).getByRole('button', { name: '2', exact: true }).click();
  const offer = page.getByRole('group', { name: 'Light week' });
  await expect(offer).toContainText('Down across your lifts');
  await check(page, info, found, 'prompt-deload');
  await offer.getByRole('button', { name: 'Start light week' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Light week' })).toContainText('half the sets');
  await check(page, info, found, 'prompt-light-week');
  // The READY tile in a light week: "Go light", its render check (and a PNG when asked for, READY_PNG=<dir>).
  const tile = page.getByRole('region', { name: 'Ready' });
  await expect(tile.locator('.ready-verdict')).toHaveText(/go light/i);
  expect((await tile.innerText()).match(CLOCK)).toBeNull();
  await check(page, info, found, 'ready-light', [], '.ready-card, .week-strip');
  if (process.env.READY_PNG) await page.screenshot({ path: `${process.env.READY_PNG}/${info.project.name}-ready-light.png` });
  await goto(page, 'Priorities');
  await page.getByRole('combobox', { name: 'Chest' }).selectOption({ index: 0 });
  const one = page.getByRole('group', { name: 'Weekly sets' }).getByRole('listitem').filter({ hasText: /^1 ·/ });
  await one.getByRole('button', { name: 'Edit' }).click();
  await check(page, info, found, 'priorities-edit');
  await one.getByRole('textbox', { name: 'Min' }).fill('12');
  await one.getByRole('textbox', { name: 'Max' }).fill('20');
  await one.getByRole('button', { name: 'Save' }).click();
  await expect(one).toContainText('12–20 sets · yours');
  await goto(page, 'Stats');
  await page.locator('[data-tile="muscles"]').click();
  await expect(page.getByRole('group', { name: 'Next 3 weeks' })).toBeVisible();
  await check(page, info, found, 'prompt-volume', [], 'main');
  clean(found);
});

test('Prompts: a program planned at the step, and its update three weeks on', async ({ page }, info) => {
  test.setTimeout(180_000);
  const WEEKS = 8, TODAY = simDay(WEEKS * 7);
  const sets = deloadLog(1, SIM_LIFTS, { weeks: WEEKS }).map((e) => `${e.date},${e.exercise},,${e.setNo},${e.weight},${e.reps},,,,sample`);
  await notched(page);
  // Built 22 days ago, mid-training: today a block has ended over weeks he trained.
  await page.clock.install({ time: new Date(`${simDay(WEEKS * 7 - 22)}T18:00:00`) });
  await page.goto('/');
  await importLog(page, ['date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source', ...sets].join('\n'), null);
  const found: string[] = [];
  await goto(page, 'Today');
  await openProgram(page);
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('group', { name: 'Short of the range' })).toContainText('/wk');
  await check(page, info, found, 'program-aims');
  // Then he raises Chest to priority 1 at 12–20: three weeks on, the program can step toward it.
  await page.clock.setSystemTime(new Date(`${TODAY}T18:00:00`));
  await page.reload();
  await goto(page, 'Priorities');
  await page.getByRole('combobox', { name: 'Chest' }).selectOption('1');
  const one = page.getByRole('group', { name: 'Weekly sets' }).getByRole('listitem').filter({ hasText: /^1 ·/ });
  await one.getByRole('button', { name: 'Edit' }).click();
  await one.getByRole('textbox', { name: 'Min' }).fill('12');
  await one.getByRole('textbox', { name: 'Max' }).fill('20');
  await one.getByRole('button', { name: 'Save' }).click();
  await goto(page, 'Today');
  await expect(page.getByRole('group', { name: 'Program update' })).toBeVisible();
  await check(page, info, found, 'prompt-program-update');
  clean(found);
});

test('Prompts: pain that keeps coming back, sharp pain, a variation for a stalled lift, a test due', async ({ page }, info) => {
  test.setTimeout(180_000);
  const H = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,pain_region,pain_severity';
  const rows = (date: string, lift: string, sets: string[], pain?: 2 | 3) => sets.map((s, i) => {
    const [w, r] = s.split('x');
    const hurt = pain && i === sets.length - 1;
    return `${date},${lift},,${i + 1},${w},${r},,${hurt ? 'pain' : ''},,sample,${hurt ? 'elbow' : ''},${hurt ? pain : ''}`;
  });
  const weeks = ['2026-08-05', '2026-08-12', '2026-08-19', '2026-08-26', '2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30', '2026-10-07'];
  const csv = [H,
    ...weeks.flatMap((d, k) => [...rows(d, 'Leg Press', ['300x10', '300x10', '300x10']), ...rows(d, 'Cable Pushdown', ['110x15', '110x15', '110x15'], k >= 5 ? 2 : undefined)]),
    ...rows('2026-03-02', 'Machine Chest Press', ['150x10', '150x10', '150x9']), ...rows('2026-03-09', 'Machine Chest Press', ['150x11', '150x10', '150x10']),
    // Twelve weeks of steady bench progress first: the plateau after it reads P > 0.6 (2026-10-28's stall bar).
    ...Array.from({ length: 12 }, (_, i) => rows(new Date(Date.UTC(2026, 5, 2 + 7 * i)).toISOString().slice(0, 10), 'Bench Press', [`${130 + 5 * i}x8`, `${130 + 5 * i}x8`, `${130 + 5 * i}x7`])).flat(),
    ...rows('2026-08-25', 'Bench Press', ['185x8', '185x8', '185x7']), ...rows('2026-09-01', 'Bench Press', ['185x8', '185x8', '185x8']),
    ...rows('2026-09-08', 'Bench Press', ['185x8', '185x8', '185x8']), ...rows('2026-09-15', 'Bench Press', ['185x9', '185x8', '185x8']),
    ...rows('2026-09-22', 'Bench Press', ['185x9', '185x8', '185x8']), ...rows('2026-09-29', 'Bench Press', ['185x9', '185x8', '185x7']),
    ...rows('2026-10-06', 'Bench Press', ['185x8', '185x8', '185x8']),
    // Two sessions, and today the third: the first a test can be due on, so its one prompt in 6 weeks is today's (2026-10-28).
    '2026-10-08,Dumbbell Bench Press,,1,85,8,,,,sample,,', '2026-10-11,Dumbbell Bench Press,,1,90,8,,,,sample,,',
  ].join('\n');
  await notched(page);
  await page.clock.install({ time: new Date('2026-10-14T18:00:00') });
  await page.goto('/');
  await importLog(page, csv, null);
  const found: string[] = [];
  await goto(page, 'Today');
  await openProgram(page);
  await page.getByRole('textbox', { name: 'Days per week' }).fill('1');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('list', { name: 'Day A exercises' }).getByText('Bench Press', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.locator('.plan-name[data-exercise="Bench Press"]').click();
  const bench = page.locator('[data-card="bench press"]');
  await expect(bench.getByRole('group', { name: 'Suggested variation' })).toContainText('Bench Press flat for 6 weeks — switch to');
  await check(page, info, found, 'prompt-rotation');
  const push = await addCard(page, 'Cable Pushdown');
  await expect(push.getByRole('group', { name: 'Pain keeps coming back' })).toBeVisible();
  await check(page, info, found, 'prompt-pain');
  await push.getByRole('button', { name: 'Details' }).click();
  await push.getByRole('button', { name: 'Pain', exact: true }).click();
  await push.getByRole('group', { name: 'Pain region' }).getByRole('button', { name: 'Elbow' }).click();
  await push.getByRole('group', { name: 'Pain severity' }).getByRole('button', { name: 'Sharp' }).click();
  await check(page, info, found, 'prompt-pain-sharp-form');
  await logSet(page, push, '2026-10-14T18:30:00');
  await expect(push.locator('.pain-stop')).toBeVisible();
  await check(page, info, found, 'prompt-pain-stop');
  await bench.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Suggested variation' })).toBeVisible();
  await check(page, info, found, 'lift-rotation');
  await goto(page, 'Lifts');
  await page.getByRole('button', { name: /^Dumbbell Bench Press/ }).click();
  await expect(page.getByText('Time for a test')).toBeVisible();
  await check(page, info, found, 'lift-test-due');
  clean(found);
});

test('Prompts: the morning pain question, answered with a note (item 08)', async ({ page }, info) => {
  const H = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,pain_region,pain_severity';
  const csv = [H, ...['2026-10-06', '2026-10-13'].flatMap((d) => [
    `${d},Single Arm Cable Lateral Raise Behind Back,,1,22.5,15,,,,sample,,`,
    `${d},Overhead Cable Triceps Extension With Rope,,1,1225,15,,pain,,sample,lower back,2`,
    `${d},Cable Pushdown,,1,110,15,,pain,,sample,elbow,3`,
  ])].join('\n');
  await notched(page);
  await page.clock.install({ time: new Date('2026-10-14T11:00:00') });
  await page.goto('/');
  await importLog(page, csv, null);
  const found: string[] = [];
  await goto(page, 'Today');
  const q = page.getByRole('group', { name: 'Morning check' });
  await expect(q).toHaveCount(2); // elbow (sharp) first, then the lower back
  await check(page, info, found, 'prompt-morning');
  await q.first().getByRole('button', { name: 'Still sore' }).click();
  await page.getByRole('group', { name: 'Morning check' }).getByRole('textbox').fill('stiff and sore on waking, worse lifting the kettle, 1,000,000 % better by noon');
  await check(page, info, found, 'prompt-morning-note');
  clean(found);
});

// ---- The audit itself: it sees each kind of fault, and nothing on a clean page. ----

// Owner, 2026-10-22: "two collapsed exercises look differently" (a chevron wrapped alone to a second line, a PR chip alone on
// one), and "award popup overlaps" (a lift's last set unlocked a PR: the row sat on its folded card's edge and ran into the
// Left chips under it). Every folded state at 375 and 320 px: done, done with a PR and its unlock and Left row, part done and
// folded by hand, not started, a long name, no planned count.
test('Today’s folded cards: one layout for every state, and a last set’s unlock row inside its card, clear of the Left row', async ({ page }, info) => {
  test.setTimeout(180_000);
  await phone(page);
  const found: string[] = [];
  await importLog(page);
  await goto(page, 'Today');
  await openProgram(page);
  await page.getByRole('textbox', { name: 'Days per week' }).fill('3');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A/ })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
  const rows = page.getByRole('list', { name: 'Planned exercises' }).getByRole('listitem');
  expect(await rows.count()).toBeGreaterThanOrEqual(3);
  // The first lift swapped for squats (a history to beat): light sets, then a PR on the last planned one.
  await rows.first().getByRole('button', { name: 'Swap' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Barbell Squat');
  await page.getByRole('button', { name: /^Barbell Squat/ }).first().click();
  const sq = page.locator('[data-card="barbell squat"]');
  const sets = Number((await rows.first().locator('.plan-count').textContent())!.split('/')[1]);
  for (let i = 0; i < sets; i++) {
    await logSet(page, sq, `18:${String(10 + 3 * i).padStart(2, '0')}:00`, i < sets - 1 ? '135' : '450', '5');
    if (i < sets - 1) await expect(sq.getByRole('list', { name: 'Sets for Barbell Squat' }).getByRole('listitem')).toHaveCount(i + 1);
  }
  // The lines are worked out on a timer once the set is saved (its PR line shown), and logSet holds the clock.
  await expect(sq.getByRole('status')).toContainText('PR');
  await page.clock.runFor(100);
  await expect(sq.locator('.fold-line')).toBeVisible();
  await expect(sq.locator('.ach-lines').getByRole('button').first()).toBeVisible();
  await expect(sq.getByRole('group', { name: 'Left to do' })).toBeVisible();
  await sq.evaluate((c) => c.scrollIntoView({ block: 'center' }));
  await check(page, info, found, 'today-folded-unlock');
  // A long name with no planned count, and a bodyweight lift (added first: the picker takes Today's place, and a card folded by
  // hand opens again when it comes back); the plan's second lift part done, its third opened unstarted; all folded by hand.
  const extra = [['Single Arm Cable Lateral Raise Behind Back', '22.5', '15'], ['Pull-up', '0', '12']] as const;
  for (const [lift, w, r] of extra) {
    const card = await addCard(page, lift);
    await logSet(page, card, '18:50:00', w, r);
    await expect(card.getByRole('list', { name: `Sets for ${lift}` }).getByRole('listitem')).toHaveCount(1);
  }
  const nameOf = async (k: number) => (await rows.nth(k).locator('.plan-name').getAttribute('data-exercise'))!;
  const b = await nameOf(1), c = await nameOf(2);
  await rows.nth(1).locator('.plan-name').click();
  const cb = page.locator(`[data-card="${b.toLowerCase()}"]`);
  await logSet(page, cb, '18:55:00', '100', '10');
  await expect(cb.getByRole('list', { name: `Sets for ${b}` }).getByRole('listitem')).toHaveCount(1);
  await rows.nth(2).locator('.plan-name').click();
  for (const lift of [b, c, ...extra.map(([l]) => l)]) await page.locator(`[data-card="${lift.toLowerCase()}"]`).getByRole('button', { name: `Fold ${lift}` }).click();
  const lines = page.locator('.card.folded .fold-line');
  await expect(lines).toHaveCount(5);
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 812 });
    // At 320 the plan is folded: these are the cards' states (the plan's rows at 320 are not this test's).
    if (width === 320) await page.getByRole('button', { name: /^Today’s plan/ }).click();
    // One layout: the glyph and the chevron centred down the line, at the same x on every card; the name on the first row, the
    // count under it; the best set's right edge the same everywhere.
    const geo = await lines.evaluateAll((els) => els.map((el) => {
      const r = (q: string) => { const e = el.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, m: (b.top + b.bottom) / 2 }; };
      const line = el.getBoundingClientRect(), card = el.closest('.card')!.getBoundingClientRect();
      return { name: el.getAttribute('aria-label'), mid: (line.top + line.bottom) / 2, card: card.right, glyph: r('.fold-check'), chev: r('.fold-chev'), title: r('.fold-name'), count: r('.fold-meta > :first-child'), best: r('.fold-best'), pr: r('.pr-tag') };
    }));
    const bad: string[] = [];
    const near = (a: number, b: number, d = 1) => Math.abs(a - b) <= d;
    for (const g of geo) {
      if (!g.glyph || !g.chev || !g.title || !g.count) { bad.push(`${g.name}: a part is missing`); continue; }
      if (!near(g.glyph.m, g.mid) || !near(g.chev.m, g.mid)) bad.push(`${g.name}: glyph/chevron not centred (${g.glyph.m}, ${g.chev.m} vs ${g.mid})`);
      if (!near(g.chev.r, g.card - 16, 2)) bad.push(`${g.name}: chevron not at the right edge (${g.chev.r} vs ${g.card - 16})`);
      if (!near(g.glyph.l, geo[0].glyph!.l) || !near(g.title.l, geo[0].title!.l)) bad.push(`${g.name}: glyph or name not where the others are`);
      if (!(g.count.t >= g.title.b - 1)) bad.push(`${g.name}: the count is not under the name`);
      if (g.best && !near(g.best.r, g.chev.l - 12, 2)) bad.push(`${g.name}: best set not against the chevron's column (${g.best.r} vs ${g.chev.l - 12})`);
      if (g.pr && !near(g.pr.m, g.count.m, 2)) bad.push(`${g.name}: PR chip not beside the count`);
    }
    expect(bad, `${width}px:\n${bad.join('\n')}`).toEqual([]);
    await check(page, info, found, `today-folded-${width}`);
  }
  clean(found);
});

test('the audit finds each kind of fault on a page built with them, and none on a clean one', async ({ page }) => {
  const shell = (body: string) => `<!doctype html><meta name=viewport content="width=device-width"><style>
    body { margin: 0; font: 16px/20px sans-serif; background: #111; color: #eee; } main { padding: 59px 16px 120px; }
    nav { position: fixed; left: 0; right: 0; bottom: 0; height: 91px; background: #222; display: flex; }
    nav button { flex: 1; height: 56px; } .row { display: flex; gap: 2px; margin: 8px 0; }
    .t { width: 44px; height: 44px; background: #333; position: relative; border-radius: 8px; }
  </style><main>${body}</main><nav><button>A</button><button>B</button></nav>`;
  const kinds = async (body: string) => {
    await page.setContent(shell(body));
    return [...new Set((await audit(page)).map((f) => f.kind))].sort();
  };
  // Clean: tiles 2px apart, a 44px button, text that fits, a short page.
  expect(await kinds('<div class=row><span class=t></span><span class=t></span></div><button style="width:44px;height:44px">x</button><p>Fits.</p>')).toEqual([]);
  // A 44px hit area made up by a ::before round a 24px button is not a finding.
  expect(await kinds('<style>.s{position:relative;width:24px;height:24px;margin:20px;border:0;padding:0}.s::before{content:"";position:absolute;inset:-10px}</style><button class=s>x</button>')).toEqual([]);
  // ...but one that reaches only 20px out is.
  expect(await kinds('<style>.s{position:relative;width:24px;height:24px;margin:20px;border:0;padding:0}.s::before{content:"";position:absolute;inset:-8px}</style><button class=s>x</button>')).toEqual(['target']);
  // The owner's board: a ring wider than its tile's gap, a corner medal over the next tile.
  expect(await kinds('<div class=row><span class=t style="box-shadow:0 0 0 2px #111,0 0 0 3.5px #aaa"></span><span class=t></span></div>')).toEqual(['overlap']);
  expect(await kinds('<div class=row><span class=t><i style="position:absolute;top:-4px;right:-4px;width:16px;height:16px;background:gold;border-radius:50%"></i></span><span class=t></span></div>')).toEqual(['overlap']);
  // A ring drawn by a ::after past the gap.
  expect(await kinds('<style>.p::after{content:"";position:absolute;inset:-4px;border:2px solid lime;border-radius:50%}</style><div class=row><span class="t p"></span><span class=t></span></div>')).toEqual(['overlap']);
  expect(await kinds('<div style="width:60px;overflow:hidden;white-space:nowrap">A long label cut off</div>')).toEqual(['clipped']);
  expect(await kinds('<span style="display:inline-block;width:40px;background:#555;white-space:nowrap">1,225 lb</span>')).toEqual(['spill']);
  expect(await kinds('<div style="width:40px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">1225 × 12</div>')).toEqual(['truncated']);
  expect(await kinds('<div style="margin-left:340px;width:80px;background:#555;height:20px"></div>')).toEqual(['offscreen', 'side-scroll']);
  expect(await kinds('<button style="width:44px;height:30px">x</button>')).toEqual(['target']);
  expect(await kinds('<p style="position:relative;top:-40px">Under the notch</p>')).toEqual(['notch']);
  expect(await kinds('<style>main{padding-bottom:0}</style><p style="margin-top:900px">Last line</p>')).toEqual(['under-bar']);
  // A bar stuck to the very top: its words go under the status bar once the page scrolls.
  expect(await kinds('<div style="position:sticky;top:0;background:#222;padding:12px 0 8px">Search</div><div style="height:2000px"></div>')).toEqual(['notch']);
  expect(await kinds('<div style="position:sticky;top:0;background:#222;padding:59px 0 8px;margin-top:-59px">Search</div><div style="height:2000px"></div>')).toEqual([]);
  // Two blocks with no gap (an unlock row on the chips under it), and the same 8px apart; a block on its card's side, and inset.
  expect(await kinds('<div class=a style="background:#555;height:40px;border-radius:8px"></div><div class=b style="border-radius:8px;background:#666;height:40px"></div>')).toEqual(['touch']);
  expect(await kinds('<div class=a style="background:#555;height:40px;border-radius:8px"></div><div class=b style="border-radius:8px;background:#666;height:40px;margin-top:8px"></div>')).toEqual([]);
  expect(await kinds('<div class=card style="background:#222;border-radius:12px"><div style="background:#444;height:40px;border-radius:8px"></div></div>')).toEqual(['edge']);
  expect(await kinds('<div class=card style="background:#222;border-radius:12px;padding:12px 16px"><div style="background:#444;height:40px;border-radius:8px"></div></div>')).toEqual([]);
  // A list's flush rows and a full-bleed band (square corners) are not shapes touching.
  expect(await kinds('<div class=a style="background:#555;height:40px"></div><div class=b style="background:#666;height:40px"></div><div class=card style="background:#222;border-radius:12px"><div style="background:#444;height:40px"></div></div>')).toEqual([]);
  // A sheet over a backdrop, its button down in the home indicator's strip; and the same sheet padded clear of it.
  // The render check: text over text, text over a chart, text out of its tile, an ellipsis, a 36px button.
  const strict = async (body: string) => {
    await page.setContent(shell(body));
    return [...new Set((await renderCheck(page, 'main')).map((f) => f.kind))].sort();
  };
  expect(await strict('<button style="display:block;width:160px;height:60px">Fits</button><svg width=100 height=24></svg><p>Clear of it.</p>')).toEqual([]);
  expect(await strict('<p style="margin:0;line-height:20px">One</p><p style="margin:-14px 0 0;line-height:20px">Two</p>')).toEqual(['text-text']);
  expect(await strict('<svg width=200 height=40 style="display:block"></svg><p style="margin:-30px 0 0">Over the chart</p>')).toEqual(['text-chart']);
  expect(await strict('<button style="display:block;width:44px;height:44px;white-space:nowrap;padding:0">A long label</button>')).toEqual(['escape']);
  expect(await strict('<div style="width:40px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Bench Press</div>')).toEqual(['clip']);
  expect(await strict('<button style="width:60px;height:36px">Go</button>')).toEqual(['tap']);
  const sheet = (pad: string) => `<div style="position:fixed;inset:0;z-index:7;background:rgb(0 0 0 / .6)"></div><div role=dialog style="position:fixed;left:0;right:0;bottom:0;z-index:8;background:#333;padding:8px 8px ${pad}"><button style="width:100%;height:44px">Save</button></div>`;
  expect(await kinds(sheet('8px'))).toEqual(['home']);
  expect(await kinds(sheet('42px'))).toEqual([]);
});
