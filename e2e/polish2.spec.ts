import { expect, test, type Page } from '@playwright/test';

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source';

// Synthetic: Thu Oct 1 trained Lat Pulldown, then Bench Press, then Cable Curl.
async function seed(page: Page, rows: string[] = [
  '2026-10-01,Lat Pulldown,,1,100,10,,,,sample', '2026-10-01,Lat Pulldown,,2,100,9,,,,sample',
  '2026-10-01,Bench Press,,1,135,8,,,,sample', '2026-10-01,Cable Curl,,1,40,12,,,,sample',
]) {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...rows].join('\n')) });
  await expect(page.getByText(`✓ Imported ${rows.length} new sets`)).toBeVisible();
  await page.getByRole('button', { name: 'Today' }).click();
}
const order = (page: Page) => page.locator('[data-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')));

test('adding a set to a lift done earlier in the day keeps its card in place', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect.poll(() => order(page)).toEqual(['lat pulldown', 'bench press', 'cable curl']);
  const lat = page.locator('[data-card="lat pulldown"]');
  await lat.getByRole('button', { name: 'Add set' }).click();
  await expect(lat.locator('.sets li')).toHaveCount(3);
  expect(await order(page)).toEqual(['lat pulldown', 'bench press', 'cable curl']);
});

test('a warm-up set is tagged “warm-up”, not the raw flag', async ({ page }) => {
  await seed(page);
  const bench = page.locator('[data-card="bench press"]');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('bench press');
  await page.locator('.picker-list').getByRole('button', { name: /^Bench Press/ }).first().click();
  await bench.getByRole('button', { name: /^More/ }).click();
  await bench.getByRole('group', { name: 'Flags' }).getByRole('button', { name: 'Warm-up' }).click();
  await bench.getByRole('button', { name: 'Add set' }).click();
  await expect(bench.locator('.sets .tag')).toHaveText('warm-up');
});

test('a set the form won’t take says why', async ({ page }) => {
  await seed(page);
  const curl = page.locator('[data-card="cable curl"]');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('cable curl');
  await page.locator('.picker-list').getByRole('button', { name: /^Cable Curl/ }).first().click();
  const add = curl.getByRole('button', { name: 'Add set' });
  await curl.getByRole('textbox', { name: 'Reps' }).fill('1000');
  await expect(add).toBeDisabled();
  await expect(curl.getByRole('status')).toHaveText('Reps go up to 999');
  await curl.getByRole('textbox', { name: 'Reps' }).fill('0');
  await curl.getByRole('textbox', { name: 'Weight' }).fill('0');
  await expect(add).toBeDisabled(); // a 0 × 0 set records nothing
  await expect(curl.getByRole('status')).toHaveText('A set needs a weight or reps');
  await curl.getByRole('textbox', { name: 'Reps' }).fill('12');
  await expect(add).toBeEnabled();
  await expect(curl.getByRole('status')).toHaveCount(0);
});

test('a hold logs seconds with no RIR chips', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('plank');
  await page.locator('.picker-list').getByRole('button', { name: /^Plank/ }).first().click();
  const plank = page.locator('[data-card="plank"]');
  await expect(plank.getByRole('textbox', { name: 'Seconds' })).toBeVisible();
  await expect(plank.getByRole('group', { name: 'RIR' })).toHaveCount(0);
});

test('progression settings say why they can’t be saved', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Lifts' }).click();
  await page.getByRole('button', { name: /Bench Press/ }).click();
  const card = page.getByRole('group', { name: 'Progression settings' });
  await card.getByRole('textbox', { name: 'Max reps' }).fill('6');
  await expect(card.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  await expect(card.getByRole('status')).toHaveText('Max reps can’t be below min reps');
  await card.getByRole('textbox', { name: 'Max reps' }).fill('12');
  await expect(card.getByRole('status')).toHaveCount(0);
});

test('a hold’s progression settings are in seconds, and go past 50', async ({ page }) => {
  await seed(page, ['2026-10-01,Plank,,1,0,40,,hold,,sample', '2026-10-01,Plank,,2,0,40,,hold,,sample']);
  await page.getByRole('button', { name: 'Lifts' }).click();
  await page.getByRole('button', { name: /Plank/ }).click();
  const card = page.getByRole('group', { name: 'Progression settings' });
  await expect(card.getByRole('textbox', { name: /reps/i })).toHaveCount(0);
  await card.getByRole('textbox', { name: 'Max seconds' }).fill('90');
  await expect(card.getByRole('textbox', { name: 'Min seconds' })).toHaveValue('20');
  await expect(card.getByRole('textbox', { name: 'Add weight' })).toBeVisible();
  await card.getByRole('button', { name: 'Save settings' }).click();
  await expect(card.getByRole('button', { name: 'Saved' })).toBeVisible();
});

test('a hold held at the top of its range says to add weight or go harder, not “40 s+”', async ({ page }) => {
  await seed(page, ['2026-10-01,Plank,,1,0,40,,hold,,sample', '2026-10-01,Plank,,2,0,40,,hold,,sample']);
  await page.getByRole('button', { name: 'Lifts' }).click();
  await page.getByRole('button', { name: /Plank/ }).click();
  const next = page.getByRole('region', { name: 'Next time' });
  await expect(next.locator('.big')).toHaveText('2 × 40 s @ BW');
  await expect(next).toContainText('harder variation');
  await page.getByRole('button', { name: 'Log it today' }).click();
  await expect(page.locator('[data-card="plank"]').getByLabel('Target')).toHaveText(/^2 × 40 s @ BW/);
});
