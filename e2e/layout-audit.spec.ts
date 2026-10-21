import { expect, test, type APIRequestContext, type Browser, type Locator, type Page } from '@playwright/test';
import { addFriend, goto, openProgram } from './nav';
import { audit, check, clean, notched, renderCheck, TOP } from './layout';
import { deloadLog, SIM_LIFTS, simDay } from '../src/domain/learn/deloadSim.sample';
import { account, befriend, iso, log, ping, put, rand, session, signedIn, Ts, type Seeded } from './seed';
import { convertedRows, pasteRows, toCsv as dupesCsv, TWINS } from './fixtures/dupes';
import { friendLog, publish, summaryOf } from './fixtures/compare';
import { sixWeeks, WED } from './fixtures/today';

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

  // Medal's page: yesterday's PR tile next to today's ringed tile.
  await crew(page).getByTestId(`crew-${medal.name}`).getByRole('button', { name: `@${medal.name}`, exact: true }).click();
  const fp = page.getByRole('region', { name: `@${medal.name}`, exact: true });
  await expect(fp.getByRole('region', { name: 'Last 8 weeks' })).toBeVisible();
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
  // The owner's screenshot, put back: the board's old rings and medal outside the tile. The audit has to see both.
  const old = await page.addStyleTag({ content: `.fp .fp-tile.today { box-shadow: 0 0 0 2px var(--surface), 0 0 0 3.5px var(--text-2) }
    .fp .fp-star { top: -4px; right: -4px; width: 16px; height: 16px; box-shadow: 0 0 0 2px var(--surface) }` });
  const was = (await audit(page)).filter((f) => f.kind === 'overlap').map((f) => `${f.a} ⨯ ${f.b}`).join('\n');
  expect(was).toMatch(/fp-tile\.empty\.today/);
  expect(was).toMatch(/fp-star/);
  await old.evaluate((el) => (el as Element).remove());
  await fp.getByRole('region', { name: 'Last 8 weeks' }).getByRole('button', { name: /PR$/ }).first().click();
  await check(page, info, found, 'friend-page-picked');

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
  for (const screen of ['Priorities', 'Characters', 'Gym', 'Program', 'Photos'] as const) {
    await goto(page, screen);
    if (screen === 'Characters') await expect(page.getByRole('heading', { name: 'Credits' })).toBeVisible(); // loaded, credits and all
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
  await check(page, info, found, 'finish-summary');
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
  await openWeek();
  await expect(strip.getByRole('listitem').first()).toContainText('Today');
  await expect(strip.locator('.ws-days > li')).toHaveCount(6); // Tuesday to Sunday
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
  await expect(strip.locator('.ws-days > li')).toHaveCount(6);
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
  await expect(strip.locator('.ws-days > li').first()).toHaveAttribute('data-mark', 'optional');
  await expect(strip.locator('.ws-why')).toContainText('Goal met');
  await look('ready-goal-met');

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
  await day.getByRole('button', { name: 'Fix sets' }).click();
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
  for (const t of ['rate', 'plateaus', 'milestones', 'hitrate', 'effort', 'rest', 'pullpush', 'lifts', 'days', 'start', 'energy']) {
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
    ...rows('2026-08-25', 'Bench Press', ['185x8', '185x8', '185x7']), ...rows('2026-09-01', 'Bench Press', ['185x8', '185x8', '185x8']),
    ...rows('2026-09-08', 'Bench Press', ['185x8', '185x8', '185x8']), ...rows('2026-09-15', 'Bench Press', ['185x9', '185x8', '185x8']),
    ...rows('2026-09-22', 'Bench Press', ['185x9', '185x8', '185x8']), ...rows('2026-09-29', 'Bench Press', ['185x9', '185x8', '185x7']),
    ...rows('2026-10-06', 'Bench Press', ['185x8', '185x8', '185x8']),
    // One working set every 3 days, each a PR: a test is due on its screen.
    ...Array.from({ length: 15 }, (_, i) => `${new Date(Date.UTC(2026, 7, 31 + i * 3)).toISOString().slice(0, 10)},Dumbbell Bench Press,,1,${85 + 5 * i},8,,,,sample,,`),
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
  await expect(bench.getByRole('group', { name: 'Suggested variation' })).toContainText('Bench Press flat for 4 weeks — switch to');
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
