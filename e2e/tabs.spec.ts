import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const T = new Date('2026-10-02T18:00:00');
const logBench = async (page: Page, weight: string, reps: string) => {
  await page.getByRole('textbox', { name: 'Weight' }).fill(weight);
  await page.getByRole('textbox', { name: 'Reps' }).fill(reps);
  await page.getByRole('button', { name: 'Add set' }).click();
};
const openBench = async (page: Page) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
};
const tab = async (context: BrowserContext, deaf = false) => {
  const p = await context.newPage();
  if (deaf) await p.addInitScript(() => { Reflect.deleteProperty(window, 'BroadcastChannel'); }); // a copy that never hears about changes
  await p.clock.install({ time: T });
  await p.goto('/');
  await expect(p.getByRole('button', { name: 'Add exercise' })).toBeVisible();
  return p;
};
const benchList = (p: Page) => p.getByRole('list', { name: 'Sets for Bench Press' });

test('a stale copy of the app numbers its set from the stored sets and overwrites nothing', async ({ context }) => {
  const a = await tab(context);
  const stale = await tab(context, true); // loaded before A's set and never told about it
  await openBench(a);
  await logBench(a, '100', '8');
  await expect(benchList(a)).toContainText('100 × 8');

  await openBench(stale);
  await logBench(stale, '200', '3');

  await a.reload();
  await expect(benchList(a)).toContainText('100 × 8');
  await expect(benchList(a)).toContainText('200 × 3');
});

test('a set logged in one copy shows in another open copy without a reload', async ({ context }) => {
  const a = await tab(context);
  const b = await tab(context);
  await openBench(a);
  await logBench(a, '150', '5');
  await expect(benchList(b)).toContainText('150 × 5');
  await a.clock.setFixedTime(new Date('2026-10-02T18:05:00'));
  await logBench(a, '160', '4');
  await expect(benchList(b)).toContainText('160 × 4');
});
