import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto } from './nav';

// Item 05 on Today's card (owner, 2026-11-21: "Time for a test" was only on the lift's own page, so he never saw it): the same
// prompt, compact, where he logs; "Set up the test" fills the form with Test ticked, and "Not now" quiets it as on the lift's page.
const SHOTS = 'screenshots/card-test';
mkdirSync(SHOTS, { recursive: true });
test.use({ serviceWorkers: 'block' });

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source';
const day = (i: number) => new Date(Date.UTC(2026, 7, 19 + i * 3)).toISOString().slice(0, 10); // Aug 19, every 3 days
/** Synthetic history (as e2e/exercise): 7 sessions of one working set, the weight rising; the 8th session, on Sep 9, is due a test. */
async function seed(page: Page) {
  const rows = Array.from({ length: 7 }, (_, i) => `${day(i)},Bench Press,,1,${135 + 5 * i},8,,,,sample`);
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...rows].join('\n')) });
  await expect(page.getByText('✓ Imported 7 new sets')).toBeVisible();
}
async function benchCard(page: Page) {
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: /^Bench Press/ }).first().click();
  return page.locator('[data-card="bench press"]');
}

test('the test prompt shows on Today’s card; “Set up the test” logs a test, and the prompt goes', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-09T18:00:00') });
  await page.goto('/');
  await seed(page);
  const card = await benchCard(page);
  const prompt = card.getByRole('group', { name: 'Time for a test' });
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveText(/^Time for a test: \d+ lb for as many good reps as you can \(about \d+\), with Test ticked\./);
  const lb = Number((await prompt.innerText()).match(/test: (\d+) lb/)![1]);
  const reps = Number((await prompt.innerText()).match(/about (\d+)/)![1]);
  // Its "Test due" pill beside the name, on the name's line; a tap brings the note into view.
  const badge = card.locator('.card-head').getByRole('button', { name: 'Test due' });
  await expect(badge).toBeVisible();
  const name = (await card.locator('.card-head > .link').boundingBox())!, pill = (await badge.boundingBox())!;
  expect(pill.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(pill.y + pill.height / 2 - (name.y + name.height / 2))).toBeLessThan(6);
  expect(pill.x).toBeGreaterThan(name.x + name.width - 1);
  await card.locator('.card-head').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/0-card-head.png` });
  await badge.click();
  await expect(prompt).toBeInViewport();
  await expect(prompt).toBeFocused();
  await page.screenshot({ path: `${SHOTS}/1-card-prompt.png` });

  await prompt.getByRole('button', { name: 'Set up the test' }).click();
  await expect(card.getByRole('textbox', { name: 'Weight' })).toHaveValue(String(lb));
  await expect(card.getByRole('textbox', { name: 'Reps' })).toHaveValue(String(reps));
  await expect(card.getByRole('group', { name: 'Flags' }).getByRole('button', { name: 'Test', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: `${SHOTS}/2-set-up.png` });
  // "Not a test" puts the plain form back.
  await prompt.getByRole('button', { name: 'Not a test' }).click();
  await expect(card.getByRole('button', { name: 'Test', exact: true })).toHaveCount(0); // Details folded again, no Test ticked
  await prompt.getByRole('button', { name: 'Set up the test' }).click();
  await card.getByRole('button', { name: /^Add set/ }).click();
  const row = card.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('test');
  await expect(prompt).toHaveCount(0);
  await expect(badge).toHaveCount(0);
  // The form is a plain one again: Test not ticked.
  await card.getByRole('button', { name: /^Details/ }).click();
  await expect(card.getByRole('group', { name: 'Flags' }).getByRole('button', { name: 'Test', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('“Not now” on the card quiets it there and on the lift’s page, after a reload too', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-09T18:00:00') });
  await page.goto('/');
  await seed(page);
  let card = await benchCard(page);
  const prompt = () => page.locator('[data-card="bench press"]').getByRole('group', { name: 'Time for a test' });
  await expect(prompt()).toBeVisible();
  await expect(card.getByRole('button', { name: 'Test due' })).toBeVisible();
  await prompt().getByRole('button', { name: 'Not now' }).click();
  await expect(prompt()).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Test due' })).toHaveCount(0);
  await page.reload();
  card = await benchCard(page);
  await expect(card.getByRole('button', { name: /^Add set/ })).toBeVisible(); // loaded: a missing prompt isn't a slow render
  await expect(prompt()).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Test due' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bench Press', level: 1 })).toBeVisible();
  await expect(page.getByText('Time for a test')).toHaveCount(0);
});
