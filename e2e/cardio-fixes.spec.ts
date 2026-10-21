import { expect, test } from '@playwright/test';
import { goto, openProgram } from './nav';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

test('cardio form: seconds carry and borrow minutes; an untouched incline is not saved; History counts minutes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Treadmill');
  await page.getByRole('button', { name: 'Treadmill', exact: true }).click();
  const card = page.locator('[data-card="treadmill"]');
  const mins = card.getByRole('textbox', { name: 'Minutes' }), secs = card.getByRole('textbox', { name: 'Seconds' });
  await expect(mins).toHaveValue('10');
  await expect(secs).toHaveValue('0');
  // Incline starts empty, like distance, with no session behind it.
  await expect(card.getByRole('textbox', { name: 'Incline %' })).toHaveValue('');

  for (let i = 0; i < 4; i++) await card.getByRole('button', { name: 'Seconds up' }).click();
  await expect(mins).toHaveValue('11');
  await expect(secs).toHaveValue('0');
  await card.getByRole('button', { name: 'Seconds down' }).click();
  await expect(mins).toHaveValue('10');
  await expect(secs).toHaveValue('45');

  await card.getByRole('textbox', { name: 'Distance (mi)' }).fill('1.2');
  await page.screenshot({ path: 'screenshots/cardio-form-carry.png' });
  await card.getByRole('button', { name: 'Log cardio' }).click();
  await expect(card.getByRole('list', { name: 'Sessions for Treadmill' })).toContainText('10:45 · 1.2 mi');
  await expect(card.getByRole('list', { name: 'Sessions for Treadmill' })).not.toContainText('%');

  await goto(page, 'History');
  const day = page.locator('details.day').first();
  await expect(day.locator('summary')).toContainText('1 exercise · 11 min cardio');
  await expect(day.locator('summary')).not.toContainText('set');
  await expect(day).toContainText('10:45 · 1.2 mi');
  await page.screenshot({ path: 'screenshots/cardio-history.png' });
});

test('pasted cardio reads like History; the chart shows tenths of a mile with distinct ticks; no priority shows minutes alone', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'More');
  await page.getByRole('button', { name: 'Paste from notes' }).click();
  // The first line is today; the rest go on two earlier days.
  await page.getByLabel('Workout notes').fill(['bike 25 min', '10/1/26', 'Treadmill 20 min 1.15 mi', '10/3/26', 'Treadmill 20:00 1.27mi 5%', 'stairs 15 min 52 floors'].join('\n'));
  await page.getByRole('button', { name: 'Read notes' }).click();
  const list = page.locator('.paste-list');
  await expect(list).toContainText('20:00 · 1.15 mi');
  await expect(list).toContainText('20:00 · 1.27 mi · 5%');
  await expect(list).toContainText('15:00 · 52 floors');
  await expect(list).not.toContainText('BW×');
  await expect(list).toContainText('as written: stairs 15 min 52 floors');
  await page.screenshot({ path: 'screenshots/cardio-paste.png', fullPage: true });
  await page.getByRole('button', { name: /^Add 4 sets from 3 days/ }).click();
  await expect(page.getByRole('status')).toContainText('Added 4 sets');

  await goto(page, 'Lifts');
  await page.getByRole('button', { name: /^Treadmill/ }).click();
  await expect(page.locator('.tile', { hasText: 'Best distance' })).toContainText('1.3 mi');
  await expect(page.locator('.readout')).toContainText('1.3 mi');
  const ticks = await page.locator('svg.chart text.lbl').allTextContents();
  const ys = ticks.slice(0, 3).map((t) => t.replace(' mi', ''));
  expect(ys.every((t) => /^\d\.\d$/.test(t))).toBe(true);
  expect(new Set(ys).size).toBe(3);
  await page.screenshot({ path: 'screenshots/cardio-chart.png', fullPage: true });

  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.getByRole('button', { name: /^StairMaster/ }).click();
  await expect(page.getByText('Log this on two days to see a trend.')).toBeVisible();

  // No cardio priority set: minutes alone, no range to fall short of.
  await goto(page, 'Priorities');
  await expect(page.getByLabel('Cardio this week')).toHaveText('This week: 25 min');
  await page.getByLabel('Cardio this week').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/cardio-stats.png' });
  await page.getByRole('combobox', { name: 'Cardio' }).selectOption('2');
  await expect(page.getByLabel('Cardio this week')).toHaveText('This week: 25 of 40–60 min');
});

test('the cardio exercise screen aims at the planned minutes', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await goto(page, 'Priorities');
  await page.getByRole('combobox', { name: 'Cardio' }).selectOption('2');
  await goto(page, 'Today');
  await openProgram(page);
  await page.getByRole('button', { name: 'Set up your gym' }).click();
  for (const e of ['dumbbells', 'flat bench', 'cable stack', 'treadmill']) await page.getByRole('checkbox', { name: e, exact: true }).check();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.getByRole('textbox', { name: 'Days per week' }).fill('3');
  await page.getByRole('textbox', { name: 'Sets per session' }).fill('12');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.locator('.prog-slots li', { hasText: 'Treadmill' }).first()).toContainText('20 min');
  await page.getByRole('button', { name: '‹ Back' }).click();

  const plan = page.getByRole('region', { name: 'Today’s plan' });
  for (const d of ['Day A', 'Day B', 'Day C']) {
    await plan.getByRole('group', { name: 'Program day' }).getByRole('button', { name: d }).click();
    if (await plan.getByRole('button', { name: /^Treadmill/ }).count()) break;
  }
  await plan.getByRole('listitem').filter({ hasText: 'Treadmill' }).getByRole('button', { name: /^Treadmill/ }).click();
  await page.locator('[data-card="treadmill"]').getByRole('button', { name: 'Treadmill', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Treadmill', level: 1 })).toBeVisible();
  await expect(page.locator('.target').first()).toHaveText('Easy start · 20 min');
});
