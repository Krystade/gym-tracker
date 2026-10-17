import { expect, test, type Page } from '@playwright/test';

type B = { x: number; y: number; width: number; height: number };
const overlaps = (a: B, b: B) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const openCurl = async (page: Page) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Cable Curl');
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  return page.locator('[data-card="cable curl"]');
};

test('a rest timer starts on Add set, clear of the form, and starts over on the next set', async ({ page }) => {
  // The Wake Lock API, recorded: the screen stays on while the timer runs.
  await page.addInitScript(() => {
    const w = window as unknown as { locks: string[] };
    w.locks = [];
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      w.locks.push('on');
      return { release: async () => { w.locks.push('off'); }, addEventListener() {} };
    } } });
  });
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  const card = await openCurl(page);
  const timer = page.getByRole('timer', { name: 'Rest' });
  await expect(timer).toHaveCount(0); // nothing before a set
  await card.getByRole('textbox', { name: 'Weight' }).fill('50');
  await card.getByRole('textbox', { name: 'Reps' }).fill('10');
  // From here the clock moves only when the test moves it, so a loaded machine can't eat into the 2:00.
  await page.clock.pauseAt(new Date('2026-10-16T18:30:00'));
  await card.getByRole('button', { name: /^Add set/ }).click();
  // No history for this lift: 2:00.
  await expect(timer).toContainText('2:00');
  expect(await page.evaluate(() => (window as unknown as { locks: string[] }).locks)).toEqual(['on']);
  await page.clock.runFor(30_000);
  await expect(timer).toContainText('1:30');

  // It doesn't cover the form: not its steppers, Add set or More.
  const t = (await timer.boundingBox())!;
  for (const b of await card.locator('.set-form button').all()) {
    const box = await b.boundingBox();
    if (box) expect(overlaps(box, t), `${await b.innerText()} under the timer`).toBe(false);
  }
  await page.screenshot({ path: 'screenshots/r7-rest-timer.png' });

  await timer.getByRole('button', { name: '+30 s' }).click();
  await expect(timer).toContainText('2:00');

  // The next set ends this rest and starts the next one.
  await page.clock.runFor(45_000);
  await expect(timer).toContainText('1:15');
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(timer).toContainText('2:00');

  // A tap puts it away, and lets the screen sleep.
  await timer.getByRole('button', { name: /Dismiss/ }).click();
  await expect(timer).toHaveCount(0);
  expect((await page.evaluate(() => (window as unknown as { locks: string[] }).locks)).at(-1)).toBe('off');
});

test('the rest timer runs out to “Rest done”, then goes', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  const card = await openCurl(page);
  await card.getByRole('textbox', { name: 'Weight' }).fill('50');
  await page.clock.pauseAt(new Date('2026-10-16T18:30:00'));
  await card.getByRole('button', { name: /^Add set/ }).click();
  const timer = page.getByRole('timer', { name: 'Rest' });
  await expect(timer).toContainText('2:00');
  await page.clock.runFor(121_000);
  await expect(timer).toContainText('Rest done');
  await page.screenshot({ path: 'screenshots/r7-rest-done.png' });
  await page.clock.runFor(31_000);
  await expect(timer).toHaveCount(0);
});

test('a set entered for an earlier time starts no rest timer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Previous day' }).click();
  const card = await openCurl(page);
  await card.getByRole('textbox', { name: 'Weight' }).fill('50');
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(card.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('timer', { name: 'Rest' })).toHaveCount(0);
});
