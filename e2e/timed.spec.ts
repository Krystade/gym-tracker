import { expect, test, type Page } from '@playwright/test';
import { goto } from './nav';

// Timed exercises (round 32): a hold logs seconds, with a stopwatch on the card; old rep sets of a lift that became timed stay
// as logged; any lift the table doesn't list can be marked timed.

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source';

async function seed(page: Page, rows: string[]) {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...rows].join('\n')) });
  await expect(page.getByText(new RegExp(`✓ Imported ${rows.length} new sets?`))).toBeVisible();
  await goto(page, 'Today');
}

test('the stopwatch fills a hold’s seconds; the set logs as seconds and the rest timer starts', async ({ page }) => {
  await seed(page, ['2026-10-01,Bench Press,,1,135,8,,,,sample']);
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('wall sit');
  await page.locator('.picker-list').getByRole('button', { name: /^Wall Sit/ }).first().click();
  const card = page.locator('[data-card="wall sit"]');
  const secs = card.getByRole('textbox', { name: 'Seconds' });
  await expect(secs).toHaveValue('30'); // the bottom of 30–60 s
  await expect(card.getByRole('group', { name: 'RIR' })).toHaveCount(0);
  const add = card.getByRole('button', { name: 'Add set' });

  await card.getByRole('button', { name: 'Start hold' }).click();
  await page.clock.runFor(12_400);
  const stop = card.getByRole('button', { name: /^Stop/ });
  await expect(stop).toContainText('0:12');
  await expect(secs).toHaveValue('12');
  await expect(add).toBeDisabled(); // not mid-hold
  await page.screenshot({ path: 'screenshots/r32-timed-running.png' });
  await page.clock.runFor(30_000);
  await stop.click();
  await expect(secs).toHaveValue('42');
  await card.getByRole('button', { name: 'Seconds up' }).click();
  await expect(secs).toHaveValue('47'); // ± steps 5 s
  await add.click();
  await expect(page.getByRole('list', { name: 'Sets for Wall Sit' }).getByRole('listitem').first()).toContainText('BW × 47s');
  await expect(page.getByRole('timer', { name: 'Rest' })).toBeVisible();
  await page.screenshot({ path: 'screenshots/r32-timed-logged.png' });
});

test('old Dead Hang reps stay reps; a lift the table doesn’t list can be marked timed', async ({ page }) => {
  await seed(page, ['2026-10-01,Dead Hang,,1,0,8,,bodyweight,,sample', '2026-10-01,Zercher Hold Thing,,1,95,10,,,,sample']);
  await goto(page, 'Lifts');
  await page.getByRole('button', { name: /Dead Hang/ }).click();
  await expect(page.locator('.set-row').first()).toContainText('BW × 8');
  await expect(page.locator('.set-row').first()).not.toContainText('8s');

  await goto(page, 'Lifts');
  await page.getByRole('button', { name: /Zercher Hold Thing/ }).click();
  await page.locator('summary', { hasText: 'Lift settings' }).click();
  const as = page.getByRole('group', { name: 'Logged as' });
  await expect(as.getByRole('button', { name: 'Reps' })).toHaveAttribute('aria-pressed', 'true');
  await as.getByRole('button', { name: 'Seconds (a hold)' }).click();
  await expect(as.getByRole('button', { name: 'Seconds (a hold)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Progression settings' }).getByRole('textbox', { name: 'Min seconds' })).toHaveValue('30');
  await expect(page.locator('.set-row').first()).toContainText('95 × 10'); // logged as reps, kept as reps
});
