import { expect, test, type Page } from '@playwright/test';

const T = new Date('2026-10-02T18:00:00');
const card = (page: Page, name: string) => page.locator(`[data-card="${name.toLowerCase()}"]`);
const addLift = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name, exact: true }).click();
  await expect(card(page, name)).toBeVisible();
};
/** Marks this page, so a reload shows as the mark gone. */
const mark = (page: Page) => page.evaluate(() => { (window as unknown as { mark: number }).mark = 1; });
const marked = (page: Page) => page.evaluate(() => (window as unknown as { mark?: number }).mark === 1);
/** What a new deploy taking over looks like to the page. */
const update = (page: Page) => page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));

test('half-typed numbers and added cards survive a reload', async ({ page }) => {
  await page.clock.install({ time: T });
  await page.goto('/');
  await addLift(page, 'Bench Press');
  await addLift(page, 'Lat Pulldown');
  await card(page, 'Bench Press').getByRole('textbox', { name: 'Weight' }).fill('135');
  await card(page, 'Bench Press').getByRole('textbox', { name: 'Reps' }).fill('7');
  await card(page, 'Lat Pulldown').getByRole('button', { name: 'Weight up' }).click(); // a stepper tap is typing too
  await card(page, 'Lat Pulldown').getByRole('button', { name: 'Weight up' }).click();

  await page.reload();
  await expect(page.locator('[data-card]')).toHaveCount(2);
  await expect(card(page, 'Bench Press').getByRole('textbox', { name: 'Weight' })).toHaveValue('135');
  await expect(card(page, 'Bench Press').getByRole('textbox', { name: 'Reps' })).toHaveValue('7');
  await expect(card(page, 'Lat Pulldown').getByRole('textbox', { name: 'Weight' })).toHaveValue('10');

  // Saved, the set leaves no draft behind: a later reload starts from the log, not from these numbers.
  await card(page, 'Bench Press').getByRole('button', { name: 'Add set' }).click();
  await expect(card(page, 'Bench Press').getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveCount(1);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.includes('Bench Press')))).toEqual([]);
  await page.reload();
  await expect(card(page, 'Bench Press').getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveText([/135 × 7/]);
  await expect(card(page, 'Lat Pulldown').getByRole('textbox', { name: 'Weight' })).toHaveValue('10');
});

test('an app update waits while a form is half-typed, and switches over once the app is in the background', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  // A clean screen takes the update at once.
  await mark(page);
  await Promise.all([page.waitForEvent('load'), update(page)]);
  expect(await marked(page)).toBe(false);

  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await addLift(page, 'Bench Press');
  await card(page, 'Bench Press').getByRole('textbox', { name: 'Weight' }).fill('135');
  await mark(page);
  await update(page);
  await page.waitForTimeout(500);
  expect(await marked(page)).toBe(true);
  await expect(card(page, 'Bench Press').getByRole('textbox', { name: 'Weight' })).toHaveValue('135');

  await Promise.all([page.waitForEvent('load'), page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  })]);
  expect(await marked(page)).toBe(false);
  await expect(card(page, 'Bench Press').getByRole('textbox', { name: 'Weight' })).toHaveValue('135');
});
