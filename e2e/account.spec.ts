import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Accounts against the local Auth and Firestore emulators (the app uses them on 127.0.0.1). Synthetic users only.
const T = new Date('2026-10-02T18:00:00');
const PASSWORD = 'synthetic-pass-1';
let n = 0;
const email = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${n++}@test.local`; // unique across parallel workers
const nav = (page: Page, t: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: t, exact: true }).click();
const account = (page: Page) => page.getByRole('region', { name: 'Account' });
const rows = (page: Page) => page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');

async function phone(browser: Browser) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:4173', localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
  const page = await ctx.newPage();
  await page.clock.install({ time: T });
  await page.goto('/');
  return page;
}
async function enter(page: Page, mail: string, how: 'Create account' | 'Sign in', password = PASSWORD) {
  await nav(page, 'Data');
  await account(page).getByRole('textbox', { name: 'Email' }).fill(mail);
  await account(page).getByLabel('Password').fill(password);
  await account(page).getByRole('button', { name: how }).click();
}
async function logBench(page: Page, weight: string, reps: string) {
  await nav(page, 'Today');
  if (!(await rows(page).count())) {
    await page.getByRole('button', { name: 'Add exercise' }).click();
    await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
    await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  }
  const before = await rows(page).count();
  await page.getByRole('textbox', { name: 'Weight' }).first().fill(weight);
  await page.getByRole('textbox', { name: 'Reps' }).first().fill(reps);
  await page.getByRole('button', { name: 'Add set' }).first().click();
  await expect(rows(page)).toHaveCount(before + 1);
}
async function syncNow(page: Page) {
  await nav(page, 'Data');
  await account(page).getByRole('button', { name: 'Sync now' }).click();
  await expect(account(page).getByRole('status')).toHaveText(/^Synced/);
}

test('a set logged on one phone reaches another that signs in, both ways, and a delete follows', async ({ browser }) => {
  const mail = email();
  const a = await phone(browser);
  await logBench(a, '135', '8');
  await enter(a, mail, 'Create account');
  await expect(account(a)).toContainText(`Signed in as ${mail}`);
  await expect(account(a).getByRole('status')).toHaveText(/^Synced/);

  const b = await phone(browser);
  await enter(b, mail, 'Sign in');
  await expect(account(b).getByRole('status')).toHaveText(/^Synced/);
  await nav(b, 'Today');
  await expect(rows(b)).toHaveCount(1);
  await expect(rows(b).first()).toContainText('135 × 8');

  await logBench(b, '140', '6');
  await syncNow(b);
  await syncNow(a);
  await nav(a, 'Today');
  await expect(rows(a)).toHaveCount(2);

  // A deletes the first set; B loses it on its next sync, and doesn't push it back.
  await rows(a).first().getByRole('button').click();
  await a.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(rows(a)).toHaveCount(1);
  await syncNow(a);
  await syncNow(b);
  await nav(b, 'Today');
  await expect(rows(b)).toHaveCount(1);
  await expect(rows(b).first()).toContainText('140 × 6');
  await syncNow(a);
  await nav(a, 'Today');
  await expect(rows(a)).toHaveCount(1);
});

test('a log kept on the phone before an account moves over on first sign-in, priorities included', async ({ browser }) => {
  const mail = email();
  const a = await phone(browser);
  await nav(a, 'Data');
  await a.getByLabel('Import CSV').setInputFiles(path.join(import.meta.dirname, 'fixtures', 'history.sample.csv')); // January
  await expect(a.getByText('✓ Imported 6 new sets')).toBeVisible();
  await a.getByLabel('Import CSV').setInputFiles(path.join(import.meta.dirname, 'fixtures', 'profile.sample.json'));
  await expect(a.getByText('Profile imported: 2 muscles prioritised')).toBeVisible();
  await logBench(a, '135', '8'); // October
  await enter(a, mail, 'Create account');
  await expect(account(a).getByRole('status')).toHaveText('Synced: 7 sets from this phone saved to your account');

  const b = await phone(browser);
  await enter(b, mail, 'Sign in');
  await expect(account(b).getByRole('status')).toHaveText('Synced: 7 sets in, program and settings updated');
  await b.waitForTimeout(4500); // the follow-up sync (the import changed the log) mustn't wipe the message
  await expect(account(b).getByRole('status')).toHaveText('Synced: 7 sets in, program and settings updated');
  await nav(b, 'Today');
  await expect(rows(b)).toHaveCount(1);
  await nav(b, 'Lifts');
  await b.getByRole('button', { name: /Cable Curl/ }).click();
  await expect(b.getByRole('img', { name: 'Estimated 1RM over time' }).locator('circle.pt')).toHaveCount(2);
  await nav(b, 'Stats');
  await expect(b.getByRole('combobox', { name: 'Calves' })).toHaveValue('1');
  await expect(b.getByRole('textbox', { name: 'Sessions per week goal' })).toHaveValue('3');
});

test('a wrong password says so, and signing out keeps the log on the phone', async ({ browser }) => {
  const mail = email();
  const a = await phone(browser);
  await logBench(a, '100', '10');
  await enter(a, mail, 'Create account');
  await expect(account(a).getByRole('status')).toHaveText(/^Synced/);
  await account(a).getByRole('button', { name: 'Sign out' }).click();
  await expect(account(a).getByRole('button', { name: 'Sign in' })).toBeVisible();
  await nav(a, 'Today');
  await expect(rows(a)).toHaveCount(1);

  const b = await phone(browser);
  await enter(b, mail, 'Sign in', 'not-the-password');
  await expect(account(b).getByRole('alert')).toHaveText('Wrong email or password.');
});

test('deleting the account removes the login and the cloud copy', async ({ browser }) => {
  const mail = email();
  const a = await phone(browser);
  await logBench(a, '100', '10');
  await enter(a, mail, 'Create account');
  await expect(account(a).getByRole('status')).toHaveText(/^Synced/);
  await account(a).getByText('Delete account', { exact: true }).click();
  await account(a).getByLabel('Password to confirm').fill(PASSWORD);
  await account(a).getByRole('button', { name: 'Delete account and cloud copy' }).click();
  await expect(account(a).getByRole('button', { name: 'Create account' })).toBeVisible();
  await nav(a, 'Today');
  await expect(rows(a)).toHaveCount(1); // the phone's own log stays

  const b = await phone(browser);
  await enter(b, mail, 'Sign in');
  await expect(account(b).getByRole('alert')).toHaveText('Wrong email or password.');
});
