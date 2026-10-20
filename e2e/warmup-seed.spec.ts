import { expect, test, type Page } from '@playwright/test';

const rows = (page: Page) => page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');
const logBench = async (page: Page, weight: string, reps: string, warmup = false) => {
  const before = await rows(page).count();
  await page.getByRole('textbox', { name: 'Weight' }).fill(weight);
  await page.getByRole('textbox', { name: 'Reps' }).fill(reps);
  if (warmup) {
    await page.getByRole('button', { name: 'Details' }).click();
    await page.getByRole('group', { name: 'Flags' }).getByRole('button', { name: 'Warm-up' }).click();
  }
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(rows(page)).toHaveCount(before + 1);
};
const addBench = async (page: Page) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: /^Bench Press( · logged)?$/ }).click();
};

test('after a warm-up the form offers the target, not the warm-up, also after a reload', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-01T18:00:00') });
  await page.goto('/');
  await addBench(page);
  for (let i = 0; i < 3; i++) await logBench(page, '185', '8');

  // Next day: 185 × 8 on every set at 8–12 → 185 × 9.
  await page.clock.setFixedTime(new Date('2026-10-02T18:00:00'));
  await page.reload();
  await addBench(page);
  const weight = page.getByRole('textbox', { name: 'Weight' });
  const reps = page.getByRole('textbox', { name: 'Reps' });
  await expect(weight).toHaveValue('185');
  await expect(reps).toHaveValue('9');

  await logBench(page, '100', '5', true);
  await expect(rows(page).first()).toContainText('warm-up');
  await expect(weight).toHaveValue('185');
  await expect(reps).toHaveValue('9');

  await page.reload();
  await expect(rows(page)).toHaveCount(1);
  await expect(weight).toHaveValue('185');
  await expect(reps).toHaveValue('9');

  // A working set today: the next one aims at its own target (owner, 2026-10-19), 9 for set 2, whatever set 1 did.
  await logBench(page, '185', '10');
  await expect(reps).toHaveValue('9');
  await logBench(page, '95', '5', true);
  await expect(weight).toHaveValue('185');
  await expect(reps).toHaveValue('9');
  // At another weight, the reps stay as typed: the targets are for 185.
  await logBench(page, '175', '11');
  await expect(reps).toHaveValue('11');
});
