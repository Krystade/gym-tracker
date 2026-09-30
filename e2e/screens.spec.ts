import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');
async function check(page: Page, name: string) {
  await page.evaluate(() => { document.documentElement.style.setProperty('--sat', '47px'); document.documentElement.style.setProperty('--sab', '34px'); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const small = await page.evaluate(() => [...document.querySelectorAll('button, input:not([type=file]), label.button')]
    .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height < 44).length);
  expect(small).toBe(0);
  // In the DOM is not on the screen: an ancestor with overflow can clip text that toBeVisible() still reports visible.
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.screen p, .screen h1, .screen h2, .screen button, .screen input, .screen label')]
    .filter((el) => el.getBoundingClientRect().height > 0)
    .flatMap((el) => {
      const r = el.getBoundingClientRect();
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if ([cs.overflowX, cs.overflowY].every((v) => v === 'visible')) continue;
        const pr = p.getBoundingClientRect();
        if (r.top < pr.top - 1 || r.bottom > pr.bottom + 1 || r.left < pr.left - 1 || r.right > pr.right + 1)
          return [`${el.tagName} "${(el.textContent ?? '').slice(0, 30)}" clipped by .${p.className}`];
      }
      return [];
    }));
  expect(clipped).toEqual([]);
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: name !== '0-picker' });
}

test('screens at iPhone 13 mini size', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText('Imported 6 new, 0 updated')).toBeVisible();
  await check(page, '4-data');
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.evaluate(() => window.scrollTo(0, 900));
  await check(page, '0-picker');
  await page.getByRole('button', { name: 'Cable Curl' }).first().click();
  await page.getByRole('button', { name: 'Pain', exact: true }).click();
  await page.getByRole('group', { name: 'Pain severity' }).getByRole('button', { name: 'Moderate' }).click();
  await check(page, '9-pain-form');
  await page.getByRole('button', { name: 'Add set' }).click();
  await check(page, '1-today');
  await page.getByRole('button', { name: 'History' }).click();
  await check(page, '2-history');
  await page.getByRole('button', { name: 'Lifts' }).click();
  await check(page, '3-lifts');
  await page.getByRole('button', { name: /Cable Curl/ }).click();
  await check(page, '5-exercise');
  await page.getByRole('button', { name: 'Stats' }).click();
  await check(page, '6-stats');
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: 'Weekly volume' })).toBeVisible();
  await page.getByRole('button', { name: 'Add back-resilience block' }).click();
  await expect(page.getByRole('list', { name: 'Day A exercises' })).toContainText('Bird Dog');
  await check(page, '7-program');
  await page.getByRole('button', { name: '‹ Back' }).click();
  await check(page, '8-today-plan');
  await page.getByRole('region', { name: 'Today’s plan' }).getByRole('button', { name: 'Swap' }).first().click();
  await expect(page.getByRole('list', { name: 'Suggested swaps' })).toBeVisible();
  await check(page, '10-swap');
});
