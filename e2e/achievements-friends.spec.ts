import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { DOCS, FIRESTORE } from './emu';
import { publish, summaryOf } from './fixtures/compare';
import { goto } from './nav';
import { account, atGym, befriend, iso, log, placed, session, signedIn, type Seeded } from './seed';

// Achievements with friends (plan stages 4-5, owner Q2-Q11): what a friend shows, from their Compare summary, on their page and,
// silver and up on the day, beside their session in your feed; and a group you keep back, gone from yours. Synthetic only.
const T = new Date(new Date().setHours(18, 0, 0, 0));
const at = (daysAgo: number, h: number, m = 0) => { const d = new Date(T.getTime() - daysAgo * 864e5); d.setHours(h, m, 0, 0); return d; };
const day = (daysAgo: number) => iso(at(daysAgo, 12));
test.use({ serviceWorkers: 'block' });
const crew = (page: Page) => page.getByRole('region', { name: 'Crew' });

/** You, and a friend who trained today and whose phone published these achievements (two of them made up, to be dropped). */
async function pair(request: APIRequestContext) {
  const [me, fr] = await Promise.all(['me', 'fr'].map((n) => account(request, `${n}${Math.random().toString(36).slice(2, 8)}`)));
  const theirs = [
    ...session(at(9, 9), [['Barbell Squat', [[135, 5], [135, 5]]]]),
    ...session(at(0, 17), [['Bench Press', [[225, 3], [225, 3]]], ['Pull Up', [[0, 6]]]]),
  ];
  const ach = [
    { i: 'plates', l: 1, d: day(0), n: 'Bench Press' }, // silver, today: the feed's chip, and the page's newest
    { i: 'sessions', l: 0, d: day(0) }, // a starter today: shown on the page, never in the feed
    { i: 'prs', l: 1, d: day(3) }, // bronze
    { i: 'bodyweight', l: 2, d: day(9), n: 'Pull Up' }, // gold, but over a week ago: not the page's newest
    { i: 'made-up', l: 0, d: day(0) }, // no such family
    { i: 'plates', l: 1, d: day(0) }, // a per-lift family with no lift
  ];
  await Promise.all([log(request, me, session(at(2, 17), [['Barbell Squat', [[185, 5]]]])), log(request, fr, theirs, { goal: 2 })]);
  await publish(request, fr, { ...summaryOf(theirs, T, 2), ach } as never);
  await befriend(request, me, fr);
  return { me, fr };
}

test('a friend’s achievements: silver and up from today beside their session in the feed, all they show on their page', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { me, fr } = await pair(request);
  const page = await signedIn(browser, me, T);
  const card = crew(page).getByTestId(`crew-${fr.name}`);
  await expect(card).toContainText('Bench Press', { timeout: 20_000 });
  // The feed: today's silver plates, not today's starter, nor the gold from nine days ago.
  const chips = card.getByRole('list', { name: 'Achievements today' });
  await expect(chips.getByRole('listitem')).toHaveCount(1);
  await expect(chips).toHaveText('Silver · Plates · Bench Press');
  // Yours carries none: your own are on your Stats.
  await expect(crew(page).getByRole('list', { name: 'Achievements today' })).toHaveCount(1);

  // Their page: the summary the feed just read, so no read of it again, and never anything of theirs but what the feed reads.
  await page.waitForLoadState('networkidle');
  const reads: string[] = [];
  page.on('request', (r) => { if (r.url().startsWith(`${FIRESTORE}/`)) reads.push(decodeURIComponent(`${r.url()} ${r.postData() ?? ''}`)); });
  await card.getByRole('button', { name: `@${fr.name}`, exact: true }).click();
  const fp = page.getByRole('region', { name: `@${fr.name}`, exact: true });
  await expect(fp.locator('.fp-ach')).toHaveText('Silver · Plates · Bench Press');
  const tile = fp.locator('.fp-stats [data-tile="achievements"]');
  // Four shown: the two made up are dropped. First in Progress, the newest said.
  await expect(tile).toContainText('4shown');
  await expect(tile).toContainText('Newest: Plates · Silver, today');
  await expect(fp.getByRole('region', { name: 'Progress' }).locator('.st-tile').first()).toHaveAttribute('data-tile', 'achievements');
  await tile.click();
  const sheet = page.getByRole('dialog', { name: 'Achievements' });
  await expect(sheet.getByRole('list', { name: 'Highest by tier' })).toContainText('1Starter1Bronze1Silver1Gold0Platinum');
  await expect(sheet.getByRole('region', { name: 'Milestones' })).toContainText('Plates');
  await expect(sheet.getByRole('region', { name: 'Milestones' })).toContainText('Bench Press');
  await expect(sheet.getByRole('region', { name: 'Milestones' })).toContainText('Pull Up');
  // Theirs to look at, not to open: no button in the sheet but Done.
  await expect(sheet.getByRole('button')).toHaveText(['Done']);
  await page.waitForTimeout(1000);
  expect(reads.filter((r) => r.includes(`users/${fr.uid}/summary`))).toEqual([]);

  // Their newest, tapped on their page, and their chip tapped in the feed: their Achievements, at that family, lit for a moment.
  await sheet.getByRole('button', { name: 'Done' }).click();
  await fp.locator('.fp-ach').getByRole('button').click();
  const at = sheet.locator('[data-ach="plates"][data-lift="Bench Press"]');
  await expect(at).toHaveClass(/ach-hit/);
  await expect(at).toBeInViewport({ ratio: 1 });
  await sheet.getByRole('button', { name: 'Done' }).click();
  await fp.getByRole('button', { name: 'Friends' }).first().click();
  await chips.getByRole('button', { name: /Silver · Plates · Bench Press/ }).click();
  await expect(fp.locator('.fp-ach')).toBeVisible();
  await expect(at).toHaveClass(/ach-hit/);
  await expect(at).toBeInViewport({ ratio: 1 });
});

test('a friend who shows nothing: no tile, no chip, and their page as before', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const [me, fr] = await Promise.all(['me', 'fr'].map((n) => account(request, `${n}${Math.random().toString(36).slice(2, 8)}`)));
  const theirs = session(at(0, 17), [['Bench Press', [[225, 3]]]]);
  await log(request, fr, theirs, { goal: 2 });
  await publish(request, fr, summaryOf(theirs, T, 2)); // an older phone's summary: no achievements in it
  await befriend(request, me, fr);
  const page = await signedIn(browser, me, T);
  const card = crew(page).getByTestId(`crew-${fr.name}`);
  await expect(card).toContainText('Bench Press', { timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  await expect(card.getByRole('list', { name: 'Achievements today' })).toHaveCount(0);
  await card.getByRole('button', { name: `@${fr.name}`, exact: true }).click();
  const fp = page.getByRole('region', { name: `@${fr.name}`, exact: true });
  await expect(fp.locator('.fp-stats [data-tile="calendar"]')).toBeVisible();
  await expect(fp.locator('[data-tile="achievements"]')).toHaveCount(0);
  await expect(fp.locator('.fp-ach')).toHaveCount(0);
});

test('a friend whose newest silver is over a week old: their tile says it, but no chip on their page or in the feed', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const [me, fr] = await Promise.all(['me', 'fr'].map((n) => account(request, `${n}${Math.random().toString(36).slice(2, 8)}`)));
  const theirs = [...session(at(9, 9), [['Pull Up', [[0, 10]]]]), ...session(at(0, 17), [['Bench Press', [[135, 5]]]])];
  await log(request, fr, theirs, { goal: 2 });
  await publish(request, fr, { ...summaryOf(theirs, T, 2), ach: [{ i: 'bodyweight', l: 2, d: day(9), n: 'Pull Up' }, { i: 'plates', l: 0, d: day(0), n: 'Bench Press' }] } as never);
  await befriend(request, me, fr);
  const page = await signedIn(browser, me, T);
  const card = crew(page).getByTestId(`crew-${fr.name}`);
  await expect(card).toContainText('Bench Press', { timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  await card.getByRole('button', { name: `@${fr.name}`, exact: true }).click();
  const fp = page.getByRole('region', { name: `@${fr.name}`, exact: true });
  await expect(fp.locator('.fp-stats [data-tile="achievements"]')).toContainText('Newest: Plates · Bronze, today');
  await expect(fp.locator('.fp-ach')).toHaveCount(0);
  await page.locator('.fp-back').click();
  await expect(crew(page).getByTestId(`crew-${fr.name}`)).toContainText('Bench Press');
  await expect(crew(page).getByRole('list', { name: 'Achievements today' })).toHaveCount(0);
});

/** Your summary as the emulator has it: its achievements' families, each `id` or `id:lift`. */
async function sharedOf(request: APIRequestContext, who: Seeded): Promise<string[] | null> {
  const r = await request.get(`${DOCS}/users/${who.uid}/summary/compare`, { headers: { Authorization: 'Bearer owner' } });
  if (!r.ok()) return null;
  const doc = await r.json() as { fields?: { ach?: { arrayValue: { values?: { mapValue: { fields: Record<string, { stringValue?: string }> } }[] } } } };
  if (!doc.fields?.ach) return null;
  return (doc.fields.ach.arrayValue.values ?? []).map((v) => [v.mapValue.fields.i.stringValue, v.mapValue.fields.n?.stringValue].filter(Boolean).join(':')).sort();
}
async function logSet(card: Locator, weight: string, reps: string) {
  await card.getByRole('textbox', { name: 'Weight' }).fill(weight);
  await card.getByRole('textbox', { name: 'Reps' }).fill(reps);
  await card.getByRole('button', { name: /^Add set/ }).click();
}

test('a group kept back: its switch in a family’s levels, and it leaves your summary at the next publish', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const me = await account(request, `me${Math.random().toString(36).slice(2, 8)}`);
  const page = await signedIn(browser, me, T);
  // Today, the first: a session and two plates a side.
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: /^Bench Press/ }).first().click();
  const card = page.locator('[data-card="bench press"]');
  await logSet(card, '225', '5');
  await expect(card.locator('.ach-lines')).toContainText('Silver · Plates');
  // Signing in published an empty list (nothing yet since the start); the next goes 15 minutes after it.
  expect(await sharedOf(request, me)).toEqual([]);
  const published = (want: string[]) => expect.poll(async () => { await page.clock.runFor(30_000); return sharedOf(request, me); }, { timeout: 60_000 }).toEqual(want);
  await page.clock.runFor(15 * 60_000);
  await published(['plates:Bench Press', 'sessions']);

  // Plates' levels: Milestones shown to friends, and switched off.
  await goto(page, 'Stats');
  await page.locator('[data-tile="achievements"]').click();
  await page.getByRole('dialog', { name: 'Achievements' }).getByRole('region', { name: 'Milestones' }).getByRole('button', { name: /^Plates · Bench Press/ }).click();
  const plates = page.getByRole('dialog', { name: 'Plates' });
  const sw = plates.getByRole('switch', { name: 'Show Milestones to friends' });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  const box = (await sw.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  // Kept on this phone: closed and opened again, still off; another group's switch untouched.
  await plates.getByRole('button', { name: 'Achievements' }).click();
  await page.getByRole('dialog', { name: 'Achievements' }).getByRole('region', { name: 'Showing up' }).getByRole('button', { name: /^Sessions/ }).click();
  await expect(page.getByRole('dialog', { name: 'Sessions' }).getByRole('switch', { name: 'Show Showing up to friends' })).toHaveAttribute('aria-checked', 'true');
  // The next publish, 15 minutes on: Plates gone, Sessions still there.
  await page.clock.runFor(15 * 60_000);
  await published(['sessions']);
});

/** The account's Together ledger as the emulator has it: the friends it counts sessions together with (null: none written). */
async function ledgerOf(request: APIRequestContext, who: Seeded): Promise<string[] | null> {
  const r = await request.get(`${DOCS}/users/${who.uid}/private/together`, { headers: { Authorization: 'Bearer owner' } });
  if (!r.ok()) return null;
  const doc = await r.json() as { fields?: { f?: { mapValue: { fields?: Record<string, { mapValue: { fields: Record<string, unknown> } }> } } } };
  return Object.entries(doc.fields?.f?.mapValue.fields ?? {}).filter(([, v]) => v.mapValue.fields.t).map(([k]) => k).sort();
}

test('trained together: the line on their card, the family and who with on yours, the ledger private; a third friend sees none of it', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const [me, fr, c] = await Promise.all(['me', 'fr', 'cc'].map((n) => account(request, `${n}${Math.random().toString(36).slice(2, 8)}`)));
  const bench = (): [string, [number, number][]][] => [['Bench Press', Array.from({ length: 10 }, (): [number, number] => [135, 8])]];
  // Location for Together on for all three: each visit's first set with its codes for the other two. (Only a friend who never signs
  // in here gets a key in a seeded profile: a phone signing in can't store a profile that's only a key.)
  const K = { me: 'memememememememememem1', fr: 'frfrfrfrfrfrfrfrfrfrf2', c: 'cccccccccccccccccccc_3' };
  const GYM = { latitude: 40.74844, longitude: -73.98566 }, ACROSS_TOWN = { latitude: 40.68920, longitude: -74.04450 };
  await Promise.all([
    log(request, me, await placed(atGym('Iron Den', session(at(0, 17, 0), bench())), GYM, K.me, [K.fr, K.c]), { since: day(5) }),
    // Their own gym, by another name (owner 2026-10-29: two people at one gym may each have made their own): the place decides it.
    log(request, fr, await placed(atGym('Her Gym', session(at(0, 17, 5), bench())), GYM, K.fr, [K.me, K.c]), { since: day(5), goal: 2, placeKey: K.fr }),
    // Signing in, a phone takes the settings it finds (a goal seeded alone isn't a profile it can store: friends' only).
    // C trains at the same time, at a gym of the same name across town: a friend of both, with them never (owner 2026-10-29).
    log(request, c, await placed(atGym('Iron Den', session(at(0, 17, 0), bench())), ACROSS_TOWN, K.c, [K.me, K.fr]), { since: day(5) }),
  ]);
  await Promise.all([befriend(request, me, fr), befriend(request, me, c), befriend(request, fr, c)]);

  const page = await signedIn(browser, me, T);
  const card = crew(page).getByTestId(`crew-${fr.name}`);
  // 5:00–5:27 and 5:05–5:32, each with its 10 minutes either side: both there from 5:00 to 5:32.
  await expect(card.locator('.fd-together')).toHaveText(new RegExp(`^Trained together · You and @${fr.name} at Iron Den, 5:00.?PM–5:32.?PM$`), { timeout: 20_000 });
  await expect(crew(page).getByTestId(`crew-${c.name}`)).toContainText('Bench Press');
  await expect(crew(page).locator('.fd-together')).toHaveCount(1);

  // Stats: the Together group, its first level, and who with: only on this phone.
  await goto(page, 'Stats');
  await page.locator('[data-tile="achievements"]').click();
  const sheet = page.getByRole('dialog', { name: 'Achievements' });
  const group = sheet.getByRole('region', { name: 'Together' });
  await expect(group).toContainText('Trained together');
  await expect(sheet.getByRole('region', { name: 'New today' })).toContainText(`First session together: @${fr.name}, Iron Den`);
  await group.getByRole('button', { name: /^Trained together/ }).click();
  const detail = page.getByRole('dialog', { name: 'Trained together' });
  const withs = detail.getByRole('region', { name: 'With' });
  await expect(withs).toContainText(`@${fr.name}`);
  await expect(withs).toContainText('1 session · last today, Iron Den');
  await expect(withs).not.toContainText(c.name);
  await expect(detail.getByRole('switch')).toHaveCount(0); // never shown to friends: no switch
  await expect(detail).toContainText('only you see these');

  // The ledger goes up with the sync, into the private document (C there too, for the day you both trained, never together); the summary friends read carries none of it.
  await expect.poll(async () => { await page.clock.runFor(60_000); return ledgerOf(request, me); }, { timeout: 90_000 }).toEqual([fr.uid]);
  await page.clock.runFor(15 * 60_000);
  await expect.poll(async () => { await page.clock.runFor(30_000); return sharedOf(request, me); }, { timeout: 60_000 }).not.toBeNull();
  expect((await sharedOf(request, me))!.filter((x) => /together|crew|same-week|full-house/.test(x))).toEqual([]);

  // C, a friend of both: no Together line on either card, and nothing of theirs in C's.
  const pc = await signedIn(browser, c, T);
  await expect(crew(pc).getByTestId(`crew-${me.name}`)).toContainText('Bench Press', { timeout: 20_000 });
  await expect(crew(pc).getByTestId(`crew-${fr.name}`)).toContainText('Bench Press', { timeout: 20_000 });
  await expect(crew(pc).locator('.fd-together')).toHaveCount(0);
  await goto(pc, 'Stats');
  await pc.locator('[data-tile="achievements"]').click();
  await expect(pc.getByRole('dialog', { name: 'Achievements' }).getByRole('region', { name: 'Together' })).not.toContainText(/@/);
  await pc.context().close();
  await page.context().close();
});
