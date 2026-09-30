import { expect, test } from '@playwright/test';

test('log sets on today, survive a reload, no horizontal scroll', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Zercher Curl');
  await page.getByRole('button', { name: 'Add “Zercher Curl”' }).click();

  await page.getByRole('textbox', { name: 'Weight' }).fill('52.5');
  await page.getByRole('textbox', { name: 'Reps' }).fill('12');
  await page.getByRole('button', { name: 'Add set' }).click();
  await page.getByRole('textbox', { name: 'Reps' }).fill('10');
  await page.getByRole('button', { name: 'Add set' }).click();

  const sets = page.getByRole('list', { name: 'Sets for Zercher Curl' });
  await expect(sets.getByRole('listitem')).toHaveText([/52\.5 × 12/, /52\.5 × 10/]);

  await page.reload();
  await expect(page.getByRole('list', { name: 'Sets for Zercher Curl' }).getByRole('listitem')).toHaveCount(2);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
