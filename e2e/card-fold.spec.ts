import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { goto, openProgram } from './nav';

// Owner, 2026-10-19: an open lift card could only be closed by finishing it; Save on an edited set seemed to do nothing.
const card = (page: Page, name: string) => page.locator(`[data-card="${name.toLowerCase()}"]`);
const addLift = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  await expect(page.getByRole('list', { name: `Sets for ${name}` })).toBeAttached();
};
const log = async (c: Locator, name: string, weight: string, reps: string) => {
  const rows = c.getByRole('list', { name: `Sets for ${name}` }).getByRole('listitem');
  const before = await rows.count();
  await c.getByRole('textbox', { name: 'Weight' }).fill(weight);
  await c.getByRole('textbox', { name: 'Reps' }).fill(reps);
  await c.getByRole('button', { name: /^Add set/ }).click();
  await expect(rows).toHaveCount(before + 1);
};

test('Save on an edited set, with the rest timer up, saves and closes the editor', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-19T18:00:00') });
  await page.goto('/');
  await addLift(page, 'Cable Pushdown');
  const c = card(page, 'Cable Pushdown');
  for (const r of ['11', '11', '8']) await log(c, 'Cable Pushdown', '120', r);
  await expect(page.getByRole('timer', { name: 'Rest' })).toBeVisible();
  await c.getByRole('list', { name: 'Sets for Cable Pushdown' }).getByRole('button').first().click();
  await expect(c.getByText('Editing set 1')).toBeVisible();
  await c.getByRole('textbox', { name: 'Reps' }).fill('12');
  const save = c.getByRole('button', { name: 'Save', exact: true });
  // Clear of the rest bar, so a tap lands on Save.
  const s = (await save.boundingBox())!, bar = (await page.locator('.rest-timer').boundingBox())!;
  expect(s.y + s.height).toBeLessThanOrEqual(bar.y);
  await save.click();
  await expect(c.getByText('Editing set 1')).toHaveCount(0);
  await expect(c.getByRole('list', { name: 'Sets for Cable Pushdown' }).getByRole('listitem').first()).toContainText('120 × 12');
  await expect(c.getByRole('button', { name: /^Add set/ })).toBeVisible();
});

test('editing a set low on the screen brings Save above the rest bar, not just into the window', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-19T18:00:00') });
  await page.goto('/');
  await addLift(page, 'Cable Pushdown');
  const c = card(page, 'Cable Pushdown');
  for (const r of ['11', '11', '8']) await log(c, 'Cable Pushdown', '120', r);
  await addLift(page, 'Cable Curl');
  await expect(page.getByRole('timer', { name: 'Rest' })).toBeVisible();
  // The last set's row just above the rest bar: its editor opens below the fold.
  const row = c.getByRole('list', { name: 'Sets for Cable Pushdown' }).getByRole('button').last();
  const bar = (await page.locator('.rest-timer').boundingBox())!;
  await row.evaluate((el, top) => { window.scrollBy(0, el.getBoundingClientRect().bottom - top + 4); }, bar.y);
  await row.click();
  const save = c.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeVisible();
  await expect.poll(async () => { const s = (await save.boundingBox())!; return s.y + s.height <= bar.y; }).toBe(true);
  await c.getByRole('textbox', { name: 'Reps' }).fill('9');
  await save.click();
  await expect(c.getByText('Editing set 3')).toHaveCount(0);
});

test('every open lift card folds from its head, and opens again with a tap; a card not started folds too', async ({ page }) => {
  await page.goto('/');
  await addLift(page, 'Cable Pushdown');
  await addLift(page, 'Cable Curl');
  const c = card(page, 'Cable Pushdown');
  await log(c, 'Cable Pushdown', '120', '11');
  await log(c, 'Cable Pushdown', '120', '11');
  const fold = c.getByRole('button', { name: 'Fold Cable Pushdown' });
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  // A 44 px tap, inside the card at 375 px.
  const f = (await fold.boundingBox())!;
  expect(f.width).toBeGreaterThanOrEqual(44);
  expect(f.height).toBeGreaterThanOrEqual(44);
  expect(f.x + f.width).toBeLessThanOrEqual(375 - 16);
  await c.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'screenshots/r16-card-open.png' });
  await fold.click();
  const line = c.getByRole('button', { name: 'Show Cable Pushdown' });
  await expect(line).toHaveAttribute('aria-expanded', 'false');
  await expect(line).toContainText('2 sets');
  await expect(c.getByRole('textbox', { name: 'Weight' })).toHaveCount(0);
  // Not started: folds to a line that says so.
  await card(page, 'Cable Curl').getByRole('button', { name: 'Fold Cable Curl' }).click();
  await expect(card(page, 'Cable Curl').getByRole('button', { name: 'Show Cable Curl' })).toContainText('Not started');
  await page.screenshot({ path: 'screenshots/r16-cards-folded.png' });
  await line.click();
  await expect(c.getByRole('textbox', { name: 'Weight' })).toBeVisible();
  await log(c, 'Cable Pushdown', '120', '8');
  await expect(c.getByRole('textbox', { name: 'Weight' })).toBeVisible(); // no plan: open as long as you're on it
});

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');
const buildProgram = async (page: Page) => {
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await goto(page, 'Today');
  await openProgram(page);
  await page.getByRole('textbox', { name: 'Days per week' }).fill('2');
  await page.getByRole('textbox', { name: 'Sets per session' }).fill('14');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A/ })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
};
const firstPlanned = async (page: Page) => {
  const row = page.getByRole('list', { name: 'Planned exercises' }).getByRole('listitem').first();
  return { row, lift: (await row.locator('.plan-name').getAttribute('data-exercise'))!, n: Number((await row.locator('.plan-count').innerText()).split('/')[1]) };
};

test('a finished lift opened to fix a set folds again on Save', async ({ page }) => {
  await buildProgram(page);
  const { row, lift, n } = await firstPlanned(page);
  await row.locator('.plan-name').click();
  const c = card(page, lift);
  for (let i = 0; i < n; i++) {
    await c.getByRole('textbox', { name: 'Weight' }).fill('100');
    await c.getByRole('textbox', { name: 'Reps' }).fill('8');
    await c.getByRole('button', { name: /^Add set/ }).click();
    await expect.poll(async () => (await c.getByRole('list', { name: `Sets for ${lift}` }).getByRole('listitem').count()) === i + 1 || (await c.getByRole('button', { name: `Show ${lift}` }).count()) > 0).toBe(true);
  }
  const line = c.getByRole('button', { name: `Show ${lift}` });
  await expect(line).toBeVisible();
  await line.click();
  await c.getByRole('list', { name: `Sets for ${lift}` }).getByRole('button').first().click();
  await c.getByRole('textbox', { name: 'Reps' }).fill('9');
  await c.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(line).toBeVisible();
  await expect(c.getByText('Editing set 1')).toHaveCount(0);
  await line.click();
  await expect(c.getByRole('list', { name: `Sets for ${lift}` }).getByRole('listitem').first()).toContainText('× 9');
  // Opened, it folds from its head as any card does.
  await c.getByRole('button', { name: `Fold ${lift}` }).click();
  await expect(line).toBeVisible();
});

test('a swap in the plan takes away the replaced lift’s card while nothing is logged on it', async ({ page }) => {
  await buildProgram(page);
  const { row, lift } = await firstPlanned(page);
  await row.locator('.plan-name').click();
  await expect(card(page, lift).getByRole('textbox', { name: 'Weight' })).toBeVisible();
  await row.getByRole('button', { name: /^Swap/ }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Standing Cable Crunch');
  await page.getByRole('button', { name: /^Add “Standing Cable Crunch”/ }).click();
  await expect(card(page, 'Standing Cable Crunch')).toBeVisible();
  await expect(card(page, lift)).toHaveCount(0);
});

test('a swapped-away lift with a set today keeps its card', async ({ page }) => {
  await buildProgram(page);
  const { row, lift } = await firstPlanned(page);
  await row.locator('.plan-name').click();
  await log(card(page, lift), lift, '100', '8');
  await row.getByRole('button', { name: /^Swap/ }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Standing Cable Crunch');
  await page.getByRole('button', { name: /^Add “Standing Cable Crunch”/ }).click();
  await expect(card(page, 'Standing Cable Crunch')).toBeVisible();
  await expect(card(page, lift)).toBeVisible();
});

// Owner, 2026-10-23: opening Add exercise (or Swap) on Today opened again every card he had folded by hand. The picker takes
// Today's place, and each card's fold went with it.
test('a card folded by hand stays folded through Add exercise, cancelled or used', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-19T18:00:00') });
  await page.goto('/');
  await addLift(page, 'Cable Pushdown');
  const c = card(page, 'Cable Pushdown');
  await log(c, 'Cable Pushdown', '120', '10');
  await c.getByRole('button', { name: 'Fold Cable Pushdown' }).click();
  await expect(c).toHaveClass(/\bfolded\b/);
  // Cancelled: back on Today, the card as he left it.
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Cable Curl');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(c).toHaveClass(/\bfolded\b/);
  // Used: another lift added, and the folded one still folded.
  await addLift(page, 'Cable Curl');
  await expect(card(page, 'Cable Curl')).not.toHaveClass(/\bfolded\b/);
  await expect(c).toHaveClass(/\bfolded\b/);
});
