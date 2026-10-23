import { expect, test } from '@playwright/test';
import { goto, openProgram } from './nav';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

test('stats: empty state, then charts after import, and priorities edit', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'Stats');
  await expect(page.getByText('No sessions yet')).toBeVisible();

  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await goto(page, 'Stats');
  await expect(page.getByRole('region', { name: 'This week', exact: true })).toBeVisible();
  for (const t of ['muscles', 'sessions', 'calendar']) await expect(page.locator(`[data-tile="${t}"]`)).toBeVisible();
  // Priorities live in settings (owner, 2026-10-20); Stats has no row for them, nor for photos (IA A5, owner 2026-10-21): the
  // Muscles sheet's "Priorities ›" is the way there from Stats.
  await expect(page.getByRole('heading', { name: 'Muscle priorities' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Priorities and goal/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Progress photos/ })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('Progress photos');
  // No weigh-ins: no Body section.
  await expect(page.getByRole('region', { name: 'Body' })).toHaveCount(0);
  await page.locator('[data-tile="muscles"]').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Priorities' }).click();
  await expect(page.getByRole('heading', { name: 'Priorities and goal', level: 1 })).toBeVisible();
  await page.getByRole('combobox', { name: 'Biceps' }).selectOption('1');
  await goto(page, 'Stats');
  await expect(page.locator('[data-tile="muscles"]')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('exercise screen: rep-max picker, calibration note, and a logged test set', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await goto(page, 'Lifts');
  await page.getByRole('button', { name: /Cable Curl/ }).click();
  await expect(page.getByText(/^Fatigue-adjusted · ±\d+% · no tests yet$/)).toBeVisible();
  await expect(page.getByText('Est. 6RM')).toBeVisible();
  await page.getByRole('button', { name: '10RM' }).click();
  await expect(page.getByText('Est. 10RM')).toBeVisible();

  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  await page.getByRole('button', { name: 'Details' }).click();
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await page.getByRole('button', { name: 'Add set' }).click();
  const row = page.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem');
  await expect(row).toContainText('RIR 0');
  await expect(row).toContainText('test');
  await page.getByRole('button', { name: 'Cable Curl', exact: true }).click();
  await expect(page.getByText(/^Fatigue-adjusted · ±\d+% · 1 test$/)).toBeVisible();
});

// ---- I17: Stats screen ----
type Pg = import('@playwright/test').Page;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const TODAY = '2026-10-02'; // a Friday

const card = (page: Pg, h: string) => page.locator('section.card').filter({ has: page.getByRole('heading', { name: h, exact: true }) });
/** A Stats tile's sheet, opened. */
const sheet = async (page: Pg, tile: string) => {
  await page.locator(`[data-tile="${tile}"]`).click();
  const d = page.getByRole('dialog');
  await expect(d).toBeVisible();
  return d;
};
const logBench = async (page: Pg, weight: string, reps: string) => {
  const rows = page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');
  const before = await rows.count();
  await page.getByRole('textbox', { name: 'Weight' }).fill(weight);
  await page.getByRole('textbox', { name: 'Reps' }).fill(reps);
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(rows).toHaveCount(before + 1); // saved: the next step moves the clock and reloads
};

/** Mon/Wed/Fri sessions for the `weeks` (up to 12) up to TODAY, climbing weight so the charts have a shape. */
function history(weeks = 12): string {
  const rows = ['date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source'];
  for (let w = 12 - weeks; w < 12; w++) {
    for (const off of [0, 2, 4]) {
      const d = new Date(Date.UTC(2026, 6, 13 + 7 * w + off));
      if (iso(d) > TODAY) continue;
      for (const ex of ['Bench Press', 'Cable Curl']) for (let s = 1; s <= 3; s++) rows.push(`${iso(d)},${ex},,${s},${100 + 5 * w},10,2,,,sample`);
    }
  }
  return rows.join('\n');
}
// Each imported set is an IndexedDB put, and Playwright's WebKit on Windows takes a timer tick (~15.6 ms) per put:
// the full 12 weeks (216 sets) is ~3.4 s of the test, more under load. A test that needs less imports less.
async function seed(page: Pg, weeks = 12) {
  await page.clock.install({ time: new Date(`${TODAY}T09:00:00`) });
  await page.goto('/');
  await goto(page, 'Backup');
  const files = [{ name: 'history.csv', mimeType: 'text/csv', buffer: Buffer.from(history(weeks)) }];
  await page.getByLabel('Import CSV').setInputFiles(files);
  await expect(page.getByText(/Imported \d+ new/)).toBeVisible();
  await goto(page, 'Stats');
}

test('stats: early in the week nothing is behind; mid-week, a muscle one session can’t carry is; Sunday, trained, what the week missed is', async ({ page }) => {
  // Monday: two Bench sets. Chest (priority 3) fits one 15-set session × 2 a week to 2.5–4. Wednesday: behind the target, ahead of the week.
  await page.clock.install({ time: new Date('2026-09-28T18:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await logBench(page, '135', '10');
  await logBench(page, '135', '10');
  await page.clock.setFixedTime(new Date('2026-09-30T09:00:00'));
  await page.reload();
  await goto(page, 'Stats');
  await sheet(page, 'muscles');
  const chest = page.locator('.mrow[aria-label^="Chest:"]');
  await expect(chest.locator('.mval')).toHaveText('2 / 2.5–4');
  await expect(chest.locator('.mstat')).toHaveText(/on pace/);
  await expect(chest).toHaveAttribute('aria-label', /on pace/);
  // Nothing logged for Calves yet, but a session left can still do it all: on pace too, and nothing reads behind.
  await expect(page.locator('.mrow[aria-label^="Calves:"] .mstat')).toHaveText(/on pace/);
  await expect(page.getByRole('region', { name: 'Behind this week' })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('[data-tile="muscles"] .st-t-val')).toHaveText(/^0\s*behind$/);

  // Calves made priority 1: its target fits the week at about 7 sets, and the one session left gives a muscle he has never
  // trained what it realistically would (3 sets, the floor), not 11: behind already on Wednesday (owner, 2026-10-21).
  await goto(page, 'Priorities');
  await page.getByRole('combobox', { name: 'Calves' }).selectOption('1');
  await goto(page, 'Stats');
  await expect(page.locator('[data-tile="muscles"] .st-t-val')).toHaveText(/^1\s*behind$/);
  const wed = await sheet(page, 'muscles');
  await expect(wed.getByRole('region', { name: 'Behind this week' })).toContainText('Calves');
  await expect(wed).toContainText('Wednesday: 1 session left this week');
  await expect(wed).toContainText('half again (3 to 11 sets)');
  await wed.getByRole('button', { name: 'Done' }).click();
  await goto(page, 'Priorities');
  await page.getByRole('combobox', { name: 'Calves' }).selectOption('3');

  // Sunday, a Bench set: the week has no session left, so what's short of its target is behind.
  await page.clock.setFixedTime(new Date('2026-10-04T10:00:00'));
  await page.reload();
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press · logged', exact: true }).click(); // done before: the picker says so
  await logBench(page, '135', '10');
  await goto(page, 'Stats');
  await expect(page.locator('[data-tile="muscles"] .st-t-val')).toHaveText(/^[1-9]\d*\s*behind$/);
  const d = await sheet(page, 'muscles');
  await expect(d).toContainText('Sunday: the week is done');
  await expect(d.locator('.mrow[aria-label^="Calves:"] .mstat')).toHaveText(/under/);
  await expect(d.getByRole('region', { name: 'Behind this week' })).toContainText('Calves');
});

test('stats: the calendar shows 12 weeks with weekday and month labels and cells big enough to tap', async ({ page }) => {
  await seed(page);
  const cal = await sheet(page, 'calendar');
  const cell = cal.locator('.cell').first();
  expect((await cell.boundingBox())!.width).toBeGreaterThanOrEqual(20);
  await expect(cal.getByRole('img')).toHaveAccessibleName('Training calendar, last 12 weeks');
  await expect(cal.locator('text.cal-lbl')).toContainText(['M', 'W', 'F', 'Jul', 'Aug', 'Sep', 'Oct']);
  await cal.locator('.cell').last().click();
  await expect(cal.locator('.readout')).toHaveText('Fri, Oct 2: 6 sets');
  await cal.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/46-stats-calendar.png' });
});

test('stats: tiles say each thing once, hide the program tile without a program, and the charts carry axes', async ({ page }) => {
  await seed(page);
  const week = page.getByRole('region', { name: 'This week', exact: true });
  // The hero: sessions in the ring, then sets, PRs, streak and cardio; no program line without a program.
  await expect(week.locator('.st-wk-cells > div')).toHaveCount(4);
  await week.getByRole('button').click();
  let d = page.getByRole('dialog', { name: 'This week' });
  await expect(d.locator('.st-lines > div')).toHaveCount(5);
  await expect(d.locator('.st-program')).toHaveCount(0);
  await d.getByRole('button', { name: 'Done' }).click();
  await expect(d).toHaveCount(0);
  await sheet(page, 'tonnage');
  const tonnage = page.getByRole('img', { name: /Weekly tonnage/ });
  await expect(tonnage.locator('line.grid')).toHaveCount(3);
  await expect(tonnage.locator('text.lbl').first()).toContainText('lb');
  await page.getByRole('button', { name: 'Done' }).click();
  await sheet(page, 'sessions');
  const sessions = page.getByRole('img', { name: /Sessions per week/ });
  await expect(sessions.locator('text.lbl', { hasText: 'goal' })).toHaveCount(1);
  // A week that meets the goal has a bar behind the label: the label must paint over the bars, not under.
  expect(await sessions.evaluate((svg) => {
    const goal = [...svg.querySelectorAll('text')].find((t) => t.textContent === 'goal')!;
    return [...svg.querySelectorAll('path.bar')].every((b) => b.compareDocumentPosition(goal) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await page.screenshot({ path: 'screenshots/44-stats-top.png' });
  await page.getByRole('button', { name: 'Done' }).click();

  // With a program built, one merged tile.
  await goto(page, 'Today');
  await openProgram(page);
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: 'Weekly volume' })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await goto(page, 'Stats');
  await week.getByRole('button').click();
  d = page.getByRole('dialog', { name: 'This week' });
  const merged = d.locator('.st-program');
  await expect(merged).toContainText('Program, 4 weeks');
  await expect(merged.locator('b')).toHaveText(/^\d+% · \d+ \/ \d+ sets$/);
});

test('stats: sessions a week averages the weeks since the first logged set, not the whole 12-week range (owner bug, 2026-10-21)', async ({ page }) => {
  // 6 weeks of Mon/Wed/Fri up to Friday 2 Oct: 5 whole weeks of 3 and this one under way. Over the range's 11 whole weeks it
  // read 1.4 and "met 5 of 11".
  await seed(page, 6);
  const tile = page.locator('[data-tile="sessions"]');
  await expect(tile.locator('.st-t-val')).toHaveText(/^3\.0\s*avg$/);
  await expect(tile.locator('.st-t-ctx')).toHaveText('goal 2 · met 5 of 5');
  const s = await sheet(page, 'sessions');
  await expect(s.locator('tbody tr')).toHaveCount(6);
  await expect(s).toContainText('The average is over the 5 whole weeks since the first logged set');
});

test('stats: the goal label stays inside the sessions chart when the goal is its top', async ({ page }) => {
  await page.goto('/');
  // One session against the default goal of 2: the goal line is the chart's top.
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  await page.getByRole('textbox', { name: 'Weight' }).fill('50');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem')).toHaveCount(1);
  await goto(page, 'Stats');
  await sheet(page, 'sessions');
  const sessions = page.getByRole('img', { name: /Sessions per week/ });
  const box = await sessions.evaluate((svg: SVGSVGElement) => {
    const goal = [...svg.querySelectorAll('text')].find((t) => t.textContent === 'goal')!.getBBox();
    const line = svg.querySelector('line.goal')!.getBBox();
    return { top: goal.y, bottom: goal.y + goal.height, line: line.y, height: svg.viewBox.baseVal.height };
  });
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(box.height);
  expect(box.bottom <= box.line || box.top >= box.line).toBe(true); // beside the line, not struck through
  await sessions.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/r7-goal-label.png' });
});

test('program: weekly volume shows the target beside each value and never "on pace"', async ({ page }) => {
  await seed(page, 1); // this week's volume is all the program screen shows
  await goto(page, 'Today');
  await openProgram(page);
  await page.getByRole('button', { name: 'Build program' }).click();
  const vol = card(page, 'Weekly volume');
  await expect(vol.locator('.mrow').first().locator('.mtarget')).toContainText(/\/ \d+–\d+/);
  await expect(vol).not.toContainText('on pace');
  await vol.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/45b-program-volume.png' });
});

test('stats: cardio-only days count toward neither the sessions goal nor the streak, and show beside the sessions', async ({ page }) => {
  // Goal 2 (the default). Last week: a Bench day and a treadmill-only day. This week: Bench with a treadmill after it, then
  // two treadmill-only days. One session a week, so no week meets the goal.
  const rows = ['date,exercise,set,weight_lb,reps,flags,duration_s',
    '2026-09-21,Bench Press,1,135,10,,', '2026-09-23,Treadmill,1,0,,cardio,1200',
    '2026-09-28,Bench Press,1,135,10,,', '2026-09-28,Treadmill,1,0,,cardio,1200',
    '2026-09-30,Treadmill,1,0,,cardio,1200', '2026-10-01,Treadmill,1,0,,cardio,1200'];
  await page.clock.install({ time: new Date(`${TODAY}T09:00:00`) });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'mixed.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) });
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await goto(page, 'Stats');
  await page.getByRole('region', { name: 'This week', exact: true }).getByRole('button').click();
  const week = page.getByRole('dialog', { name: 'This week' });
  const row = (name: string) => week.locator('.st-lines > div').filter({ has: page.getByText(name, { exact: true }) }).locator('dd');
  await expect(row('Sessions')).toHaveText('1 of 2 + 2 cardio days');
  await expect(row('Streak')).toHaveText('0 weeks · best 0');
  await week.getByRole('button', { name: 'Done' }).click();
  const s = await sheet(page, 'sessions');
  await expect(s.locator('tbody tr').last().locator('td')).toHaveText(['2026-09-28', '1']);
});

// ---- Stats v2 S4/S5 (plan §4): a muscle's weeks, the lift sheet's two readings, the learning core's tiles behind their gates ----

test('stats: 12 weeks untimed, the core’s tiles stay hidden; a lift reads fatigue-adjusted or best set; a muscle’s weeks and back', async ({ page }) => {
  await seed(page);
  // 36 sessions, none timed, no weigh-ins, no program: under every gate.
  await expect(page.locator('[data-tile="calendar"]')).toBeVisible();
  for (const id of ['fatigue', 'bestrest', 'forecast', 'carry', 'relstrength']) await expect(page.locator(`[data-tile="${id}"]`)).toHaveCount(0);
  await expect(page.locator('.st-t-ev')).toHaveCount(0);

  // Bench's sheet: the tile's fatigue-adjusted level, or the best set by Epley (155 × 10 on Friday: 207).
  const lift = await sheet(page, 'lift:bench press');
  const reading = lift.getByRole('group', { name: 'Reading' });
  await expect(reading.getByRole('button', { name: 'Fatigue-adjusted' })).toHaveAttribute('aria-pressed', 'true');
  await expect(lift.locator('.st-dr-k')).toHaveText('e1RM · fatigue-adjusted · 12 wk');
  await expect(lift.locator('.st-ev')).toContainText('learned');
  const adjusted = await lift.locator('.st-dr-v b').textContent();
  await reading.getByRole('button', { name: 'Best set' }).click();
  await expect(lift.locator('.st-dr-k')).toHaveText('e1RM · best set · 12 wk');
  await expect(lift.locator('.st-dr-v b')).toHaveText('207');
  expect(adjusted).not.toBe('207');
  await expect(lift.getByRole('img', { name: 'Bench Press e1RM per session, best set, last 12 weeks' })).toBeVisible();
  await expect(lift.locator('.st-ev')).toContainText(/research.*Epley 1985/);
  await lift.getByRole('button', { name: 'Done' }).click();

  // The Muscles sheet lists each muscle over the range; Chest opens its weeks against its band, and comes back.
  const mus = await sheet(page, 'muscles');
  const list = mus.getByRole('region', { name: 'Each muscle, last 12 weeks' });
  const chest = list.getByRole('button', { name: /^Chest/ });
  await expect(chest).toContainText('9.0 a week');
  await chest.click();
  const ch = page.getByRole('dialog', { name: 'Chest · last 12 weeks' });
  await expect(ch).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(ch.getByRole('img', { name: 'Chest, fractional sets per week, last 12 weeks' })).toBeVisible();
  await expect(ch.locator('rect.band')).toHaveCount(1);
  await expect(ch.locator('.st-dr-v b')).toHaveText('9.0'); // 11 whole weeks of 9 since the first set; this week left out
  await expect(ch.locator('tbody tr')).toHaveCount(13);
  await expect(ch.locator('tbody tr').first().locator('td')).toHaveText(['2026-07-06', '0.0']);
  await expect(ch.locator('.st-ev')).toContainText('research');
  await ch.getByRole('button', { name: 'Muscles', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Sets per muscle' })).toBeVisible();
});

/** Weigh-ins over the rest-knee fixture's last 12 weeks, 190 lb easing to 186. */
const BODY_2024 = ['date,weight_lb', ...Array.from({ length: 30 }, (_, i) => `${iso(new Date(Date.UTC(2024, 5, 1 + 3 * i)))},${(190 - i * 0.14).toFixed(1)}`)].join('\n');
const KNEE = path.join(import.meta.dirname, 'fixtures', 'rest-knee.sample.csv');

test('stats: 80 timed sessions, weigh-ins and a program: fatigue per set, best rest, carry-over, relative strength, the next session, each labelled', async ({ page }) => {
  test.setTimeout(150_000);
  await page.clock.install({ time: new Date('2024-08-28T18:00:00') });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles([
    { name: 'sets.csv', mimeType: 'text/csv', buffer: readFileSync(KNEE) }, { name: 'body.csv', mimeType: 'text/csv', buffer: Buffer.from(BODY_2024) }]);
  await expect(page.getByText('✓ Imported 1098 new sets')).toBeVisible({ timeout: 60_000 });
  await goto(page, 'Stats');

  const tile = (id: string) => page.locator(`[data-tile="${id}"]`);
  await expect(tile('fatigue')).toBeVisible();
  for (const id of ['fatigue', 'bestrest', 'carry', 'relstrength']) await expect(tile(id).locator('.st-t-ev')).toHaveText('learnedlearned from the log');
  // No program yet: no next session.
  await expect(tile('forecast')).toHaveCount(0);

  await expect(tile('fatigue').locator('.st-t-val')).toHaveText(/^−2\.\d\s*reps$/);
  await expect(tile('fatigue').locator('.st-t-ctx')).toHaveText(/^3rd .+ set$/);
  let d = await sheet(page, 'fatigue');
  await expect(d.locator('.st-sub').first()).toHaveText(/^Your 3rd .+ set loses about 2\.\d reps, at your usual 2:15 from one set to the next\.$/);
  await expect(d.getByRole('list', { name: 'Reps the 3rd set loses, per lift' }).getByRole('listitem')).toHaveCount(10);
  await expect(d).toContainText('A set of another lift for the same muscles just before costs about 0.5 reps');
  await d.getByRole('button', { name: 'Done' }).click();

  await expect(tile('bestrest').locator('.st-t-val')).toHaveText(/^1:[0-5]\d$/);
  d = await sheet(page, 'bestrest');
  await expect(d.getByRole('list', { name: 'Best rest per lift' }).getByRole('listitem')).toHaveCount(10);
  await expect(d.locator('.st-ev .st-t-ev')).toHaveText(['learnedlearned from the log', 'researchfrom research']);
  await d.getByRole('button', { name: 'Done' }).click();

  await expect(tile('carry').locator('.st-t-val')).toHaveText(/^4\s*pairs$/);
  d = await sheet(page, 'carry');
  const pairs = d.getByRole('list', { name: 'Carry-over per pair' }).getByRole('listitem');
  await expect(pairs).toHaveCount(4);
  await expect(pairs.first()).toContainText('Incline DB Press against Bench Press');
  await expect(pairs.first()).toContainText('0.38×');
  await d.getByRole('button', { name: 'Done' }).click();
  // Four weeks can't hold 8 weeks of a pair; fatigue per set reads the whole log, whatever the range.
  await page.getByRole('group', { name: 'Range' }).getByRole('button', { name: '4 wk' }).click();
  await expect(tile('carry')).toHaveCount(0);
  await expect(tile('fatigue')).toBeVisible();
  await page.getByRole('group', { name: 'Range' }).getByRole('button', { name: '12 wk' }).click();

  const body = page.getByRole('region', { name: 'Body' });
  await expect(body.locator('[data-tile="relstrength"] .st-t-val')).toHaveText(/^\d\.\d\d\s*× body wt$/);
  d = await sheet(page, 'relstrength');
  await expect(d.getByRole('list', { name: 'Relative strength per lift' }).getByRole('listitem')).toHaveCount(4);
  await d.getByRole('button', { name: 'Done' }).click();

  // A program: the next session at his pace and at the timer's rests.
  await goto(page, 'Today');
  await openProgram(page);
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: 'Weekly volume' })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await goto(page, 'Stats');
  await expect(tile('forecast').locator('.st-t-val')).toHaveText(/^\d+\s*min$/);
  await expect(tile('forecast').locator('.st-t-ctx')).toHaveText(/^Your pace · timer \d+ min$/);
  d = await sheet(page, 'forecast');
  await expect(d.locator('.st-lines dt')).toHaveText(['At your pace', 'At the timer', 'The plan']);
  await expect(d.getByRole('list', { name: 'The timer’s rest per lift' }).getByRole('listitem').first()).toBeVisible();
  await expect(d.locator('.st-ev .st-t-ev')).toHaveText(['learnedlearned from the log', 'researchfrom research']);
});

// ---- The body map (owner, 2026-10-22): over the Muscles sheet's bars, each muscle in its bar's status; a tap opens its weeks. ----

test('stats: the Muscles sheet’s body map sits over the bars, coloured as each bar’s status says, and a muscle tapped opens its weeks', async ({ page }) => {
  await seed(page, 2);
  const d = await sheet(page, 'muscles');
  const map = d.locator('figure.bodymap');
  await expect(map.locator('svg.bm-side')).toHaveCount(2); // the lazy drawing loaded: front and back
  // Above the bars.
  expect(await map.evaluate((m) => !!(m.compareDocumentPosition(document.querySelector('.st-sheet .mrow')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  const CLASS: Record<string, string> = { under: 'bm-under', 'on pace': 'bm-pace', 'on target': 'bm-on', over: 'bm-over' };
  const checked: string[] = [];
  for (const m of ['Chest', 'Biceps', 'Quads', 'Lats']) {
    const word = (await d.locator(`.mrow[aria-label^="${m}:"] .mword`).textContent())!.trim();
    for (const p of await map.locator(`path[data-m="${m}"]`).all()) await expect(p).toHaveClass(CLASS[word]);
    // Every colour on the map has its word in the legend.
    await expect(map.locator('.bm-legend')).toContainText(word);
    checked.push(`${m} ${word}`);
  }
  expect(new Set(checked.map((c) => c.split(' ').slice(1).join(' '))).size).toBeGreaterThan(1); // more than one status shown
  // Abductors has no shape of its own: it's named under the map.
  await expect(map.locator('path[data-m="Abductors"]')).toHaveCount(0);
  await expect(map.locator('.bm-note')).toContainText('abductors');
  // A tap on the chest opens Chest's weeks, and its back link returns to the sheet.
  const chest = (await map.locator('svg[data-side="front"] path[data-m="Chest"]').boundingBox())!;
  await page.mouse.click(chest.x + chest.width * 0.25, chest.y + chest.height * 0.5);
  const ch = page.getByRole('dialog', { name: 'Chest · last 12 weeks' });
  await expect(ch).toBeVisible();
  await ch.getByRole('button', { name: 'Muscles', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Sets per muscle' })).toBeVisible();
  // Just off a thin muscle still counts for it: 6 px beside the forearm, on nothing that is a muscle.
  await page.locator('figure.bodymap').scrollIntoViewIfNeeded();
  const off = await page.locator('figure.bodymap svg[data-side="back"] path[data-m="Forearms"]').evaluate((el) => {
    const b = el.getBoundingClientRect(), y = b.top + b.height * 0.5;
    for (let x = b.left; x < b.right; x++) if (document.elementFromPoint(x, y) === el) return { x: x - 6, y, there: document.elementFromPoint(x - 6, y)?.getAttribute('data-m') ?? null };
    return null;
  });
  expect(off).not.toBeNull();
  expect(off!.there).toBeNull();
  await page.mouse.click(off!.x, off!.y);
  await expect(page.getByRole('dialog', { name: 'Forearms · last 12 weeks' })).toBeVisible();
});
