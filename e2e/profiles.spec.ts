import { expect, test, type Page } from '@playwright/test';

const bar = (page: Page) => page.getByRole('group', { name: 'Who’s training' });
const addCurl = async (page: Page) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Zercher Curl');
  await page.getByRole('button', { name: 'Add “Zercher Curl”' }).click();
};

test('two people on one phone: separate logs, one-tap switch, typed sets survive a switch', async ({ page }) => {
  await page.goto('/');
  await expect(bar(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sam');
  await expect(page.getByText('Backed up to profiles/sam/')).toBeVisible();
  await page.getByRole('button', { name: 'Add Sam' }).click();
  await expect(bar(page).getByRole('button', { name: /Sam/ })).toHaveAttribute('aria-pressed', 'true');

  // Sam logs a set.
  await page.getByRole('button', { name: 'Today' }).click();
  await addCurl(page);
  await page.getByRole('textbox', { name: 'Weight' }).fill('20');
  await page.getByRole('textbox', { name: 'Reps' }).fill('10');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Zercher Curl' }).getByRole('listitem')).toHaveText([/20 × 10/]);
  await page.screenshot({ path: 'screenshots/18-profiles.png', fullPage: true });

  // Me sees none of it.
  await bar(page).getByRole('button', { name: /Me/ }).click();
  await expect(page.getByRole('list', { name: 'Sets for Zercher Curl' })).toHaveCount(0);
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText('Zercher Curl')).toHaveCount(0);

  // Me types a set, switches away and back before saving: it's still there.
  await page.getByRole('button', { name: 'Today' }).click();
  await addCurl(page);
  await page.getByRole('textbox', { name: 'Weight' }).fill('45');
  await page.getByRole('textbox', { name: 'Reps' }).fill('7');
  await bar(page).getByRole('button', { name: /Sam/ }).click();
  await expect(page.getByRole('list', { name: 'Sets for Zercher Curl' }).getByRole('listitem')).toHaveText([/20 × 10/]);
  await bar(page).getByRole('button', { name: /Me/ }).click();
  await expect(page.getByRole('textbox', { name: 'Reps' })).toHaveValue('7');
  await expect(page.getByRole('textbox', { name: 'Weight' })).toHaveValue('45');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Zercher Curl' }).getByRole('listitem')).toHaveText([/45 × 7/]);

  // The active profile survives a reload.
  await bar(page).getByRole('button', { name: /Sam/ }).click();
  await expect(page.getByRole('list', { name: 'Sets for Zercher Curl' }).getByRole('listitem')).toHaveText([/20 × 10/]);
  await expect.poll(() => page.evaluate(() => new Promise((ok) => {
    const r = indexedDB.open('gym-tracker-shared');
    r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('people'); g.onsuccess = () => { ok(g.result?.active); r.result.close(); }; };
  }))).not.toBe('main');
  await page.reload();
  await expect(bar(page).getByRole('button', { name: /Sam/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('list', { name: 'Sets for Zercher Curl' }).getByRole('listitem')).toHaveText([/20 × 10/]);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Deleting Sam needs the name typed.
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const del = page.getByRole('button', { name: 'Delete Sam' });
  await expect(del).toBeDisabled();
  await page.getByRole('textbox', { name: 'Type Sam to confirm' }).fill('Sam');
  await del.click();
  await expect(bar(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText('Zercher Curl').first()).toBeVisible(); // Me's set is untouched

  // A new person can't take over the deleted one's backup folder.
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sam');
  await expect(page.getByText(/still holds an old backup/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Sam' })).toBeDisabled();
});

test('switching person goes back to today', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sam');
  await page.getByRole('button', { name: 'Add Sam' }).click();
  await bar(page).getByRole('button', { name: /Me/ }).click();
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByText('Logging to Thu, Oct 1, 2026')).toBeVisible();
  await bar(page).getByRole('button', { name: /Sam/ }).click();
  await expect(bar(page).getByRole('button', { name: /Sam/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Fri, Oct 2' })).toBeVisible();
  await expect(page.getByText(/Logging to/)).toHaveCount(0);
});

test('the exercise search stays visible below the profile bar when the list scrolls', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sam');
  await page.getByRole('button', { name: 'Add Sam' }).click();
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(300);
  const barBox = (await bar(page).boundingBox())!;
  const search = (await page.getByRole('searchbox', { name: 'Search exercises' }).boundingBox())!;
  expect(search.y).toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);
  await page.screenshot({ path: 'screenshots/19-picker-profiles.png' });
});
