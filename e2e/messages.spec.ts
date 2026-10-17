import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { goto } from './nav';

// Pings and messages between two synthetic accounts on the local Auth and Firestore emulators, on the iPhone 13 mini's
// 375×812 with its notch and home-bar insets served into the CSS (headless browsers report 0).
const PASSWORD = 'synthetic-pass-1';
const SHOTS = 'screenshots/messages';
mkdirSync(SHOTS, { recursive: true });
const rand = () => Math.random().toString(36).slice(2, 10);
const friends = (page: Page) => page.getByRole('region', { name: 'Friends', exact: true });
const orbit = (page: Page) => page.getByRole('region', { name: 'Orbit' });
const sheetOf = (page: Page, name: string) => page.getByRole('dialog', { name: `Messages with @${name}` });
const TOP = 47, BOTTOM = 34;
// A message near the 140 limit: it has to fit Orbit's row, the friends list and Today's one line without scrolling sideways.
const LONG = 'See you at 6? Bring chalk, deadlifts first and then heavy rows after if the rack by the window is free';

test.use({ serviceWorkers: 'block' });
async function notched(page: Page) {
  const inset = (s: string) => s.replace(/env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,[^)]*)?\)/g, (_, side: string) => `${side === 'top' ? TOP : side === 'bottom' ? BOTTOM : 0}px`);
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (!req.url().startsWith('http://127.0.0.1')) return route.abort();
    if (!['document', 'stylesheet'].includes(req.resourceType())) return route.continue();
    const res = await route.fetch();
    return route.fulfill({ response: res, body: inset(await res.text()) });
  });
}

/** A phone with an account and a username, on Friends. */
async function person(browser: Browser) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
  const page = await ctx.newPage();
  await notched(page);
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

/** `from` asks, `to` accepts. */
async function befriend(from: { page: Page }, to: { page: Page; name: string }, fromName: string) {
  await friends(from.page).getByRole('textbox', { name: 'Their username' }).fill(to.name);
  await friends(from.page).getByRole('button', { name: 'Send request' }).click();
  await to.page.reload();
  await goto(to.page, 'Friends');
  await friends(to.page).getByRole('region', { name: 'Requests' }).getByRole('button', { name: 'Accept' }).click();
  await expect(friends(to.page).getByRole('status')).toHaveText(`You and @${fromName} are now friends.`);
  await from.page.reload();
  await goto(from.page, 'Friends');
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);
const fontPx = (l: ReturnType<Page['locator']>) => l.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

test('a ping from an Orbit row and a message from the friend view land in the other’s thread, with the dot and the Today line', async ({ browser }, info) => {
  const [a, b] = await Promise.all([person(browser), person(browser)]);
  await befriend(b, a, b.name);

  // A: B's Orbit row has a message button; it opens the thread as a sheet from the bottom.
  const row = orbit(a.page).getByTestId(`orbit-${b.name}`);
  await row.getByRole('button', { name: `Message @${b.name}` }).click();
  const sheet = sheetOf(a.page, b.name);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('list', { name: 'Messages' })).toContainText(`Nothing yet. Send @${b.name} a ping.`);
  // The six pings in one row, each a 44px target or more, all on the screen; nothing scrolls sideways.
  const presets = sheet.getByRole('group', { name: 'Quick pings' }).getByRole('button');
  await expect(presets).toHaveCount(6);
  for (const p of await presets.all()) {
    const box = (await p.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  }
  expect(await noSideScroll(a.page)).toBe(true);
  // The sheet sits above the home bar, and the field is 16px (iOS zooms a smaller one).
  const field = sheet.getByRole('textbox', { name: `Message @${b.name}` });
  expect(await fontPx(field)).toBeGreaterThanOrEqual(16);
  const sb = (await sheet.boundingBox())!;
  const fb = (await field.boundingBox())!;
  expect(fb.y + fb.height).toBeLessThanOrEqual(812 - BOTTOM);
  expect(sb.y).toBeGreaterThanOrEqual(TOP);
  await a.page.screenshot({ path: `${SHOTS}/thread-empty.png` });
  await info.attach('thread-empty', { path: `${SHOTS}/thread-empty.png`, contentType: 'image/png' });

  await sheet.getByRole('button', { name: 'Send 💪 Strong' }).click();
  await expect(sheet.getByRole('status')).toHaveText('Sent 💪');
  await expect(sheet.getByRole('list', { name: 'Messages' }).locator('.bubble.mine')).toHaveText([/💪 Strong/]);
  // 140 characters at most, counted as it's typed; an empty one can't be sent.
  await expect(sheet.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await field.fill('x'.repeat(150));
  await expect(field).toHaveValue('x'.repeat(140));
  await expect(sheet).toContainText('140/140');
  await field.fill(LONG);
  await expect(sheet.getByRole('button', { name: 'Send', exact: true })).toBeEnabled(); // the 2 s after a send are over
  await sheet.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(sheet.getByRole('status')).toHaveText('Sent');
  await expect(field).toHaveValue('');
  await expect(sheet.getByRole('list', { name: 'Messages' }).locator('.bubble.mine')).toHaveText([/💪 Strong/, /See you at 6\?/]);
  await a.page.screenshot({ path: `${SHOTS}/thread-sent.png` });
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  // Nothing from B yet: no dot on B's row.
  await expect(row.getByRole('button', { name: `Message @${b.name}`, exact: true })).toBeVisible();
  await expect(row.locator('.unread-dot')).toHaveCount(0);

  // B opens the app: Today has the newest in one line, and More its dot.
  await b.page.reload();
  const news = b.page.getByRole('button', { name: new RegExp(`^@${a.name} See you at 6\\?`) });
  await expect(news).toBeVisible();
  await expect(news).toContainText('tap to reply');
  expect(await noSideScroll(b.page)).toBe(true);
  await expect(b.page.getByRole('navigation', { name: 'Sections' }).locator('.tab-dot')).toHaveCount(1);
  await b.page.screenshot({ path: `${SHOTS}/today-news.png` });
  await info.attach('today-news', { path: `${SHOTS}/today-news.png`, contentType: 'image/png' });
  // On Friends, A's row has the dot and says how many.
  await goto(b.page, 'Friends');
  const aRow = orbit(b.page).getByTestId(`orbit-${a.name}`);
  await expect(aRow.getByRole('button', { name: `Message @${a.name}, 2 unread` })).toBeVisible();
  await expect(aRow.locator('.unread-dot')).toHaveCount(1);
  await expect(aRow).toContainText('See you at 6?');
  expect(await noSideScroll(b.page)).toBe(true);
  // The row's line is cut with an ellipsis, inside the screen.
  const latest = (await aRow.locator('.msg-latest').boundingBox())!;
  expect(latest.x + latest.width).toBeLessThanOrEqual(375);
  await b.page.screenshot({ path: `${SHOTS}/orbit-unread.png` });
  await info.attach('orbit-unread', { path: `${SHOTS}/orbit-unread.png`, contentType: 'image/png' });

  // Opening the thread reads them: both of A's, oldest first; the dots go.
  await aRow.getByRole('button', { name: `Message @${a.name}, 2 unread` }).click();
  const bSheet = sheetOf(b.page, a.name);
  await expect(bSheet.getByRole('list', { name: 'Messages' }).locator('.bubble.theirs')).toHaveText([/💪 Strong/, /See you at 6\?/]);
  await bSheet.getByRole('button', { name: 'Close' }).click();
  await expect(aRow.getByRole('button', { name: `Message @${a.name}`, exact: true })).toBeVisible();
  await expect(aRow.locator('.unread-dot')).toHaveCount(0);
  await expect(b.page.getByRole('navigation', { name: 'Sections' }).locator('.tab-dot')).toHaveCount(0);
  await goto(b.page, 'Today');
  await expect(b.page.locator('.today-news')).toHaveCount(0);

  // B looks at A's log, and answers from its bar.
  await goto(b.page, 'Friends');
  await aRow.getByRole('button', { name: `@${a.name}`, exact: true }).click();
  const bar = b.page.getByRole('region', { name: 'Viewing a friend' });
  await expect(bar).toContainText(`Viewing @${a.name}`);
  expect(await noSideScroll(b.page)).toBe(true);
  await bar.getByRole('button', { name: `Message @${a.name}` }).click();
  await bSheet.getByRole('button', { name: 'Send 👏 Nice work' }).click();
  await expect(bSheet.getByRole('status')).toHaveText('Sent 👏');
  await bSheet.getByRole('button', { name: 'Close' }).click();

  // A: B's 👏 on Today, and a tap there opens B's thread.
  await a.page.reload();
  await a.page.getByRole('button', { name: new RegExp(`^@${b.name} 👏`) }).click();
  await expect(sheetOf(a.page, b.name).getByRole('list', { name: 'Messages' }).locator('.bubble')).toHaveText([/💪 Strong/, /See you at 6\?/, /👏 Nice work/]);
});

test('mute is quiet and private; block stops the sender and lists them to unblock', async ({ browser }) => {
  const [a, b] = await Promise.all([person(browser), person(browser)]);
  await befriend(b, a, b.name);

  // B mutes A: the bell says so, and Friends marks A muted. A sees nothing different.
  await orbit(b.page).getByTestId(`orbit-${a.name}`).getByRole('button', { name: `Message @${a.name}` }).click();
  const bSheet = sheetOf(b.page, a.name);
  await bSheet.getByRole('button', { name: `Mute @${a.name}` }).click();
  await expect(bSheet.getByRole('button', { name: `Unmute @${a.name}` })).toHaveAttribute('aria-pressed', 'true');
  await expect(bSheet.getByRole('status')).toContainText('won’t ring your phone');
  await bSheet.getByRole('button', { name: 'Close' }).click();
  await expect(friends(b.page).getByRole('region', { name: 'Your friends' })).toContainText(`@${a.name} 🔕`);
  // Still muted after a reload: it's on the account, not the phone.
  await b.page.reload();
  await goto(b.page, 'Friends');
  await friends(b.page).getByRole('region', { name: 'Your friends' }).getByRole('button', { name: `Message @${a.name}` }).click();
  await expect(bSheet.getByRole('button', { name: `Unmute @${a.name}` })).toBeVisible();

  // A's ping still arrives in the thread (mute only keeps the phone quiet).
  await goto(a.page, 'Friends');
  await orbit(a.page).getByTestId(`orbit-${b.name}`).getByRole('button', { name: `Message @${b.name}` }).click();
  const aSheet = sheetOf(a.page, b.name);
  await expect(aSheet.getByRole('button', { name: /^Mute|^Unmute/ })).toHaveAttribute('aria-pressed', 'false');
  await aSheet.getByRole('button', { name: 'Send 🔥 On fire' }).click();
  await expect(aSheet.getByRole('status')).toHaveText('Sent 🔥');
  await bSheet.getByRole('button', { name: 'Close' }).click();
  await b.page.reload();
  await goto(b.page, 'Friends');
  await expect(orbit(b.page).getByTestId(`orbit-${a.name}`).getByRole('button', { name: `Message @${a.name}, 1 unread` })).toBeVisible();

  // B blocks A, from the thread's More, asked twice.
  await orbit(b.page).getByTestId(`orbit-${a.name}`).getByRole('button', { name: `Message @${a.name}, 1 unread` }).click();
  await bSheet.getByRole('button', { name: 'More' }).click();
  await bSheet.getByRole('button', { name: 'Block' }).click();
  await bSheet.getByRole('button', { name: 'Tap again to block' }).click();
  await expect(bSheet.getByRole('status')).toContainText(`Blocked @${a.name}.`);
  await bSheet.getByRole('button', { name: 'Close' }).click();
  const blocked = friends(b.page).getByRole('region', { name: 'Blocked' });
  await expect(blocked).toContainText(`@${a.name}`);
  await expect(friends(b.page).getByRole('region', { name: 'Your friends' })).toContainText('None yet');

  // A's open thread can't send now; the next time it opens, it says they're not friends.
  await expect(aSheet.getByRole('button', { name: 'Send 👀 Did you lift?' })).toBeEnabled();
  await aSheet.getByRole('button', { name: 'Send 👀 Did you lift?' }).click();
  await expect(aSheet.getByRole('alert')).toHaveText('Couldn’t send.');
  await aSheet.getByRole('button', { name: 'Close' }).click();
  await a.page.reload();
  await goto(a.page, 'Friends');
  await expect(orbit(a.page).getByTestId(`orbit-${b.name}`)).toHaveCount(0);
  // Nor can A ask again while blocked.
  await friends(a.page).getByRole('textbox', { name: 'Their username' }).fill(b.name);
  await friends(a.page).getByRole('button', { name: 'Send request' }).click();
  await expect(friends(a.page).getByRole('alert')).toBeVisible();

  // Unblock: gone from the list; A can ask again.
  await blocked.getByRole('button', { name: 'Unblock' }).click();
  await expect(friends(b.page).getByRole('status')).toHaveText(`Unblocked @${a.name}.`);
  await expect(friends(b.page).getByRole('region', { name: 'Blocked' })).toHaveCount(0);
  await friends(a.page).getByRole('button', { name: 'Send request' }).click();
  await expect(friends(a.page).getByRole('status')).toContainText(b.name);
});
