import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { dataSettled } from './settle';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');
const nav = (page: Page, t: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: t, exact: true }).click();

const importFixture = async (page: Page) => {
  await page.goto('/');
  await nav(page, 'Data');
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await nav(page, 'Today');
};
const buildProgram = async (page: Page) => {
  await importFixture(page);
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('textbox', { name: 'Days per week' }).fill('2');
  await page.getByRole('textbox', { name: 'Sets per session' }).fill('14');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A/ })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
};
const addCard = async (page: Page, n: string) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(n);
  await page.getByRole('button', { name: new RegExp(`^${n}`) }).first().click();
  await expect(page.getByRole('list', { name: `Sets for ${n}` })).toBeAttached();
};
/** Opens the plan's first lift and returns its name and planned set count. */
const firstPlanned = async (page: Page) => {
  const row = page.getByRole('list', { name: 'Planned exercises' }).getByRole('listitem').first();
  const name = (await row.locator('.plan-name').getAttribute('data-exercise'))!;
  const sets = Number((await row.locator('.plan-count').textContent())!.split('/')[1]);
  await row.locator('.plan-name').click();
  return { name, sets, card: page.locator(`[data-card="${name.toLowerCase()}"]`) };
};
const logSet = async (card: ReturnType<Page['locator']>) => {
  const w = card.getByRole('textbox', { name: 'Weight' });
  if ((await w.inputValue()) === '') await w.fill('50');
  await card.getByRole('button', { name: /^Add set/ }).click();
};

test('once a lift is done, the folded plan lists what is left', async ({ page }) => {
  await buildProgram(page);
  const { name, sets, card } = await firstPlanned(page);
  for (let i = 0; i < sets; i++) await logSet(card);
  await expect(card.getByRole('button', { name: `Show ${name}` })).toBeVisible();
  const left = page.getByRole('group', { name: 'Left to do' });
  await expect(left).toBeVisible();
  await expect(left.getByRole('button', { name, exact: true })).toHaveCount(0);
  const next = left.getByRole('button').first();
  const lift = (await next.textContent())!;
  await next.click();
  await expect(page.locator(`[data-card="${lift.toLowerCase()}"]`)).toBeInViewport();
});

test('folding a finished card does not jump the page', async ({ page }) => {
  await buildProgram(page);
  await addCard(page, 'Cable Curl');
  await addCard(page, 'Pull-up');
  await page.evaluate(() => scrollTo(0, 0));
  await page.getByRole('button', { name: /^Today’s plan/ }).click();
  const { sets, card } = await firstPlanned(page); // the last card on the page
  for (let i = 0; i < sets - 1; i++) await logSet(card);
  // Saves land async; measure once they've rendered, or Playwright's own click scroll chases the moving button.
  await expect(card.getByRole('list', { name: /^Sets for / }).getByRole('listitem')).toHaveCount(sets - 1);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const before = (await card.boundingBox())!.y;
  await logSet(card);
  await expect(card.locator('.fold-line')).toBeVisible();
  expect(Math.abs((await card.boundingBox())!.y - before)).toBeLessThan(3);
});

test('a lift with no history starts with an empty weight, unless it needs no gear', async ({ page }) => {
  await importFixture(page);
  await addCard(page, 'Leg Extension');
  const leg = page.locator('[data-card="leg extension"]');
  await expect(leg.getByRole('textbox', { name: 'Weight' })).toHaveValue('');
  await expect(leg.getByText('Enter a weight (0 for bodyweight)')).toBeVisible();
  await expect(leg.getByRole('button', { name: /^Add set/ })).toBeDisabled();
  await addCard(page, 'Push-up');
  await expect(page.locator('[data-card="push-up"]').getByRole('textbox', { name: 'Weight' })).toHaveValue('0');
});

test('a swapped-in card says what it replaces', async ({ page }) => {
  await buildProgram(page);
  const row = page.getByRole('list', { name: 'Planned exercises' }).getByRole('listitem').first();
  const orig = (await row.locator('.plan-name').getAttribute('data-exercise'))!;
  await row.locator('.plan-name').click();
  await logSet(page.locator(`[data-card="${orig.toLowerCase()}"]`)); // 50 lb on the original
  await page.evaluate(() => scrollTo(0, 0));
  await page.getByRole('button', { name: /^Today’s plan/ }).click();
  await row.getByRole('button', { name: 'Swap' }).click();
  await page.getByLabel('Suggested swaps').getByRole('button').first().click();
  const card = page.locator('[data-card]').filter({ hasText: new RegExp(`For ${orig}`) });
  await expect(card).toBeVisible();
  // With no history of its own, a typo is judged against the lift it replaces.
  await card.getByRole('textbox', { name: 'Weight' }).fill('9000');
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(card.getByText(/9000 lb is \d+× your best/)).toBeVisible();
});

test('with two people, Add set names whose set it is', async ({ page }) => {
  await importFixture(page);
  await addCard(page, 'Cable Curl');
  await expect(page.getByRole('button', { name: 'Add set', exact: true })).toBeVisible();
  await nav(page, 'Data');
  await dataSettled(page);
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sam');
  await page.getByRole('button', { name: 'Add Sam' }).click();
  await nav(page, 'Today');
  await addCard(page, 'Cable Curl');
  await expect(page.getByRole('button', { name: 'Add set · Sam' })).toBeVisible();
});

test('turning on Pain brings its fields into view, and the row shows how bad', async ({ page }) => {
  await importFixture(page);
  await addCard(page, 'Cable Curl');
  const card = page.locator('[data-card="cable curl"]');
  await card.getByRole('button', { name: 'More' }).click();
  await card.getByRole('button', { name: 'Pain', exact: true }).click();
  // In view means above the fixed tab bar, not merely inside the window.
  const bar = (await page.getByRole('navigation', { name: 'Sections' }).boundingBox())!.y;
  await expect.poll(async () => { const g = (await card.getByRole('group', { name: 'Pain severity' }).boundingBox())!; return g.y + g.height <= bar && g.y >= 0; }).toBe(true);
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(card.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem').first()).toContainText('mild');
});

test('a weight over twice your best asks once before saving', async ({ page }) => {
  await importFixture(page);
  await addCard(page, 'Cable Curl'); // best working set: 80 lb
  const card = page.locator('[data-card="cable curl"]');
  await card.getByRole('textbox', { name: 'Weight' }).fill('801');
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(card.getByText(/801 lb is 10× your best/)).toBeVisible();
  await expect(card.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem')).toHaveCount(0);
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(card.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem')).toHaveCount(1);
  // A normal weight saves on the first tap.
  await card.getByRole('textbox', { name: 'Weight' }).fill('85');
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(card.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem')).toHaveCount(2);
});
