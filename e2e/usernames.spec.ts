import { expect, test, type Browser, type Page } from '@playwright/test';
import { goto } from './nav';

// Changing your username, and private tags for friends, against the local Auth and Firestore emulators. Synthetic users only.
const T = new Date(new Date().setHours(18, 0, 0, 0));
const PASSWORD = 'synthetic-pass-1';
const rand = () => Math.random().toString(36).slice(2, 10);
const friends = (page: Page) => page.getByRole('region', { name: 'Friends', exact: true });
const crew = (page: Page) => page.getByRole('region', { name: 'Crew' });

async function person(browser: Browser) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
  const page = await ctx.newPage();
  await page.clock.install({ time: T });
  await page.goto('/');
  const name = `u${rand()}`;
  await goto(page, 'Friends');
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  const account = page.getByRole('region', { name: 'Account' });
  await account.getByRole('textbox', { name: 'Email' }).fill(`${name}@test.local`);
  await account.getByLabel('Password').fill(PASSWORD);
  await account.getByRole('button', { name: 'Create account' }).click();
  await expect(account.getByRole('status')).toHaveText(/^Synced/);
  await goto(page, 'Friends');
  await friends(page).getByRole('textbox', { name: 'Username' }).fill(name);
  await friends(page).getByRole('button', { name: 'Save username' }).click();
  await expect(friends(page)).toContainText(`You’re @${name}`);
  return { page, name };
}

async function befriend(a: { page: Page; name: string }, b: { page: Page; name: string }) {
  await friends(b.page).getByRole('textbox', { name: 'Their username' }).fill(a.name);
  await friends(b.page).getByRole('button', { name: 'Send request' }).click();
  await expect(friends(b.page).getByRole('status')).toHaveText(`Request sent to @${a.name}.`);
  await a.page.reload();
  await goto(a.page, 'Friends');
  await friends(a.page).getByRole('region', { name: 'Requests' }).getByRole('button', { name: 'Accept' }).click();
  await expect(friends(a.page).getByRole('status')).toHaveText(`You and @${b.name} are now friends.`);
}

test('a tag only you see follows a friend through a change of username, with “formerly” beside the new one', async ({ browser }) => {
  const [a, b] = await Promise.all([person(browser), person(browser)]);
  await befriend(a, b);

  // b tags a on a's page: it shows beside a's @username there and on Crew.
  await b.page.reload();
  await goto(b.page, 'Friends');
  await crew(b.page).getByRole('button', { name: `@${a.name}`, exact: true }).click();
  await b.page.getByRole('button', { name: 'Add a tag' }).click();
  await b.page.getByRole('textbox', { name: `Your tag for @${a.name}` }).fill('  Sam   (gym) ');
  await b.page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(b.page.getByRole('region', { name: 'Viewing a friend' })).toContainText(`Viewing Sam (gym) @${a.name}`);
  await expect(b.page.getByText('Only you see it.')).toBeVisible();
  await b.page.getByRole('button', { name: 'Back to you' }).click();
  await expect(crew(b.page).getByRole('button', { name: `Sam (gym) · @${a.name}`, exact: true })).toBeVisible();

  // a sees no tag anywhere: it's b's alone.
  await a.page.reload();
  await goto(a.page, 'Friends');
  await expect(a.page.getByText('Sam (gym)')).toHaveCount(0);

  // a changes username, in place, beside "You're @…".
  const old = a.name, next = `${a.name}_k`;
  await friends(a.page).getByRole('button', { name: 'Change username' }).click();
  const form = friends(a.page).getByRole('form', { name: 'Change username' });
  await form.getByRole('textbox', { name: 'New username' }).fill(next);
  await form.getByRole('button', { name: 'Save username' }).click();
  await expect(friends(a.page).getByRole('status')).toHaveText(`You’re @${next} now. Friends see it at once, with “formerly @${old}” for 30 days.`);
  await expect(friends(a.page)).toContainText(`You’re @${next}.`);
  // Once a day: the form says when, and won't save.
  await friends(a.page).getByRole('button', { name: 'Change username' }).click();
  await expect(form).toContainText('You changed it in the last day.');
  await form.getByRole('textbox', { name: 'New username' }).fill(`${old}_z`);
  await expect(form.getByRole('button', { name: 'Save username' })).toBeDisabled();
  await form.getByRole('button', { name: 'Cancel' }).click();

  // b: still friends (by account, not name), the tag still on them, the new name beside it and the old one as "formerly".
  await b.page.reload();
  await goto(b.page, 'Friends');
  const row = crew(b.page).getByTestId(`crew-${next}`);
  await expect(row.getByRole('button', { name: `Sam (gym) · @${next}`, exact: true })).toBeVisible();
  await expect(row).toContainText(`formerly @${old}`);
  await row.getByRole('button', { name: `Message @${next}` }).click();
  const sheet = b.page.getByRole('dialog', { name: `Messages with Sam (gym) · @${next}` });
  await expect(sheet.getByRole('heading', { level: 2 })).toHaveText(`Sam (gym) @${next} formerly @${old}`);
  await sheet.getByRole('button', { name: 'Close' }).click();

  // The old name is free: nobody goes by it now.
  await friends(b.page).getByRole('textbox', { name: 'Their username' }).fill(old);
  await friends(b.page).getByRole('button', { name: 'Send request' }).click();
  await expect(friends(b.page).getByRole('alert')).toHaveText(`No one goes by “${old}”. Check the spelling.`);

  // Removing the tag leaves the @username alone.
  await crew(b.page).getByRole('button', { name: `Sam (gym) · @${next}`, exact: true }).click();
  await b.page.getByRole('button', { name: 'Edit tag' }).click();
  await b.page.getByRole('button', { name: 'Remove' }).click();
  await expect(b.page.getByRole('button', { name: 'Add a tag' })).toBeVisible();
  await b.page.getByRole('button', { name: 'Back to you' }).click();
  await expect(crew(b.page).getByRole('button', { name: `@${next}`, exact: true })).toBeVisible();
});
