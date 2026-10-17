import { expect, test, type Page } from '@playwright/test';
import { goto } from './nav';

const bar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const tabButton = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true });

test('the tab bar is Today · History · Lifts · Stats · Friends · More', async ({ page }) => {
  await page.goto('/');
  await expect(bar(page).getByRole('button')).toHaveText(['Today', 'History', 'Lifts', 'Stats', 'Friends', 'More']);
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
  await page.getByRole('button', { name: 'Program', exact: true }).click();
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
  await expect(tabButton(page, 'More')).not.toHaveAttribute('aria-current', 'page');
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
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Build program' }).click();
  const day = page.getByRole('heading', { name: /^Day A/ });
  await expect(day).toBeVisible();
  await expect(page.locator('details.builder')).not.toHaveAttribute('open');
  const gym = page.getByText('Gym: Garage');
  await expect(gym).toBeVisible();
  expect((await gym.boundingBox())!.y).toBeLessThan((await day.boundingBox())!.y);
  await page.screenshot({ path: 'screenshots/87-program-gym-line.png' });
});

test('More lists Characters, Gym, Program and Photos; each opens with ‹ More back', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'More');
  await expect(page.getByRole('heading', { name: 'More', level: 1 })).toBeVisible();
  const rows = page.getByRole('list', { name: 'More screens' }).getByRole('button');
  await expect(rows).toHaveText([/^Characters/, /^Gym/, /^Program/, /^Photos/]);
  await page.screenshot({ path: 'screenshots/88-more.png' });
  for (const [row, heading] of [['Characters', 'Characters'], ['Gym', 'Gyms'], ['Program', 'Program'], ['Photos', 'Progress photos']]) {
    await rows.filter({ hasText: new RegExp(`^${row}`) }).click();
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    // Opened from More, each is shown as the More tab.
    await expect(tabButton(page, 'More')).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: '‹ More' }).click();
    await expect(page.getByRole('heading', { name: 'More', level: 1 })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Paste from notes' }).click();
  await expect(tabButton(page, 'More')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: '‹ More' }).click();
  // Opened from Today, Program still goes back to Today, and More isn't lit.
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await expect(tabButton(page, 'More')).not.toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
});
