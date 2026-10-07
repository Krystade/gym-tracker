import { expect, test, type Page } from '@playwright/test';

// The config marks the walkthrough as seen for every other spec; here the phone is new.
test.use({ storageState: { cookies: [], origins: [] } });

const nav = (page: Page, t: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: t, exact: true }).click();

test('a first visit opens the walkthrough; Back and Next step through it, and Done closes it for good', async ({ page }) => {
  await page.goto('/');
  const sheet = page.getByRole('dialog', { name: 'Walkthrough' });
  await expect(sheet).toContainText('1 of 5');
  await expect(sheet.getByRole('heading')).toHaveText('Today');
  await expect(sheet.getByRole('button', { name: 'Back' })).toHaveCount(0);
  await page.screenshot({ path: 'screenshots/71-walkthrough.png' });
  await sheet.getByRole('button', { name: 'Next' }).click();
  await expect(sheet.getByRole('heading')).toHaveText('Log a set');
  await sheet.getByRole('button', { name: 'Back' }).click();
  await expect(sheet.getByRole('heading')).toHaveText('Today');
  for (const t of ['Log a set', 'The plan', 'History, Lifts and Stats', 'Your data']) {
    await sheet.getByRole('button', { name: 'Next' }).click();
    await expect(sheet.getByRole('heading')).toHaveText(t);
  }
  await expect(sheet).toContainText('5 of 5');
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(sheet).toHaveCount(0);
});

test('Skip closes it for good, and the Data tab opens it again from the start', async ({ page }) => {
  await page.goto('/');
  const sheet = page.getByRole('dialog', { name: 'Walkthrough' });
  await sheet.getByRole('button', { name: 'Next' }).click();
  await sheet.getByRole('button', { name: 'Skip' }).click();
  await expect(sheet).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await nav(page, 'Data');
  await page.getByRole('button', { name: 'Show walkthrough' }).click();
  await expect(sheet.getByRole('heading')).toHaveText('Today');
});

test('the sheet leaves the screen above it usable', async ({ page }) => {
  await page.goto('/');
  const sheet = page.getByRole('dialog', { name: 'Walkthrough' });
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  expect(box.y).toBeGreaterThan(812 / 2); // a sheet at the bottom, not a modal over the middle
  await page.getByRole('button', { name: 'Add exercise' }).click(); // nothing blocks the page behind it
  await expect(page.getByRole('searchbox', { name: 'Search exercises' })).toBeVisible();
});
