import { expect, test, type Locator, type Page } from '@playwright/test';
import { goto } from './nav';

// Achievements (plan stage 3; owner 2026-10-21: everyone starts from 0): what a set unlocks, said under its card, and a tap to
// its levels on Stats. Counting starts on the profile's first open: a history from before it counts for nothing. Synthetic only.

const TODAY = '2026-09-15'; // a Tuesday, before the Oct 1 floor (domain/buddies/start COUNT_FLOOR); the clock starts at 18:00
const H = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,pain_region,pain_severity,logged_at';
/** Twelve sessions of Bench Press at 225 × 5 before today. */
const history = () => [H, ...Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.parse(`${TODAY}T12:00:00Z`) - (40 - 3 * i) * 864e5).toISOString().slice(0, 10);
  return [1, 2, 3].map((k) => `${d},Bench Press,,${k},225,5,,,,sample,,,${d}T17:0${k}:00.000Z`);
}).flat()].join('\n');

async function open(page: Page) {
  await page.clock.install({ time: new Date(`${TODAY}T18:00:00`) });
  await page.goto('/');
}
async function addCard(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  return page.locator(`[data-card="${name.toLowerCase()}"]`);
}
async function logSet(card: Locator, weight: string, reps: string) {
  await card.getByRole('textbox', { name: 'Weight' }).fill(weight);
  await card.getByRole('textbox', { name: 'Reps' }).fill(reps);
  await card.getByRole('button', { name: /^Add set/ }).click();
}
const lines = (card: Locator) => card.locator('.ach-lines');

test('a set that unlocks something says so under its card, and a tap opens the Achievements page at that family', async ({ page }) => {
  await open(page);
  await goto(page, 'Today');
  const card = await addCard(page, 'Bench Press');
  await logSet(card, '135', '5');
  // The first session, and a plate a side: a line each, the tier in words.
  await expect(lines(card).getByRole('button')).toHaveCount(2);
  await expect(lines(card)).toContainText('Starter · SessionsYour first session');
  await expect(lines(card)).toContainText('Bronze · PlatesBench Press: 135 lb, 1 plate a side');
  // Not a status (the PR line is that): a page-wide status query finds no achievement.
  await expect(page.getByRole('status').filter({ hasText: 'plate a side' })).toHaveCount(0);
  // The next set unlocks nothing: the lines go.
  await logSet(card, '135', '5');
  await expect(card.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveCount(2);
  await expect(lines(card).getByRole('button')).toHaveCount(0);
  // Two plates a side: the line names the highest level reached, and a tap opens the Achievements page at Plates · Bench Press,
  // scrolled to it and lit for a moment.
  await logSet(card, '225', '3');
  await expect(lines(card).getByRole('button')).toHaveCount(1);
  await lines(card).getByRole('button', { name: /Silver · Plates/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Achievements' });
  const row = sheet.locator('[data-ach="plates"][data-lift="Bench Press"]');
  await expect(row).toHaveClass(/ach-hit/);
  await expect(row).toBeInViewport({ ratio: 1 });
  await expect(row).toContainText('Plates · Bench Press');
  await expect(row).not.toHaveClass(/ach-hit/, { timeout: 5000 });
  // Its row opens the family's levels.
  await row.click();
  const plates = page.getByRole('dialog', { name: 'Plates' });
  await expect(plates.getByRole('region', { name: 'Bench Press' })).toContainText('225 lb');
  // No account, no friends: no switch for showing them (stage 4).
  await expect(plates.getByRole('switch')).toHaveCount(0);
  await plates.getByRole('button', { name: 'Achievements' }).click();
  await expect(page.getByRole('dialog', { name: 'Achievements' }).getByRole('region', { name: 'New today' })).toContainText('Your first session');
  // The tile says what today brought, and leads Progress.
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('[data-tile="achievements"]')).toContainText('earned · 2 today');
});

test('a history from before the start counts for nothing: the first set after it is the first session, its first PR', async ({ page }) => {
  await open(page);
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'sets.csv', mimeType: 'text/csv', buffer: Buffer.from(history()) });
  await expect(page.getByText('✓ Imported 36 new sets')).toBeVisible();
  // Twelve sessions and 225 on the bar before today, and nothing earned.
  await goto(page, 'Stats');
  await expect(page.locator('[data-tile="achievements"]')).toContainText('0earned');
  await goto(page, 'Today');
  const card = await addCard(page, 'Bench Press');
  // A PR against everything before (the bar), counted from today: the first session, the first PR, and plates from here.
  await logSet(card, '230', '5');
  await expect(card.getByRole('status')).toContainText('PR');
  await expect(lines(card).getByRole('button')).toHaveCount(3); // plates: two a side only, not one as well
  await expect(lines(card)).toContainText('Your first session');
  await expect(lines(card)).toContainText('Your first PR');
  await expect(lines(card)).toContainText('Bench Press: 225 lb, 2 plates a side');
});

test('the Achievements page is one tap from the top of Stats and from More', async ({ page }) => {
  await open(page);
  await goto(page, 'Today');
  await logSet(await addCard(page, 'Bench Press'), '135', '5');
  await goto(page, 'Stats');
  await page.getByRole('button', { name: 'Achievements', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Achievements' }).getByRole('region', { name: 'New today' })).toContainText('Your first session');
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await goto(page, 'More');
  await page.getByRole('button', { name: /^Achievements/ }).click();
  await expect(page.getByRole('dialog', { name: 'Achievements' }).getByRole('list', { name: 'Earned by tier' })).toBeVisible();
});
