import { expect, test } from '@playwright/test';
import { goto } from './nav';

// Round 15, stage 3: about 280 lifts, found by any name they go by; the Add row says what a new name counts for; gear the app
// added after a gym was set up is asked about, not assumed.

test('search finds a lift by its words in any order and by another name; the add row says what a new name counts for', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  const box = page.getByRole('searchbox', { name: 'Search exercises' });
  const list = page.locator('.picker-list');
  // Before typing: the common lifts, not every lift.
  await expect(list.getByRole('button', { name: 'Bench Press', exact: true })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Zottman Curl', exact: true })).toHaveCount(0);
  await box.fill('inc db pr');
  await expect(list.getByRole('button').first()).toHaveText('Incline DB Press');
  await box.fill('dumbbell incline');
  await expect(list.getByRole('button', { name: 'Incline DB Press', exact: true })).toBeVisible();
  await box.fill('yates row');
  await expect(list.getByRole('button').first()).toHaveText('Reverse-Grip Barbell Row');
  await box.fill('Paused Kroc Row');
  const add = list.getByRole('button', { name: 'Add “Paused Kroc Row” as a new lift' });
  await expect(add).toContainText('counts for mid-back · lats ½ · rear delts ½ · biceps ½ · forearms ½');
  await expect(add).toHaveAccessibleDescription(/counts for mid-back/);
  await page.screenshot({ path: 'screenshots/r15-picker-add-counts.png' });
  await box.fill('Zercher Wobble');
  await expect(list.getByRole('button', { name: 'Add “Zercher Wobble” as a new lift' })).toContainText('muscles unknown');
  await list.getByRole('button', { name: 'Add “Zercher Wobble” as a new lift' }).click();
  await expect(page.getByRole('heading', { name: 'Zercher Wobble' }).or(page.getByText('Zercher Wobble').first())).toBeVisible();
});

test('a lift page says what it works, and when that was guessed from the name', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'Lifts');
  await page.getByRole('searchbox', { name: 'Filter lifts' }).fill('hex bar dead');
  await page.getByRole('button', { name: /^Trap Bar Deadlift/ }).click();
  await expect(page.getByText('Works hamstrings · glutes ½ · erectors ½ · quads ½ · hinge · trap bar')).toBeVisible();
  await page.screenshot({ path: 'screenshots/r15-lift-works.png' });
});

test('gear added after a gym was set up is to check: its lifts stay in the main list until he says', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'Gym');
  // A gym copied from text has no gear version: it predates the new gear, like every gym set up before round 15.
  await page.getByRole('button', { name: 'Add from text' }).click();
  await page.getByLabel('Paste a copied gym').fill('Gym Tracker gym: Garage\nEquipment: dumbbells, barbell, flat bench');
  await page.getByRole('region', { name: 'Add from text' }).getByRole('button', { name: 'Add gym' }).click();
  const check = page.getByRole('region', { name: 'New equipment to check' });
  await expect(check).toContainText('ez bar, trap bar, kettlebells');
  await page.screenshot({ path: 'screenshots/r15-gym-new-gear.png', fullPage: true });
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('ez bar curl');
  await expect(page.getByRole('listitem').filter({ hasText: /^EZ-Bar Curl/ })).toContainText('gear unknown');
  // In the picker it is in the main list, not under "Not at Garage".
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('ez bar curl');
  const items = await page.locator('.picker-list li').allInnerTexts();
  const divider = items.findIndex((t) => t.startsWith('Not at'));
  const at = items.findIndex((t) => t.startsWith('EZ-Bar Curl'));
  expect(at).toBeGreaterThanOrEqual(0);
  expect(divider === -1 || at < divider).toBe(true);
  await page.getByRole('button', { name: 'Cancel' }).click();
  // Checked: what it doesn't tick is missing, and the line goes.
  await goto(page, 'Gym');
  await page.getByRole('region', { name: 'New equipment to check' }).getByRole('button', { name: 'Checked' }).click();
  await expect(page.getByRole('region', { name: 'New equipment to check' })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('ez bar curl');
  await expect(page.getByRole('listitem').filter({ hasText: /^EZ-Bar Curl/ })).toContainText('missing gear');
});
