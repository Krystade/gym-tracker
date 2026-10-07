import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

const buildProgram = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('textbox', { name: 'Days per week' }).fill('2');
  await page.getByRole('textbox', { name: 'Sets per session' }).fill('14');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A/ })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
};

const card = (page: Page, name: string) => page.locator(`[data-card="${name.toLowerCase()}"]`);

const addLift = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  await expect(page.getByRole('list', { name: `Sets for ${name}` })).toBeAttached();
};

const logSets = async (c: Locator, name: string, n: number, weight = '135', reps = '8') => {
  const rows = c.getByRole('list', { name: `Sets for ${name}` }).getByRole('listitem');
  for (let i = 0; i < n; i++) {
    const before = await rows.count();
    await c.getByRole('textbox', { name: 'Weight' }).fill(weight);
    await c.getByRole('textbox', { name: 'Reps' }).fill(reps);
    await c.getByRole('button', { name: 'Add set' }).click();
    // Saved: the row appears, or the card folded away with it (the set that finishes the lift).
    await expect.poll(async () => (await rows.count()) === before + 1 || (await c.getByRole('button', { name: /^Show / }).count()) > 0).toBe(true);
  }
};

// The first planned lift and its planned set count, read from the plan rows.
const firstPlanned = async (page: Page, nth = 0) => {
  const row = page.getByRole('list', { name: 'Planned exercises' }).getByRole('listitem').nth(nth);
  const lift = (await row.locator('.plan-name').getAttribute('data-exercise'))!;
  const n = Number((await row.locator('.plan-count').innerText()).split('/')[1]);
  return { lift, n };
};

const order = (page: Page) => page.locator('[data-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')));

test('a card keeps its place when its first set is logged', async ({ page }) => {
  await page.goto('/');
  for (const n of ['Bench Press', 'Lat Pulldown', 'Cable Curl']) await addLift(page, n);
  expect(await order(page)).toEqual(['bench press', 'lat pulldown', 'cable curl']);
  await logSets(card(page, 'Lat Pulldown'), 'Lat Pulldown', 1);
  expect(await order(page)).toEqual(['bench press', 'lat pulldown', 'cable curl']);
});

test('a lift folds to one line when it reaches its planned sets, and tapping opens it', async ({ page }) => {
  await buildProgram(page);
  const { lift, n } = await firstPlanned(page);
  await page.getByRole('list', { name: 'Planned exercises' }).getByRole('listitem').first().locator('.plan-name').click();
  const c = card(page, lift);
  await expect(c).toBeAttached();
  await logSets(c, lift, n - 1);
  await expect(c.getByRole('textbox', { name: 'Weight' })).toBeVisible(); // one short: still open
  await logSets(c, lift, 1);
  const folded = c.getByRole('button', { name: `Show ${lift}` });
  await expect(folded).toHaveAttribute('aria-expanded', 'false');
  await expect(c).toContainText(`${n}/${n} sets`);
  await expect(c).toContainText('135 × 8');
  await expect(c.getByRole('textbox', { name: 'Weight' })).toBeHidden();
  // The fold is one line; the card under it also offers what's left of the plan.
  expect((await folded.boundingBox())!.height).toBeLessThan(80);
  await expect(c.getByRole('group', { name: 'Left to do' })).toBeVisible();
  expect((await folded.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // Tap: the form is back, and one more set leaves it open.
  await folded.click();
  await expect(c.getByRole('textbox', { name: 'Weight' })).toBeVisible();
  await logSets(c, lift, 1);
  await expect(c.getByRole('textbox', { name: 'Weight' })).toBeVisible();
  await expect(c.getByRole('button', { name: `Show ${lift}` })).toHaveCount(0);
  // Fold puts it away again; a reload starts a completed lift folded.
  await c.getByRole('button', { name: 'Fold', exact: true }).click();
  await expect(c.getByRole('button', { name: `Show ${lift}` })).toBeVisible();
  await c.getByRole('button', { name: `Show ${lift}` }).click();
  await page.reload();
  await expect(card(page, lift).getByRole('button', { name: `Show ${lift}` })).toBeVisible();
});

test('tapping a folded lift in the plan opens its card and scrolls to it', async ({ page }) => {
  await buildProgram(page);
  const { lift, n } = await firstPlanned(page);
  await page.getByRole('list', { name: 'Planned exercises' }).getByRole('listitem').first().locator('.plan-name').click();
  await logSets(card(page, lift), lift, n);
  await expect(card(page, lift).getByRole('button', { name: `Show ${lift}` })).toBeVisible();
  for (const x of ['Bench Press', 'Lat Pulldown', 'Cable Curl']) await addLift(page, x);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole('button', { name: /^Today’s plan/ })).toHaveAttribute('aria-expanded', 'true'); // open while lifts are left
  await page.getByRole('list', { name: 'Planned exercises' }).locator(`.plan-name[data-exercise="${lift}"]`).click();
  await expect(card(page, lift).getByRole('textbox', { name: 'Weight' })).toBeVisible();
  await expect(card(page, lift).getByRole('button', { name: lift, exact: true })).toBeInViewport();
});

test('a lift that is not on the plan never folds', async ({ page }) => {
  await buildProgram(page);
  const planned = await page.getByRole('list', { name: 'Planned exercises' }).locator('.plan-name').evaluateAll((els) => els.map((e) => e.getAttribute('data-exercise')!.toLowerCase()));
  const lift = ['Face Pull', 'Standing Calf Raise', 'Chin-up'].find((x) => !planned.includes(x.toLowerCase()))!;
  await addLift(page, lift);
  await logSets(card(page, lift), lift, 5);
  await expect(card(page, lift).getByRole('textbox', { name: 'Weight' })).toBeVisible();
  await expect(card(page, lift).getByRole('button', { name: `Show ${lift}` })).toHaveCount(0);
});

test('four cards: two folded, one in progress, one untouched', async ({ page }) => {
  await buildProgram(page);
  const a = await firstPlanned(page, 0);
  const b = await firstPlanned(page, 1);
  for (const x of [a, b]) {
    const list = page.getByRole('list', { name: 'Planned exercises' });
    if (!(await list.isVisible())) await page.getByRole('button', { name: /^Today’s plan/ }).click(); // open on an empty day, folded after
    await list.locator(`.plan-name[data-exercise="${x.lift}"]`).click();
    await logSets(card(page, x.lift), x.lift, x.n);
  }
  await addLift(page, 'Face Pull');
  await logSets(card(page, 'Face Pull'), 'Face Pull', 1, '40', '12');
  await addLift(page, 'Chin-up');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: process.env.P18_SHOT ?? 'test-results/p18-today-cards.png', fullPage: true });
  await expect(page.getByRole('button', { name: /^Show / })).toHaveCount(2);
});
