import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { DOCS, FIRESTORE } from './emu';
import { friendLog, publish, summaryOf } from './fixtures/compare';
import { goto } from './nav';
import { account, befriend, log, put, signedIn, type Seeded } from './seed';

// Compare (round 22) against the local emulators: synthetic accounts and numbers only (e2e/seed.ts, e2e/fixtures/compare.ts).
// Today at 18:00.
const T = new Date(new Date().setHours(18, 0, 0, 0));
test.use({ serviceWorkers: 'block' });

const compare = (page: Page) => page.getByRole('region', { name: 'Compare' });
/** Every Firestore request from here on: its URL and body, decoded. */
function watch(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => { if (r.url().startsWith(`${FIRESTORE}/`)) seen.push(`${decodeURIComponent(r.url())} ${r.postData() ?? ''}`); });
  return seen;
}
/** The documents under `who` those requests asked for (a get names each in its body). */
const asked = (seen: string[], who: Seeded) => seen.flatMap((s) => [...s.matchAll(new RegExp(`users/${who.uid}/[A-Za-z0-9_/-]*`, 'g'))].map((m) => m[0]));
/**
 * Anything else of theirs those requests touched: a query names its parent (users/them) with the collection apart, so any request
 * naming them counts, but for the summary and their name (the friends list reads each friend's profile, users/them, for it).
 */
const anythingElse = (seen: string[], fs: Seeded[]) => seen.filter((s) => fs.some((f) => s.includes(f.uid)))
  .filter((s) => !/\/summary\/compare"/.test(s) && !fs.some((f) => new RegExp(`documents/users/${f.uid}"`).test(s)));

/** You, with a log, and friends: two who publish a summary (one with a first pull-up), one whose phone hasn't yet. */
async function crew(request: APIRequestContext) {
  const [me, ana, ben, cal] = await Promise.all(['me', 'ana', 'ben', 'cal'].map((n) => account(request, `${n}${Math.random().toString(36).slice(2, 8)}`)));
  const mine = friendLog(0, T, { rate: 2 });
  const theirs = [friendLog(1, T, { pull: true }), friendLog(2, T, { rate: -0.5 }), friendLog(3, T)];
  await Promise.all([
    log(request, me, mine),
    // Their months are there to be read, and Compare must not read them.
    ...[ana, ben, cal].map((f, i) => log(request, f, theirs[i], { goal: 2 + i })),
    publish(request, ana, summaryOf(theirs[0], T, 2)),
    publish(request, ben, summaryOf(theirs[1], T, 3)),
  ]);
  for (const f of [ana, ben, cal]) await befriend(request, me, f);
  return { me, ana, ben, cal };
}

test('opening Compare reads one document a friend, their summary, and never their sets; a friend without one shows as not updated yet', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { me, ana, ben, cal } = await crew(request);
  let all: string[] = [];
  const page = await signedIn(browser, me, T, async (p) => { all = watch(p); });
  const feed = page.getByRole('region', { name: 'Crew' });
  await expect(feed.getByTestId(`crew-${ana.name}`)).toBeVisible({ timeout: 20_000 });
  // Friends' own reads (their lines, the news) settle first; what's counted is what opening Compare costs.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  const seen = watch(page);
  await feed.getByRole('button', { name: /^Compare/ }).click();
  const c = compare(page);
  await expect(c.getByRole('heading', { name: 'Compare', level: 1 })).toBeVisible();
  const board = c.getByRole('list', { name: 'Ranked by Strength' });
  await expect(board.getByRole('listitem')).toHaveCount(3); // you, ana, ben
  await expect(c.getByRole('list', { name: 'Not updated yet' })).toContainText(`@${cal.name}`);
  await expect(c.getByRole('list', { name: 'Not updated yet' })).toContainText('Not updated yet');
  await page.waitForTimeout(1500);
  // Friends read each one's summary once, for the achievement chips on their cards (kept 5 minutes); Compare reads it from there.
  const sums = (f: Seeded) => asked(all, f).filter((d) => d.endsWith('/summary/compare'));
  for (const f of [ana, ben, cal]) expect(sums(f), `summary reads of @${f.name}`).toEqual([`users/${f.uid}/summary/compare`]);
  for (const f of [ana, ben, cal]) expect(asked(seen, f), `reads of @${f.name} opening Compare`).toEqual([]);
  // Nothing of anyone's sets: no month, no index, no meta, no query of a friend's.
  expect(anythingElse(seen, [ana, ben, cal])).toEqual([]);

  // Strength is each person's own change, ranked; no load anywhere but a First.
  await expect(board).toContainText(/[+−]\d+\.\d%/);
  await expect(board).not.toContainText(/\blb\b/);
  await expect(c.getByRole('region', { name: 'Firsts' })).toContainText(`@${ana.name} · first bodyweight Pull-up`);

  // The other two views, from the same documents: no more reads.
  await c.getByRole('tab', { name: 'Table' }).click();
  const table = c.getByRole('table', { name: 'Everyone by every metric' });
  await expect(table.getByRole('row')).toHaveCount(1 + 3 + 1); // the head, three with numbers, cal not updated
  await expect(table.getByRole('row').filter({ hasText: `@${cal.name}` })).toContainText('Not updated yet');
  await table.getByRole('button', { name: 'Sort by Streak' }).click();
  await expect(table.getByRole('columnheader', { name: 'Sort by Streak' })).toHaveAttribute('aria-sort', 'descending');
  await c.getByRole('tab', { name: 'Chart' }).click();
  const lines = c.getByRole('group', { name: /^Lines/ });
  await expect(lines.getByRole('button')).toHaveCount(3);
  await lines.getByRole('button', { name: new RegExp(`@${ana.name}`) }).click();
  await expect(lines.getByRole('button', { name: new RegExp(`@${ana.name}`) })).toHaveAttribute('aria-pressed', 'true');
  await expect(c.getByRole('img', { name: /^Strength change from each person’s own start, 12 wk/ })).toBeVisible();
  for (const f of [ana, ben, cal]) expect(asked(seen, f), `reads of @${f.name}`).toEqual([]);
  for (const f of [ana, ben, cal]) expect(sums(f), `summary reads of @${f.name}`).toHaveLength(1);
  expect(anythingElse(seen, [ana, ben, cal])).toEqual([]);

  // Hide ben: gone from every view, kept hidden on this phone, and not read when Compare opens again.
  await c.getByRole('button', { name: /^People: 3 of 3/ }).click();
  const sheet = page.getByRole('dialog', { name: 'People' });
  await sheet.getByRole('button', { name: new RegExp(`@${ben.name}`) }).click();
  await expect(sheet.getByRole('button', { name: new RegExp(`@${ben.name}`) })).toHaveAttribute('aria-pressed', 'false');
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(c.getByRole('button', { name: /^People: 2 of 3/ })).toBeVisible();
  await expect(c.getByRole('group', { name: /^Lines/ }).getByRole('button')).toHaveCount(2);
  await page.reload();
  await goto(page, 'Friends');
  const seen2 = watch(page);
  await page.getByRole('region', { name: 'Crew' }).getByRole('button', { name: /^Compare/ }).click();
  await expect(compare(page).getByRole('button', { name: /^People: 2 of 3/ })).toBeVisible();
  await expect(compare(page).getByRole('tab', { name: 'Chart' })).toHaveAttribute('aria-selected', 'true'); // the view kept too
  await page.waitForTimeout(1500);
  expect(asked(seen2, ben)).toEqual([]);
  // A friend's row opens their page, whose Back goes to Compare.
  await compare(page).getByRole('tab', { name: 'Ranks' }).click();
  await compare(page).getByRole('list', { name: 'Ranked by Strength' }).getByRole('button', { name: new RegExp(`@${ana.name}`) }).click();
  await expect(page.getByRole('region', { name: `@${ana.name}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(compare(page).getByRole('heading', { name: 'Compare', level: 1 })).toBeVisible();
});

test('your phone publishes your summary after a sync, in its shape and nothing more, and a friend’s Compare shows you from it', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const [me, ana] = await Promise.all(['me', 'ana'].map((n) => account(request, `${n}${Math.random().toString(36).slice(2, 8)}`)));
  const mine = friendLog(5, T, { rate: 2.5 });
  // A painful set with a note: neither leaves the phone in a summary.
  mine.push({ ...mine[mine.length - 1], id: 'app|pain|1', setNo: 9, flags: ['pain'], note: 'left elbow twinge' } as never);
  await Promise.all([log(request, me, mine), log(request, ana, friendLog(1, T)), publish(request, ana, summaryOf(friendLog(1, T), T, 2))]);
  await befriend(request, me, ana);
  await put(request, `users/${me.uid}/private/cycle`, { days: {}, tracking: false, updatedAt: 1 });
  const page = await signedIn(browser, me, T);
  // Written after the first sync, when the phone is idle.
  let doc: { fields?: Record<string, unknown> } = {};
  await expect.poll(async () => {
    const r = await request.get(`${DOCS}/users/${me.uid}/summary/compare`, { headers: { Authorization: 'Bearer owner' } });
    doc = r.ok() ? await r.json() : {};
    return Object.keys(doc.fields ?? {}).sort();
  }, { timeout: 20_000 }).toEqual(['ach', 'at', 'day', 'firsts', 'goal', 'r', 'streak', 'v']);
  // Achievements count from the Oct 1 floor (domain/buddies/start COUNT_FLOOR): none from the log's days before it, none after
  // today, and each one only its id, level, day and lift.
  type Ach = { mapValue: { fields: Record<string, { stringValue?: string }> } };
  const ach = (doc.fields!.ach as { arrayValue: { values?: Ach[] } }).arrayValue.values ?? [];
  for (const a of ach) {
    expect(Object.keys(a.mapValue.fields).filter((k) => !['i', 'l', 'd', 'n'].includes(k))).toEqual([]);
    expect(a.mapValue.fields.d.stringValue! >= '2026-10-01' && a.mapValue.fields.d.stringValue! <= T.toLocaleDateString('en-CA'), a.mapValue.fields.d.stringValue).toBe(true);
  }
  // The Bodyweight achievement's id (one of the log's, from Oct 1) is not a weight.
  const text = JSON.stringify(doc).replaceAll('{"stringValue":"bodyweight"}', '{"stringValue":"<id>"}');
  for (const word of ['pain', 'elbow', 'twinge', 'note', 'cycle', 'energy', 'reps', 'weight']) expect(text, word).not.toContain(word);
  expect(JSON.stringify(doc.fields!.goal)).toContain('"2"'); // the app's default goal
  await page.context().close();

  // Ana's Compare: you, from that one document.
  const other = await signedIn(browser, ana, T);
  await other.getByRole('region', { name: 'Crew' }).getByRole('button', { name: /^Compare/ }).click();
  const board = compare(other).getByRole('list', { name: 'Ranked by Strength' });
  await expect(board.getByRole('button', { name: new RegExp(`@${me.name}`) })).toBeVisible();
  await compare(other).getByRole('button', { name: 'Streak', exact: true }).click();
  await expect(compare(other).getByRole('list', { name: 'Ranked by Streak' }).getByRole('button', { name: new RegExp(`@${me.name}`) })).toContainText('2/wk');
  await expect(compare(other).getByRole('list', { name: 'Not updated yet' })).toHaveCount(0);
});
