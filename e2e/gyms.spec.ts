import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');
const slotNames = async (page: Page) => (await page.getByRole('list', { name: /exercises$/ }).getByRole('listitem').allInnerTexts()).join('\n');

test('Set up your gym saves nothing until the user names it or ticks gear', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Set up your gym' }).click();
  await page.getByRole('button', { name: '‹ Back' }).click();
  // Still no gym: the prompt is back and no "Gym:" line appears.
  await expect(page.getByRole('button', { name: 'Set up your gym' })).toBeVisible();
  await expect(page.getByText('Gym: My gym')).toHaveCount(0);
  await page.getByRole('button', { name: 'Set up your gym' }).click();
  await expect(page.getByRole('group', { name: 'Active gym' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'barbell', exact: true }).check();
  await expect(page.getByRole('group', { name: 'Active gym' }).getByRole('button', { name: 'My gym' })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(page.getByText('Gym: My gym')).toBeVisible();
});

test('a long gym name ellipsises and Delete stays on one line', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/');
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Set up your gym' }).click();
  await page.getByLabel('Gym name').fill('The Extremely Long Named Garage Gym Downtown');
  const chip = page.getByRole('group', { name: 'Active gym' }).getByRole('button').first();
  expect((await chip.boundingBox())!.height).toBeLessThanOrEqual(48);
  expect((await chip.boundingBox())!.width).toBeLessThanOrEqual(375 * 0.45 + 1);
  // One line of text: a wrapped label is two lines tall (the button's 44px minimum hides it).
  const label = page.getByRole('button', { name: /^Delete / }).locator('.pname');
  expect((await label.boundingBox())!.height).toBeLessThanOrEqual(24);
  expect(await label.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});

test('a gym without machines gets a plan it can do; exclusions and inclusions stick', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Program', exact: true }).click();

  await expect(page.getByText('Priorities aren’t set')).toBeVisible();
  await page.getByRole('button', { name: 'Set up your gym' }).click();
  await page.getByLabel('Gym name').fill('Downtown');
  for (const e of ['dumbbells', 'flat bench', 'incline bench', 'cable stack', 'lat pulldown', 'pull-up bar']) await page.getByRole('checkbox', { name: e, exact: true }).check();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Cable Curl');
  await page.getByRole('button', { name: 'Exclude Cable Curl' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Zercher Squat');
  await page.getByRole('button', { name: 'I can do “Zercher Squat” here' }).click();
  await expect(page.getByText('Zercher Squat')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('');
  await page.screenshot({ path: 'screenshots/16-gyms.png', fullPage: true });
  await page.getByRole('button', { name: '‹ Back' }).click();

  await expect(page.getByText('Gym: Downtown')).toBeVisible();
  await expect(page.getByText('Low-priority share 20%')).toBeVisible();
  await page.getByRole('textbox', { name: 'Days per week' }).fill('2');
  await page.getByRole('textbox', { name: 'Sets per session' }).fill('14');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A/ })).toBeVisible();
  const names = await slotNames(page);
  expect(names).not.toMatch(/Leg Press|Machine|Pec Deck|Leg Curl|Leg Extension|Seated Calf Raise|Glute Press|Cable Curl/);
  await expect(page.getByText(/Nothing at this gym trains/)).toBeVisible();
  await page.screenshot({ path: 'screenshots/17-program-gym.png', fullPage: true });

  // The swap picker lists what the gym can't do last, under a divider.
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Leg Press');
  await expect(page.getByText('Not at Downtown')).toBeVisible();
});
