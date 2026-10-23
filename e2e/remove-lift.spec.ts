import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { goto, openProgram } from './nav';

// Item 8 (owner): a lift comes off today from its card, by its × or a swipe right to left; today only, the program as it was. Its
// sets today go with it, with an Undo for 5 s.
test.use({ serviceWorkers: 'block' });
const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

async function start(page: Page) {
  await page.clock.install({ time: new Date('2026-10-23T18:00:00') });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await goto(page, 'Today');
}
async function add(page: Page, n: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(n);
  await page.getByRole('button', { name: new RegExp(`^${n}`) }).first().click();
  return page.locator(`[data-card="${n.toLowerCase()}"]`);
}
const logSet = async (card: Locator) => {
  const rows = card.getByRole('list', { name: /^Sets for/ }).getByRole('listitem');
  const n = await rows.count();
  await card.getByRole('textbox', { name: 'Weight' }).fill('40');
  await card.getByRole('textbox', { name: 'Reps' }).fill('10');
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(rows).toHaveCount(n + 1);
};
const big = async (l: Locator) => { const b = (await l.boundingBox())!; expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44); };

test('the × takes a lift and its sets off today, Undo brings them back, and 5 s later the offer is gone', async ({ page }) => {
  await start(page);
  const card = await add(page, 'DB Curl');
  await logSet(card);
  await logSet(card);
  const x = card.getByRole('button', { name: 'Remove DB Curl from today' });
  await big(x);
  await x.click();
  await expect(card).toHaveCount(0);
  // Its rest ("set 3 next") went with it.
  await expect(page.locator('.rest-timer')).toHaveCount(0);
  const toast = page.getByRole('status').filter({ hasText: 'DB Curl removed' });
  await expect(toast).toContainText('2 sets deleted');
  await big(toast.getByRole('button', { name: 'Undo' }));
  await page.screenshot({ path: 'screenshots/r29-remove-toast.png' });
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(card.getByRole('list', { name: 'Sets for DB Curl' }).getByRole('listitem')).toHaveCount(2);
  await expect(toast).toHaveCount(0);
  // Again, and let it go: after 5 s no Undo, and the sets are gone for good (a reload doesn't bring the card back).
  await card.getByRole('button', { name: 'Remove DB Curl from today' }).click();
  await expect(toast).toBeVisible();
  await page.clock.runFor(4_000);
  await expect(toast).toBeVisible();
  await page.clock.runFor(1_500);
  await expect(toast).toHaveCount(0);
  await page.reload();
  await goto(page, 'Today');
  await expect(page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
  await expect(card).toHaveCount(0);
});

test('a planned lift comes off today only: the plan skips it, the program keeps it', async ({ page }) => {
  await start(page);
  await openProgram(page);
  await page.getByRole('textbox', { name: 'Days per week' }).fill('2');
  await page.getByRole('textbox', { name: 'Sets per session' }).fill('14');
  await page.getByRole('button', { name: 'Build program' }).click();
  const dayA = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Day A/ }) }).first();
  await expect(dayA).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
  const slots = page.getByRole('list', { name: 'Planned exercises' });
  const first = (await slots.locator('.plan-name').first().getAttribute('data-exercise'))!;
  await slots.locator('.plan-name').first().click();
  const card = page.locator(`[data-card="${first.toLowerCase()}"]`);
  await logSet(card);
  await card.getByRole('button', { name: `Remove ${first} from today` }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: `${first} removed` })).toContainText('1 set deleted');
  await expect(slots.getByRole('listitem').first()).toContainText('Skipped');
  // The program is as it was: the lift is still on its day.
  await openProgram(page);
  await expect(page.getByRole('main')).toContainText(first);
});

/**
 * A finger's drag on `el`, as the phone sends it: pointer events of type touch, from (x, y) by (dx, dy) a step, and with `click` the click a
 * browser may send on lifting (a scroll sends none). (Playwright's WebKit has no touch moves.)
 */
const drag = (el: Locator, at: { x: number; y: number }, step: { dx: number; dy: number }, click = false, n = 8) => el.evaluate((t, { at, step, click, n }) => {
  const ev = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
  t.dispatchEvent(ev('pointerdown', at.x, at.y));
  for (let i = 1; i <= n; i++) t.dispatchEvent(ev('pointermove', at.x + i * step.dx, at.y + i * step.dy));
  t.dispatchEvent(ev('pointerup', at.x + n * step.dx, at.y + n * step.dy));
  if (click) t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}, { at, step, click, n });

test('a swipe right to left shows Remove; a drag down the cards never does', async ({ page }) => {
  await start(page);
  const curl = await add(page, 'DB Curl');
  await logSet(curl);
  await add(page, 'Leg Press');
  await curl.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  // Started on the set's row: the drag is the card's, and never opens the set's editor.
  const row = curl.getByRole('list', { name: 'Sets for DB Curl' }).getByRole('button').first();
  const b = (await row.boundingBox())!;
  const remove = page.getByRole('button', { name: 'Remove', exact: true });
  // Down the card (more down than across): nothing revealed.
  await drag(row, { x: b.x + b.width - 40, y: b.y + 10 }, { dx: -2, dy: 12 });
  await expect(remove).toHaveCount(0);
  expect(await curl.evaluate((el) => (el.parentElement as HTMLElement).style.transform)).toBe('');
  // Right to left: Remove, 44 px and up, and the set's editor stayed shut.
  await drag(row, { x: b.x + b.width - 30, y: b.y + 10 }, { dx: -15, dy: 1 }, true);
  await expect(remove).toBeVisible();
  await expect(curl.getByText('Editing set 1')).toHaveCount(0);
  await big(remove);
  await page.waitForTimeout(300); // the slide's transition, for the PNG
  await page.screenshot({ path: 'screenshots/r29-swipe-remove.png' });
  await remove.click();
  await expect(curl).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'DB Curl removed' })).toContainText('1 set deleted');
  await expect(page.locator('[data-card="leg press"]')).toBeVisible();
});
