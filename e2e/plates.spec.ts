import { expect, test } from '@playwright/test';

test('a bar lift says what goes on each side as the weight is typed; a dumbbell lift says nothing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Smith Flat Press');
  await page.getByRole('button', { name: 'Smith Flat Press', exact: true }).click();
  const card = page.locator('[data-card="smith flat press"]');
  await card.getByRole('textbox', { name: 'Weight' }).fill('120');
  await expect(card.getByLabel('Per side')).toHaveText('37.5 a side · 25 + 10 + 2.5');
  await card.getByRole('textbox', { name: 'Weight' }).fill('45');
  await expect(card.getByLabel('Per side')).toHaveCount(0);

  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Flat DB Press');
  await page.getByRole('button', { name: 'Flat DB Press', exact: true }).click();
  await page.locator('[data-card="flat db press"]').getByRole('textbox', { name: 'Weight' }).fill('120');
  await expect(page.locator('[data-card="flat db press"]').getByLabel('Per side')).toHaveCount(0);
});
