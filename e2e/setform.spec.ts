import { expect, test, type Page } from '@playwright/test';

const logBench = async (page: Page, weight: string, reps: string) => {
  const rows = page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');
  const before = await rows.count();
  await page.getByRole('textbox', { name: 'Weight' }).fill(weight);
  await page.getByRole('textbox', { name: 'Reps' }).fill(reps);
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(rows).toHaveCount(before + 1);
};
const openBench = async (page: Page) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: /^Bench Press( · logged)?$/ }).click();
};
const more = (page: Page) => page.getByRole('button', { name: 'More' });

// 4 sets: with 3 the button still fits before the change on a fresh day (no cards above the exercise)
test('Add set sits in view after a few sets', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await openBench(page);
  for (const reps of ['10', '9', '8', '7']) await logBench(page, '135', reps);
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const box = await page.getByRole('button', { name: 'Add set' }).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(812);
  await page.screenshot({ path: 'screenshots/32-setform.png' });
  await more(page).click();
  await page.screenshot({ path: 'screenshots/33-setform-more.png', fullPage: true });
});

test('More reopens for a drafted note, and folds after the set is saved', async ({ page }) => {
  await page.goto('/');
  await openBench(page);
  await expect(more(page)).toHaveAttribute('aria-expanded', 'false');
  await more(page).click();
  await page.getByRole('textbox', { name: 'Note' }).fill('felt strong');
  await page.getByRole('button', { name: 'History' }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(more(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('felt strong');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveCount(1);
  await expect(more(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('textbox', { name: 'Note' })).toBeHidden();
});

test('a time later than now is marked as an error', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T09:00:00') });
  await page.goto('/');
  await openBench(page);
  await more(page).click();
  await page.getByRole('button', { name: 'Did this earlier?' }).click();
  const when = page.getByRole('textbox', { name: 'When' });
  await when.fill('23:30');
  await expect(when).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Later than now (')).toBeVisible();
});

test('a typed time stays in view when More folds, so a blocked Add set shows why', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await openBench(page);
  await more(page).click();
  await page.getByRole('button', { name: 'Did this earlier?' }).click();
  await page.getByRole('textbox', { name: 'When' }).fill('23:30');
  await more(page).click();
  await expect(more(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('textbox', { name: 'When' })).toBeVisible();
  await expect(page.getByText('Later than now (')).toBeVisible();
});

test('a stored time later than now does not block fixing the weight', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await openBench(page);
  await logBench(page, '135', '8');
  // The clock went back (travel, a manual change): the set now sits after "now".
  await page.clock.setFixedTime(new Date('2026-10-02T17:00:00'));
  await page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('button').first().click();
  await page.getByRole('textbox', { name: 'Weight' }).fill('140');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: 'When' }).fill('18:05');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});
