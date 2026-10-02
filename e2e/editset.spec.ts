import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const T = new Date('2026-10-02T18:00:00');
const addLift = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name, exact: true }).click();
};
const logBench = async (page: Page, weight: string, reps: string) => {
  const rows = page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');
  const before = await rows.count();
  await page.getByRole('textbox', { name: 'Weight' }).first().fill(weight);
  await page.getByRole('textbox', { name: 'Reps' }).first().fill(reps);
  await page.getByRole('button', { name: 'Add set' }).first().click();
  await expect(rows).toHaveCount(before + 1);
};
const fits = (l: ReturnType<Page['getByRole']>) => l.evaluate((el: HTMLInputElement) => el.scrollWidth <= el.clientWidth);

test('editing a set brings Save into view and marks the row', async ({ page }) => {
  await page.clock.install({ time: T });
  await page.goto('/');
  await addLift(page, 'Bench Press');
  for (const r of ['8', '7', '6', '5', '5', '4', '4', '3']) await logBench(page, '135', r);
  await addLift(page, 'Barbell Squat');
  await page.evaluate(() => window.scrollTo(0, 0));
  const rows = page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('button');
  await rows.first().click();
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeInViewport();
  // Clear of the fixed tab bar, not just inside the window.
  const saveBox = (await save.boundingBox())!;
  const navTop = (await page.getByRole('navigation', { name: 'Sections' }).boundingBox())!.y;
  expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(navTop);
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  await expect(rows.nth(1)).not.toHaveAttribute('aria-current', 'true');
  await expect(page.getByText('Editing set 1')).toBeVisible();
});

test('the weight and reps fields do not clip long values', async ({ page }) => {
  await page.clock.install({ time: T });
  await page.goto('/');
  await addLift(page, 'Bench Press');
  const weight = page.getByRole('textbox', { name: 'Weight' });
  const reps = page.getByRole('textbox', { name: 'Reps' });
  await weight.fill('152.5');
  await reps.fill('12');
  expect(await fits(weight)).toBe(true);
  expect(await fits(reps)).toBe(true);
  await weight.fill('1002.5');
  expect(await fits(weight)).toBe(true);
  await page.screenshot({ path: 'screenshots/34-weight-field.png' });
});

test('on a 320 px phone the steppers stack, so neither field clips', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.clock.install({ time: T });
  await page.goto('/');
  await addLift(page, 'Bench Press');
  const weight = page.getByRole('textbox', { name: 'Weight' });
  const reps = page.getByRole('textbox', { name: 'Reps' });
  await weight.fill('152.5');
  await reps.fill('12');
  expect(await fits(weight)).toBe(true);
  expect(await fits(reps)).toBe(true);
});

test('a set deleted in another copy closes the editor instead of leaving "Delete set 0"', async ({ context }: { context: BrowserContext }) => {
  const open = async () => {
    const p = await context.newPage();
    await p.clock.install({ time: T });
    await p.goto('/');
    await expect(p.getByRole('button', { name: 'Add exercise' })).toBeVisible();
    return p;
  };
  const a = await open();
  const b = await open();
  await addLift(a, 'Bench Press');
  await logBench(a, '135', '8');
  await b.reload();
  const list = (p: Page) => p.getByRole('list', { name: 'Sets for Bench Press' });
  await list(a).getByRole('button').first().click();
  await expect(a.getByRole('button', { name: 'Save', exact: true })).toBeVisible();

  b.on('dialog', (d) => void d.accept());
  await list(b).getByRole('button').first().click();
  await b.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(list(b).getByRole('listitem')).toHaveCount(0);

  await expect(a.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(a.getByRole('button', { name: 'Add set' })).toBeVisible();
});
