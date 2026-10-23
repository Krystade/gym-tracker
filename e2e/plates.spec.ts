import { expect, test } from '@playwright/test';
import { goto } from './nav';

test('a bar lift says what goes on each side as the weight is typed; a dumbbell lift says nothing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Smith Flat Press');
  await page.getByRole('button', { name: 'Smith Flat Press', exact: true }).click();
  const card = page.locator('[data-card="smith flat press"]');
  await card.getByRole('textbox', { name: 'Weight' }).fill('120');
  await expect(card.getByLabel('Per side')).toHaveText('37.5 a side · 35 + 2.5');
  await card.getByRole('textbox', { name: 'Weight' }).fill('45');
  await expect(card.getByLabel('Per side')).toHaveCount(0);

  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Flat DB Press');
  await page.getByRole('button', { name: 'Flat DB Press', exact: true }).click();
  await page.locator('[data-card="flat db press"]').getByRole('textbox', { name: 'Weight' }).fill('120');
  await expect(page.locator('[data-card="flat db press"]').getByLabel('Per side')).toHaveCount(0);
});

// Round 28 (owner): a gym's plates, 35s on by default; a gym without them turns them off and the line loads 25 + 10.
test('the per-side line loads the current gym’s plates', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'Gym');
  await page.getByRole('button', { name: 'Add gym' }).click();
  await page.getByLabel('Gym name').fill('Garage');
  const plates = page.getByRole('group', { name: 'Plates here' });
  await expect(plates.getByRole('button', { name: '35 lb plates' })).toHaveAttribute('aria-pressed', 'true');
  await plates.getByRole('button', { name: '35 lb plates' }).click();
  await expect(plates.getByRole('button', { name: '35 lb plates' })).toHaveAttribute('aria-pressed', 'false');
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Smith Flat Press');
  await page.getByRole('button', { name: 'Smith Flat Press', exact: true }).click();
  const card = page.locator('[data-card="smith flat press"]');
  await card.getByRole('textbox', { name: 'Weight' }).fill('115');
  await expect(card.getByLabel('Per side')).toHaveText('35 a side · 25 + 10');
  await goto(page, 'Gym');
  await page.getByRole('group', { name: 'Plates here' }).getByRole('button', { name: '35 lb plates' }).click();
  await goto(page, 'Today');
  await card.getByRole('textbox', { name: 'Weight' }).fill('115');
  await expect(card.getByLabel('Per side')).toHaveText('35 a side · 35');
});
