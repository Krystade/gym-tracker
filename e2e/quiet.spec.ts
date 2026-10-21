import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { goto } from './nav';
import { commitsOf, recordRenders, rendersAbove, watchRenders } from './renders';

// What changes nothing renders nothing: a minute going by, and the commits that only cleared a one-off request (a card to
// bring up, a folded card to open, a superset's next lift). With years of history each render of Today is a long freeze.
test.use({ serviceWorkers: 'block' });
const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');
const today = (page: Page) => page.locator('.today-head h1');

async function addCard(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  return page.locator(`[data-card="${name.toLowerCase()}"]`);
}

/** A set on `card`, with weight and reps the first time (the form keeps them after). */
async function logSet(card: Locator, weight?: string) {
  if (weight) {
    await card.getByRole('textbox', { name: 'Weight' }).fill(weight);
    await card.getByRole('textbox', { name: 'Reps' }).fill('10');
  }
  await card.getByRole('button', { name: /^Add set/ }).click();
}

/** Lets whatever a step set off land (a render, an IndexedDB write and its update) before counting. */
const settle = (page: Page) => page.waitForTimeout(1000);

test('a minute going by renders nothing on Today or History, and the day still turns over at midnight', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T20:50:00') });
  await watchRenders(page);
  await page.goto('/');
  const bench = await addCard(page, 'Bench Press');
  await logSet(bench, '135');
  await expect(bench.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveCount(1);
  await expect(today(page)).toHaveText('Fri, Oct 2');

  await recordRenders(page);
  await page.clock.fastForward(60_000);
  await page.clock.fastForward(60_000);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // the app shown again
  await settle(page);
  expect(await commitsOf(today(page))).toBe(0);

  await goto(page, 'History');
  const history = page.getByRole('heading', { name: 'History', level: 1 });
  await expect(page.locator('details.day')).toHaveCount(1);
  await recordRenders(page);
  await page.clock.fastForward(60_000);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await settle(page);
  expect(await commitsOf(history)).toBe(0);

  // Left open past midnight (the workout over 3 hours old by then), no event: the minute's look turns the day, and the
  // instrument sees that render.
  await goto(page, 'Today');
  await recordRenders(page);
  await page.clock.fastForward('03:10:00');
  await expect(today(page)).toHaveText('Sat, Oct 3');
  expect(await rendersAbove(today(page))).toBeGreaterThan(0);
});

test('past midnight, a workout carried to its day lets go on the minute once it is 3 hours old, with the app left open', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-01T23:40:00') });
  await page.goto('/');
  const bench = await addCard(page, 'Bench Press');
  await logSet(bench, '135');
  await expect(bench.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveCount(1);
  await page.clock.fastForward('30:00'); // 00:10, Oct 2 by the date
  await expect(today(page)).toHaveText('Thu, Oct 1');
  await expect(page.getByText('Still logging')).toBeVisible();
  await page.clock.fastForward('02:31:00'); // 02:41: the last set is over 3 hours old; the date hasn't changed since 00:10
  await expect(today(page)).toHaveText('Fri, Oct 2');
  await expect(page.getByText('Still logging')).toHaveCount(0);
});

async function buildProgram(page: Page) {
  await page.goto('/');
  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('textbox', { name: 'Days per week' }).fill('2');
  await page.getByRole('textbox', { name: 'Sets per session' }).fill('14');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A/ })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
}

test('a planned lift tapped renders Today once: its card comes up, a finished one opens, and a folded one stays folded after', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await watchRenders(page);
  await buildProgram(page);
  const rows = page.getByRole('list', { name: 'Planned exercises' }).getByRole('listitem');
  const name = async (i: number) => (await rows.nth(i).locator('.plan-name').getAttribute('data-exercise'))!;
  const card = (n: string) => page.locator(`[data-card="${n.toLowerCase()}"]`);

  // Finish the first lift (the tap that opens it also records the day's plan): its card folds.
  const first = await name(0);
  const sets = Number((await rows.nth(0).locator('.plan-count').textContent())!.split('/')[1]);
  await rows.nth(0).locator('.plan-name').click();
  for (let i = 0; i < sets; i++) {
    const w = card(first).getByRole('textbox', { name: 'Weight' });
    if ((await w.inputValue()) === '') await w.fill('50');
    await card(first).getByRole('button', { name: /^Add set/ }).click();
    if (i < sets - 1) await expect(card(first).getByRole('list', { name: `Sets for ${first}` }).getByRole('listitem')).toHaveCount(i + 1);
  }
  await expect(card(first).getByRole('button', { name: `Show ${first}` })).toBeVisible();
  await page.getByRole('timer').getByRole('button', { name: 'Close rest timer' }).click();
  await settle(page);

  // A lift not started: one render, and its card is brought into view.
  await page.evaluate(() => window.scrollTo(0, 0));
  const second = await name(1);
  await recordRenders(page);
  await rows.nth(1).locator('.plan-name').click();
  await expect(card(second).getByRole('button', { name: second, exact: true })).toBeInViewport();
  await settle(page);
  expect(await commitsOf(today(page))).toBe(1);

  // The finished one: one render, and it opens.
  await page.evaluate(() => window.scrollTo(0, 0));
  await recordRenders(page);
  await rows.nth(0).locator('.plan-name').click();
  await expect(card(first).getByRole('list', { name: `Sets for ${first}` })).toBeInViewport();
  await settle(page);
  expect(await commitsOf(today(page))).toBe(1);

  // Folded again by hand, it stays folded when the cards come back after the picker: the plan's request was used once.
  await card(first).getByRole('button', { name: 'Fold' }).click();
  await expect(card(first).getByRole('button', { name: `Show ${first}` })).toBeVisible();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(card(second)).toBeVisible();
  await expect(card(first).getByRole('button', { name: `Show ${first}` })).toBeVisible();
});

test('a set that switches to the superset’s other lift renders Today once, and that card comes up', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await watchRenders(page);
  await page.goto('/');
  const curl = await addCard(page, 'Cable Curl'), push = await addCard(page, 'Cable Pushdown');
  const at = async (card: Locator, time: string, weight?: string) => {
    await page.clock.pauseAt(new Date(`2026-10-16T${time}`));
    await logSet(card, weight);
  };
  await at(curl, '18:30:00', '40');
  await expect(page.getByRole('timer', { name: 'Rest' })).toContainText('2:00');
  await at(push, '18:31:00', '50');
  await expect(page.getByRole('timer', { name: 'Rest' })).toContainText('2:00');
  await settle(page);
  await recordRenders(page);
  // Back to curls after the rest: a pair, so a short switch and the pushdown's card comes up.
  await at(curl, '18:33:30');
  await expect(page.getByRole('timer', { name: 'Switch' })).toContainText('0:15');
  await expect(push.locator('.card-head .link')).toBeFocused();
  await settle(page);
  expect(await commitsOf(today(page))).toBe(1);
});

test('History puts a folded month’s days on the page only once it is opened, with the tap that opens it', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T18:00:00') });
  await page.goto('/');
  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE); // two days in January 2026
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  const march = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source\n2026-03-03,Leg Press,,1,200,10,,,,sample';
  await page.getByLabel('Import CSV').setInputFiles({ name: 'march.csv', mimeType: 'text/csv', buffer: Buffer.from(march) });
  await expect(page.getByText(/Imported 1 new/)).toBeVisible();
  await goto(page, 'Today');
  const curl = await addCard(page, 'Cable Curl');
  await logSet(curl);
  await expect(curl.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem')).toHaveCount(1);
  await goto(page, 'History');
  const months = page.locator('details.month');
  await expect(months).toHaveCount(3);
  await expect(months.nth(0).locator('details.day')).toHaveCount(1);
  await expect(months.nth(0).locator('details.day').first()).toHaveAttribute('open', '');
  const jan = months.nth(2);
  await expect(jan.locator('> summary')).toContainText('January 2026 · 2 sessions');
  await expect(jan).not.toHaveAttribute('open');
  await expect(jan.locator('details.day')).toHaveCount(0);
  // The days are there as the month opens, not a frame after (the toggle event comes later).
  const days = await jan.evaluate(async (m) => {
    m.querySelector('summary')!.click();
    await Promise.resolve();
    return m.querySelectorAll('details.day').length;
  });
  expect(days).toBe(2);
  await expect(jan).toHaveAttribute('open', '');
  const jan5 = jan.locator('details.day').filter({ hasText: 'Jan 5' });
  await expect(jan5).not.toHaveAttribute('open');
  await jan5.locator('summary').click();
  await expect(jan5.getByRole('button', { name: /^Cable Curl/ })).toContainText('60 × 12, 70 × 10');
  // Folded and opened again: still there, once.
  await jan.locator('> summary').click();
  await jan.locator('> summary').click();
  await expect(jan.locator('details.day')).toHaveCount(2);
  // Opened some other way than a tap: its days come with the toggle.
  await expect(months.nth(1).locator('details.day')).toHaveCount(0);
  await months.nth(1).evaluate((m) => { (m as HTMLDetailsElement).open = true; });
  await expect(months.nth(1).locator('details.day')).toHaveCount(1);
  await expect(months.nth(1).locator('details.day summary')).toContainText('1 exercise · 1 set');
});

test('a time later than now stops being one as the minute comes, with nothing typed', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:20') });
  await page.goto('/');
  const bench = await addCard(page, 'Bench Press');
  await bench.getByRole('textbox', { name: 'Weight' }).fill('135');
  await bench.getByRole('textbox', { name: 'Reps' }).fill('10');
  await bench.getByRole('button', { name: 'Details' }).click();
  await bench.getByRole('button', { name: 'Did this earlier?' }).click();
  await bench.getByRole('textbox', { name: 'When' }).fill('18:01');
  await expect(bench.getByText('Later than now (18:00)')).toBeVisible();
  await expect(bench.getByRole('button', { name: /^Add set/ })).toBeDisabled();
  await page.clock.fastForward(60_000);
  await expect(bench.getByText('Later than now')).toHaveCount(0);
  await expect(bench.getByRole('button', { name: /^Add set/ })).toBeEnabled();
});
