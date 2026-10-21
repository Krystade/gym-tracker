import { expect, test, type Page } from '@playwright/test';
import { addFriend, goto } from './nav';
import { fetches, recordRenders, rendersAbove, watchRenders } from './renders';

// Fields keep what's typed when something read in the background lands inside the keystroke. A friend-cache read (or any
// state change) that comes back between the field changing and React's own listener seeing it re-rendered the field; a
// controlled field was written back to the old value and React then saw no change, so the keystroke was gone.
// e2e/messages.spec has the thread's message box; these are the set form and Friends.
test.use({ serviceWorkers: 'block' });
const PASSWORD = 'synthetic-pass-1';
const rand = () => Math.random().toString(36).slice(2, 10);
const friends = (page: Page) => page.getByRole('region', { name: 'Friends', exact: true });

/** Signed in to a new account, with a username. */
async function signedIn(page: Page) {
  const name = `u${rand()}`;
  await page.goto('/');
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
  return name;
}

type Held = { held: (() => void)[] };
/**
 * Firestore's replies are held, and a push comes in (as the service worker would tell an open app): it reads the lists and the
 * news again. They're let go inside the next input event, before React's listener on the root, so the reads finish there.
 */
async function readsLandInNextKeystroke(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as Held, json = Response.prototype.json;
    w.held = [];
    Response.prototype.json = function () { const p = json.call(this); return new Promise((res, rej) => { w.held.push(() => void p.then(res, rej)); }); };
    addEventListener('input', () => { Response.prototype.json = json; for (const go of w.held.splice(0)) go(); }, { capture: true, once: true });
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'push', kind: 'request', route: 'friends' } }));
  });
  // The lists are six reads and the news more; all of them are out and their bodies in.
  await expect.poll(() => page.evaluate(() => (window as unknown as Held).held.length)).toBeGreaterThanOrEqual(6);
  await page.waitForTimeout(300);
}

async function openBench(page: Page) {
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: /^Bench Press( · logged)?$/ }).click();
  const weight = page.getByRole('textbox', { name: 'Weight' });
  await expect(weight).toBeVisible();
  return weight;
}

test('a friends read coming back mid-keystroke keeps the weight typed', async ({ page }) => {
  await signedIn(page);
  const weight = await openBench(page);
  await readsLandInNextKeystroke(page);
  await weight.fill('185');
  await expect(weight).toHaveValue('185');
  // And the form has it: a set logs at 185.
  await page.getByRole('textbox', { name: 'Reps' }).fill('5');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Bench Press' })).toContainText('185');
});

test('a friends read coming back mid-keystroke keeps the username typed in Add a friend', async ({ page }) => {
  await signedIn(page);
  const field = (await addFriend(page)).getByRole('textbox', { name: 'Their username' });
  await expect(field).toBeVisible();
  await readsLandInNextKeystroke(page);
  await field.fill('somebody');
  await expect(field).toHaveValue('somebody');
  await expect((await addFriend(page)).getByRole('button', { name: 'Send request' })).toBeEnabled();
});

// What's read and synced in the background renders only what shows it. The app's top subscribed to all of friends' cache and
// kept the sync's status and the news counter, so each of them took every screen through a render. (A minute going by
// renders only what shows the time, e2e/quiet; the clock stands still here all the same.)
test('reads, a push and a sync in the background don’t render the set form', async ({ page }) => {
  await page.clock.setFixedTime(new Date());
  await watchRenders(page);
  await signedIn(page);
  const weight = await openBench(page);
  // The instrument sees a render: a keystroke renders the form.
  await recordRenders(page);
  await weight.fill('1');
  expect(await rendersAbove(weight)).toBeGreaterThan(0);
  await weight.fill('');

  const before = (await fetches(page)).done;
  await recordRenders(page);
  // A push (lists and news read again), and the app coming back (a sync); then a minute goes by.
  await page.evaluate(() => {
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'push', kind: 'request', route: 'friends' } }));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  // Both done: requests went out and none has been out for a second.
  let quiet = 0;
  await expect.poll(async () => {
    const f = await fetches(page);
    quiet = f.out === 0 && f.done - before >= 8 ? quiet + 1 : 0;
    return quiet;
  }, { intervals: [250] }).toBeGreaterThanOrEqual(4);
  expect(await rendersAbove(weight)).toBe(0);
});
