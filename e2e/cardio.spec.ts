import { expect, test } from '@playwright/test';
import { goto } from './nav';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

test('cardio: a priority plans treadmill slots; logging one fills the plan, History and the week', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();

  // Cardio is a priority next to the muscles, in minutes a week.
  await goto(page, 'Priorities');
  await page.getByRole('combobox', { name: 'Cardio' }).selectOption('2');
  await expect(page.getByLabel('Cardio this week')).toHaveText('This week: 0 of 40–60 min');

  // A gym with a treadmill.
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Set up your gym' }).click();
  for (const e of ['dumbbells', 'flat bench', 'cable stack', 'treadmill']) await page.getByRole('checkbox', { name: e, exact: true }).check();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.getByRole('textbox', { name: 'Days per week' }).fill('3');
  await page.getByRole('textbox', { name: 'Sets per session' }).fill('12');
  await page.getByRole('button', { name: 'Build program' }).click();
  // 40 minutes a week: two 20-minute treadmill slots, each last in its day.
  const rows = page.locator('.prog-slots li', { hasText: 'Treadmill' });
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('20 min');
  await page.screenshot({ path: 'screenshots/cardio-program.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: '‹ Back' }).click();

  // Pick a day that has the treadmill.
  const plan = page.getByRole('region', { name: 'Today’s plan' });
  for (const d of ['Day A', 'Day B', 'Day C']) {
    await plan.getByRole('group', { name: 'Program day' }).getByRole('button', { name: d }).click();
    if (await plan.getByRole('button', { name: /^Treadmill/ }).count()) break;
  }
  const row = plan.getByRole('listitem').filter({ hasText: 'Treadmill' });
  await expect(row).toContainText('0/1 · Easy start · 20 min');
  await row.getByRole('button', { name: /^Treadmill/ }).click();

  const card = page.locator('[data-card="treadmill"]');
  await expect(card.getByLabel('Target')).toHaveText('Easy start · 20 min');
  await expect(card.getByRole('textbox', { name: 'Minutes' })).toHaveValue('20');
  await card.getByRole('textbox', { name: 'Distance (mi)' }).fill('1.3');
  await card.getByRole('textbox', { name: 'Incline %' }).fill('-2');
  await expect(card.getByText('Below 0 is decline')).toBeVisible();
  await page.screenshot({ path: 'screenshots/cardio-form.png', fullPage: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await card.getByRole('button', { name: 'Log cardio' }).click();

  // Logged: the card folds with its numbers, the plan row is done.
  await expect(card.getByRole('button', { name: 'Show Treadmill' })).toContainText('20:00 · 1.3 mi · −2%');
  await expect(row).toContainText('1/1');

  await goto(page, 'History');
  await expect(page.getByText('20:00 · 1.3 mi · −2%').first()).toBeVisible();
  await goto(page, 'Priorities');
  await expect(page.getByLabel('Cardio this week')).toHaveText('This week: 20 of 40–60 min');
});

test('cardio machines are gym gear in their own group', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Set up your gym' }).click();
  for (const e of ['treadmill', 'stair climber', 'exercise bike', 'elliptical']) await expect(page.getByRole('checkbox', { name: e, exact: true })).toBeVisible();
  await expect(page.getByText('Cardio', { exact: true }).first()).toBeVisible();
});
