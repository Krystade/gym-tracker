import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Round 68 (owner, 2026-11-22): suggested supersets grouped in the plan, the partner's form brought up after a set, the set's own
// start-to-save timer, and Ready's number only when a muscle is short of fresh. At the 13 mini's 375×812 with its notch (insets
// faked as in e2e/superset). Synthetic log only.
const TOP = 47, BOTTOM = 34;
const SHOTS = 'screenshots/r68';
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

const PUSH = 'Cable Pushdown', ROW = 'Seated Cable Row', CHEST = 'Machine Chest Press';
const W: Record<string, number> = { [PUSH]: 100, [ROW]: 130, [CHEST]: 120 };
interface S { id: string; date: string; seq: number; loggedAt: string; exercise: string; setNo: number; weight: number; reps: number; flags: string[]; source: string; target: { weight: number; reps: number; sets: number } }
/** Sets one after another from 18:00 on `date`: a lift, then the seconds to the next. */
function run(date: string, ...steps: (string | number)[]): S[] {
  let t = 0;
  const out: S[] = [], no = new Map<string, number>();
  for (const s of steps) {
    if (typeof s === 'number') { t += s; continue; }
    const n = (no.get(s) ?? 0) + 1;
    no.set(s, n);
    const at = new Date(Date.parse(`${date}T18:00:00`) + t * 1000);
    out.push({ id: `app|${date}|${s.toLowerCase()}|${n}`, date, seq: at.getTime(), loggedAt: at.toISOString(), exercise: s, setNo: n, weight: W[s], reps: 10, flags: [], source: 'app',
      target: { weight: W[s], reps: 10, sets: 3 } });
  }
  return out;
}
/** A superset day: three rounds, a minute's switch, 2:30 after each round; then the chest press on its own. */
const supersetDay = (date: string, first: string) => {
  const other = first === PUSH ? ROW : PUSH;
  return run(date, first, 60, other, 150, first, 60, other, 150, first, 60, other, 300, CHEST, 240, CHEST, 240, CHEST);
};
/** The log: one day of each lift on its own (his straight set-to-set times), then three superset days, the row first last time. */
const LOG = [
  ...run('2026-11-01', PUSH, 240, PUSH, 240, PUSH, 240, PUSH, 300, ROW, 300, ROW, 300, ROW, 300, ROW),
  ...supersetDay('2026-11-08', ROW), ...supersetDay('2026-11-12', PUSH), ...supersetDay('2026-11-15', ROW),
];
const PROGRAM = { key: 'program', perSession: 9, createdAt: '2026-11-01T12:00:00.000Z',
  days: [{ name: 'Day A', slots: [PUSH, CHEST, ROW].map((exercise) => ({ exercise, sets: 3, repMin: 8, repMax: 15 })) }] };

/** Today 2026-11-22 at `time`, the log and the program in the phone's store. */
async function seeded(page: Page, time = '18:00:00', log: S[] = LOG, program: object | null = PROGRAM) {
  await notched(page);
  await page.clock.install({ time: new Date(`2026-11-22T${time}`) });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
  await page.evaluate(async ({ log, program }) => {
    const db = await new Promise<IDBDatabase>((ok, no) => { const r = indexedDB.open('gym-tracker'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const tx = db.transaction(['sets', 'program'], 'readwrite');
    for (const s of log) tx.objectStore('sets').put(s);
    if (program) tx.objectStore('program').put(program);
    await new Promise((ok) => { tx.oncomplete = ok; });
    db.close();
  }, { log, program });
  await page.reload();
}
const plan = (page: Page) => page.getByRole('list', { name: 'Planned exercises' });
const bracket = (page: Page) => plan(page).locator('li.plan-superset');

/** Nothing sideways, and every button in `sel` 44 px tall or more. */
async function fits(page: Page, sel: string) {
  const bad = await page.evaluate((sel) => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth) out.push(`scrolls sideways: ${document.documentElement.scrollWidth}`);
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height < 44) out.push(`${el.textContent} is ${r.height}px tall`);
      if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) out.push(`off the side: ${el.textContent}`);
    }
    return out;
  }, sel);
  expect(bad).toEqual([]);
}

test('a pair he has done together is grouped in the plan, order alternated, with the time it saves; Swap order and Not today', async ({ page }) => {
  await seeded(page);
  const b = bracket(page);
  await expect(b).toHaveCount(1);
  // His three timed superset days back it: 3 rounds × (4:00 + 5:00 straight − his 3:30 round) ≈ 17 min.
  await expect(b.locator('.ss-tag')).toHaveText('Superset · saves ~17 min');
  // The row went first last time, so the pushdown goes first today; the chest press stays on its own, outside the bracket.
  await expect(b.locator('.plan-name b')).toHaveText([`1 · ${PUSH}`, `2 · ${ROW}`]);
  await expect(b.locator('.ss-note')).toContainText(`${ROW} went first last time`);
  await expect(plan(page).locator(':scope > li:not(.plan-superset) .plan-name b')).toHaveText([CHEST]);
  await fits(page, '.ss-note button, .plan-superset .plan-name');
  await b.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${SHOTS}/superset-plan.png` });

  await b.getByRole('button', { name: 'Swap order' }).click();
  await expect(b.locator('.plan-name b')).toHaveText([`1 · ${ROW}`, `2 · ${PUSH}`]);
  await page.reload();
  await expect(bracket(page).locator('.plan-name b')).toHaveText([`1 · ${ROW}`, `2 · ${PUSH}`]); // held for the day
  await bracket(page).getByRole('button', { name: 'Not today' }).click();
  await expect(bracket(page)).toHaveCount(0);
  await expect(plan(page).locator('.plan-name b')).toHaveText([PUSH, CHEST, ROW]); // the plan's own order again
});

test('never another gym’s: the same history at a gym he isn’t at suggests nothing', async ({ page }) => {
  await seeded(page, '18:00:00', LOG.map((s) => ({ ...s, gym: 'Elsewhere' })));
  await expect(plan(page).locator('.plan-name b')).toHaveText([PUSH, CHEST, ROW]);
  await expect(bracket(page)).toHaveCount(0);
});

test('after a set on one lift of the pair, the partner’s form comes up outlined and filled in, its Add set on screen', async ({ page }) => {
  await seeded(page);
  await bracket(page).locator('.plan-name').first().click();
  const push = page.locator(`[data-card="${PUSH.toLowerCase()}"]`);
  await expect(push.getByRole('textbox', { name: 'Weight' })).toHaveValue('100');
  await page.clock.pauseAt(new Date('2026-11-22T18:05:00'));
  await push.getByRole('button', { name: /^Add set/ }).click();
  await expect(page.getByRole('timer', { name: 'Switch' })).toBeVisible();
  const row = page.locator(`[data-card="${ROW.toLowerCase()}"]`);
  await expect(row).toHaveClass(/partner-ready/);
  await expect(row.getByRole('textbox', { name: 'Weight' })).toHaveValue('130');
  await expect(row.getByRole('textbox', { name: 'Reps' })).toHaveValue('10');
  const add = (await row.getByRole('button', { name: /^Add set/ }).boundingBox())!;
  const bar = (await page.locator('.rest-timer').boundingBox())!;
  expect(add.y).toBeGreaterThanOrEqual(TOP);
  expect(add.y + add.height).toBeLessThanOrEqual(bar.y);
  await expect(push).not.toHaveClass(/partner-ready/);
  await page.screenshot({ path: `${SHOTS}/partner-ready.png` });
  // Its set in: no longer outlined.
  await page.clock.pauseAt(new Date('2026-11-22T18:06:30'));
  await row.getByRole('button', { name: /^Add set/ }).click();
  await expect(row).not.toHaveClass(/partner-ready/);
});

/** The set's own time as stored on this phone. */
const workOf = (page: Page, id: string) => page.evaluate(async (id) => {
  const db = await new Promise<IDBDatabase>((ok, no) => { const r = indexedDB.open('gym-tracker'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const s = await new Promise<{ workS?: number } | undefined>((ok) => { const r = db.transaction('sets').objectStore('sets').get(id); r.onsuccess = () => ok(r.result); });
  db.close();
  return s ? s.workS ?? null : undefined;
}, id);

test('the set’s own time: opening the card or a tap on its reps starts it, Start too; Add set keeps start to save on the set', async ({ page }) => {
  await seeded(page);
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(CHEST);
  await page.getByRole('button', { name: new RegExp(`^${CHEST}`) }).first().click();
  const card = page.locator(`[data-card="${CHEST.toLowerCase()}"]`);
  // Opening the card started it; a tap on its time starts it again from now. 34 s later, the set is saved with 34 s.
  const running = card.locator('.set-start.on');
  await expect(running).toBeVisible();
  await page.clock.runFor(5_000);
  await running.click();
  await expect(running).toHaveText('0:00');
  await page.clock.runFor(34_000);
  await expect(card.locator('.set-start.on')).toHaveText('0:34');
  await fits(page, '.set-start');
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/set-timer-running.png` });
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(card.getByRole('list', { name: `Sets for ${CHEST}` }).getByRole('listitem')).toHaveCount(1);
  expect(await workOf(page, `app|2026-11-22|${CHEST.toLowerCase()}|1`)).toBe(34);
  // Back to Start for the next set; a set saved without a start keeps no time.
  await expect(card.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(card.getByRole('list', { name: `Sets for ${CHEST}` }).getByRole('listitem')).toHaveCount(2);
  expect(await workOf(page, `app|2026-11-22|${CHEST.toLowerCase()}|2`)).toBeNull();
  // A tap on the reps starts the next one (its ± too); a second tap doesn't move the start. 41 s.
  await card.getByRole('textbox', { name: 'Reps' }).click();
  await expect(running).toHaveText('0:00');
  await page.clock.runFor(20_000);
  await card.getByRole('button', { name: 'Reps up' }).click();
  await page.clock.runFor(21_000);
  await expect(running).toHaveText('0:41');
  await card.getByRole('button', { name: /^Add set/ }).click();
  // The plan's third set folds the card; the set itself holds the time.
  await expect.poll(() => workOf(page, `app|2026-11-22|${CHEST.toLowerCase()}|3`)).toBe(41);
});

test('Ready’s number and verdict only when a muscle is short of fresh; the check-in stays either way', async ({ page }) => {
  // Fresh: last trained a week ago. The tile's number goes; Energy, the weigh-in and the Week row stay.
  await seeded(page);
  const ready = page.getByRole('region', { name: 'Ready' });
  await expect(ready.getByRole('group', { name: 'Energy' })).toBeVisible();
  await expect(ready.locator('.ready-tile')).toHaveCount(0);
  await expect(ready.locator('.ready-n')).toHaveCount(0);
  await expect(ready.getByRole('button', { name: /^Week/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/ready-hidden.png` });
});

test('Ready shows its number once today’s session’s muscles are short of fresh: the same lifts hard last night', async ({ page }) => {
  // Six hard sets of each of today's lifts at 19:00 last night, and nothing before to learn a faster recovery from: short of
  // fresh 23 hours on (P(full strength) about 0.5).
  let t = 0;
  const hard = [PUSH, ROW, CHEST].flatMap((ex) => Array.from({ length: 6 }, (_, i) => {
    const at = new Date(Date.parse('2026-11-21T19:00:00') + (t += 120) * 1000);
    return { id: `app|2026-11-21|${ex.toLowerCase()}|${i + 1}`, date: '2026-11-21', seq: at.getTime(), loggedAt: at.toISOString(), exercise: ex, setNo: i + 1,
      weight: W[ex], reps: 10, rir: 0, flags: [], source: 'app', target: { weight: W[ex], reps: 10, sets: 6 } };
  }));
  await seeded(page, '18:00:00', hard);
  const ready = page.getByRole('region', { name: 'Ready' });
  await expect(ready.locator('.ready-n')).toBeVisible();
  await expect(ready.getByRole('group', { name: 'Energy' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/ready-shown.png` });
});
