import { expect, test } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

test('build a program, then run today from it with skip and log', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();

  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('textbox', { name: 'Days per week' }).fill('2');
  await page.getByRole('textbox', { name: 'Sets per session' }).fill('14');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Day B/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Weekly volume' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: '‹ Back' }).click();
  const plan = page.getByRole('region', { name: 'Today’s plan' });
  await expect(plan).toContainText('Day A');
  const slots = plan.getByRole('listitem');
  expect(await slots.count()).toBeGreaterThan(1);

  await slots.nth(1).getByRole('button', { name: 'Skip' }).click();
  await expect(slots.nth(1)).toContainText('Skipped');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Today’s plan' }).getByRole('listitem').nth(1)).toContainText('Skipped');

  const first = page.getByRole('region', { name: 'Today’s plan' }).getByRole('listitem').first();
  const name = (await first.getByRole('button').first().getAttribute('data-exercise'))!;
  await first.getByRole('button').first().click();
  await expect(page.getByRole('list', { name: `Sets for ${name}` })).toBeAttached();
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(first).toContainText(/1\/\d/);
});

test('logging without touching the plan still records the session for adherence', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Build program' }).click();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Stats' }).click();
  await expect(page.locator('.tile', { hasText: 'Sets done / planned' })).toContainText(/\d+ \/ \d+/);
});
