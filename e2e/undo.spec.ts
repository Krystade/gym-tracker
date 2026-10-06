import { expect, test, type Page } from '@playwright/test';

const T = new Date('2026-10-02T18:00:00');
const rows = (page: Page) => page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');
const logBench = async (page: Page, weight: string, reps: string) => {
  const before = await rows(page).count();
  await page.getByRole('textbox', { name: 'Weight' }).first().fill(weight);
  await page.getByRole('textbox', { name: 'Reps' }).first().fill(reps);
  await page.getByRole('button', { name: 'Add set' }).first().click();
  await expect(rows(page)).toHaveCount(before + 1);
};

test('deleting a set asks nothing, and Undo puts it back where it was', async ({ page }) => {
  await page.clock.install({ time: T });
  await page.goto('/');
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; void d.dismiss(); });
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await logBench(page, '135', '8');
  await logBench(page, '140', '6');
  await logBench(page, '135', '7');
  await rows(page).nth(1).getByRole('button').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  const note = page.getByRole('status').filter({ hasText: 'Set 2 deleted' });
  await expect(note).toBeVisible();
  await note.getByRole('button', { name: 'Undo' }).click();
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(1)).toContainText('140 × 6');
  await expect(note).toHaveCount(0);
  expect(dialogs).toBe(0);
  await page.reload();
  await expect(rows(page)).toHaveCount(3);
});

test('the undo offer goes after 8 s, and the delete stays', async ({ page }) => {
  await page.clock.install({ time: T });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await logBench(page, '135', '8');
  await rows(page).first().getByRole('button').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const note = page.getByRole('status').filter({ hasText: 'Set 1 deleted' });
  await expect(note).toBeVisible();
  await page.clock.runFor(6000);
  await expect(note).toBeVisible();
  await page.clock.runFor(2500);
  await expect(note).toHaveCount(0);
  await page.reload();
  await expect(rows(page)).toHaveCount(0);
});
