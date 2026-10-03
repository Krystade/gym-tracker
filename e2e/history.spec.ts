import { expect, test, type Page } from '@playwright/test';

const openLift = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name: new RegExp(`^${name}( · logged)?$`) }).click();
};
const logSet = async (page: Page, lift: string, weight: string, reps: string, flag?: 'Warm-up' | 'Pain') => {
  const card = page.locator(`[data-card="${lift.toLowerCase()}"]`); // every open lift has its own form
  const rows = card.getByRole('list', { name: `Sets for ${lift}` }).getByRole('listitem');
  const before = await rows.count();
  await card.getByRole('textbox', { name: 'Weight' }).fill(weight);
  await card.getByRole('textbox', { name: 'Reps' }).fill(reps);
  if (flag) {
    await card.getByRole('button', { name: 'More' }).click();
    await card.getByRole('button', { name: flag, exact: true }).click();
    if (flag === 'Pain') {
      await card.getByRole('group', { name: 'Pain region' }).getByRole('button', { name: 'Elbow' }).click();
      await card.getByRole('group', { name: 'Pain severity' }).getByRole('button', { name: 'Moderate' }).click();
    }
  }
  await card.getByRole('button', { name: 'Add set' }).click();
  await expect(rows).toHaveCount(before + 1);
};

test('History: short date, a two-line summary, warm-ups folded to a suffix, pain marked', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await openLift(page, 'Bench Press');
  await logSet(page, 'Bench Press', '95', '5', 'Warm-up');
  await logSet(page, 'Bench Press', '135', '8');
  await logSet(page, 'Bench Press', '135', '8', 'Pain');
  for (const lift of ['Leg Press', 'Leg Extension', 'Overhead Press']) {
    await page.getByRole('button', { name: 'Add exercise' }).click();
    await page.getByRole('searchbox', { name: 'Search exercises' }).fill(lift);
    await page.getByRole('button', { name: new RegExp(`^${lift}( · logged)?$`) }).first().click();
    await logSet(page, lift, '100', '5');
  }
  await page.getByRole('button', { name: 'History' }).click();
  const day = page.locator('details.day').first();
  const bench = day.getByRole('button', { name: /^Bench Press/ });
  await expect(bench).toContainText('135 × 8, 135 × 8');
  await expect(bench).toContainText('+ 1 warm-up');
  await expect(bench).not.toContainText('95 × 5');
  // Same word and colour as Today's pain tag; an emoji ⚠ ignores the colour.
  const pain = bench.locator('.pain-mark');
  await expect(pain).toHaveCount(1);
  await expect(pain).toHaveText('pain');
  await expect(pain).toHaveCSS('color', 'rgb(239, 107, 107)');
  const summary = day.locator('summary');
  await expect(summary).toContainText('Fri, Oct 2');
  await expect(summary).not.toContainText('2026');
  // 4 lifts: the stats line stays on one line box.
  await expect(summary).toContainText('4 exercises · 6 sets');
  const second = (await summary.locator('span').nth(1).boundingBox())!;
  expect(second.height).toBeLessThanOrEqual(24);
  await page.screenshot({ path: 'screenshots/41-history.png', fullPage: true });
});
