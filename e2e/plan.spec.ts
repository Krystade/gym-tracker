import { expect, test, type Page } from '@playwright/test';
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

test('tapping a planned lift jumps to its card', async ({ page }) => {
  await buildProgram(page);
  // Cards already on screen push a new one below the fold, so only the jump can bring it into view.
  for (const n of ['Bench Press', 'Cable Curl', 'Hammer Curl']) {
    await page.getByRole('button', { name: 'Add exercise' }).click();
    await page.getByRole('searchbox', { name: 'Search exercises' }).fill(n);
    await page.getByRole('button', { name: new RegExp(`^${n}`) }).first().click();
    await expect(page.getByRole('list', { name: `Sets for ${n}` })).toBeAttached();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: /^Today’s plan/ }).click();
  const row = page.getByRole('list', { name: 'Planned exercises' }).getByRole('listitem').nth(1).locator('.plan-name');
  const lift = (await row.getAttribute('data-exercise'))!;
  await row.click();
  await expect(page.locator('[data-card]').getByRole('button', { name: lift, exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: /^Today’s plan/ })).toHaveAttribute('aria-expanded', 'false');
});

test('the plan folds once a card is on screen and opens on tap', async ({ page }) => {
  await buildProgram(page);
  await expect(page.getByRole('list', { name: 'Planned exercises' })).toBeVisible();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  await expect(page.getByRole('list', { name: 'Sets for Cable Curl' })).toBeAttached();
  await expect(page.getByRole('list', { name: 'Planned exercises' })).toBeHidden();
  await expect(page.getByRole('heading', { name: /^Today’s plan · Day A/ })).toBeVisible();
  await page.getByRole('button', { name: /^Today’s plan/ }).click();
  await expect(page.getByRole('list', { name: 'Planned exercises' })).toBeVisible();
});

test('an empty past day shows no plan', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T09:00:00') });
  await buildProgram(page);
  await expect(page.getByRole('list', { name: 'Planned exercises' })).toBeVisible();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByRole('heading', { name: 'Thu, Oct 1' })).toBeVisible();
  await expect(page.getByText('Nothing logged that day.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Planned exercises' })).toHaveCount(0);
  await page.screenshot({ path: 'screenshots/37-past-day.png' });
});

test('the past-day banner is one line at 375 wide', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T09:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByText('Logging to a past day')).toBeVisible();
  // One line: the 44px button plus the card padding make the banner 70 tall; a wrapped label would add a line to the text.
  expect((await page.locator('.past-day span').boundingBox())!.height).toBeLessThan(30);
  expect((await page.locator('.past-day').boundingBox())!.height).toBeLessThan(80);
});

test('with logged sets the plan starts folded, even after a reload', async ({ page }) => {
  await buildProgram(page);
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  await page.getByRole('textbox', { name: 'Weight' }).fill('30');
  await page.getByRole('textbox', { name: 'Reps' }).fill('10');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('list', { name: 'Sets for Cable Curl' })).toBeAttached();
  await expect(page.getByRole('button', { name: /^Today’s plan/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('list', { name: 'Planned exercises' })).toBeHidden();
});

test('a jump lands the card below the profile bar', async ({ page }) => {
  await buildProgram(page);
  // A second person brings the profile bar; switch straight back to Me (no reload, so Sam's save can't race it).
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sam');
  await page.getByRole('button', { name: 'Add Sam' }).click();
  const bar = page.getByRole('group', { name: 'Who’s training' });
  await expect(bar.getByRole('button', { name: /Sam/ })).toHaveAttribute('aria-pressed', 'true');
  await bar.getByRole('button', { name: /Me/ }).click();
  await expect(bar.getByRole('button', { name: /Me/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Today' }).click();
  const plan = page.getByRole('button', { name: /^Today’s plan/ });
  const row = (i: number) => page.getByRole('list', { name: 'Planned exercises' }).getByRole('listitem').nth(i).locator('.plan-name');
  for (let i = 0; i < 4; i++) {
    if ((await plan.getAttribute('aria-expanded')) === 'false') await plan.click();
    await row(i).click();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await plan.click();
  const lift = (await row(0).getAttribute('data-exercise'))!;
  await row(0).click();
  const head = page.locator('[data-card]').getByRole('button', { name: lift, exact: true });
  await expect(head).toBeInViewport();
  const barBottom = await page.getByRole('group', { name: 'Who’s training' }).evaluate((el) => el.getBoundingClientRect().bottom);
  expect((await head.boundingBox())!.y).toBeGreaterThanOrEqual(barBottom);
});

test('the longest catalog name fits its plan row without being cut', async ({ page }) => {
  await buildProgram(page);
  const b = page.getByRole('list', { name: 'Planned exercises' }).locator('.plan-name b').first();
  const cut = await b.evaluate((el) => { el.textContent = 'Overhead DB Triceps Extension'; return el.scrollHeight > el.clientHeight + 1; });
  expect(cut).toBe(false);
});
