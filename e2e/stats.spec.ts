import { expect, test } from '@playwright/test';
import { goto } from './nav';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

test('stats: empty state, then charts after import, and priorities edit', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'Stats');
  await expect(page.getByText('No sessions yet')).toBeVisible();

  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await goto(page, 'Stats');
  await expect(page.getByRole('region', { name: 'This week', exact: true })).toBeVisible();
  for (const t of ['muscles', 'sessions', 'calendar']) await expect(page.locator(`[data-tile="${t}"]`)).toBeVisible();
  // Priorities live in settings (owner, 2026-10-20): Stats links there.
  await expect(page.getByRole('heading', { name: 'Muscle priorities' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Priorities and goal/ }).click();
  await expect(page.getByRole('heading', { name: 'Priorities and goal', level: 1 })).toBeVisible();
  await page.getByRole('combobox', { name: 'Biceps' }).selectOption('1');
  await goto(page, 'Stats');
  await expect(page.getByRole('button', { name: /^Priorities and goal/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('exercise screen: rep-max picker, calibration note, and a logged test set', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'More');
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
  await goto(page, 'More');
  const files = [{ name: 'history.csv', mimeType: 'text/csv', buffer: Buffer.from(history(weeks)) }];
  await page.getByLabel('Import CSV').setInputFiles(files);
  await expect(page.getByText(/Imported \d+ new/)).toBeVisible();
  await goto(page, 'Stats');
}

test('stats: early in the week nothing is behind; Sunday, trained, what the week missed is', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Program', exact: true }).click();
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
  await page.getByRole('button', { name: 'Program', exact: true }).click();
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
  await goto(page, 'More');
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
