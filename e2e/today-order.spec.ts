import { expect, test, type Locator, type Page } from '@playwright/test';
import { goto, openProgram } from './nav';
import { notched, TOP } from './layout';
import { account, befriend, iso, log, ping, signedIn } from './seed';
import { sixWeeks, sixWeeksCsv, WED } from './fixtures/today';

// IA A1 (owner, 2026-10-21): Today's order is Ready → a friend's ping → today's plan → the other cards, so the first planned lift
// and its target are on the first screen; the plan stays listed until every planned set is done, then the summary takes its
// place; an unseen past workout is one line into History. Synthetic accounts and numbers only.
test.use({ serviceWorkers: 'block' });

const T = WED;
const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const plan = (page: Page) => page.getByRole('region', { name: 'Today’s plan' });
const rows = (page: Page) => page.getByRole('list', { name: 'Planned exercises' }).getByRole('listitem');

async function buildProgram(page: Page) {
  await openProgram(page);
  await page.getByRole('textbox', { name: 'Days per week' }).fill('3');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A/ })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(plan(page)).toBeVisible();
}

test('before training on a digest week, with a ping and an unseen workout: the first lift and its target clear the tab bar', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const [me, ana] = await Promise.all([account(request), account(request)]);
  await log(request, me, sixWeeks());
  await befriend(request, me, ana);
  await ping(request, ana, me, 'fire', T.getTime() - 20 * 60_000);
  const page = await signedIn(browser, me, T, notched);
  await goto(page, 'Today');
  await buildProgram(page);
  await page.evaluate(() => window.scrollTo(0, 0));

  // Everything above the plan that the day can put there: Ready open (Energy, Weight, Week), and the ping.
  const ready = page.getByRole('region', { name: 'Ready' });
  await expect(ready.getByRole('group', { name: 'Energy' })).toBeVisible();
  await expect(ready.getByRole('group', { name: 'Weigh-in' })).toBeVisible();
  await expect(ready.getByRole('button', { name: /^Week/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: /tap to reply/ })).toBeVisible();
  // The cards it used to push down: on Today, under the plan, each one line.
  const digest = page.getByRole('region', { name: 'Last week' });
  await expect(digest.getByRole('button', { name: /^Last week/ })).toHaveAttribute('aria-expanded', 'false');
  const past = page.getByRole('region', { name: 'Last workout' });
  await expect(past).toContainText('Mon’s workout');
  for (const below of [digest, past]) expect((await below.boundingBox())!.y).toBeGreaterThan((await plan(page).boundingBox())!.y);
  // The Today header's Program button is gone: Edit › on the plan opens Program.
  await expect(page.getByRole('button', { name: 'Program', exact: true })).toHaveCount(0);
  await expect(plan(page).getByRole('button', { name: 'Edit plan' })).toBeVisible();
  await expect(plan(page).getByRole('heading', { level: 2 })).toHaveText(/Day [ABC] · \d+ sets · ≈ \d+ min/);

  // S1: the first planned lift's name and target, whole, between the notch and the tab bar, without a scroll.
  expect(await page.evaluate(() => scrollY)).toBe(0);
  const first = rows(page).first().locator('.plan-name');
  const target = first.locator('> .muted').last();
  await expect(target).toHaveText(/^0\/\d+ · \d+–\d+ reps/);
  const bar = (await tabBar(page).boundingBox())!;
  for (const el of [first.locator('> b'), target]) {
    const b = (await el.boundingBox())!;
    expect(b.y, 'below the notch').toBeGreaterThanOrEqual(TOP);
    expect(b.y + b.height, `${await el.innerText()}: above the tab bar at ${bar.y}`).toBeLessThanOrEqual(bar.y);
  }
});

async function phone(page: Page) {
  await page.clock.install({ time: T });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from(sixWeeksCsv()) });
  await expect(page.getByText(/✓ Imported \d+ new sets/)).toBeVisible();
  await goto(page, 'Today');
}
async function logSet(page: Page, card: Locator, hm: string) {
  const w = card.getByRole('textbox', { name: 'Weight' });
  if ((await w.inputValue()) === '') await w.fill('50');
  const r = card.getByRole('textbox', { name: 'Reps' });
  if ((await r.inputValue()) === '') await r.fill('10');
  await page.clock.pauseAt(new Date(`${iso(T)}T${hm}`));
  await card.getByRole('button', { name: /^Add set/ }).click();
}

test('the plan stays listed through the session until every planned set is done; then the summary takes its place', async ({ page }) => {
  test.setTimeout(120_000);
  await phone(page);
  await buildProgram(page);
  // Two lifts left in the plan, so the session is short; each set logged from the plan's row, as at the gym.
  const n = await rows(page).count();
  for (let i = n - 1; i >= 2; i--) await rows(page).nth(i).getByRole('button', { name: 'Skip' }).click();
  const planned: { name: string; sets: number }[] = [];
  for (let i = 0; i < 2; i++) {
    const p = rows(page).nth(i).locator('.plan-name');
    planned.push({ name: (await p.getAttribute('data-exercise'))!, sets: Number((await p.locator('.plan-count').textContent())!.split('/')[1]) });
  }
  const total = planned.reduce((a, p) => a + p.sets, 0);
  let done = 0, minute = 10;
  for (const p of planned) {
    await rows(page).filter({ has: page.locator(`[data-exercise="${p.name}"]`) }).locator('.plan-name').click();
    const card = page.locator(`[data-card="${p.name.toLowerCase()}"]`);
    for (let s = 0; s < p.sets; s++) {
      await logSet(page, card, `17:${String(minute).padStart(2, '0')}:00`);
      minute += 3; done++;
      if (done === total) break;
      // (Its card folds once its planned sets are in, so the plan row's count is what's read.)
      await expect(rows(page).locator(`[data-exercise="${p.name}"] .plan-count`)).toHaveText(`${s + 1}/${p.sets}`);
      // Every set but the last: the whole list still there, open, each row with its target; Ready folded as before.
      await expect(page.getByRole('button', { name: /^Today’s plan/ })).toHaveAttribute('aria-expanded', 'true');
      await expect(rows(page)).toHaveCount(n);
      await expect(rows(page).first().locator('.plan-count')).toBeVisible();
      await expect(page.getByRole('region', { name: 'Ready' }).getByRole('group', { name: 'Energy' })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Workout summary' })).toHaveCount(0);
    }
  }
  // The last planned set: the summary is where the plan was (Finish or Keep going in the rest bar's place).
  await expect(page.getByRole('region', { name: 'Workout summary' })).toBeVisible();
  await expect(plan(page)).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Plan done' })).toBeVisible();
});

test('an unseen past workout is one line under the plan, and opens that day in History', async ({ page }) => {
  await phone(page);
  const past = page.getByRole('region', { name: 'Last workout' });
  await expect(past.getByRole('button')).toHaveText(/^Mon’s workout · 12 sets · \d+ minHistory$/);
  expect((await past.boundingBox())!.height).toBeLessThanOrEqual(60);
  await past.getByRole('button').click();
  await expect(tabBar(page).getByRole('button', { name: 'Log' })).toHaveAttribute('aria-current', 'page');
  // That day, open in History.
  await expect(page.locator('details.day[open]')).toContainText(/Mon/);
  await expect(page.locator('details.day[open]')).toContainText('Overhead Press'); // Monday's was C
  // Seen: not on Today again.
  await goto(page, 'Today');
  await expect(page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
  await expect(past).toHaveCount(0);
});

test('Why’s body map: recovery today in three steps, the same as each muscle’s Now; a muscle tapped opens its weeks, and Why › comes back', async ({ page }) => {
  test.setTimeout(120_000);
  // Tuesday: the six weeks, and a hard chest day yesterday (ten more sets to failure) on top of Monday's session.
  const TUE = new Date('2026-10-20T17:00:00');
  const hard = Array.from({ length: 10 }, (_, i) => `2026-10-19,Bench Press,,${4 + i},135,6,0,,,sample,2026-10-19T18:${String(10 + 3 * i).padStart(2, '0')}:00.000Z`);
  await page.clock.install({ time: TUE });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([sixWeeksCsv(TUE), ...hard].join('\n')) });
  await expect(page.getByText(/✓ Imported \d+ new sets/)).toBeVisible();
  await goto(page, 'Today');
  const tile = page.getByRole('region', { name: 'Ready' });
  await tile.getByRole('button', { name: /^Why/ }).click();
  const why = page.getByRole('dialog', { name: 'Why' });
  const map = why.locator('figure.bodymap');
  await expect(map.locator('svg.bm-side')).toHaveCount(2);
  const tone = (pct: number) => (pct >= 80 ? 'ready' : pct >= 50 ? 'recovering' : 'notyet');
  const rows = why.locator('.why-table tbody tr');
  expect(await rows.count()).toBeGreaterThan(0);
  const seen = new Set<string>();
  for (const r of await rows.all()) {
    const m = (await r.locator('th').textContent())!.trim();
    const pct = Number((await r.locator('td').last().textContent())!.replace('%', ''));
    const t = tone(pct);
    seen.add(t);
    await expect(r.locator('td').last()).toHaveClass(t); // the table's Now in the map's colour
    for (const p of await map.locator(`path[data-m="${m}"]`).all()) await expect(p).toHaveClass(`bm-${t}`);
    await expect(map.locator('.bm-legend')).toContainText({ ready: 'ready', recovering: 'recovering', notyet: 'not yet' }[t]);
  }
  // (The model has every muscle back within a day of this much: the steps' cut-offs are unit-tested in src/ui/body/regions.test.ts.)
  expect(seen.size).toBeGreaterThan(0);
  // A muscle not trained in two weeks is ready.
  const listed = new Set((await why.locator('.why-table tbody th').allTextContents()).map((s) => s.trim()));
  const fresh = ['Quads', 'Hamstrings', 'Calves', 'Glutes', 'Chest', 'Lats'].find((m) => !listed.has(m))!;
  expect(fresh).toBeTruthy();
  await expect(map.locator(`path[data-m="${fresh}"]`).first()).toHaveClass('bm-ready');
  // The chest tapped: its weeks; ‹ Why goes back.
  const chest = (await map.locator('svg[data-side="front"] path[data-m="Chest"]').boundingBox())!;
  await page.mouse.click(chest.x + chest.width * 0.25, chest.y + chest.height * 0.5);
  const ch = page.getByRole('dialog', { name: /^Chest · / });
  await expect(ch).toBeVisible();
  await ch.getByRole('button', { name: 'Why', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Why' })).toBeVisible();
});
