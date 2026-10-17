import { expect, test, type Browser, type Page } from '@playwright/test';
import { goto } from './nav';

// Friends against the local Auth and Firestore emulators. Synthetic users only.
// Today at 18:00: the emulator checks invite expiry against the real clock, so a fixed date goes stale within a week.
const T = new Date(new Date().setHours(18, 0, 0, 0));
const PASSWORD = 'synthetic-pass-1';
const rand = () => Math.random().toString(36).slice(2, 10);
const friends = (page: Page) => page.getByRole('region', { name: 'Friends', exact: true });
const note = (page: Page) => friends(page).getByRole('status');

async function person(browser: Browser, opts: { bench?: boolean; gym?: string } = {}) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
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
  if (opts.gym) {
    await page.getByRole('button', { name: 'Program', exact: true }).click();
    await page.getByRole('button', { name: 'Set up your gym' }).click();
    await page.getByLabel('Gym name').fill(opts.gym);
    await page.getByRole('checkbox', { name: 'barbell', exact: true }).check();
    await page.getByRole('checkbox', { name: 'dumbbells', exact: true }).check();
    await page.getByRole('button', { name: '‹ Back' }).click();
    await page.getByRole('button', { name: '‹ Back' }).click();
  }
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

test('a request, accepted, lets each see the other’s log read-only; removing ends it for both', async ({ browser }) => {
  // Two phones set up side by side: each is a sign-up and a username against the emulators.
  const [a, b] = await Promise.all([person(browser, { bench: true }), person(browser)]);

  await friends(b.page).getByRole('textbox', { name: 'Their username' }).fill(`@${a.name.toUpperCase()}`);
  await friends(b.page).getByRole('button', { name: 'Send request' }).click();
  await expect(note(b.page)).toHaveText(`Request sent to @${a.name}.`);
  await friends(b.page).getByRole('textbox', { name: 'Their username' }).fill('nobody_here_123');
  await friends(b.page).getByRole('button', { name: 'Send request' }).click();
  await expect(friends(b.page).getByRole('alert')).toHaveText('No one goes by “nobody_here_123”. Check the spelling.');

  // The request shows as a dot on More, the tab Friends lives under, and as a count on its Friends row.
  await a.page.reload();
  await expect(a.page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'More', exact: true }).locator('.tab-dot')).toBeVisible();
  await goto(a.page, 'More');
  await expect(a.page.getByRole('list', { name: 'More screens' }).getByRole('button', { name: /^Friends/ })).toContainText('1 request');
  await goto(a.page, 'Friends');
  const req = friends(a.page).getByRole('region', { name: 'Requests' });
  await expect(req).toContainText(`@${b.name} wants to be friends`);
  await req.getByRole('button', { name: 'Accept' }).click();
  await expect(note(a.page)).toHaveText(`You and @${b.name} are now friends.`);
  await expect(friends(a.page).getByRole('region', { name: 'Your friends' }).getByRole('button', { name: `@${b.name}`, exact: true })).toBeVisible();

  // b looks at a's log: the same screens, nothing to edit.
  await goto(b.page, 'Today');
  await goto(b.page, 'Friends');
  await friends(b.page).getByRole('button', { name: `@${a.name}`, exact: true }).click();
  await expect(b.page.getByRole('region', { name: 'Viewing a friend' })).toContainText(`Viewing @${a.name}`);
  await expect(b.page.getByRole('heading', { name: 'Stats', level: 1 })).toBeVisible();
  await expect(b.page.getByRole('combobox', { name: 'Chest' })).toBeDisabled();
  await expect(b.page.getByRole('navigation', { name: 'Sections' }).getByRole('button')).toHaveText(['History', 'Lifts', 'Stats']);
  await goto(b.page, 'History');
  await expect(b.page.getByRole('button', { name: /Bench Press/ })).toContainText('135 × 8');
  await expect(b.page.getByRole('button', { name: 'Add to this day' })).toHaveCount(0);
  await goto(b.page, 'Lifts');
  await b.page.getByRole('button', { name: /Bench Press/ }).click();
  await expect(b.page.getByRole('heading', { name: 'Bench Press', level: 1 })).toBeVisible();
  await expect(b.page.getByRole('button', { name: 'Save settings' })).toHaveCount(0);
  await expect(b.page.getByRole('button', { name: 'Rename' })).toHaveCount(0);
  await b.page.getByRole('button', { name: 'Back to you' }).click();
  await expect(b.page.getByRole('heading', { name: 'Friends', level: 1 })).toBeVisible();
  await goto(b.page, 'Today');
  await expect(b.page.getByRole('list', { name: 'Sets for Bench Press' })).toHaveCount(0); // b's own Today, still empty

  await goto(a.page, 'Today');
  await goto(a.page, 'Friends');
  // Remove is in the friend's thread, under More, and asks twice.
  await friends(a.page).getByRole('region', { name: 'Your friends' }).getByRole('button', { name: `Message @${b.name}` }).click();
  const sheet = a.page.getByRole('dialog', { name: `Messages with @${b.name}` });
  await sheet.getByRole('button', { name: 'More' }).click();
  await sheet.getByRole('button', { name: 'Remove' }).click();
  await sheet.getByRole('button', { name: 'Tap again to remove' }).click();
  await expect(sheet.getByRole('status')).toHaveText(`Removed @${b.name}. Neither of you can see the other’s log now.`);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(friends(a.page).getByRole('region', { name: 'Your friends' })).toContainText('None yet');
  await goto(b.page, 'Friends');
  await expect(friends(b.page).getByRole('region', { name: 'Your friends' })).toContainText('None yet');
});

test('an invite link asks before it befriends, says what each side sees, and works once', async ({ browser }) => {
  // All three phones set up at once; none of them depends on another until the link is opened.
  const [a, c, d] = await Promise.all([person(browser, { bench: true }), person(browser), person(browser)]);
  await friends(a.page).getByRole('button', { name: 'Make an invite link' }).click();
  const link = await friends(a.page).getByRole('textbox', { name: 'Your invite link' }).inputValue();
  expect(link).toMatch(/#invite=\w+\.[a-f0-9]{32}$/);
  await expect(friends(a.page)).toContainText('Works once, for 7 days.');
  await friends(a.page).getByRole('textbox', { name: /Got an invite link/ }).fill(link);
  await friends(a.page).getByRole('button', { name: 'Open invite' }).click();
  await expect(friends(a.page).getByRole('alert')).toHaveText('That’s your own invite link. Send it to a friend.');

  // Opening the link only asks; Not now leaves both lists as they were.
  await c.page.goto(link);
  await expect(c.page.getByRole('heading', { name: 'Friends', level: 1 })).toBeVisible();
  const offer = friends(c.page).getByRole('region', { name: 'Invite' });
  await expect(offer).toContainText(`@${a.name} invited you`);
  expect(c.page.url()).not.toContain('invite=');
  await expect(offer).toContainText('you each see the other’s log');
  await offer.getByRole('button', { name: 'Not now' }).click();
  await expect(offer).toHaveCount(0);
  await c.page.waitForTimeout(500);
  await expect(friends(c.page).getByRole('region', { name: 'Your friends' })).toContainText('None yet');

  await c.page.goto(link);
  await friends(c.page).getByRole('region', { name: 'Invite' }).getByRole('button', { name: 'Accept' }).click();
  await expect(note(c.page)).toHaveText(`You and @${a.name} are now friends.`);
  await friends(c.page).getByRole('button', { name: `@${a.name}`, exact: true }).click();
  await goto(c.page, 'History');
  await expect(c.page.getByRole('button', { name: /Bench Press/ })).toContainText('135 × 8');

  // Used once: the next person holding the same link is turned away before anything is asked.
  await d.page.goto(link);
  await expect(friends(d.page).getByRole('alert')).toHaveText('That invite has expired, was cancelled or was already used. Ask for a new link.');
  await expect(friends(d.page).getByRole('region', { name: 'Invite' })).toHaveCount(0);

  // Cancelled, a fresh link stops working too.
  await a.page.reload();
  await goto(a.page, 'Friends');
  await friends(a.page).getByRole('button', { name: 'Make an invite link' }).click();
  const second = await friends(a.page).getByRole('textbox', { name: 'Your invite link' }).inputValue();
  await friends(a.page).getByRole('button', { name: 'Cancel link' }).click();
  await expect(note(a.page)).toHaveText('Invite link cancelled.');
  await friends(d.page).getByRole('textbox', { name: /Got an invite link/ }).fill(second);
  await friends(d.page).getByRole('button', { name: 'Open invite' }).click();
  await expect(friends(d.page).getByRole('alert')).toHaveText('That invite has expired, was cancelled or was already used. Ask for a new link.');
});

async function befriend(a: { page: Page }, b: { page: Page; name: string }) {
  await friends(a.page).getByRole('button', { name: 'Make an invite link' }).click();
  const link = await friends(a.page).getByRole('textbox', { name: 'Your invite link' }).inputValue();
  await b.page.goto(link);
  await friends(b.page).getByRole('region', { name: 'Invite' }).getByRole('button', { name: 'Accept' }).click();
  await expect(note(b.page)).toHaveText(/are now friends/);
}
const openGyms = (page: Page) => goto(page, 'Gym');

test('a friend’s gym can be added to yours from their Stats', async ({ browser }) => {
  const a = await person(browser, { gym: 'Garage' });
  const b = await person(browser);
  await befriend(a, b);
  await friends(b.page).getByRole('button', { name: `@${a.name}`, exact: true }).click();
  const theirs = b.page.getByRole('region', { name: 'Their gyms' });
  await expect(theirs).toContainText('Garage · 2 pieces of gear');
  await theirs.getByRole('button', { name: 'Add to my gyms' }).click();
  await expect(theirs.getByRole('status')).toHaveText('Added Garage to your gyms.');
  await b.page.getByRole('button', { name: 'Back to you' }).click();
  await goto(b.page, 'Today');
  await openGyms(b.page);
  await expect(b.page.getByLabel('Gym name')).toHaveValue('Garage');
  await expect(b.page.getByRole('checkbox', { name: 'dumbbells', exact: true })).toBeChecked();
  await expect(b.page.getByRole('checkbox', { name: 'leg press', exact: true })).not.toBeChecked();
});

test('a gym sent to a friend waits under Friends until they add it', async ({ browser }) => {
  const a = await person(browser, { gym: 'Garage' });
  const b = await person(browser);
  await befriend(a, b);
  await goto(a.page, 'Today');
  await openGyms(a.page);
  const share = a.page.getByRole('region', { name: 'Share this gym' });
  await share.getByRole('button', { name: 'Send to a friend' }).click();
  await share.getByRole('list', { name: 'Send to' }).getByRole('button', { name: 'Send' }).click();
  await expect(share.getByRole('status')).toHaveText(`Sent Garage to ${b.name}.`);

  await goto(b.page, 'Today');
  await goto(b.page, 'Friends');
  const inbox = friends(b.page).getByRole('region', { name: 'Gyms sent to you' });
  await expect(inbox).toContainText(`@${a.name} sent you a gym: Garage`);
  await inbox.getByRole('button', { name: 'Add' }).click();
  await expect(note(b.page)).toHaveText('Added Garage to your gyms.');
  await expect(inbox).toHaveCount(0);
  await goto(b.page, 'Today');
  await openGyms(b.page);
  await expect(b.page.getByLabel('Gym name')).toHaveValue('Garage');
  await expect(b.page.getByRole('checkbox', { name: 'barbell', exact: true })).toBeChecked();
});
