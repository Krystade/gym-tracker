import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');
const nav = (page: Page, t: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: t, exact: true }).click();

test('weekly targets fit the week, and a priority can be set by hand and handed back', async ({ page }) => {
  await page.goto('/');
  await nav(page, 'Data');
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE); // Stats shows Priorities once there's a log
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await nav(page, 'Stats');
  const box = page.getByRole('group', { name: 'Weekly sets' });
  await expect(box).toContainText(/fitted to 2 sessions × \d+ sets/);
  const one = box.getByRole('listitem').filter({ hasText: /^1 ·/ });
  await expect(one).toContainText('auto');
  const auto = (await one.innerText()).match(/1 · ([\d.]+–[\d.]+)/)![1];
  await one.getByRole('button', { name: 'Edit' }).click();
  await one.getByRole('textbox', { name: 'Min' }).fill('8');
  await one.getByRole('textbox', { name: 'Max' }).fill('10');
  await box.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/70-weekly-sets-edit.png' });
  await one.getByRole('button', { name: 'Save' }).click();
  await expect(one).toContainText('1 · 8–10 sets · yours');
  await page.reload();
  await nav(page, 'Stats');
  await expect(one).toContainText('1 · 8–10 sets · yours');
  await expect(page.getByRole('combobox', { name: 'Chest' }).locator('option').first()).toHaveText('1 · 8–10 sets');
  await one.getByRole('button', { name: 'Use auto' }).click();
  await expect(one).toContainText(`1 · ${auto} sets · auto`);
});
