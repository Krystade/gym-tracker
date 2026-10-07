import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

// Spacing rhythm: 12px between blocks, cards inset evenly, controls clear of the text beside them.
const FX = (f: string) => path.join(import.meta.dirname, 'fixtures', f);
const nav = (page: Page, t: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: t, exact: true }).click();

/** Cards whose content sits further from the top edge than the bottom (or the reverse) by more than 2px. */
const unevenCards = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main .card')].flatMap((c) => {
  const kids = [...c.children].filter((k) => { const r = k.getBoundingClientRect(); return r.height > 0 && getComputedStyle(k).position !== 'absolute'; });
  if (!kids.length || c.classList.contains('folded')) return [];
  const r = c.getBoundingClientRect(), cs = getComputedStyle(c);
  const top = kids[0].getBoundingClientRect().top - r.top - parseFloat(cs.borderTopWidth);
  const bottom = r.bottom - parseFloat(cs.borderBottomWidth) - kids.at(-1)!.getBoundingClientRect().bottom;
  return Math.abs(top - bottom) > 2 ? [`${c.className} "${(c.textContent ?? '').trim().slice(0, 24)}": ${Math.round(top)} top, ${Math.round(bottom)} bottom`] : [];
}));

const gap = async (page: Page, above: string, below: string) => {
  const a = (await page.locator(above).first().boundingBox())!, b = (await page.locator(below).first().boundingBox())!;
  return Math.round(b.y - (a.y + a.height));
};

test('Today: the energy row and the date arrows have room, and the button under the log sits 12px below it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
  expect(await gap(page, '[role=group][aria-label=Energy]', 'main p.muted')).toBeGreaterThanOrEqual(12);
  expect(await gap(page, 'main p.muted', 'button:text-is("Add exercise")')).toBe(12);
  const [prev, title, next] = await Promise.all(['Previous day', 'h1', 'Next day'].map((n) =>
    (n === 'h1' ? page.locator('.day-switch h1') : page.getByRole('button', { name: n })).boundingBox()));
  expect(title!.x - (prev!.x + prev!.width)).toBeGreaterThanOrEqual(12);
  expect(next!.x - (title!.x + title!.width)).toBeGreaterThanOrEqual(12);
  // With a log: a card above the button is 12px off too, not 24.
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await page.getByRole('textbox', { name: 'Weight' }).fill('135');
  await page.getByRole('textbox', { name: 'Reps' }).fill('10');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.locator('.summary, .card').filter({ hasText: 'Today so far' }).first()).toBeVisible();
  expect(await gap(page, '.card:has-text("Today so far")', 'button:text-is("Add exercise")')).toBe(12);
  expect(await unevenCards(page)).toEqual([]);
});

test('cards are inset evenly and sub-screens give their title room under Back', async ({ page }) => {
  await page.goto('/');
  await nav(page, 'Data');
  await page.getByLabel('Import CSV').setInputFiles(FX('history.sample.csv'));
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  const bad: string[] = [];
  bad.push(...(await unevenCards(page)).map((s) => `Data: ${s}`));
  await nav(page, 'Stats');
  bad.push(...(await unevenCards(page)).map((s) => `Stats: ${s}`));
  await nav(page, 'Lifts');
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  bad.push(...(await unevenCards(page)).map((s) => `Exercise: ${s}`));
  expect(await gap(page, 'main button:text-is("‹ Back")', 'main h1')).toBeGreaterThanOrEqual(12);
  await nav(page, 'Today');
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  bad.push(...(await unevenCards(page)).map((s) => `Program: ${s}`));
  expect(await gap(page, 'main button:text-is("‹ Back")', 'main h1')).toBeGreaterThanOrEqual(12);
  expect(bad).toEqual([]);
});

test('Stats: the wide program tile keeps the tile grid gap', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await nav(page, 'Data');
  await page.getByLabel('Import CSV').setInputFiles(FX('history.sample.csv'));
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await nav(page, 'Today');
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('textbox', { name: 'Days per week' }).fill('2');
  await page.getByRole('textbox', { name: 'Sets per session' }).fill('14');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A/ })).toBeVisible();
  await nav(page, 'Today'); // the program tile shows once a planned set is logged
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await page.getByRole('textbox', { name: 'Weight' }).fill('135');
  await page.getByRole('textbox', { name: 'Reps' }).fill('10');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveCount(1);
  await nav(page, 'Stats');
  const tiles = page.locator('.tiles').first().locator('.tile');
  await expect(tiles.last()).toHaveClass(/wide/);
  const last = (await tiles.last().boundingBox())!, above = (await tiles.nth(-2).boundingBox())!;
  expect(Math.round(last.y - (above.y + above.height))).toBe(8);
});
