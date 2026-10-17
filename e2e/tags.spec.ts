import { expect, test, type Browser, type Page } from '@playwright/test';
import { goto } from './nav';

// Tags he manages: built-ins shown or hidden, his own added and removed, saved on the set and synced. Synthetic data only.
const T = new Date('2026-10-02T18:00:00');
const rows = (page: Page) => page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');
const flags = (page: Page) => page.getByRole('group', { name: 'Flags' });
const editor = (page: Page) => page.getByRole('group', { name: 'Edit tags' });
const addBench = async (page: Page) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: /^Bench Press( · logged)?$/ }).click();
};
const logBench = async (page: Page, weight: string, reps: string, tap: string[] = []) => {
  const before = await rows(page).count();
  await page.getByRole('textbox', { name: 'Weight' }).fill(weight);
  await page.getByRole('textbox', { name: 'Reps' }).fill(reps);
  if (tap.length) {
    const more = page.getByRole('button', { name: /^Details/ });
    if ((await more.getAttribute('aria-expanded')) === 'false') await more.click();
    for (const t of tap) await flags(page).getByRole('button', { name: t, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(rows(page)).toHaveCount(before + 1);
  // The set lands before the form has finished resetting, and the reset folds More away.
  await expect(page.getByRole('button', { name: /^Details/ })).toHaveAttribute('aria-expanded', 'false');
};
/** Opens the editor: adds his own tags and hides the built-ins named. */
const editTags = async (page: Page, add: string[], hide: string[] = []) => {
  const more = page.getByRole('button', { name: /^Details/ });
  if ((await more.getAttribute('aria-expanded')) === 'false') await more.click();
  await flags(page).getByRole('button', { name: 'Edit tags' }).click();
  for (const t of add) {
    await editor(page).getByRole('textbox', { name: 'Add a tag' }).fill(t);
    await editor(page).getByRole('textbox', { name: 'Add a tag' }).press('Enter');
  }
  for (const h of hide) await editor(page).getByRole('switch', { name: `Show ${h}` }).click();
  await editor(page).getByRole('button', { name: 'Done' }).click();
};

test('his own tags join the row, hidden built-ins leave it, and a tagged set shows its tag in the row and History', async ({ page }) => {
  await page.clock.install({ time: T });
  await page.goto('/');
  await addBench(page);
  await page.getByRole('button', { name: 'Details' }).click();
  await flags(page).getByRole('button', { name: 'Edit tags' }).click();
  // Enter adds the tag; it doesn't log a set.
  await page.getByRole('textbox', { name: 'Weight' }).fill('135');
  await editor(page).getByRole('textbox', { name: 'Add a tag' }).fill('Paused');
  await editor(page).getByRole('textbox', { name: 'Add a tag' }).press('Enter');
  await expect(rows(page)).toHaveCount(0);
  await expect(editor(page).getByRole('textbox', { name: 'Add a tag' })).toHaveValue('');
  await editor(page).getByRole('textbox', { name: 'Add a tag' }).fill('paused');
  await expect(editor(page).getByText('Already a tag')).toBeVisible();
  await expect(editor(page).getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  await editor(page).getByRole('textbox', { name: 'Add a tag' }).fill('Band');
  await editor(page).getByRole('button', { name: 'Add', exact: true }).click();
  await editor(page).getByRole('switch', { name: 'Show Test' }).click();
  await expect(editor(page).getByRole('switch', { name: 'Show Test' })).toHaveAttribute('aria-checked', 'false');
  await page.screenshot({ path: 'screenshots/r7-tag-editor.png', fullPage: true });
  await expect(flags(page).getByRole('button')).toHaveText(['Pain', 'Unsure', 'Warm-up', '2× pulley', 'Paused', 'Band', 'Edit tags']);
  await editor(page).getByRole('button', { name: 'Remove Band' }).click();
  await editor(page).getByRole('button', { name: 'Done' }).click();
  await expect(editor(page)).toHaveCount(0);

  await flags(page).getByRole('button', { name: 'Paused' }).click();
  await expect(page.getByRole('button', { name: /^Details/ })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Paused');
  // The tag goes with the set: the next one starts without it.
  await page.getByRole('button', { name: 'Details' }).click();
  await expect(flags(page).getByRole('button', { name: 'Paused' })).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: 'screenshots/r7-tagged-row.png', fullPage: true });

  // Kept per profile: the row is the same after a reload.
  await page.reload();
  await page.getByRole('button', { name: 'Details' }).click();
  await expect(flags(page).getByRole('button')).toHaveText(['Pain', 'Unsure', 'Warm-up', '2× pulley', 'Paused', 'Edit tags']);

  await goto(page, 'History');
  await expect(page.locator('details.day').first()).toContainText('135 × 8 Paused');
  await page.screenshot({ path: 'screenshots/r7-tag-history.png', fullPage: true });
});

test('a hidden built-in still shows on a set that has it, so it can be turned off, and keeps its meaning', async ({ page }) => {
  await page.clock.install({ time: T });
  await page.goto('/');
  await addBench(page);
  await logBench(page, '95', '5', ['Warm-up']);
  await editTags(page, [], ['Warm-up']);
  await expect(flags(page).getByRole('button', { name: 'Warm-up' })).toHaveCount(0);
  // Still a warm-up: History counts it, not lists it.
  await goto(page, 'History');
  await expect(page.locator('details.day').first()).toContainText('1 warm-up');
  await goto(page, 'Today');
  await rows(page).first().getByRole('button').click();
  const box = page.locator('.edit-box');
  await expect(box.getByRole('group', { name: 'Flags' }).getByRole('button', { name: 'Warm-up' })).toHaveAttribute('aria-pressed', 'true');
  await box.getByRole('group', { name: 'Flags' }).getByRole('button', { name: 'Warm-up' }).click();
  await box.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(rows(page).first()).not.toContainText('warm-up');
});

test('a removed tag on a set can still be turned off in its editor', async ({ page }) => {
  await page.clock.install({ time: T });
  await page.goto('/');
  await addBench(page);
  await editTags(page, ['Slow']);
  await logBench(page, '135', '8', ['Slow']);
  await page.getByRole('button', { name: 'Details' }).click();
  await flags(page).getByRole('button', { name: 'Edit tags' }).click();
  await editor(page).getByRole('button', { name: 'Remove Slow' }).click();
  await editor(page).getByRole('button', { name: 'Done' }).click();
  await expect(flags(page).getByRole('button', { name: 'Slow' })).toHaveCount(0);
  await rows(page).first().getByRole('button').click();
  const chip = page.locator('.edit-box').getByRole('group', { name: 'Flags' }).getByRole('button', { name: 'Slow' });
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await chip.click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(rows(page).first()).not.toContainText('Slow');
});

const PASSWORD = 'synthetic-pass-1';
let n = 0;
const email = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${n++}@test.local`;
const account = (page: Page) => page.getByRole('region', { name: 'Account' });
async function phone(browser: Browser) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
  const page = await ctx.newPage();
  await page.clock.install({ time: T });
  await page.goto('/');
  return page;
}
async function enter(page: Page, mail: string, how: 'Create account' | 'Sign in') {
  await goto(page, 'More');
  await account(page).getByRole('textbox', { name: 'Email' }).fill(mail);
  await account(page).getByLabel('Password').fill(PASSWORD);
  await account(page).getByRole('button', { name: how }).click();
  await expect(account(page).getByRole('status')).toHaveText(/^Synced/);
}

test('the tag row and a set’s tags reach another phone on the same account', async ({ browser }) => {
  const mail = email();
  const a = await phone(browser);
  await addBench(a);
  await editTags(a, ['Paused'], ['Test']);
  await logBench(a, '135', '8', ['Paused']);
  await enter(a, mail, 'Create account');

  const b = await phone(browser);
  await enter(b, mail, 'Sign in');
  await goto(b, 'Today');
  await expect(rows(b)).toHaveCount(1);
  await expect(rows(b).first()).toContainText('Paused');
  await b.getByRole('button', { name: 'Details' }).click();
  await expect(flags(b).getByRole('button')).toHaveText(['Pain', 'Unsure', 'Warm-up', '2× pulley', 'Paused', 'Edit tags']);
});
