import { expect, test, type Browser, type Page } from '@playwright/test';

// Friends against the local Auth and Firestore emulators. Synthetic users only.
const T = new Date('2026-10-02T18:00:00');
const PASSWORD = 'synthetic-pass-1';
const rand = () => Math.random().toString(36).slice(2, 10);
const nav = (page: Page, t: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: t, exact: true }).click();
const friends = (page: Page) => page.getByRole('region', { name: 'Friends', exact: true });
const note = (page: Page) => friends(page).getByRole('status');

async function person(browser: Browser, opts: { bench?: boolean } = {}) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:4173', localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
  const page = await ctx.newPage();
  await page.clock.install({ time: T });
  await page.goto('/');
  if (opts.bench) {
    await page.getByRole('button', { name: 'Add exercise' }).click();
    await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
    await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
    await page.getByRole('textbox', { name: 'Weight' }).first().fill('135');
    await page.getByRole('textbox', { name: 'Reps' }).first().fill('8');
    await page.getByRole('button', { name: 'Add set' }).first().click();
  }
  const name = `u${rand()}`;
  await nav(page, 'Friends');
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  const account = page.getByRole('region', { name: 'Account' });
  await account.getByRole('textbox', { name: 'Email' }).fill(`${name}@test.local`);
  await account.getByLabel('Password').fill(PASSWORD);
  await account.getByRole('button', { name: 'Create account' }).click();
  await expect(account.getByRole('status')).toHaveText(/^Synced/);
  await nav(page, 'Friends');
  await friends(page).getByRole('textbox', { name: 'Username' }).fill(name);
  await friends(page).getByRole('button', { name: 'Save username' }).click();
  await expect(friends(page)).toContainText(`You’re @${name}`);
  return { page, name };
}

test('a request, accepted, lets each see the other’s log read-only; removing ends it for both', async ({ browser }) => {
  const a = await person(browser, { bench: true });
  const b = await person(browser);

  await friends(b.page).getByRole('textbox', { name: 'Their username' }).fill(`@${a.name.toUpperCase()}`);
  await friends(b.page).getByRole('button', { name: 'Send request' }).click();
  await expect(note(b.page)).toHaveText(`Request sent to ${a.name}.`);
  await friends(b.page).getByRole('textbox', { name: 'Their username' }).fill('nobody_here_123');
  await friends(b.page).getByRole('button', { name: 'Send request' }).click();
  await expect(friends(b.page).getByRole('alert')).toHaveText('No one goes by “nobody_here_123”. Check the spelling.');

  await nav(a.page, 'Today');
  await nav(a.page, 'Friends');
  const req = friends(a.page).getByRole('region', { name: 'Requests' });
  await expect(req).toContainText(`@${b.name} wants to be friends`);
  await req.getByRole('button', { name: 'Accept' }).click();
  await expect(note(a.page)).toHaveText(`You and ${b.name} are now friends.`);
  await expect(friends(a.page).getByRole('region', { name: 'Your friends' }).getByRole('button', { name: `@${b.name}` })).toBeVisible();

  // b looks at a's log: the same screens, nothing to edit.
  await nav(b.page, 'Today');
  await nav(b.page, 'Friends');
  await friends(b.page).getByRole('button', { name: `@${a.name}` }).click();
  await expect(b.page.getByRole('region', { name: 'Viewing a friend' })).toContainText(`Viewing @${a.name}`);
  await expect(b.page.getByRole('heading', { name: 'Stats', level: 1 })).toBeVisible();
  await expect(b.page.getByRole('combobox', { name: 'Chest' })).toBeDisabled();
  await expect(b.page.getByRole('navigation', { name: 'Sections' }).getByRole('button')).toHaveText(['History', 'Lifts', 'Stats']);
  await nav(b.page, 'History');
  await expect(b.page.getByRole('button', { name: /Bench Press/ })).toContainText('135 × 8');
  await expect(b.page.getByRole('button', { name: 'Add to this day' })).toHaveCount(0);
  await nav(b.page, 'Lifts');
  await b.page.getByRole('button', { name: /Bench Press/ }).click();
  await expect(b.page.getByRole('heading', { name: 'Bench Press', level: 1 })).toBeVisible();
  await expect(b.page.getByRole('button', { name: 'Save settings' })).toHaveCount(0);
  await expect(b.page.getByRole('button', { name: 'Rename' })).toHaveCount(0);
  await b.page.getByRole('button', { name: 'Back to you' }).click();
  await expect(b.page.getByRole('heading', { name: 'Friends', level: 1 })).toBeVisible();
  await nav(b.page, 'Today');
  await expect(b.page.getByRole('list', { name: 'Sets for Bench Press' })).toHaveCount(0); // b's own Today, still empty

  await nav(a.page, 'Today');
  await nav(a.page, 'Friends');
  await friends(a.page).getByRole('button', { name: 'Remove' }).click();
  await friends(a.page).getByRole('button', { name: 'Tap again to remove' }).click();
  await expect(note(a.page)).toHaveText(`Removed ${b.name}. Neither of you can see the other’s log now.`);
  await nav(b.page, 'Friends');
  await expect(friends(b.page).getByRole('region', { name: 'Your friends' })).toContainText('None yet');
});

test('an invite link opened while signed in makes you friends; your own link says so', async ({ browser }) => {
  const a = await person(browser, { bench: true });
  await friends(a.page).getByRole('button', { name: 'Make an invite link' }).click();
  const link = await friends(a.page).getByRole('textbox', { name: 'Your invite link' }).inputValue();
  expect(link).toMatch(/#invite=\w+\.[a-f0-9]{32}$/);
  await friends(a.page).getByRole('textbox', { name: /Got an invite link/ }).fill(link);
  await friends(a.page).getByRole('button', { name: 'Accept invite' }).click();
  await expect(friends(a.page).getByRole('alert')).toHaveText('That’s your own invite link. Send it to a friend.');

  const c = await person(browser);
  await c.page.goto(link);
  await expect(c.page.getByRole('heading', { name: 'Friends', level: 1 })).toBeVisible();
  await expect(note(c.page)).toHaveText(`You and ${a.name} are now friends.`);
  expect(c.page.url()).not.toContain('invite=');
  await friends(c.page).getByRole('button', { name: `@${a.name}` }).click();
  await nav(c.page, 'History');
  await expect(c.page.getByRole('button', { name: /Bench Press/ })).toContainText('135 × 8');

  // Cancelled, the link stops working for anyone else.
  await friends(a.page).getByRole('button', { name: 'Cancel link' }).click();
  await expect(note(a.page)).toHaveText('Invite link cancelled.');
  const d = await person(browser);
  await friends(d.page).getByRole('textbox', { name: /Got an invite link/ }).fill(link);
  await friends(d.page).getByRole('button', { name: 'Accept invite' }).click();
  await expect(friends(d.page).getByRole('alert')).toHaveText('That invite has expired or was cancelled. Ask for a new link.');
});
