import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto, openProgram } from './nav';

// Owner, 2026-11-21: a sets-a-week goal beside the sessions goal, either one making the calendar week a goal week (its points
// and ticket), and the week's two rings in Today's header beside the date and in the workout summary. Synthetic data only. At
// the 13 mini's 375×812 with its notch (insets faked as in e2e/points-tags).
const TOP = 47, BOTTOM = 34;
const SHOTS = 'screenshots/week-goals';
mkdirSync(SHOTS, { recursive: true });
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

/** Every ring square at its size (never squashed), nothing off the side, and the date never under the rings. */
async function rings(page: Page, scope: Locator, size: number) {
  const got = await scope.locator('.week-ring').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [r.width, r.height, r.left, r.right]; }));
  expect(got.length).toBeGreaterThan(0);
  for (const [w, h, l, r] of got) {
    expect(w).toBeCloseTo(size, 0);
    expect(h).toBeCloseTo(size, 0);
    expect(l).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(375);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
}

const TODAY = '2026-10-22'; // a Thursday: its week began Monday 2026-10-19
const H = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,pain_region,pain_severity';
/** Sessions before the Oct 1 floor (they pay nothing), and this Monday's 3 sets of curls: 1 session, 3 sets this week. */
function log(): string {
  const rows = [H];
  for (const d of ['2026-09-16', '2026-09-19', '2026-09-22', '2026-09-24', '2026-09-27', '2026-09-30']) {
    for (const [lift, w, r] of [['Lat Pulldown', 140, 10], ['Cable Curl', 50, 12], ['Machine Chest Press', 150, 10]] as const) {
      for (let s = 1; s <= 3; s++) rows.push(`${d},${lift},,${s},${w},${r},,,,sample,,`);
    }
  }
  for (let s = 1; s <= 3; s++) rows.push(`2026-10-19,Cable Curl,,${s},50,12,,,,sample,,`);
  return rows.join('\n');
}
async function start(page: Page) {
  await notched(page);
  await page.clock.install({ time: new Date(`${TODAY}T18:00:00`) });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'sets.csv', mimeType: 'text/csv', buffer: Buffer.from(log()) });
  await expect(page.getByText(/✓ Imported \d+ new sets/)).toBeVisible();
}
async function goals(page: Page, sessions: string, sets: string) {
  await goto(page, 'Weekly goal');
  const s = page.getByRole('textbox', { name: 'Sessions per week goal' });
  await s.fill(sessions);
  await s.blur();
  const v = page.getByRole('textbox', { name: 'Sets per week goal' });
  await v.fill(sets);
  await v.blur();
}
/** A two-day program with every lift but the first skipped today: that lift's card and planned sets. */
async function planOfOne(page: Page): Promise<{ card: Locator; sets: number }> {
  await openProgram(page);
  await page.getByRole('textbox', { name: 'Days per week' }).fill('2');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A/ })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
  const rows = page.getByRole('list', { name: 'Planned exercises' }).getByRole('listitem');
  const n = await rows.count();
  for (let i = 1; i < n; i++) await rows.nth(i).getByRole('button', { name: 'Skip' }).click();
  const first = rows.first();
  const name = (await first.locator('.plan-name').getAttribute('data-exercise'))!;
  const sets = Number((await first.locator('.plan-count').textContent())!.split('/')[1]);
  await first.locator('.plan-name').click();
  return { card: page.locator(`[data-card="${name.toLowerCase()}"]`), sets };
}
async function logSet(page: Page, card: Locator, i: number) {
  const w = card.getByRole('textbox', { name: 'Weight' });
  if ((await w.inputValue()) === '') await w.fill('50');
  const r = card.getByRole('textbox', { name: 'Reps' });
  if ((await r.inputValue()) === '') await r.fill('10');
  await page.clock.pauseAt(new Date(`${TODAY}T18:${String(30 + 3 * i).padStart(2, '0')}:00`));
  await card.getByRole('button', { name: /^Add set/ }).click();
}
const head = (page: Page) => page.locator('.today-head');

test('the rings sit beside the date, square, and read the week against both goals', async ({ page }) => {
  await start(page);
  await goals(page, '3', '40');
  // A lead buddy on the header's top row, as most phones have.
  await goto(page, 'Buddies');
  const offer = page.getByRole('group', { name: 'Your first buddy' }).getByRole('button');
  const first = (await offer.first().locator('b').textContent())!;
  await offer.first().click();
  await page.getByRole('button', { name: `Pick ${first}` }).click();
  await goto(page, 'Today');
  const h = head(page);
  await expect(h.getByRole('img', { name: 'Sessions this week: 1 of 3' })).toBeVisible();
  await expect(h.getByRole('img', { name: 'Sets this week: 3 of 40' })).toBeVisible();
  await expect(h.locator('.week-ring-n').first()).toHaveText('1/3');
  await rings(page, h, 38);
  // On the date's row, at its right, clear of the date's words.
  const [date, ring] = await Promise.all([h.locator('h1').evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return { right: b.right, top: b.top, bottom: b.bottom }; }),
    h.locator('.today-rings').boundingBox()]);
  expect(ring!.x).toBeGreaterThan(date.right + 8);
  expect(ring!.y + ring!.height / 2).toBeGreaterThan(date.top);
  expect(ring!.y + ring!.height / 2).toBeLessThan(date.bottom);
  await page.screenshot({ path: `${SHOTS}/today-header.png` });
  // A past day's week: the day before Monday is last week, with its own count.
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(h.getByRole('img', { name: 'Sessions this week: 0 of 3' })).toBeVisible();
  await rings(page, h, 38);
  await page.screenshot({ path: `${SHOTS}/past-day-header.png` });
});

test('either goal makes the week: one more session short of 3, the sets goal met today pays the goal week and its ticket', async ({ page }) => {
  await start(page);
  // 3 sets this week already: a goal of 4 is met by today's first set, while 2 sessions stay short of 3.
  await goals(page, '3', '4');
  await goto(page, 'Today');
  await expect(head(page).getByRole('img', { name: 'Sets this week: 3 of 4' })).toBeVisible();
  const { card, sets } = await planOfOne(page);
  for (let i = 0; i < sets; i++) {
    await logSet(page, card, i);
    if (i < sets - 1) await expect(card.getByRole('list', { name: /^Sets for/ }).getByRole('listitem')).toHaveCount(i + 1);
  }
  await expect(head(page).getByRole('img', { name: /^Sets this week: \d+ of 4, met$/ })).toBeVisible();
  await expect(head(page).getByRole('img', { name: 'Sessions this week: 2 of 3' })).toBeVisible();
  await page.getByRole('group', { name: 'Plan done' }).getByRole('button', { name: 'Finish' }).click();
  const sum = page.getByRole('region', { name: 'Workout summary' });
  const pts = sum.getByRole('region', { name: 'Points earned' });
  const got = Object.fromEntries(await pts.locator('.finish-pts-rows > div').evaluateAll((ds) => ds.map((d) => [d.querySelector('dt')!.textContent!, d.querySelector('dd')!.textContent!])));
  expect(got['Goal week hit']).toBe('+20');
  await expect(pts.getByLabel(/tickets? earned$/)).toContainText('+1 goal week');
  const week = pts.getByRole('group', { name: 'This week' });
  await expect(week.locator('.finish-week-words')).toHaveText('Goal week: hit on sets.');
  await expect(week.getByRole('img', { name: 'Sessions this week: 2 of 3' })).toBeVisible();
  await rings(page, week, 46);
  await expect(pts.getByRole('progressbar', { name: 'Session ticket progress' })).toBeVisible();
  await week.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/finish-rings.png` });
});

test('the sets goal: its default is the minimums added up, a typed one replaces it, and Use the default brings it back', async ({ page }) => {
  await start(page);
  await goto(page, 'Weekly goal');
  const v = page.getByRole('textbox', { name: 'Sets per week goal' });
  await expect(v).toHaveValue('');
  const auto = Number(await v.getAttribute('placeholder'));
  expect(auto).toBeGreaterThan(0);
  await expect(page.getByText(`${auto}: your muscles’ weekly minimums added up`)).toBeVisible();
  await goto(page, 'Today');
  await expect(head(page).getByRole('img', { name: `Sets this week: 3 of ${auto}` })).toBeVisible();
  await goto(page, 'Weekly goal');
  await v.fill('25');
  await v.blur();
  await goto(page, 'Today');
  await expect(head(page).getByRole('img', { name: 'Sets this week: 3 of 25' })).toBeVisible();
  await goto(page, 'Weekly goal');
  await expect(v).toHaveValue('25');
  await page.screenshot({ path: `${SHOTS}/settings.png` });
  await page.getByRole('button', { name: `Use the default, ${auto}` }).click();
  await expect(v).toHaveValue('');
  await goto(page, 'Today');
  await expect(head(page).getByRole('img', { name: `Sets this week: 3 of ${auto}` })).toBeVisible();
});

test('a tall lead buddy hangs where the rings sit: they go up beside the day arrows, and nothing overlaps', async ({ page }) => {
  await start(page);
  await goto(page, 'Buddies');
  const offer = page.getByRole('group', { name: 'Your first buddy' }).getByRole('button');
  const first = (await offer.first().locator('b').textContent())!;
  await offer.first().click();
  await page.getByRole('button', { name: `Pick ${first}` }).click();
  // The school bus, the widest of the tall ones (BOX.today): kept as a pull keeps it, then made the lead.
  await page.evaluate(async () => {
    const d = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('gym-tracker'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const store = d.transaction('config', 'readwrite').objectStore('config');
    const row = await new Promise<{ map: Record<string, unknown> }>((res) => { const r = store.get('spends'); r.onsuccess = () => res(r.result); });
    const day = new Date().toLocaleDateString('en-CA');
    const s = { id: 'e2e-bus', at: Date.now(), day, kind: 'pull', banner: 'buddy', cost: 15, seed: 1, got: 'bus_school', rarity: 2, refund: 0 };
    await new Promise((res) => { const r = store.put({ key: 'spends', map: { ...row.map, [s.id]: s } }); r.onsuccess = res; });
    d.close();
  });
  await page.reload();
  await goto(page, 'Buddies');
  await page.getByRole('region', { name: /^Your buddies/ }).getByRole('button').nth(1).click();
  await page.getByRole('button', { name: 'Make lead' }).click();
  await goto(page, 'Today');
  const h = head(page);
  await expect(h).toHaveClass(/rings-up/);
  await rings(page, h, 38);
  const box = async (l: Locator) => (await l.boundingBox())!;
  const [r, sprite, next, title] = await Promise.all([box(h.locator('.today-rings')), box(h.locator('.today-buddy .bu-sprite')), box(page.getByRole('button', { name: 'Next day' })),
    h.locator('h1').evaluate((el) => { const g = document.createRange(); g.selectNodeContents(el); const b = g.getBoundingClientRect(); return { right: b.right, top: b.top }; })]);
  expect(r.x).toBeGreaterThanOrEqual(next.x + next.width - 0.5); // right of the arrows
  expect(r.x + r.width).toBeLessThan(sprite.x); // clear of the bus
  expect(r.y + r.height).toBeLessThanOrEqual(title.top + 4); // above the date's words
  expect(title.right).toBeLessThan(sprite.x); // the date whole, never under the bus
  await page.screenshot({ path: `${SHOTS}/tall-buddy-header.png` });
});
