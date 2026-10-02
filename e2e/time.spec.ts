import { expect, test } from '@playwright/test';

const logBench = async (page: import('@playwright/test').Page, weight: string, reps: string) => {
  const rows = page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');
  const before = await rows.count();
  await page.getByRole('textbox', { name: 'Weight' }).fill(weight);
  await page.getByRole('textbox', { name: 'Reps' }).fill(reps);
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(rows).toHaveCount(before + 1); // saved: the next step may reload the page or move the clock
};

test('a forgotten set goes into yesterday at the suggested time, and the workout length is measured', async ({ page }) => {
  // Yesterday: sets at 18:00, 18:02, 18:04, then a 10-min gap, then 18:14 and 18:16.
  await page.clock.install({ time: new Date('2026-10-01T18:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  for (const t of ['18:00', '18:02', '18:04', '18:14', '18:16']) {
    await page.clock.setFixedTime(new Date(`2026-10-01T${t}:00`));
    await logBench(page, '135', '10');
  }
  // Today: open yesterday from History and add the set that was forgotten in the gap.
  await page.clock.setFixedTime(new Date('2026-10-02T09:00:00'));
  await page.reload();
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.locator('details.day').filter({ hasText: 'Thu, Oct 1' })).toContainText('1 exercise · 5 sets · 18 min');
  await page.getByRole('button', { name: 'Add to this day' }).click();
  await expect(page.getByText('Logging to a past day')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'When' })).toHaveValue('18:09');
  await logBench(page, '135', '9');
  // In the order done: the late set sits where it happened, numbered by position.
  await expect(page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveText([/^1\s*135 × 10/, /^2/, /^3/, /^4\s*135 × 9/, /^5\s*135 × 10/, /^6\s*135 × 10/]);
  await page.screenshot({ path: 'screenshots/22-late-set.png', fullPage: true });
  // The day switcher goes back to today.
  await page.getByRole('button', { name: 'Back to today' }).click();
  await expect(page.getByRole('heading', { name: 'Fri, Oct 2' })).toBeVisible();
  await expect(page.getByText(/Logging to/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByRole('heading', { name: 'Thu, Oct 1' })).toBeVisible();
});

test('a set entered a few minutes late today can take an earlier time', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await logBench(page, '135', '10');
  await page.clock.setFixedTime(new Date('2026-10-02T18:12:00'));
  await expect(page.getByRole('textbox', { name: 'When' })).toHaveCount(0);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Did this earlier?' }).click();
  await expect(page.getByRole('textbox', { name: 'When' })).toHaveValue('18:03');
  await logBench(page, '135', '9');
  await expect(page.getByRole('textbox', { name: 'When' })).toHaveCount(0); // closes again after saving
});

test('the builder builds to minutes, and program days show their length', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Minutes', exact: true }).click();
  await page.getByRole('textbox', { name: 'Minutes per session' }).fill('30');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A · \d+ sets · ≈ \d+ min$/ })).toBeVisible();
  const heads = await page.getByRole('heading', { name: /^Day [A-Z] · \d+ sets · ≈ \d+ min$/ }).allInnerTexts();
  expect(heads.length).toBeGreaterThan(0);
  for (const h of heads) expect(Number(/≈ (\d+) min/.exec(h)![1])).toBeLessThanOrEqual(30);
  await page.screenshot({ path: 'screenshots/23-program-minutes.png', fullPage: true });
});

test('a minutes budget too small to meet says so', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Minutes', exact: true }).click();
  await page.getByRole('textbox', { name: 'Minutes per session' }).fill('20');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A · / })).toBeVisible();
  const heads = await page.getByRole('heading', { name: /^Day [A-Z] · \d+ sets · ≈ \d+ min$/ }).allInnerTexts();
  expect(Math.max(...heads.map((h) => Number(/≈ (\d+) min/.exec(h)![1])))).toBeGreaterThan(20); // premise: 20 can't be met
  const note = page.getByRole('status').filter({ hasText: 'over your 20' });
  await expect(note).toBeVisible();
  await expect(note).toContainText(/^Day [A-Z] ≈ \d+ min(, Day [A-Z] ≈ \d+ min)*: over your 20\. Train fewer days a week or allow more minutes, then rebuild\.$/);
  // Each day named carries its own length, as its heading shows it.
  for (const [, day, min] of (await note.innerText()).matchAll(/(Day [A-Z]) ≈ (\d+) min/g))
    await expect(page.getByRole('heading', { name: new RegExp(`^${day} · \\d+ sets · ≈ ${min} min$`) })).toBeVisible();
  await page.screenshot({ path: 'screenshots/40-budget-note.png', fullPage: true });
  await page.getByRole('textbox', { name: 'Minutes per session' }).fill('150');
  await expect(page.getByRole('textbox', { name: 'Minutes per session' })).toHaveValue('150');
  await expect(note).toBeVisible(); // describes the program as built, not the input: no rebuild yet
  await page.getByRole('button', { name: 'Sets', exact: true }).click();
  page.once('dialog', (d) => void d.accept()); // "Replace the current program?"
  await page.getByRole('button', { name: 'Rebuild program' }).click(); // by sets: no minutes budget
  await expect(page.getByRole('status').filter({ hasText: 'over your' })).toHaveCount(0);
});

test('a program built by sets is not said to be over a minutes budget a rebuild could meet', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Build program' }).click(); // 14 sets, ≈ 44 min
  await expect(page.getByRole('heading', { name: /^Day A · 14 sets/ })).toBeVisible();
  await page.getByRole('button', { name: 'Minutes', exact: true }).click();
  await page.getByRole('textbox', { name: 'Minutes per session' }).fill('30');
  await expect(page.getByRole('textbox', { name: 'Minutes per session' })).toHaveValue('30');
  await expect(page.getByRole('status').filter({ hasText: 'some days run over' })).toHaveCount(0);
});

const openBench = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: /^Bench Press( · logged)?$/ }).click();
};

test('switching day with the same lift on both days gives each day its own time mode and cards', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-01T18:00:00') });
  await page.goto('/');
  await openBench(page);
  for (const t of ['18:00', '18:02', '18:04']) {
    await page.clock.setFixedTime(new Date(`2026-10-01T${t}:00`));
    await logBench(page, '135', '10');
  }
  await page.clock.setFixedTime(new Date('2026-10-02T18:00:00'));
  await page.reload();
  await openBench(page);
  await logBench(page, '135', '10');
  await page.clock.setFixedTime(new Date('2026-10-02T19:00:00'));
  // Yesterday's form asks when; today's doesn't.
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByRole('textbox', { name: 'When' })).toHaveValue('18:06');
  await page.getByRole('button', { name: 'Back to today' }).click();
  await expect(page.getByRole('textbox', { name: 'When' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Previous day' }).click();
  await logBench(page, '135', '8');
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.locator('details.day').filter({ hasText: 'Thu, Oct 1' })).toContainText('1 exercise · 4 sets · 8 min');
});

test('a card added but not logged stays on its own day', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await openBench(page);
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Bench Press' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Stats' }).click();
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Bench Press' })).toBeAttached();
});

test('after a late set the next suggested time moves on', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-01T18:00:00') });
  await page.goto('/');
  await openBench(page);
  for (const t of ['18:00', '18:02', '18:04', '18:14', '18:16']) {
    await page.clock.setFixedTime(new Date(`2026-10-01T${t}:00`));
    await logBench(page, '135', '10');
  }
  await page.clock.setFixedTime(new Date('2026-10-02T09:00:00'));
  await page.reload();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByRole('textbox', { name: 'When' })).toHaveValue('18:09');
  await logBench(page, '135', '9');
  await expect(page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveCount(6);
  await expect(page.getByRole('textbox', { name: 'When' })).toHaveValue('18:06');
});

test('looking at a past day does not move the program rotation, and "Log it today" logs today', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-30T18:00:00') });
  await page.goto('/');
  await openBench(page);
  await logBench(page, '135', '10');
  await page.clock.setFixedTime(new Date('2026-10-01T09:00:00'));
  await page.reload();
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A/ })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(page.getByRole('heading', { name: 'Today’s plan · Day A' })).toBeVisible();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByText('Logging to a past day')).toBeVisible();
  await page.waitForTimeout(300); // let any plan write land, then read today's plan back from storage
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today’s plan · Day A' })).toBeVisible();
  // From a past day, "Log it today" lands on today.
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Lifts' }).click();
  await page.getByRole('searchbox', { name: 'Filter lifts' }).fill('bench');
  await page.getByRole('button', { name: /^Bench Press/ }).first().click();
  await page.getByRole('region', { name: 'Next time' }).getByRole('button', { name: 'Log it today' }).click();
  await expect(page.getByRole('heading', { name: 'Thu, Oct 1' })).toBeVisible();
  await expect(page.getByText(/Logging to/)).toHaveCount(0);
});

test("a time later than now can't be saved for today", async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T09:00:00') });
  await page.goto('/');
  await openBench(page);
  await logBench(page, '135', '10');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Did this earlier?' }).click();
  await page.getByRole('textbox', { name: 'When' }).fill('23:30');
  await expect(page.getByRole('button', { name: 'Add set' })).toBeDisabled();
  await expect(page.getByText('Later than now')).toBeVisible();
  await page.getByRole('textbox', { name: 'When' }).fill('08:55');
  await expect(page.getByRole('button', { name: 'Add set' })).toBeEnabled();
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveCount(2);
});

test('the day switch buttons are full-size taps and the header fits at 375 wide', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-30T18:00:00') });
  await page.goto('/');
  for (const name of ['Previous day', 'Next day']) {
    const box = await page.getByRole('button', { name }).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByText(/Logging to/)).toBeVisible();
  // One line: a wrapped heading is taller than a single 22px line.
  expect((await page.getByRole('heading', { name: /Sep 29/ }).boundingBox())!.height).toBeLessThan(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'screenshots/24-day-switch.png' });
});

test('half-typed sets stay on their own day', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-01T18:00:00') });
  await page.goto('/');
  await openBench(page);
  await logBench(page, '135', '10');
  await page.clock.setFixedTime(new Date('2026-10-02T18:00:00'));
  await page.reload();
  await openBench(page);
  const weight = page.getByRole('textbox', { name: 'Weight' });
  await weight.fill('200'); // typed on today, not added
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(weight).toHaveValue('135'); // seeded from that day's set, not today's draft
  await weight.fill('150');
  await page.getByRole('button', { name: 'Back to today' }).click();
  await expect(weight).toHaveValue('200');
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(weight).toHaveValue('150');
});

test('deleting a late set names it by the number on its row', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-01T18:00:00') });
  await page.goto('/');
  await openBench(page);
  for (const t of ['18:00', '18:02', '18:04', '18:14', '18:16']) {
    await page.clock.setFixedTime(new Date(`2026-10-01T${t}:00`));
    await logBench(page, '135', '10');
  }
  await page.clock.setFixedTime(new Date('2026-10-02T09:00:00'));
  await page.reload();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByRole('textbox', { name: 'When' })).toHaveValue('18:09');
  await logBench(page, '135', '9');
  const rows = page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');
  await expect(rows).toHaveCount(6);
  // The late set was entered 6th but done 4th: the prompt must say 4.
  let msg = '';
  page.once('dialog', async (d) => { msg = d.message(); await d.dismiss(); });
  await rows.nth(3).getByRole('button').click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => msg).toBe('Delete set 4?');
  await expect(rows).toHaveCount(6);
});

const pastMidnight = async (page: import('@playwright/test').Page, last: string) => {
  await page.clock.install({ time: new Date(`2026-10-01T${last}:00`) });
  await page.goto('/');
  await openBench(page);
  await logBench(page, '135', '10');
  await page.clock.setFixedTime(new Date('2026-10-02T00:10:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
};

test('a workout past midnight stays on its day', async ({ page }) => {
  await pastMidnight(page, '23:40');
  await expect(page.getByRole('heading', { name: 'Thu, Oct 1' })).toBeVisible();
  await expect(page.getByText('Still logging')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Sets for Bench Press' })).toBeAttached();
  // 00:10 is later than the old day's clock time, and still allowed on it.
  await logBench(page, '135', '9');
  await expect(page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveCount(2);
  await page.screenshot({ path: 'screenshots/26-past-midnight.png' });
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.locator('details.day').filter({ hasText: 'Thu, Oct 1' })).toContainText('1 exercise · 2 sets');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByText('Still logging')).toBeVisible(); // the tab keeps the carry; only the banner button ends it
  await page.locator('.past-day').getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fri, Oct 2' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Sets for Bench Press' })).toHaveCount(0);
  await expect(page.getByText('Still logging')).toHaveCount(0);
});

test("an old workout doesn't carry past midnight", async ({ page }) => {
  await pastMidnight(page, '20:00');
  await expect(page.getByRole('heading', { name: 'Fri, Oct 2' })).toBeVisible();
  await expect(page.getByText('Still logging')).toHaveCount(0);
});

test('the carry ends by itself once the workout is 3 hours old, even with the date unchanged', async ({ page }) => {
  await pastMidnight(page, '23:40');
  await expect(page.getByText('Still logging')).toBeVisible();
  // A phone locked at 00:10 and opened at 06:00: the date was already Oct 2, so only the clock moved.
  await page.clock.setFixedTime(new Date('2026-10-02T06:00:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('heading', { name: 'Fri, Oct 2' })).toBeVisible();
  await expect(page.getByText('Still logging')).toHaveCount(0);
});

test('a late set on the old day can be later than the clock after midnight', async ({ page }) => {
  await pastMidnight(page, '23:40');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Did this earlier?' }).click();
  await page.getByRole('textbox', { name: 'When' }).fill('23:59');
  await expect(page.getByText('Later than now')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add set' })).toBeEnabled();
});

test("a past day's plan is not called today's", async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-01T09:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A/ }).first()).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(page.getByRole('heading', { name: /^Today’s plan · Day/ })).toBeVisible();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await openBench(page); // an empty past day shows no plan, so give it a set
  await logBench(page, '135', '10');
  await expect(page.getByRole('heading', { name: /^Plan · Day/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Today’s plan/ })).toHaveCount(0);
});

test('pasting notes onto a live day keeps the next set prefilled from the last live set', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await openBench(page);
  await logBench(page, '135', '10');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('button', { name: 'Paste from notes' }).click();
  await page.getByLabel('Workout notes').fill(['10/2/26', 'Bench press: 95x12'].join('\n'));
  await page.getByRole('button', { name: 'Read notes' }).click();
  await page.getByLabel('Already in your log — add anyway').check();
  await page.getByRole('button', { name: /^Add 1 set/ }).click();
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'Weight' })).toHaveValue('135');
});

test('editing a set can move its time, and an untouched time stays put', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { (window as unknown as { copied: string }).copied = t; } } });
  });
  await page.goto('/');
  await openBench(page);
  // Odd seconds, so re-saving an unchanged time (which drops seconds) would show.
  for (const [t, reps] of [['18:00:07', '10'], ['18:02:13', '9'], ['18:04:21', '8']]) {
    await page.clock.setFixedTime(new Date(`2026-10-02T${t}`));
    await logBench(page, '135', reps);
  }
  await page.clock.setFixedTime(new Date('2026-10-02T18:10:00'));
  const rows = page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');
  const when = page.getByRole('textbox', { name: 'When' });
  await rows.nth(1).getByRole('button').click();
  await expect(when).toHaveValue('18:02');
  await page.screenshot({ path: 'screenshots/25-edit-time.png', fullPage: true });
  await when.fill('18:05');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // The 9 was done after the 8 now, so the row moves down.
  await expect(rows).toHaveText([/^1\s*135 × 10/, /^2\s*135 × 8/, /^3\s*135 × 9/]);
  await rows.nth(2).getByRole('button').click();
  await expect(when).toHaveValue('18:05');
  await page.getByRole('button', { name: 'Cancel' }).click();
  // Changing only the reps leaves the time (and its seconds) alone.
  await rows.nth(0).getByRole('button').click();
  await expect(when).toHaveValue('18:00');
  await page.getByRole('textbox', { name: 'Reps' }).fill('11');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(rows).toHaveText([/^1\s*135 × 11/, /^2\s*135 × 8/, /^3\s*135 × 9/]);
  await rows.nth(0).getByRole('button').click();
  await expect(when).toHaveValue('18:00');
  await page.getByRole('button', { name: 'Cancel' }).click();
  // Stored times: the moved set keeps when it was entered; the reps-only edit keeps its exact time.
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  await expect(page.getByText('Copied the CSV to the clipboard')).toBeVisible();
  const [head, ...lines] = (await page.evaluate(() => (window as unknown as { copied: string }).copied)).trim().split('\r\n').map((l) => l.split(','));
  const col = (n: string) => head.indexOf(n);
  const byReps = (r: string) => lines.find((l) => l[col('reps')] === r)!;
  const iso = (t: string) => new Date(`2026-10-02T${t}`).toISOString();
  expect([byReps('9')[col('logged_at')], byReps('9')[col('entered_at')]]).toEqual([iso('18:05:00'), iso('18:02:13')]);
  expect([byReps('11')[col('logged_at')], byReps('11')[col('entered_at')]]).toEqual([iso('18:00:07'), '']);
  expect([byReps('8')[col('logged_at')], byReps('8')[col('entered_at')]]).toEqual([iso('18:04:21'), '']);
});

test('a hold lift shows its best hold, not 1RM tiles, rep chips or a test banner', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Plank');
  await page.getByRole('button', { name: /^Plank( · logged)?$/ }).click();
  await page.getByRole('textbox', { name: 'Seconds' }).fill('60');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Plank' }).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Plank', exact: true }).click(); // opens its exercise screen
  await expect(page.getByRole('heading', { name: 'Plank', exact: true })).toBeVisible();
  await expect(page.locator('.tile').filter({ hasText: 'Best hold' })).toContainText('60 s');
  await expect(page.getByText(/Est\. \d*\s*1?RM/)).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Rep max' })).toHaveCount(0);
  await expect(page.getByText('Time for a test')).toHaveCount(0);
  await expect(page.getByText(/no tests yet/)).toHaveCount(0);
  await page.screenshot({ path: 'screenshots/41-hold-exercise.png', fullPage: true });
});

test('a lift logged as a hold is timed in seconds everywhere, whatever its name', async ({ page }, info) => {
  const csv = ['date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,pain_region,pain_severity,logged_at,target_weight_lb,target_reps,target_sets,gym,entered_at', '2026-09-20,Wall Sit Hold X,,1,0,40,,bodyweight;hold,,t,,,,,,,,', '2026-09-27,Wall Sit Hold X,,1,0,50,,bodyweight;hold,,t,,,,,,,,'].join('\n') + '\n';
  const file = info.outputPath('hold.csv');
  (await import('node:fs')).writeFileSync(file, csv);
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(file);
  await expect(page.getByText('✓ Imported 2 new sets')).toBeVisible();
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Wall Sit');
  await page.getByRole('button', { name: /^Wall Sit Hold X/ }).click();
  await expect(page.getByRole('textbox', { name: 'Seconds' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Seconds' }).fill('55');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Wall Sit Hold X' }).getByRole('listitem')).toContainText(['BW × 55s']);
  // Two earlier sessions: the chart plots the longest hold.
  await page.getByRole('button', { name: 'Wall Sit Hold X', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Longest hold over time' })).toBeVisible();
  await expect(page.getByText('Longest hold per session')).toBeVisible();
});
