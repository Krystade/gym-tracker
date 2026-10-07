import { expect, test } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

test('stats: empty state, then charts after import, and priorities edit', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Stats' }).click();
  await expect(page.getByText('No sessions yet')).toBeVisible();

  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await page.getByRole('button', { name: 'Stats' }).click();
  for (const h of ['This week', 'Muscle volume', 'Sessions per week', 'Weekly tonnage', 'Calendar', 'Priorities']) {
    await expect(page.getByRole('heading', { name: h })).toBeVisible();
  }
  await page.getByRole('combobox', { name: 'Biceps' }).selectOption('1');
  await expect(page.getByRole('heading', { name: 'Priority 1' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('exercise screen: rep-max picker, calibration note, and a logged test set', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Lifts' }).click();
  await page.getByRole('button', { name: /Cable Curl/ }).click();
  await expect(page.getByText('Epley · no tests yet')).toBeVisible();
  await expect(page.getByText('Est. 6RM')).toBeVisible();
  await page.getByRole('button', { name: '10RM' }).click();
  await expect(page.getByText('Est. 10RM')).toBeVisible();

  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await page.getByRole('button', { name: 'Add set' }).click();
  const row = page.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem');
  await expect(row).toContainText('RIR 0');
  await expect(row).toContainText('test');
  await page.getByRole('button', { name: 'Cable Curl', exact: true }).click();
  await expect(page.getByText(/calibrated · 1 test/)).toBeVisible();
});

// ---- I17: Stats screen ----
type Pg = import('@playwright/test').Page;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const TODAY = '2026-10-02'; // a Friday

const card = (page: Pg, h: string) => page.locator('section.card').filter({ has: page.getByRole('heading', { name: h, exact: true }) });
const logBench = async (page: Pg, weight: string, reps: string) => {
  const rows = page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');
  const before = await rows.count();
  await page.getByRole('textbox', { name: 'Weight' }).fill(weight);
  await page.getByRole('textbox', { name: 'Reps' }).fill(reps);
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(rows).toHaveCount(before + 1); // saved: the next step moves the clock and reloads
};

/** Mon/Wed/Fri sessions for the 12 weeks up to TODAY, climbing weight so the charts have a shape. */
function history(): string {
  const rows = ['date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source'];
  for (let w = 0; w < 12; w++) {
    for (const off of [0, 2, 4]) {
      const d = new Date(Date.UTC(2026, 6, 13 + 7 * w + off));
      if (iso(d) > TODAY) continue;
      for (const ex of ['Bench Press', 'Cable Curl']) for (let s = 1; s <= 3; s++) rows.push(`${iso(d)},${ex},,${s},${100 + 5 * w},10,2,,,sample`);
    }
  }
  return rows.join('\n');
}
/** 30 daily weigh-ins ending TODAY (MyFitnessPal weight CSV). */
function weighIns(): string {
  const rows = ['Date,Body Fat %,Weight,Neck'];
  for (let i = 0; i < 30; i++) rows.push(`${iso(new Date(Date.UTC(2026, 8, 3 + i)))},,${(180 + Math.sin(i / 3) + i * 0.05).toFixed(1)},`);
  return rows.join('\n');
}
async function seed(page: Pg, body = true) {
  await page.clock.install({ time: new Date(`${TODAY}T09:00:00`) });
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  const files = [{ name: 'history.csv', mimeType: 'text/csv', buffer: Buffer.from(history()) }];
  if (body) files.push({ name: 'mfp-weight.csv', mimeType: 'text/csv', buffer: Buffer.from(weighIns()) });
  await page.getByLabel('Import CSV').setInputFiles(files);
  await expect(page.getByText(/Imported \d+ new/)).toBeVisible();
  await page.getByRole('button', { name: 'Stats' }).click();
}

test('stats: early in the week, a muscle keeping up with the week reads on pace, with its target beside the value', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Stats' }).click();
  const chest = page.locator('.mrow[aria-label^="Chest:"]');
  await expect(chest.locator('.mval')).toHaveText('2 / 2.5–4');
  await expect(chest.locator('.mstat')).toHaveText(/on pace/);
  await expect(chest).toHaveAttribute('aria-label', /on pace/);
  // Nothing logged for Calves: behind any pace.
  await expect(page.locator('.mrow[aria-label^="Calves:"] .mstat')).toHaveText(/under/);
});

test('stats: the calendar shows 12 weeks with weekday and month labels and cells big enough to tap', async ({ page }) => {
  await seed(page);
  const cal = card(page, 'Calendar');
  const cell = cal.locator('.cell').first();
  expect((await cell.boundingBox())!.width).toBeGreaterThanOrEqual(20);
  await expect(cal.getByRole('img')).toHaveAccessibleName('Training calendar, last 12 weeks');
  await expect(cal.locator('text.cal-lbl')).toContainText(['M', 'W', 'F', 'Jul', 'Aug', 'Sep', 'Oct']);
  await cal.locator('.cell').last().click();
  await expect(cal.locator('.readout')).toHaveText('Fri, Oct 2: 6 sets');
  await cal.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/46-stats-calendar.png' });
});

test('stats: a tap on the body-weight chart picks the nearest weigh-in, even beside its neighbour', async ({ page }) => {
  await seed(page);
  const card = page.getByRole('region', { name: 'Body weight' });
  const svg = card.getByRole('img', { name: /Body weight/ });
  const hits = svg.locator('rect[fill="transparent"]');
  await expect(hits).toHaveCount(30);
  await svg.scrollIntoViewIfNeeded();
  const a = (await hits.nth(10).boundingBox())!, b = (await hits.nth(11).boundingBox())!;
  const pitch = (b.x + b.width / 2) - (a.x + a.width / 2);
  // 35 % of the way to the next point: nearer point 10, but inside the old overlap with point 11's 16 px target.
  await page.mouse.click(a.x + a.width / 2 + 0.35 * pitch, a.y + a.height / 2);
  const w = (i: number) => String(Number((180 + Math.sin(i / 3) + i * 0.05).toFixed(1))); // the app drops a trailing .0
  await expect(card).toContainText(`weighed ${w(10)} lb`); // not point 11's (the later target used to paint on top)
  await expect(card).not.toContainText(`weighed ${w(11)} lb`);
  await expect(card.locator('.readout')).toContainText('Sun, Sep 13');
  await page.screenshot({ path: 'screenshots/47-stats-body.png' });
});

test('stats: tiles say each thing once, hide the program tile without a program, and the charts carry axes', async ({ page }) => {
  await seed(page);
  const week = card(page, 'This week');
  await expect(week.locator('.tile')).toHaveCount(4);
  await expect(week).not.toContainText('—');
  await expect(week).not.toContainText('Sets done / planned');
  const rate = page.getByRole('region', { name: 'Body weight' }).locator('.tile').filter({ hasText: '4-week rate' });
  await expect(rate.locator('b')).toHaveText(/^[+−]\d\.\d lb\/week$/);
  await expect(rate).toContainText(/[+−]\d\.\d\d % of body weight/);
  const tonnage = page.getByRole('img', { name: /Weekly tonnage/ });
  await expect(tonnage.locator('line.grid')).toHaveCount(3);
  await expect(tonnage.locator('text.lbl').first()).toContainText('lb');
  const sessions = page.getByRole('img', { name: /Sessions per week/ });
  await expect(sessions.locator('text.lbl', { hasText: 'goal' })).toHaveCount(1);
  // A week that meets the goal has a bar behind the label: the label must paint over the bars, not under.
  expect(await sessions.evaluate((svg) => {
    const goal = [...svg.querySelectorAll('text')].find((t) => t.textContent === 'goal')!;
    return [...svg.querySelectorAll('path.bar')].every((b) => b.compareDocumentPosition(goal) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await page.screenshot({ path: 'screenshots/44-stats-top.png' });
  await card(page, 'Muscle volume').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/45-stats-volume.png' });

  // With a program built, one merged tile.
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: 'Weekly volume' })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.getByRole('button', { name: 'Stats' }).click();
  const merged = week.locator('.tile').filter({ hasText: 'Program, 4 weeks' });
  await expect(merged.locator('b')).toHaveText(/^\d+% · \d+ \/ \d+ sets$/);
  await expect(week.locator('.tile')).toHaveCount(5);
});

test('program: weekly volume shows the target beside each value and never "on pace"', async ({ page }) => {
  await seed(page, false);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Build program' }).click();
  const vol = card(page, 'Weekly volume');
  await expect(vol.locator('.mrow').first().locator('.mtarget')).toContainText(/\/ \d+–\d+/);
  await expect(vol).not.toContainText('on pace');
  await vol.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/45b-program-volume.png' });
});
