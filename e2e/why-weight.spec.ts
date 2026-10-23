import { expect, test, type Locator, type Page } from '@playwright/test';
import { goto } from './nav';
import { WHY, whyCsv } from './fixtures/whyWeight';

// The target's "?" (owner, 2026-10-22): "Why this weight" in a sheet, a line per input the target came from, each with its
// evidence: (a) research, (b) learned, (c) a default. Synthetic lifts and numbers only (e2e/fixtures/whyWeight).
test.use({ serviceWorkers: 'block' });
const DAY0 = '2026-10-20';

async function addCard(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  return page.locator(`[data-card="${name.toLowerCase()}"]`);
}

test('the target’s “?” opens why it is what it is: its lines in order, each labelled, the target as the card says it', async ({ page }) => {
  await page.clock.install({ time: new Date(`${DAY0}T18:00:00`) });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'why.csv', mimeType: 'text/csv', buffer: Buffer.from(whyCsv(DAY0)) });
  await expect(page.getByText(/✓ Imported \d+ new sets/)).toBeVisible();
  await goto(page, 'Today');
  const sheet = page.getByRole('dialog', { name: 'Why this weight' });

  // A jump: up a learned cable rung, each set less what his jumps cost.
  const curl = await addCard(page, WHY.jump.lift);
  const target = curl.getByLabel('Target');
  await expect(target).toContainText('Go up: 13 · 13 · 12 @ 50 lb');
  await target.getByRole('button', { name: 'Why this weight' }).click();
  await expect(sheet.locator('.why-target')).toHaveText(`${WHY.jump.lift}Go up: 13 · 13 · 12 @ 50 lb`);
  const lines = sheet.locator('.why-lines > li');
  expect(await lines.evaluateAll((ls) => ls.map((l) => l.getAttribute('data-input')))).toEqual(WHY.jump.lines);
  for (const tag of await sheet.locator('.why-tag').allInnerTexts()) expect(tag).toMatch(/^[abc] · (Research|Learned|Default)$/);
  await expect(lines.filter({ hasText: 'Up' }).first()).toContainText('47.5 lb → 50 lb');
  await expect(lines.filter({ hasText: 'Reps a jump costs you' })).toContainText('fatigue-adjusted');
  await expect(lines.filter({ hasText: 'Range topped last time' })).toContainText('Plotkin 2022');
  // Escape and Done each put it away; the card is as it was.
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await target.getByRole('button', { name: 'Why this weight' }).click();
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(target).toContainText('Go up: 13 · 13 · 12 @ 50 lb');

  // Pain last time: held, and the sheet says so with its source; nothing about the range or the goal.
  const ext = await addCard(page, WHY.hold.lift);
  await ext.getByLabel('Target').getByRole('button', { name: 'Why this weight' }).click();
  await expect(sheet.locator('.why-lines > li')).toHaveCount(WHY.hold.lines.length);
  await expect(sheet.locator('[data-input="pain"]')).toContainText('Silbernagel');
  await expect(sheet.locator('[data-input="range"], [data-input="goal"]')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Done' }).click();

  // A brand-new lift: a target line now, sets × range (one line: Add set stays in view), with the "?": no history, its range, 3 sets.
  const hack = await addCard(page, WHY.fresh.lift);
  await expect(hack.getByLabel('Target')).toHaveText('3 × 8–12');
  await hack.getByLabel('Target').getByRole('button', { name: 'Why this weight' }).click();
  expect(await sheet.locator('.why-lines > li').evaluateAll((ls) => ls.map((l) => l.getAttribute('data-input')))).toEqual(WHY.fresh.lines);
  await expect(sheet.locator('[data-input="new"]')).toContainText('c · Default');
});
