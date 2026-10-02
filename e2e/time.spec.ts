import { expect, test } from '@playwright/test';

const logBench = async (page: import('@playwright/test').Page, weight: string, reps: string) => {
  await page.getByRole('textbox', { name: 'Weight' }).fill(weight);
  await page.getByRole('textbox', { name: 'Reps' }).fill(reps);
  await page.getByRole('button', { name: 'Add set' }).click();
};

test('a forgotten set goes into yesterday at the suggested time, and the workout length is measured', async ({ page }) => {
  // Yesterday: sets at 18:00, 18:02, 18:04, then a 10-min gap, then 18:14 and 18:16.
  await page.clock.install({ time: new Date('2026-10-01T18:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  for (const t of ['18:00', '18:02', '18:04', '18:14', '18:16']) {
    await page.clock.setFixedTime(new Date(`2026-10-01T${t}:00`));
    await logBench(page, '135', '10');
  }
  // Today: open yesterday from History and add the set that was forgotten in the gap.
  await page.clock.setFixedTime(new Date('2026-10-02T09:00:00'));
  await page.reload();
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText(/Thu, Oct 1, 2026 · 1 exercise · 5 sets · 18 min/)).toBeVisible();
  await page.getByRole('button', { name: 'Add to this day' }).click();
  await expect(page.getByText('Logging to Thu, Oct 1, 2026')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'When' })).toHaveValue('18:09');
  await logBench(page, '135', '9');
  // In the order done: the late set sits where it happened, numbered by position.
  await expect(page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveText([/^1\s*135 × 10/, /^2/, /^3/, /^4\s*135 × 9/, /^5\s*135 × 10/, /^6\s*135 × 10/]);
  await page.screenshot({ path: 'screenshots/22-late-set.png', fullPage: true });
  // The day switcher goes back to today.
  await page.getByRole('button', { name: 'Back to today' }).click();
  await expect(page.getByRole('heading', { name: 'Fri, Oct 2, 2026' })).toBeVisible();
  await expect(page.getByText(/Logging to/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByRole('heading', { name: 'Thu, Oct 1, 2026' })).toBeVisible();
});

test('a set entered a few minutes late today can take an earlier time', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await logBench(page, '135', '10');
  await page.clock.setFixedTime(new Date('2026-10-02T18:12:00'));
  await expect(page.getByRole('textbox', { name: 'When' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Did this earlier?' }).click();
  await expect(page.getByRole('textbox', { name: 'When' })).toHaveValue('18:03');
  await logBench(page, '135', '9');
  await expect(page.getByRole('textbox', { name: 'When' })).toHaveCount(0); // closes again after saving
});

test('the builder builds to minutes, and program days show their length', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Minutes', exact: true }).click();
  await page.getByRole('textbox', { name: 'Minutes per session' }).fill('30');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A · \d+ sets · ≈ \d+ min$/ })).toBeVisible();
  const heads = await page.getByRole('heading', { name: /^Day [A-Z] · \d+ sets · ≈ \d+ min$/ }).allInnerTexts();
  expect(heads.length).toBeGreaterThan(0);
  for (const h of heads) expect(Number(/≈ (\d+) min/.exec(h)![1])).toBeLessThanOrEqual(30);
  await page.screenshot({ path: 'screenshots/23-program-minutes.png', fullPage: true });
});
