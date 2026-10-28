import { expect, test } from '@playwright/test';
import { goto } from './nav';

const DAY0 = new Date('2026-09-25T17:00:00');
const DAY1 = new Date('2026-09-28T17:00:00');
const DAY2 = new Date('2026-10-02T17:00:00');

test('open an exercise: next sets × reps @ weight with a warm-up, history below, log it today with the suggestion saved', async ({ page }) => {
  await page.clock.install({ time: DAY0 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { (window as unknown as { copied: string }).copied = t; } } });
  });
  await page.goto('/');
  // The last two sessions: 3 × 12 @ 135 each — the range topped twice, time to go up (2026-10-28).
  for (const day of [DAY0, DAY1]) {
    if (day === DAY1) { await page.clock.setSystemTime(DAY1); await page.reload(); }
    await page.getByRole('button', { name: 'Add exercise' }).click();
    await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
    await page.getByRole('button', { name: /^Bench Press( · logged)?$/ }).first().click();
    for (let i = 0; i < 3; i++) {
      await page.getByRole('textbox', { name: 'Weight' }).fill('135');
      await page.getByRole('textbox', { name: 'Reps' }).fill('12');
      await page.getByRole('button', { name: 'Add set' }).click();
    }
    await expect(page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveCount(3);
  }

  await page.clock.setSystemTime(DAY2);
  await page.reload();
  await goto(page, 'Lifts');
  await page.getByRole('searchbox', { name: 'Filter lifts' }).fill('bench');
  await page.getByRole('button', { name: /^Bench Press/ }).first().click();
  const card = page.getByRole('region', { name: 'Next time' });
  await expect(card).toContainText('3 × 8–12 @ 140 lb');
  await expect(card).toContainText('+5 lb');
  await expect(card).toContainText('Warm-up: 75 × 5');
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(page.getByText('135 × 12').first()).toBeVisible();
  await page.screenshot({ path: 'screenshots/20-suggestion.png', fullPage: true });

  await card.getByRole('button', { name: 'Log it today' }).click();
  await expect(page.getByRole('textbox', { name: 'Weight' })).toHaveValue('140');
  await expect(page.getByLabel('Target')).toContainText('3 × 8+ @ 140 lb');
  await page.getByRole('group', { name: 'Energy' }).getByRole('button', { name: '4' }).click();
  await expect(page.getByRole('group', { name: 'Energy' }).getByRole('button', { name: '4' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveCount(1);
  // The target line is one block of text beside its icon, not two wrapped columns.
  expect(await page.getByLabel('Target').evaluate((el) => [el.children.length, el.lastElementChild?.textContent])).toEqual([2, expect.stringMatching(/@ 140 lb.*warm-up/)]);

  await page.getByLabel('Target').screenshot({ path: 'screenshots/21-target-line.png' });
  // Trained today: the exercise screen now shows the next session, with nothing to log today.
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  // One set today, 140 × 8, no RIR logged: the next session aims that set at 8 again (2026-10-28).
  await expect(page.getByRole('region', { name: 'Next time' })).toContainText('8 @ 140 lb');
  await expect(page.getByRole('button', { name: 'Log it today' })).toHaveCount(0);

  // The backup carries when it was logged and what was suggested; the body file carries energy.
  await goto(page, 'Backup');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  await expect(page.getByText('Copied the CSV to the clipboard')).toBeVisible();
  const csv = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(csv.split('\r\n')[0]).toMatch(/logged_at,target_weight_lb,target_reps,target_sets,gym,entered_at,duration_s,distance_mi,incline_pct,level,floors,cardio_aim,tags,edited_at,morning,morning_note,not_used,hold_s$/);
  expect(csv).toMatch(/2026-10-02,Bench Press,,1,140,8,,,,app,,,\d{4}-\d{2}-\d{2}T[\d:.]+Z,140,8,3,/); // logged_at is UTC
  await page.getByRole('button', { name: 'Export body CSV' }).click();
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toContain('2026-10-02,,,,4');
});

test('Lifts search finds catalog lifts never logged, with a no-history suggestion', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'Lifts');
  await page.getByRole('searchbox', { name: 'Filter lifts' }).fill('hammer');
  await page.getByRole('button', { name: /^Hammer Curl/ }).click();
  const card = page.getByRole('region', { name: 'Next time' });
  await expect(card).toContainText('3 × 10–15');
  await expect(card).toContainText('No history yet');
});
