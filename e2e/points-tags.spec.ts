import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto, openProgram } from './nav';

// Owner, 2026-11-21: points as they're earned (a +1 off each set, the lift's running pill, the workout's summary), the four
// set-quality tags (Full stack shown here), and a tingle below Mild that holds nothing. Synthetic data only. At the 13 mini's
// 375×812 with its notch (insets faked as in e2e/pain).
const TOP = 47, BOTTOM = 34;
const SHOTS = 'screenshots/points';
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
/** Nothing off the side; every pill and ring keeps its shape (as wide as tall for a ring, one line for a pill). */
async function fits(page: Page) {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth) out.push(`scrolls sideways: ${document.documentElement.scrollWidth}`);
    for (const el of document.querySelectorAll<HTMLElement>('.pts-pill, .pts-ticket')) {
      const r = el.getBoundingClientRect();
      if (r.height > 26) out.push(`${el.textContent} wraps: ${r.height}px`);
      if (r.right > innerWidth + 0.5 || r.left < -0.5) out.push(`off the side: ${el.textContent}`);
    }
    return out;
  });
  expect(bad).toEqual([]);
}

const TODAY = '2026-10-20'; // a Tuesday
const H = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,pain_region,pain_severity,logged_at';
/** Six timed sessions before the Oct 1 floor (so they pay nothing), three lifts of three sets (as e2e/finish). */
function timedLog(): string {
  const rows = [H], gaps = [150, 200, 260, 330, 230, 280, 190, 310];
  ['2026-09-16', '2026-09-19', '2026-09-22', '2026-09-24', '2026-09-27', '2026-09-30'].forEach((d, k) => {
    let t = Date.parse(`${d}T17:00:00Z`), i = k;
    for (const [lift, w, r] of [['Lat Pulldown', 140, 10], ['Cable Curl', 50, 12], ['Machine Chest Press', 150, 10]] as const) {
      for (let s = 1; s <= 3; s++) {
        rows.push(`${d},${lift},,${s},${w},${r},,,,sample,,,${new Date(t).toISOString()}`);
        t += gaps[i++ % gaps.length] * 1000;
      }
    }
  });
  return rows.join('\n');
}
async function start(page: Page, csv = timedLog()) {
  await notched(page);
  await page.clock.install({ time: new Date(`${TODAY}T18:00:00`) });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'sets.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText(/✓ Imported \d+ new sets/)).toBeVisible();
  await goto(page, 'Today');
}
/** A two-day program with every lift but the first skipped today: that lift's name, card and planned sets. */
async function planOfOne(page: Page): Promise<{ name: string; card: Locator; sets: number }> {
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
  return { name, card: page.locator(`[data-card="${name.toLowerCase()}"]`), sets };
}
async function logSet(page: Page, card: Locator, hm: string) {
  const w = card.getByRole('textbox', { name: 'Weight' });
  if ((await w.inputValue()) === '') await w.fill('50');
  const r = card.getByRole('textbox', { name: 'Reps' });
  if ((await r.inputValue()) === '') await r.fill('10');
  await page.clock.pauseAt(new Date(`${TODAY}T${hm}`));
  await card.getByRole('button', { name: /^Add set/ }).click();
}
const hm = (i: number) => `18:${String(30 + 3 * i).padStart(2, '0')}:00`;
const summary = (page: Page) => page.getByRole('region', { name: 'Workout summary' });
const num = (s: string | null) => Number((s ?? '').replace(/[^\d-]/g, ''));

test('each set logged: a +1 rises off its row once, the card’s pill counts the lift’s points today, and the last set’s rises off the folded card', async ({ page }) => {
  await start(page);
  const { name, card, sets } = await planOfOne(page);
  expect(sets).toBeGreaterThan(1);
  const pill = card.locator('.card-head .pts-pill');
  await expect(pill).toHaveCount(0); // nothing logged yet: no pill
  const rows = card.getByRole('list', { name: /^Sets for/ }).getByRole('listitem');
  for (let i = 0; i < sets - 1; i++) {
    await logSet(page, card, hm(i));
    await expect(rows).toHaveCount(i + 1);
    await expect(rows.nth(i).locator('.pts-rise')).toHaveText('+1');
    await expect(card.locator('.pts-rise')).toHaveCount(1); // only the set just logged
    await expect(pill).toHaveText(`+${i + 1} pts`);
    await expect(pill).toHaveAttribute('aria-label', new RegExp(`^${i + 1} points? from ${name} today$`));
    if (i === 0) {
      await card.evaluate((el) => { el.scrollIntoView(); window.scrollBy(0, -120); });
      await page.screenshot({ path: `${SHOTS}/rise-first-set.png` });
      await fits(page);
    }
    // It rises once and goes.
    await expect(card.locator('.pts-rise')).toHaveCount(0, { timeout: 5000 });
  }
  // The plan's last set folds the card: its +1 rises off the folded line.
  await logSet(page, card, hm(sets - 1));
  await expect(card.locator('.fold-line')).toBeVisible();
  await expect(card.locator('.pts-rise')).toHaveText('+1');
  // Held at its peak for the picture (the rise is over before a screenshot lands).
  await card.locator('.pts-rise').evaluate((el) => el.getAnimations().forEach((a) => { a.pause(); a.currentTime = 400; }));
  await page.screenshot({ path: `${SHOTS}/rise-folded.png` });
  await card.locator('.pts-rise').evaluate((el) => el.getAnimations().forEach((a) => a.finish()));
  await expect(card.locator('.pts-rise')).toHaveCount(0, { timeout: 5000 });
  await page.getByRole('button', { name: `Show ${name}` }).click();
  await expect(pill).toHaveText(`+${sets} pts`);
  await card.evaluate((el) => { el.scrollIntoView(); window.scrollBy(0, -120); });
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/pill-done.png` });
});

test('the finish summary: what the workout paid, line by line, its ticket, the next session ticket, and Open Buddies', async ({ page }) => {
  await start(page);
  // A goal of 1 a week: today's session meets it, so the week pays 20 and a ticket.
  await goto(page, 'Weekly goal');
  const goal = page.getByRole('textbox', { name: 'Sessions per week goal' });
  await goal.fill('1');
  await goal.blur();
  await goto(page, 'Today');
  const { card, sets } = await planOfOne(page);
  for (let i = 0; i < sets; i++) {
    await logSet(page, card, hm(i));
    if (i < sets - 1) await expect(card.getByRole('list', { name: /^Sets for/ }).getByRole('listitem')).toHaveCount(i + 1);
  }
  await page.getByRole('group', { name: 'Plan done' }).getByRole('button', { name: 'Finish' }).click();
  const sum = summary(page);
  await expect(sum.getByRole('heading', { level: 2 })).toHaveText('Workout done · Day A');
  const pts = sum.getByRole('region', { name: 'Points earned' });
  const rows = pts.locator('.finish-pts-rows > div');
  const read = async () => Object.fromEntries(await rows.evaluateAll((ds) => ds.map((d) => [d.querySelector('dt')!.textContent!, d.querySelector('dd')!.textContent!])));
  const got = await read();
  expect(got[`${sets} sets`]).toBe(`+${sets}`);
  expect(got['Session']).toBe('+5');
  expect(got['Goal week hit']).toBe('+20');
  // The first session and the first goal week at least are starter achievements (domain/buddies/rewards).
  expect(num(got['Achievements'])).toBeGreaterThanOrEqual(20);
  const total = Object.values(got).reduce((a, v) => a + num(v), 0);
  await expect(sum.locator('.finish-head .pts-pill')).toHaveText(`+${total} pts`);
  await expect(pts.getByLabel('1 ticket earned')).toContainText('+1 goal week');
  await expect(pts.locator('.pts-ticket')).toHaveCount(1);
  // One session counted since the buddies' start: 4 to the next session ticket.
  await expect(pts).toContainText('4 sessions to your next session ticket');
  await expect(pts.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  const open = pts.getByRole('button', { name: 'Open Buddies · 1 ticket' });
  await expect(open).toBeVisible();
  await sum.scrollIntoViewIfNeeded();
  await pts.scrollIntoViewIfNeeded();
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/finish-summary.png` });
  await page.screenshot({ path: `${SHOTS}/finish-summary-full.png`, fullPage: true });
  await open.click();
  await expect(page.getByRole('heading', { name: 'Buddies', level: 1 })).toBeVisible();
});

// Lat Pulldown at 150 × 12, 12, 12 two sessions running: the range topped, so it goes up, unless the last was Full stack.
const PULL = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,pain_region,pain_severity';
const topped = (lastFlags = '', pain = ''): string => [PULL, ...['2026-10-13', '2026-10-16'].flatMap((d, k) => [1, 2, 3].map((n) =>
  `${d},Lat Pulldown,,${n},150,12,2,${k === 1 ? lastFlags : ''},,sample,${k === 1 && pain !== '' ? 'elbow' : ''},${k === 1 ? pain : ''}`))].join('\n');
async function pulldown(page: Page) {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('button', { name: /^Lat Pulldown/ }).first().click();
  return page.locator('[data-card="lat pulldown"]');
}

test('untagged, the topped range goes up (the contrast for Full stack and a tingle)', async ({ page }) => {
  await start(page, topped());
  await expect((await pulldown(page)).getByLabel('Target')).toContainText(/^Go up: .*lb/);
});

test('Full stack: the target holds the weight and says to go past the range or switch lift', async ({ page }) => {
  await start(page, topped('full_stack'));
  const c = await pulldown(page);
  const target = c.getByLabel('Target');
  await expect(target).not.toContainText('Go up');
  await expect(target).toContainText('13 · 13 · 13 @ 150 lb');
  await expect(target).toContainText('full stack: reps past the range, or switch lift');
  await c.scrollIntoViewIfNeeded();
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/full-stack-target.png` });
});

test('moderate pain last time holds the lift (the contrast for a tingle)', async ({ page }) => {
  await start(page, topped('pain', '2'));
  await expect((await pulldown(page)).getByLabel('Target')).toContainText(/^Hold: /);
});

test('a tingle last time: the lift goes up as if no pain; the scale starts at Tingle and a set logs it', async ({ page }) => {
  await start(page, topped('pain', '0'));
  const c = await pulldown(page);
  await expect(c.getByLabel('Target')).toContainText(/^Go up: /);
  await c.getByRole('button', { name: 'Details' }).click();
  await c.getByRole('button', { name: 'Pain', exact: true }).click();
  const scale = c.getByRole('group', { name: 'Pain severity' }).getByRole('button');
  await expect(scale).toHaveText(['Tingle', 'Mild', 'Moderate', 'Sharp']);
  await scale.filter({ hasText: 'Tingle' }).click();
  await expect(scale.filter({ hasText: 'Tingle' })).toHaveAttribute('aria-pressed', 'true');
  await c.getByRole('group', { name: 'Pain region' }).getByRole('button', { name: 'Elbow' }).click();
  await c.locator('.pain-box').scrollIntoViewIfNeeded();
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/tingle-scale.png` });
  await c.getByRole('button', { name: /^Add set/ }).click();
  const row = c.getByRole('list', { name: /^Sets for/ }).getByRole('listitem').first();
  await expect(row).toContainText('tingle · elbow');
  // No sharp-pain stop, no hold: the target after it is unchanged.
  await expect(c.locator('.pain-stop')).toHaveCount(0);
});
