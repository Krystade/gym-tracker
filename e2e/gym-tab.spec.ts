import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { goto, openProgram } from './nav';

const bar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const tabButton = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true });

test('the tab bar is Today · Log · Stats · Buddies · Friends · More', async ({ page }) => {
  await page.goto('/');
  await expect(bar(page).getByRole('button')).toHaveText(['Today', 'Log', 'Stats', 'Buddies', 'Friends', 'More']);
});

test('Friends is a tab: lit as itself, with no Back to More', async ({ page }) => {
  await page.goto('/');
  await tabButton(page, 'Friends').click();
  await expect(page.getByRole('heading', { name: 'Friends', level: 1 })).toBeVisible();
  await expect(tabButton(page, 'Friends')).toHaveAttribute('aria-current', 'page');
  await expect(tabButton(page, 'More')).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: /Back|‹/ })).toHaveCount(0);
});

test('Gym opens from More with ‹ More back, and Add gym then leaving saves nothing', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'Gym');
  await expect(tabButton(page, 'More')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Gyms', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '‹ More' }).click();
  await expect(page.getByRole('heading', { name: 'More', level: 1 })).toBeVisible();
  await goto(page, 'Gym');
  await page.getByRole('button', { name: 'Add gym', exact: true }).click();
  await expect(page.getByLabel('Gym name')).toHaveValue('My gym');
  // Left untouched: no gym was made.
  await goto(page, 'Today');
  await goto(page, 'Gym');
  await expect(page.getByRole('button', { name: 'Add gym', exact: true })).toBeVisible();
  await goto(page, 'Today');
  await openProgram(page);
  await expect(page.getByRole('button', { name: 'Set up your gym' })).toBeVisible();
  // The first edit keeps it.
  await goto(page, 'Gym');
  await page.getByRole('button', { name: 'Add gym', exact: true }).click();
  await page.getByRole('checkbox', { name: 'barbell', exact: true }).check();
  await expect(page.getByRole('group', { name: 'Active gym' }).getByRole('button', { name: 'My gym' })).toBeVisible();
  await page.reload();
  await goto(page, 'Gym');
  await expect(page.getByLabel('Gym name')).toHaveValue('My gym');
  await page.screenshot({ path: 'screenshots/85-gym-tab.png' });
});

test('Today names the gym only with two or more, and the line opens Gyms, with Back to Today', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'Gym');
  await page.getByRole('button', { name: 'Add gym', exact: true }).click();
  await page.getByLabel('Gym name').fill('Garage');
  await goto(page, 'Today');
  await expect(page.getByRole('button', { name: /^at Garage/ })).toHaveCount(0);
  await goto(page, 'Gym');
  await page.getByRole('button', { name: '+ Add gym' }).click();
  await page.getByLabel('Gym name').fill('Downtown');
  await goto(page, 'Today');
  const line = page.getByRole('button', { name: /^at Downtown/ });
  await expect(line).toBeVisible();
  await page.screenshot({ path: 'screenshots/86-today-gym-line.png' });
  await line.click();
  await expect(page.getByLabel('Gym name')).toHaveValue('Downtown');
  // Opened from Today, Today stays lit (owner, 2026-10-21: a screen lights the tab it came from).
  await expect(bar(page).locator('[aria-current="page"]')).toHaveText('Today');
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(line).toBeVisible();
});

test('+ Add gym beside a gym opens a draft: leaving it adds no second gym', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'Gym');
  await page.getByRole('button', { name: 'Add gym', exact: true }).click();
  await page.getByLabel('Gym name').fill('Garage');
  await page.getByRole('button', { name: '+ Add gym' }).click();
  await expect(page.getByLabel('Gym name')).toHaveValue('Gym 2');
  await goto(page, 'Today');
  await expect(page.getByRole('button', { name: /^at / })).toHaveCount(0);
  await goto(page, 'Gym');
  await expect(page.getByRole('group', { name: 'Active gym' }).getByRole('button')).toHaveText(['Garage', '+ Add gym', '+ From text']);
});

test('Program shows the gym above the days, outside the folded rebuild', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'Gym');
  await page.getByRole('button', { name: 'Add gym', exact: true }).click();
  await page.getByLabel('Gym name').fill('Garage');
  await page.getByRole('button', { name: 'Full gym: tick all gear' }).click();
  await goto(page, 'Today');
  await openProgram(page);
  await page.getByRole('button', { name: 'Build program' }).click();
  const day = page.getByRole('heading', { name: /^Day A/ });
  await expect(day).toBeVisible();
  await expect(page.locator('details.builder')).not.toHaveAttribute('open');
  const gym = page.getByText('Gym: Garage');
  await expect(gym).toBeVisible();
  expect((await gym.boundingBox())!.y).toBeLessThan((await day.boundingBox())!.y);
  await page.screenshot({ path: 'screenshots/87-program-gym-line.png' });
});

test('More is four groups of rows; each opens its screen with ‹ More back, and More stays lit', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'More');
  await expect(page.getByRole('heading', { name: 'More', level: 1 })).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 2 })).toHaveText(['Training setup', 'You', 'Account and data', 'Help']);
  const group = (name: string) => main.getByRole('list', { name, exact: true }).getByRole('button');
  await expect(group('Training setup')).toHaveText([/^Program/, /^Weekly goal/, /^Priorities and goal/, /^Gym/]);
  await expect(group('You')).toHaveText([/^Achievements/, /^Progress photos/, /^Cycle tracking/, /^People on this phone/]);
  await expect(group('Account and data')).toHaveText([/^Account and sync/, /^Notifications/, /^Backup, import and export/]);
  await expect(group('Help')).toHaveText(['Show walkthrough', 'Accessory placer']);
  await page.screenshot({ path: 'screenshots/88-more.png' });
  for (const [row, heading] of [['Program', 'Program'], ['Weekly goal', 'Weekly goal'], ['Priorities and goal', 'Priorities and goal'], ['Gym', 'Gyms'],
    ['Progress photos', 'Progress photos'], ['Cycle tracking', 'Cycle tracking'], ['People on this phone', 'People on this phone'],
    ['Account and sync', 'Account and sync'], ['Notifications', 'Notifications'], ['Backup, import and export', 'Backup, import and export']]) {
    await main.getByRole('button', { name: new RegExp(`^${row}`) }).click();
    await expect(page.getByRole('heading', { name: heading, level: 1, exact: true })).toBeVisible();
    // Opened from More, each is shown as the More tab, and only it.
    await expect(bar(page).locator('[aria-current="page"]')).toHaveText('More');
    await page.getByRole('button', { name: '‹ More' }).click();
    await expect(page.getByRole('heading', { name: 'More', level: 1 })).toBeVisible();
  }
  // Paste, two deep: still More, and back to Backup.
  await goto(page, 'Backup');
  await page.getByRole('button', { name: 'Paste from notes' }).click();
  await expect(bar(page).locator('[aria-current="page"]')).toHaveText('More');
  await page.getByRole('button', { name: '‹ Backup' }).click();
  await expect(page.getByRole('heading', { name: 'Backup, import and export', level: 1 })).toBeVisible();
  // Photos is More's alone: not on Stats.
  await goto(page, 'Stats');
  await expect(page.getByRole('button', { name: /Progress photos/ })).toHaveCount(0);
});

test('a screen over a tab lights the tab it came from: Exercise its list, Program and Gym Today (or More)', async ({ page }) => {
  const lit = bar(page).locator('[aria-current="page"]');
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles(path.join(import.meta.dirname, 'fixtures', 'history.sample.csv'));
  await expect(page.getByText(/Imported \d+ new/)).toBeVisible();
  // Exercise from Lifts: Log.
  await goto(page, 'Lifts');
  await page.getByRole('main').getByRole('button', { name: /^Cable Curl/ }).click();
  await expect(page.getByRole('heading', { name: 'Cable Curl', level: 1 })).toBeVisible();
  await expect(lit).toHaveText('Log');
  // Exercise from History: Log.
  await goto(page, 'History');
  const jan5 = page.locator('details.day').filter({ hasText: 'Jan 5' });
  await jan5.locator('summary').click();
  await jan5.getByRole('button', { name: /^Cable Curl/ }).click();
  await expect(page.getByRole('heading', { name: 'Cable Curl', level: 1 })).toBeVisible();
  await expect(lit).toHaveText('Log');
  // Program from Today: Today, with ‹ Back to it. From More: More.
  await goto(page, 'Today');
  await openProgram(page);
  await expect(page.getByRole('heading', { name: 'Program', level: 1 })).toBeVisible();
  await expect(lit).toHaveText('Today');
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
  await expect(lit).toHaveText('Today');
  await goto(page, 'Program');
  await expect(lit).toHaveText('More');
  // Photos: More.
  await goto(page, 'Photos');
  await expect(page.getByRole('heading', { name: 'Progress photos', level: 1 })).toBeVisible();
  await expect(lit).toHaveText('More');
  // A tap on the lit tab leaves the screen for the tab's own.
  await tabButton(page, 'More').click();
  await expect(page.getByRole('heading', { name: 'More', level: 1 })).toBeVisible();
});
