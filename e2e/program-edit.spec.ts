import { expect, test, type Page } from '@playwright/test';

const openProgram = async (page: Page) => {
  await page.getByRole('button', { name: 'Program', exact: true }).click();
};
const build = async (page: Page) => {
  await page.goto('/');
  await openProgram(page);
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A · / })).toBeVisible();
};
const openBuilder = async (page: Page) => {
  const d = page.locator('details.builder');
  if (!(await d.evaluate((el: HTMLDetailsElement) => el.open))) await d.locator('summary').click();
};
const dayA = (page: Page) => page.getByRole('list', { name: 'Day A exercises' }).getByRole('listitem');
const names = (page: Page) => dayA(page).locator('b').allInnerTexts();

test('once a program exists its days come first and the builder folds away', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await build(page);
  await page.reload();
  await openProgram(page);
  const head = page.getByRole('heading', { name: /^Day A · / });
  await expect(head).toBeInViewport({ ratio: 1 });
  expect((await head.boundingBox())!.y).toBeLessThan(400); // near the top, not just peeking over the builder
  await expect(page.getByRole('textbox', { name: 'Days per week' })).toBeHidden();
  await page.screenshot({ path: 'screenshots/49-program-built.png' });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.screenshot({ path: 'screenshots/49-program-built-320.png' });
  await page.setViewportSize({ width: 375, height: 812 });
  await openBuilder(page);
  await expect(page.getByRole('textbox', { name: 'Days per week' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rebuild program' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'screenshots/51-rebuild-open.png' });
});

test('with no program the builder is open and not folded', async ({ page }) => {
  await page.goto('/');
  await openProgram(page);
  await expect(page.getByRole('textbox', { name: 'Days per week' })).toBeVisible();
  await expect(page.locator('details.builder')).toHaveCount(0);
});

test('removing a lift can be undone, back into the same place', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await build(page);
  const before = await names(page);
  expect(before.length).toBeGreaterThan(2);
  const first = before[0];
  // The × is not jammed against the steppers.
  const row = dayA(page).first();
  const plus = (await row.getByRole('button', { name: `More sets of ${first}` }).boundingBox())!;
  const x = (await row.getByRole('button', { name: `Remove ${first}` }).boundingBox())!;
  expect(x.x - (plus.x + plus.width)).toBeGreaterThanOrEqual(11);
  expect(x.width).toBeGreaterThanOrEqual(44);
  expect(x.height).toBeGreaterThanOrEqual(44);
  await row.getByRole('button', { name: `Remove ${first}` }).click();
  const note = page.getByRole('status').filter({ hasText: `Removed ${first}.` });
  await expect(note).toBeVisible();
  await expect.poll(() => names(page)).toEqual(before.slice(1));
  await page.screenshot({ path: 'screenshots/50-program-edit-undo.png' });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.screenshot({ path: 'screenshots/50-program-edit-undo-320.png' });
  await note.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => names(page)).toEqual(before);
  await expect(note).toHaveCount(0);
  await page.reload();
  await openProgram(page);
  expect(await names(page)).toEqual(before); // saved, not just shown
});

test('the undo note goes on the next edit and after eight seconds', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await build(page);
  const before = await names(page);
  await dayA(page).first().getByRole('button', { name: `Remove ${before[0]}` }).click();
  const note = page.getByRole('status').filter({ hasText: `Removed ${before[0]}.` });
  await expect(note).toBeVisible();
  await dayA(page).first().getByRole('button', { name: /^More sets of / }).click();
  await expect(note).toHaveCount(0); // the next edit drops it
  await dayA(page).first().getByRole('button', { name: /^Remove / }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Removed' })).toBeVisible();
  await page.clock.fastForward(7000);
  await expect(page.getByRole('status').filter({ hasText: 'Removed' })).toBeVisible();
  await page.clock.fastForward(1500);
  await expect(page.getByRole('status').filter({ hasText: 'Removed' })).toHaveCount(0);
});

test('rebuilding asks nothing and can be undone, edits and all', async ({ page }) => {
  await build(page);
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; void d.dismiss(); });
  // Edit: one more set on the first lift of Day A.
  const row = dayA(page).first();
  const count = row.locator('.prog-sets');
  const n = Number(await count.innerText());
  await row.getByRole('button', { name: /^More sets of / }).click();
  await expect(count).toHaveText(String(n + 1));
  await openBuilder(page);
  await page.getByRole('button', { name: 'Rebuild program' }).click();
  await expect(count).toHaveText(String(n));
  const undo = page.getByRole('status').filter({ hasText: 'Program rebuilt' });
  await undo.getByRole('button', { name: 'Undo' }).click();
  await expect(count).toHaveText(String(n + 1));
  await expect(undo).toHaveCount(0);
  expect(dialogs).toBe(0);
  await page.reload(); // the restored program is the saved one
  await openProgram(page);
  await expect(dayA(page).first().locator('.prog-sets')).toHaveText(String(n + 1));
});

test('a rebuild drops a pending undo, so it cannot splice an old lift into the new program', async ({ page }) => {
  await build(page);
  page.on('dialog', (d) => void d.accept());
  const before = await names(page);
  await dayA(page).first().getByRole('button', { name: `Remove ${before[0]}` }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Removed' })).toBeVisible();
  await openBuilder(page);
  await page.getByRole('button', { name: 'Rebuild program' }).click();
  await expect.poll(() => names(page)).toEqual(before);
  await expect(page.getByRole('status').filter({ hasText: 'Removed' })).toHaveCount(0);
});
