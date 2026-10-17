import { expect, test, type Page } from '@playwright/test';
import { goto } from './nav';

const bar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const tabButton = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true });

test('the tab bar is Today · History · Lifts · Stats · Gym · More', async ({ page }) => {
  await page.goto('/');
  await expect(bar(page).getByRole('button')).toHaveText(['Today', 'History', 'Lifts', 'Stats', 'Gym', 'More']);
});

test('the Gym tab has no Back, and Add gym then leaving saves nothing', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'Gym');
  await expect(tabButton(page, 'Gym')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Gyms', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /Back/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add gym', exact: true }).click();
  await expect(page.getByLabel('Gym name')).toHaveValue('My gym');
  await expect(page.getByRole('button', { name: /Back/ })).toHaveCount(0);
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

test('Today names the gym only with two or more, and the line opens the Gym tab', async ({ page }) => {
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
  await expect(tabButton(page, 'Gym')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Gym name')).toHaveValue('Downtown');
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

test('More lists Characters, Friends, Program and Photos; each opens with ‹ More back', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'More');
  await expect(page.getByRole('heading', { name: 'More', level: 1 })).toBeVisible();
  const rows = page.getByRole('list', { name: 'More screens' }).getByRole('button');
  await expect(rows).toHaveText([/^Characters/, /^Friends/, /^Program/, /^Photos/]);
  await page.screenshot({ path: 'screenshots/88-more.png' });
  for (const [row, heading] of [['Characters', 'Characters'], ['Friends', 'Friends'], ['Program', 'Program'], ['Photos', 'Progress photos']]) {
    await rows.filter({ hasText: new RegExp(`^${row}`) }).click();
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    // Friends is shown as the More tab.
    if (row === 'Friends') await expect(tabButton(page, 'More')).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: '‹ More' }).click();
    await expect(page.getByRole('heading', { name: 'More', level: 1 })).toBeVisible();
  }
  // Opened from Today, Program still goes back to Today.
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
});
