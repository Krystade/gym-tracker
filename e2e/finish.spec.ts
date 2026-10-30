import { expect, test, type Locator, type Page } from '@playwright/test';
import { goto, openProgram } from './nav';

// Finishing a workout (owner, 2026-10-20): no rest after the plan's last set, Finish or Keep going in the bar's place, the
// session closing by itself once it has gone quiet, and the plan turned into the day's summary. Synthetic data only.

const TODAY = '2026-10-20'; // a Tuesday; the clock starts at 18:00
const H = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,pain_region,pain_severity,logged_at';
/** Six timed sessions before the Oct 1 floor (so they pay nothing), gaps between sets of 2½–5½ min (so a quiet time is learned), three lifts of three sets. */
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

async function start(page: Page) {
  await page.clock.install({ time: new Date(`${TODAY}T18:00:00`) });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'sets.csv', mimeType: 'text/csv', buffer: Buffer.from(timedLog()) });
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
const bar = (page: Page) => page.getByRole('group', { name: 'Plan done' });
const summary = (page: Page) => page.getByRole('region', { name: 'Workout summary' });
const minutes = (hm: string, add: number) => { const [h, m] = hm.split(':').map(Number); const t = h * 60 + m + add; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}:00`; };

/** The plan's sets, each 3 min after the one before from 18:30; the rest timer after each but the last. Returns the last set's time. */
async function doThePlan(page: Page, card: Locator, sets: number): Promise<string> {
  let hm = '18:30';
  for (let i = 0; i < sets; i++) {
    hm = minutes('18:30', 3 * i);
    await logSet(page, card, hm);
    if (i < sets - 1) {
      await expect(card.getByRole('list', { name: /^Sets for/ }).getByRole('listitem')).toHaveCount(i + 1);
      await expect(page.getByRole('timer', { name: 'Rest' })).toBeVisible();
      await expect(bar(page)).toHaveCount(0);
    }
  }
  return hm;
}

test('the plan’s last set starts no rest: Finish or Keep going in its place, and Keep going starts the rest it held back', async ({ page }) => {
  await start(page);
  const { name, card, sets } = await planOfOne(page);
  expect(sets).toBeGreaterThan(1);
  await doThePlan(page, card, sets);
  // No rest, no lock-screen alert: the bar offers Finish and Keep going instead.
  await expect(bar(page)).toBeVisible();
  await expect(page.getByRole('timer')).toHaveCount(0);
  await expect(bar(page).getByRole('button', { name: 'Finish' })).toBeVisible();
  // The plan has turned into the day's summary.
  await expect(page.getByRole('list', { name: 'Planned exercises' })).toHaveCount(0);
  await expect(summary(page).getByRole('heading', { level: 2 })).toHaveText('Plan done · Day A');
  await expect(page.getByRole('region', { name: 'Today so far' })).toHaveCount(0);
  // Left alone a while, nothing happens: still there.
  await page.clock.fastForward(60_000);
  await expect(bar(page)).toBeVisible();
  // Keep going: the bar goes, and the rest held back runs from the set, a minute and more of it gone.
  await bar(page).getByRole('button', { name: 'Keep going' }).click();
  await expect(bar(page)).toHaveCount(0);
  const rest = page.getByRole('timer', { name: 'Rest' });
  await expect(rest).toBeVisible();
  const left = await rest.locator('b').innerText();
  const [m, s] = left.split(':').map(Number);
  expect(m * 60 + s).toBeLessThanOrEqual(300 - 60);
  expect(name).toBeTruthy();
});

test('Finish: the summary in the plan’s place; Add more brings the plan back, and a set after it runs the timer as usual', async ({ page }) => {
  await start(page);
  const { name, card, sets } = await planOfOne(page);
  await doThePlan(page, card, sets);
  await bar(page).getByRole('button', { name: 'Finish' }).click();
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole('timer')).toHaveCount(0);
  const sum = summary(page);
  await expect(sum.getByRole('heading', { level: 2 })).toHaveText('Workout done · Day A');
  await expect(sum.locator('.finish-stats')).toContainText(`Sets${sets}`);
  await expect(sum.locator('.finish-stats')).toContainText(`Time${3 * (sets - 1) + 1} min`);
  await expect(sum.getByRole('list', { name: 'Sets per muscle this week' }).getByRole('listitem').first()).toBeVisible();
  await expect(sum.getByLabel('Next')).toContainText('Next: Day B');
  // What today unlocked, counted from today (the first open: the six sessions imported from before count for nothing), and the
  // closest level still to come.
  await expect(sum.getByRole('region', { name: 'Achievements today' })).toContainText('Your first session');
  await expect(sum.getByRole('region', { name: 'Closest achievement' }).getByRole('button')).toHaveCount(1);
  await page.screenshot({ path: 'screenshots/finish-summary.png', fullPage: true });

  // A reload keeps it finished.
  await page.reload();
  await expect(summary(page).getByRole('heading', { level: 2 })).toHaveText('Workout done · Day A');

  await summary(page).getByRole('button', { name: 'Add more' }).click();
  await expect(summary(page)).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Planned exercises' })).toBeVisible();
  // One more set of the same lift: its rest as usual, no Finish bar (the plan was already done).
  await page.getByRole('button', { name: `Show ${name}` }).click();
  await logSet(page, card, minutes('18:30', 3 * sets));
  await expect(page.getByRole('timer', { name: 'Rest' })).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

test('with no plan: no Finish bar; left alone the session closes once it has gone quiet, and a set after opens it again', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Cable Curl');
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  const card = page.locator('[data-card="cable curl"]');
  await logSet(page, card, '18:30:00');
  await logSet(page, card, '18:33:00');
  await expect(page.getByRole('timer', { name: 'Rest' })).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Today so far' })).toBeVisible();
  // A usual gap and more: still open.
  await page.clock.fastForward('05:00');
  await expect(page.getByRole('region', { name: 'Today so far' })).toBeVisible();
  await expect(summary(page)).toHaveCount(0);
  // Well past his gaps: closed by itself, the summary in its place.
  await page.clock.fastForward('40:00');
  await expect(summary(page).getByRole('heading', { level: 2 })).toHaveText('Workout done');
  await expect(summary(page)).toContainText('Closed after a quiet spell');
  await expect(page.getByRole('region', { name: 'Today so far' })).toHaveCount(0);
  await expect(page.getByRole('timer')).toHaveCount(0);
  // He's back: a set opens it again, with its rest.
  await logSet(page, card, '19:20:00');
  await expect(summary(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Today so far' })).toBeVisible();
  await expect(page.getByRole('timer', { name: 'Rest' })).toBeVisible();
});

test('a session that closed while the app was away: the next day it is one line on Today, into History at that day, until opened', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Cable Curl');
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  const card = page.locator('[data-card="cable curl"]');
  await logSet(page, card, '18:30:00');
  await logSet(page, card, '18:33:00');
  await expect(card.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem')).toHaveCount(2);
  // The app goes away, and next opens the morning after.
  await page.goto('about:blank');
  await page.clock.setSystemTime(new Date('2026-10-21T09:00:00'));
  await page.goto('/');
  // IA A1 (owner, 2026-10-21): one line, not the summary card.
  const last = page.getByRole('region', { name: 'Last workout' });
  await expect(last.getByRole('button')).toHaveText(/^Yesterday’s workout · 2 sets(?: · \d+ min)?History$/);
  await expect(last.locator('.finish-stats')).toHaveCount(0);
  await last.getByRole('button').click();
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Log' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('details.day[open]')).toContainText('Cable Curl');
  await page.reload();
  await goto(page, 'Today');
  await expect(page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Last workout' })).toHaveCount(0);
});
