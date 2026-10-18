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
const crew = (page: Page) => page.getByRole('region', { name: 'Crew' });
const sheetOf = (page: Page, name: string) => page.getByRole('dialog', { name: `Messages with @${name}` });
const TOP = 47, BOTTOM = 34;
// A message near the 140 limit: it has to fit Crew's row and Today's one line without scrolling sideways.
const LONG = 'See you at 6? Bring chalk, deadlifts first and then heavy rows after if the rack by the window is free';

// Where the thread sheet sits, not where it is mid-slide (its 240ms rise; e2e/design.spec checks the motion itself).
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
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

test('a ping from a Crew row and a message from the friend view land in the other’s thread, with the dot and the Today line', async ({ browser }, info) => {
  const [a, b] = await Promise.all([person(browser), person(browser)]);
  await befriend(b, a, b.name);

  // A: B's Crew row has a message button; it opens the thread as a sheet from the bottom.
  const row = crew(a.page).getByTestId(`crew-${b.name}`);
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
  // A ping is its emoji alone, larger than a message's words; no label goes with it.
  await expect(sheet.getByRole('list', { name: 'Messages' }).locator('.bubble.mine .bubble-text')).toHaveText(['💪']);
  expect(await fontPx(sheet.locator('.bubble.ping .bubble-text'))).toBeGreaterThanOrEqual(28);
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
  await expect(sheet.getByRole('list', { name: 'Messages' }).locator('.bubble.mine .bubble-text')).toHaveText(['💪', LONG]);
  await a.page.screenshot({ path: `${SHOTS}/thread-sent.png` });
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  // Nothing from B yet: no dot on B's row.
  await expect(row.getByRole('button', { name: `Message @${b.name}`, exact: true })).toBeVisible();
  await expect(row.locator('.unread-dot')).toHaveCount(0);

  // B opens the app: Today has the newest in one line, and the Friends tab its dot.
  await b.page.reload();
  const news = b.page.getByRole('button', { name: new RegExp(`^@${a.name} See you at 6\\?`) });
  await expect(news).toBeVisible();
  await expect(news).toContainText('tap to reply');
  expect(await noSideScroll(b.page)).toBe(true);
  await expect(b.page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Friends', exact: true }).locator('.tab-dot')).toHaveCount(1);
  await b.page.screenshot({ path: `${SHOTS}/today-news.png` });
  await info.attach('today-news', { path: `${SHOTS}/today-news.png`, contentType: 'image/png' });
  // On Friends, A's row has the dot and says how many.
  await goto(b.page, 'Friends');
  const aRow = crew(b.page).getByTestId(`crew-${a.name}`);
  await expect(aRow.getByRole('button', { name: `Message @${a.name}, 2 unread` })).toBeVisible();
  await expect(aRow.locator('.unread-dot')).toHaveCount(1);
  await expect(aRow).toContainText('See you at 6?');
  expect(await noSideScroll(b.page)).toBe(true);
  // The row's line is cut with an ellipsis, inside the screen.
  const latest = (await aRow.locator('.msg-latest').boundingBox())!;
  expect(latest.x + latest.width).toBeLessThanOrEqual(375);
  await b.page.screenshot({ path: `${SHOTS}/crew-unread.png` });
  await info.attach('crew-unread', { path: `${SHOTS}/crew-unread.png`, contentType: 'image/png' });

  // Opening the thread reads them: both of A's, oldest first; the dots go.
  await aRow.getByRole('button', { name: `Message @${a.name}, 2 unread` }).click();
  const bSheet = sheetOf(b.page, a.name);
  await expect(bSheet.getByRole('list', { name: 'Messages' }).locator('.bubble.theirs .bubble-text')).toHaveText(['💪', LONG]);
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
  await expect(sheetOf(a.page, b.name).getByRole('list', { name: 'Messages' }).locator('.bubble .bubble-text')).toHaveText(['💪', LONG, '👏']);
});

test('mute is quiet and private; block stops the sender and lists them to unblock', async ({ browser }) => {
  const [a, b] = await Promise.all([person(browser), person(browser)]);
  await befriend(b, a, b.name);

  // B mutes A: the bell says so, and Friends marks A muted. A sees nothing different.
  await crew(b.page).getByTestId(`crew-${a.name}`).getByRole('button', { name: `Message @${a.name}` }).click();
  const bSheet = sheetOf(b.page, a.name);
  await bSheet.getByRole('button', { name: `Mute @${a.name}` }).click();
  await expect(bSheet.getByRole('button', { name: `Unmute @${a.name}` })).toHaveAttribute('aria-pressed', 'true');
  await expect(bSheet.getByRole('status')).toContainText('won’t ring your phone');
  await bSheet.getByRole('button', { name: 'Close' }).click();
  await expect(crew(b.page).getByTestId(`crew-${a.name}`).getByRole('img', { name: 'Muted' })).toBeVisible();
  // Still muted after a reload: it's on the account, not the phone.
  await b.page.reload();
  await goto(b.page, 'Friends');
  await crew(b.page).getByTestId(`crew-${a.name}`).getByRole('button', { name: `Message @${a.name}` }).click();
  await expect(bSheet.getByRole('button', { name: `Unmute @${a.name}` })).toBeVisible();

  // A's ping still arrives in the thread (mute only keeps the phone quiet).
  await goto(a.page, 'Friends');
  await crew(a.page).getByTestId(`crew-${b.name}`).getByRole('button', { name: `Message @${b.name}` }).click();
  const aSheet = sheetOf(a.page, b.name);
  await expect(aSheet.getByRole('button', { name: /^Mute|^Unmute/ })).toHaveAttribute('aria-pressed', 'false');
  await aSheet.getByRole('button', { name: 'Send 🔥 On fire' }).click();
  await expect(aSheet.getByRole('status')).toHaveText('Sent 🔥');
  await bSheet.getByRole('button', { name: 'Close' }).click();
  await b.page.reload();
  await goto(b.page, 'Friends');
  await expect(crew(b.page).getByTestId(`crew-${a.name}`).getByRole('button', { name: `Message @${a.name}, 1 unread` })).toBeVisible();

  // B blocks A, from the thread's More, asked twice.
  await crew(b.page).getByTestId(`crew-${a.name}`).getByRole('button', { name: `Message @${a.name}, 1 unread` }).click();
  await bSheet.getByRole('button', { name: 'More' }).click();
  await bSheet.getByRole('button', { name: 'Block' }).click();
  await bSheet.getByRole('button', { name: 'Tap again to block' }).click();
  await expect(bSheet.getByRole('status')).toContainText(`Blocked @${a.name}.`);
  await bSheet.getByRole('button', { name: 'Close' }).click();
  const blocked = friends(b.page).getByRole('region', { name: 'Blocked' });
  await expect(blocked).toContainText(`@${a.name}`);
  await expect(crew(b.page)).toContainText('No friends here yet');

  // A's open thread can't send now; the next time it opens, it says they're not friends.
  await expect(aSheet.getByRole('button', { name: 'Send 👀 Did you lift?' })).toBeEnabled();
  await aSheet.getByRole('button', { name: 'Send 👀 Did you lift?' }).click();
  await expect(aSheet.getByRole('alert')).toHaveText('Couldn’t send.');
  await aSheet.getByRole('button', { name: 'Close' }).click();
  await a.page.reload();
  await goto(a.page, 'Friends');
  await expect(crew(a.page).getByTestId(`crew-${b.name}`)).toHaveCount(0);
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

// ---- The sheet on a notched phone, with a thread long enough to reach its full height ----

const EMU = 'http://127.0.0.1:8080/v1/projects/demo-gym-tracker/databases/(default)/documents';
/** The signed-in account's uid, as this phone keeps it. */
const uidOf = (page: Page) => page.evaluate(async () => {
  const db: IDBDatabase = await new Promise((ok, no) => { const r = indexedDB.open('gym-tracker-shared'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const link: { uid: string } = await new Promise((ok, no) => { const r = db.transaction('kv').objectStore('kv').get('cloud'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  db.close();
  return link.uid;
});
/** `n` long messages from `from` in `to`'s inbox, written as an admin (the rules' 2 s gap would make this a minute). */
async function seedThread(page: Page, from: string, to: string, n: number) {
  for (let i = 0; i < n; i++) {
    const res = await page.request.post(`${EMU}/users/${to}/inbox`, {
      headers: { Authorization: 'Bearer owner' },
      data: { fields: { from: { stringValue: from }, kind: { stringValue: 'm' }, t: { stringValue: `${i + 1}. ${LONG}` }, at: { timestampValue: new Date(Date.now() - (n - i) * 60_000).toISOString() } } },
    });
    expect(res.ok()).toBe(true);
  }
}

test('a full thread sheet starts below the status bar, and stays on the visible screen when iOS leaves the viewport offset', async ({ browser }) => {
  const [a, b] = await Promise.all([person(browser), person(browser)]);
  await befriend(b, a, b.name);
  await seedThread(a.page, await uidOf(b.page), await uidOf(a.page), 10);
  await crew(a.page).getByTestId(`crew-${b.name}`).getByRole('button', { name: new RegExp(`^Message @${b.name}`) }).click();
  const sheet = sheetOf(a.page, b.name);
  await expect(sheet.getByRole('list', { name: 'Messages' }).locator('.bubble.theirs')).toHaveCount(10);
  const head = sheet.locator('.sheet-head');
  // Ten long messages fill it to its full height: its top is up by the status bar, where the bug was.
  expect((await sheet.boundingBox())!.y).toBeLessThan(TOP + 60);
  expect((await head.boundingBox())!.y).toBeGreaterThanOrEqual(TOP);
  await a.page.screenshot({ path: `${SHOTS}/thread-full.png` });
  // iOS 26 can leave the visual viewport 40px down the page after the keyboard closes (src/ui/viewportPin.ts sets
  // these): the header still clears the status bar on the screen you see, and the sheet's foot stays on it.
  await a.page.evaluate(() => { const s = document.documentElement.style; s.setProperty('--vv-top', '40px'); s.setProperty('--vv-bottom', '30px'); });
  await expect.poll(async () => (await head.boundingBox())!.y).toBeGreaterThanOrEqual(TOP + 40);
  const box = (await sheet.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(812 - 30 + 0.5);
});

test('the message box wraps a long message onto lines it grows to fit; Enter is a new line, Send sends; the count shows near the limit', async ({ browser }) => {
  const [a, b] = await Promise.all([person(browser), person(browser)]);
  await befriend(b, a, b.name);
  await crew(a.page).getByTestId(`crew-${b.name}`).getByRole('button', { name: `Message @${b.name}` }).click();
  const sheet = sheetOf(a.page, b.name);
  await expect(sheet.getByRole('button', { name: 'Send 💪 Strong' })).toBeEnabled(); // read: the box is live
  const field = sheet.getByRole('textbox', { name: `Message @${b.name}` });
  expect(await fontPx(field)).toBeGreaterThanOrEqual(16);
  const one = (await field.boundingBox())!.height;
  expect(one).toBeGreaterThanOrEqual(44);
  // Short: one line, and no count.
  await field.fill('On my way');
  await expect(sheet.getByText(/^\d+\/140$/)).toHaveCount(0);

  // 130 characters: all of it in view, none of it scrolled sideways or up out of sight, the box taller, the count shown.
  const text = `${LONG} and then curls, a few sets of dips, and a long walk home`.slice(0, 130);
  expect(text).toHaveLength(130);
  await field.fill(text);
  await expect(sheet.getByText('130/140', { exact: true })).toBeVisible();
  const m = await field.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight }));
  expect(m.sw, 'nothing scrolled sideways').toBeLessThanOrEqual(m.cw);
  expect(m.sh, 'nothing scrolled out of the top').toBeLessThanOrEqual(m.ch + 1);
  const grown = (await field.boundingBox())!;
  expect(grown.height).toBeGreaterThan(one + 20);
  expect(grown.x).toBeGreaterThanOrEqual(0);
  expect(grown.x + grown.width).toBeLessThanOrEqual(375);
  expect(grown.y + grown.height).toBeLessThanOrEqual(812 - BOTTOM);
  expect((await sheet.locator('.sheet-head').boundingBox())!.y).toBeGreaterThanOrEqual(TOP);
  expect(await noSideScroll(a.page)).toBe(true);
  await a.page.screenshot({ path: `${SHOTS}/thread-long-message.png` });

  // Enter starts a new line and sends nothing; Send sends both lines, and the bubble keeps the break. The box shrinks back.
  await field.fill('Line one');
  await field.press('Enter');
  await field.pressSequentially('line two');
  await expect(field).toHaveValue('Line one\nline two');
  await expect(sheet.locator('.bubble.mine')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(sheet.getByRole('status')).toHaveText('Sent');
  const bubble = sheet.locator('.bubble.mine .bubble-text');
  await expect(bubble).toHaveCount(1);
  expect(await bubble.innerText()).toBe('Line one\nline two');
  await expect(field).toHaveValue('');
  expect((await field.boundingBox())!.height).toBeLessThanOrEqual(one + 1);
});

// A thread read can come back at any moment (a push, the app coming back, the news after a send), and the friend cache
// re-renders the sheet at once. One that lands inside a keystroke's input event, after the field has changed and before
// React's own listener sees it, used to write the old, empty value over what was typed (the field was controlled).
test('a thread read coming back mid-keystroke keeps what was typed', async ({ browser }) => {
  const [a, b] = await Promise.all([person(browser), person(browser)]);
  await befriend(b, a, b.name);
  await crew(a.page).getByTestId(`crew-${b.name}`).getByRole('button', { name: `Message @${b.name}` }).click();
  const sheet = sheetOf(a.page, b.name);
  await expect(sheet.getByRole('list', { name: 'Messages' })).toContainText('Nothing yet');
  const field = sheet.getByRole('textbox', { name: `Message @${b.name}` });
  type Held = { held: (() => void)[] };
  // Firestore's replies are held; the app coming back reads the thread again (three queries).
  await a.page.evaluate(() => {
    const w = window as unknown as Held, json = Response.prototype.json;
    w.held = [];
    Response.prototype.json = function () { const p = json.call(this); return new Promise((res, rej) => { w.held.push(() => void p.then(res, rej)); }); };
    // Let go inside the field's next input event, before React's listener on the root; replies after that aren't held.
    addEventListener('input', () => { Response.prototype.json = json; for (const go of w.held.splice(0)) go(); }, { capture: true, once: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => a.page.evaluate(() => (window as unknown as Held).held.length)).toBeGreaterThanOrEqual(3);
  await a.page.waitForTimeout(300); // the replies' bodies are in, so letting go finishes the read within the event
  await field.fill('Bench at 6?');
  await expect(field).toHaveValue('Bench at 6?');
  await expect(sheet.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
});
