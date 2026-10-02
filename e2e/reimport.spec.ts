import fs from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const clip = (page: Page) => page.addInitScript(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { (window as unknown as { copied: string }).copied = t; } } });
});
const copied = (page: Page) => page.evaluate(() => (window as unknown as { copied: string }).copied);
const file = (info: TestInfo, name: string, text: string) => { const p = info.outputPath(name); fs.writeFileSync(p, text); return p; };

test('an import asks before changing sets already logged, and brand-new rows need no asking', async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await clip(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  const rows = page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');
  await page.getByRole('textbox', { name: 'Weight' }).fill('100');
  await page.getByRole('textbox', { name: 'Reps' }).fill('8');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const old = file(info, 'old.csv', await copied(page));

  // Re-importing what is already there changes nothing, so it must not ask.
  await page.getByLabel('Import CSV').setInputFiles(old);
  await expect(page.getByText('Nothing new: 1 set already in your log')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await toBench(page);
  await rows.nth(0).getByRole('button').click();
  await page.getByRole('textbox', { name: 'Weight' }).fill('135');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(rows.nth(0)).toContainText('135 × 8');
  await page.getByRole('button', { name: 'Data' }).click();

  await page.getByLabel('Import CSV').setInputFiles(old);
  const card = page.getByRole('alert');
  await expect(card).toContainText('This file changes 1 set already in your log.');
  await page.screenshot({ path: 'screenshots/30-import-confirm.png', fullPage: true });
  await card.getByRole('button', { name: 'Only add new' }).click();
  await expect(card).toHaveCount(0);
  await toBench(page);
  await expect(rows.nth(0)).toContainText('135 × 8');

  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(old);
  await expect(page.getByRole('alert')).toContainText('This file changes 1 set already in your log.');
  await page.getByRole('button', { name: 'Replace them' }).click();
  await expect(page.getByText('✓ Imported 0 new sets, 1 set updated')).toBeVisible();
  await page.screenshot({ path: 'screenshots/31-import-result.png', fullPage: true });
  await toBench(page);
  await expect(rows.nth(0)).toContainText('100 × 8');
});

test('a file with both edited and new sets says so, and adds the new ones either way', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  const head = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,pain_region,pain_severity,logged_at,target_weight_lb,target_reps,target_sets,gym,entered_at\n';
  const row = (set: number, w: number) => `2026-09-01,Bench Press,,${set},${w},8,,,,t,,,,,,,,\n`;
  await page.getByLabel('Import CSV').setInputFiles(file(info, 'a.csv', head + row(1, 100)));
  await expect(page.getByText('✓ Imported 1 new set')).toBeVisible();
  await page.getByLabel('Import CSV').setInputFiles(file(info, 'b.csv', head + row(1, 110) + row(2, 110)));
  await expect(page.getByRole('alert')).toContainText('This file changes 1 set already in your log and adds 1 new set.');
  // Only one card at a time: a second pick while it asks can't drop this file unanswered.
  await expect(page.getByLabel('Import CSV')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Only add new' })).toBeFocused();
  await page.getByRole('button', { name: 'Only add new' }).click();
  await expect(page.getByText('✓ Imported 1 new set')).toBeVisible();
  await expect(page.getByLabel('Import CSV')).toBeEnabled();
  await expect(page.getByText('2 sets · 1 session')).toBeVisible();
  // The edited set kept its stored weight; only set 2 came in.
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.locator('details.day').first()).toContainText('100 × 8, 110 × 8');
});

test('a body file asks before changing days already logged', async ({ page }, info) => {
  await clip(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(file(info, 'b1.csv', 'date,weight_lb\n2026-09-01,180\n2026-09-02,181\n'));
  await expect(page.getByText('✓ Body data: 2 days')).toBeVisible();
  await page.getByLabel('Import CSV').setInputFiles(file(info, 'b2.csv', 'date,weight_lb\n2026-09-01,175\n2026-09-02,181\n2026-09-03,182\n'));
  await expect(page.getByRole('alert')).toContainText('This file changes 1 day already in your log and adds 1 new day.');
  await page.getByRole('button', { name: 'Only add new' }).click();
  await page.getByRole('button', { name: 'Export body CSV' }).click();
  await expect.poll(() => copied(page)).toContain('2026-09-03,182');
  expect(await copied(page)).toContain('2026-09-01,180');
  await page.getByLabel('Import CSV').setInputFiles(file(info, 'b3.csv', 'date,weight_lb\n2026-09-01,175\n'));
  await page.getByRole('button', { name: 'Replace them' }).click();
  await page.getByRole('button', { name: 'Export body CSV' }).click();
  await expect.poll(() => copied(page)).toContain('2026-09-01,175');
});

test('a file that is not a log says nothing was imported', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(file(info, 'junk.csv', 'not,a,csv\n1,2,3'));
  await expect(page.getByText('Nothing imported', { exact: true })).toBeVisible();
  await expect(page.getByText(/1 row skipped/)).toBeVisible();
});

// The Today tab may or may not still hold the open lift after a trip to Data.
async function toBench(page: Page) {
  await page.getByRole('button', { name: 'Today' }).click();
  const rows = page.getByRole('list', { name: 'Sets for Bench Press' });
  if (await rows.isVisible()) return;
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: /^Bench Press( · logged)?$/ }).click();
}
