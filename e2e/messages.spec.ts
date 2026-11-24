import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { addFriend, goto } from './nav';
import { drag, mid } from './finger';
import { DOCS } from './emu';
import { tapAndSync } from './synced';

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
    // A blob: URL is the page's own image (a pasted sticker being read), never the network.
    if (!req.url().startsWith('http://127.0.0.1') && !req.url().startsWith('blob:')) return route.abort();
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
  await tapAndSync(page, account, account.getByRole('button', { name: 'Create account' }));
  await goto(page, 'Friends');
  await friends(page).getByRole('textbox', { name: 'Username' }).fill(name);
  await friends(page).getByRole('button', { name: 'Save username' }).click();
  await expect(friends(page)).toContainText(`You’re @${name}`);
  return { page, name };
}

/** `from` asks, `to` accepts. */
async function befriend(from: { page: Page }, to: { page: Page; name: string }, fromName: string) {
  const add = await addFriend(from.page);
  await add.getByRole('textbox', { name: 'Their username' }).fill(to.name);
  await add.getByRole('button', { name: 'Send request' }).click();
  await expect(add.getByRole('status')).toHaveText(`Request sent to @${to.name}.`);
  await to.page.reload();
  await goto(to.page, 'Friends');
  await friends(to.page).getByRole('region', { name: 'Requests' }).getByRole('button', { name: 'Accept' }).click();
  await expect(friends(to.page).getByRole('status')).toHaveText(`You and @${fromName} are now friends.`);
  await from.page.reload();
  await goto(from.page, 'Friends');
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);
const fontPx = (l: ReturnType<Page['locator']>) => l.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
/** What the message box holds, as its lines show (it's a contenteditable: ui/MessageBox). */
const boxValue = (l: ReturnType<Page['locator']>) => l.evaluate((el) => (el as HTMLElement).innerText);

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
  await expect.poll(() => boxValue(field)).toBe('x'.repeat(140));
  await expect(sheet).toContainText('140/140');
  await field.fill(LONG);
  await expect(sheet.getByRole('button', { name: 'Send', exact: true })).toBeEnabled(); // no wait after a send
  await sheet.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(sheet.getByRole('status')).toHaveText('Sent');
  await expect.poll(() => boxValue(field)).toBe('');
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

  // B opens A's page, and answers from its Chat.
  await goto(b.page, 'Friends');
  await aRow.getByRole('button', { name: `@${a.name}`, exact: true }).click();
  const bar = b.page.getByRole('region', { name: `@${a.name}`, exact: true });
  await expect(bar.getByRole('heading', { name: `@${a.name}`, level: 1 })).toBeVisible();
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
  const add = await addFriend(a.page);
  await add.getByRole('textbox', { name: 'Their username' }).fill(b.name);
  await add.getByRole('button', { name: 'Send request' }).click();
  await expect(add.getByRole('alert')).toBeVisible();

  // Unblock: gone from the list; A can ask again.
  await blocked.getByRole('button', { name: 'Unblock' }).click();
  await expect(friends(b.page).getByRole('status')).toHaveText(`Unblocked @${a.name}.`);
  await expect(friends(b.page).getByRole('region', { name: 'Blocked' })).toHaveCount(0);
  await add.getByRole('button', { name: 'Send request' }).click();
  await expect(add.getByRole('status')).toContainText(b.name);
});

// ---- The sheet on a notched phone, with a thread long enough to reach its full height ----

const EMU = DOCS;
/** The signed-in account's uid, as this phone keeps it. */
const uidOf = (page: Page) => page.evaluate(async () => {
  const db: IDBDatabase = await new Promise((ok, no) => { const r = indexedDB.open('gym-tracker-shared'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const link: { uid: string } = await new Promise((ok, no) => { const r = db.transaction('kv').objectStore('kv').get('cloud'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  db.close();
  return link.uid;
});
/** `n` long messages from `from` in `to`'s inbox, written as an admin (quicker than through the app, one by one). */
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
  await expect.poll(() => boxValue(field)).toBe('Line one\nline two');
  await expect(sheet.locator('.bubble.mine')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(sheet.getByRole('status')).toHaveText('Sent');
  const bubble = sheet.locator('.bubble.mine .bubble-text');
  await expect(bubble).toHaveCount(1);
  expect(await bubble.innerText()).toBe('Line one\nline two');
  await expect.poll(() => boxValue(field)).toBe('');
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
  await expect.poll(() => boxValue(field)).toBe('Bench at 6?');
  await expect(sheet.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
});

// ---- Touch (owner's 13 mini, 2026-11-12): a ping tapped over and over, the page behind, a swipe down ----

test('a ping tapped again and again sends every tap, one message each', async ({ browser }) => {
  const [a, b] = await Promise.all([person(browser), person(browser)]);
  await befriend(b, a, b.name);
  await crew(a.page).getByTestId(`crew-${b.name}`).getByRole('button', { name: `Message @${b.name}` }).click();
  const sheet = sheetOf(a.page, b.name);
  const eyes = sheet.getByRole('button', { name: 'Send 👀 Did you lift?' });
  await expect(eyes).toBeEnabled();
  // Real taps where the button is, one straight after another as a thumb makes them: nothing waits for it to be ready again.
  const at = await mid(eyes);
  const N = 8, t0 = Date.now();
  for (let i = 0; i < N; i++) await a.page.touchscreen.tap(at.x, at.y);
  expect(Date.now() - t0, 'the taps were quick').toBeLessThan(2000);
  await expect(sheet.locator('.bubble.mine .bubble-text')).toHaveText(Array<string>(N).fill('👀'), { timeout: 30_000 });
  await expect(sheet.getByRole('status')).toHaveText(`Sent 👀 ×${N}`);
  // And B has every one.
  await crew(b.page).getByTestId(`crew-${a.name}`).getByRole('button', { name: new RegExp(`^Message @${a.name}`) }).click();
  await expect(sheetOf(b.page, a.name).locator('.bubble.theirs .bubble-text')).toHaveText(Array<string>(N).fill('👀'));
});

test('an open thread holds the page behind it still, and a swipe down closes it (from its head, or its list at the top)', async ({ browser }) => {
  const [a, b] = await Promise.all([person(browser), person(browser)]);
  await befriend(b, a, b.name);
  await seedThread(a.page, await uidOf(b.page), await uidOf(a.page), 10);
  // A page long enough to scroll, scrolled part way down.
  await a.page.evaluate(() => { document.body.style.paddingBottom = '1600px'; });
  const open = crew(a.page).getByTestId(`crew-${b.name}`).getByRole('button', { name: new RegExp(`^Message @${b.name}`) });
  await open.evaluate((el) => { el.scrollIntoView({ block: 'center' }); window.scrollBy(0, 200); });
  await open.click();
  const sheet = sheetOf(a.page, b.name);
  const list = sheet.getByRole('list', { name: 'Messages' });
  await expect(list.locator('.bubble.theirs')).toHaveCount(10);
  const y0 = await a.page.evaluate(() => scrollY);
  expect(y0).toBeGreaterThan(100);
  await a.page.screenshot({ path: `${SHOTS}/thread-touch.png` });

  // The root can't scroll, and a drag nothing in the sheet can scroll is refused (iOS would have scrolled the page with it):
  // on the head, on the pings, on the dim above it.
  expect(await a.page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe('hidden');
  const head = sheet.locator('.sheet-head');
  const h = await mid(head);
  expect(await drag(head, { x: 60, y: h.y }, 0, -120)).toEqual(Array(6).fill(true));
  const pings = sheet.getByRole('group', { name: 'Quick pings' });
  expect(await drag(pings, await mid(pings), 0, -120)).toEqual(Array(6).fill(true));
  expect(await drag(a.page.locator('.sheet-backdrop'), { x: 180, y: 10 }, 0, 200)).toEqual(Array(6).fill(true));
  // The list scrolled to its newest: a drag down it scrolls it back up (not refused), and the sheet stays.
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await drag(list, await mid(list), 0, 160)).toEqual(Array(6).fill(false));
  await expect(sheet).toBeVisible();
  // At its top, a drag down the list is the sheet's: it closes.
  await list.evaluate((el) => { el.scrollTop = 0; });
  expect(await drag(list, await mid(list), 0, 160)).toEqual(Array(6).fill(true));
  await expect(sheet).toHaveCount(0);
  expect(await a.page.evaluate(() => scrollY), 'the page is where it was').toBe(y0);
  expect(await a.page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).not.toBe('hidden');

  // Again from the head: a short drag springs back, a long one closes.
  await open.click();
  await expect(list.locator('.bubble.theirs')).toHaveCount(10);
  await drag(head, { x: 60, y: h.y }, 0, 20, 4);
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveAttribute('data-drag', /./);
  await drag(head, { x: 60, y: h.y }, 4, 140);
  await expect(sheet).toHaveCount(0);
  expect(await a.page.evaluate(() => scrollY)).toBe(y0);
});

test('a sticker pasted into the box is trimmed, shrunk under the cap and sent; it shows big and unbubbled, and the recent row resends it at every tap', async ({ browser }, info) => {
  const [a, b] = await Promise.all([person(browser), person(browser)]);
  await befriend(b, a, b.name);
  await crew(a.page).getByTestId(`crew-${b.name}`).getByRole('button', { name: `Message @${b.name}` }).click();
  const sheet = sheetOf(a.page, b.name);
  const field = sheet.getByRole('textbox', { name: `Message @${b.name}` });
  await expect(sheet.getByRole('button', { name: 'Send 💪 Strong' })).toBeEnabled();
  // As iOS pastes a sticker: a transparent PNG in the clipboard. 900×600 with a 300px disc in it, and nothing but clear round it.
  await field.evaluate(async (el) => {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 600;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(420, 280, 20, 450, 300, 150);
    grad.addColorStop(0, '#ffd23f'); grad.addColorStop(1, '#ee4266');
    g.fillStyle = grad; g.beginPath(); g.arc(450, 300, 150, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1b1b1b'; g.font = 'bold 90px sans-serif'; g.textAlign = 'center'; g.fillText('PR', 450, 330);
    const blob = await new Promise<Blob>((ok) => c.toBlob((x) => ok(x!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'sticker.png', { type: 'image/png' }));
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: dt });
    el.dispatchEvent(ev);
  });
  // It waits in the box for Send.
  await expect(sheet.getByRole('img', { name: 'Sticker to send' })).toBeVisible();
  await expect.poll(() => boxValue(field)).toBe('');
  await a.page.screenshot({ path: `${SHOTS}/sticker-waiting.png` });
  await sheet.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(sheet.getByRole('status')).toHaveText('Sent sticker');
  await expect(sheet.getByRole('img', { name: 'Sticker to send' })).toHaveCount(0);
  const sent = sheet.locator('.bubble.mine.sticker img');
  await expect(sent).toHaveCount(1);
  // What went: WebP or PNG, under 60 KB of image, trimmed to the disc (300px, so 256 on its long side), clear at its corners.
  const got = await sent.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const b64 = img.src.slice(img.src.indexOf(',') + 1);
    return { head: img.src.slice(0, img.src.indexOf(',') + 1), len: img.src.length, bytes: b64.length * 0.75, w: img.naturalWidth, h: img.naturalHeight,
      corner: g.getImageData(1, 1, 1, 1).data[3], middle: g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] };
  });
  expect(got.head).toMatch(/^data:image\/(webp|png);base64,$/);
  expect(got.bytes).toBeLessThanOrEqual(60_000);
  expect(got.len).toBeLessThanOrEqual(120_023);
  expect(Math.max(got.w, got.h)).toBe(256);
  expect(Math.abs(got.w - got.h)).toBeLessThanOrEqual(2); // the clear border went: a disc's box is square
  expect(got.corner).toBe(0);
  expect(got.middle).toBe(255);
  // Shown at 120px, on nothing: no bubble fill behind it.
  const box = (await sent.boundingBox())!;
  expect(Math.round(box.width)).toBe(120);
  expect(Math.round(box.height)).toBe(120);
  expect(await sheet.locator('.bubble.mine.sticker').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await sent.evaluate((el) => getComputedStyle(el).webkitUserSelect)).toBe('none');

  // The recent row has it; tapped again and again, every tap sends, and the row stays put under the finger.
  const recent = sheet.getByRole('group', { name: 'Recent stickers' }).getByRole('button');
  await expect(recent).toHaveCount(1);
  const at = await mid(recent.first());
  for (let i = 0; i < 3; i++) await a.page.touchscreen.tap(at.x, at.y);
  await expect(sent).toHaveCount(4, { timeout: 30_000 });
  await expect(sheet.getByRole('status')).toHaveText('Sent sticker ×3');
  await expect(recent).toHaveCount(1);

  // As on the iPhone, whose canvas can't write WebP (it gives PNG): a photo-like sticker, noisy to the edge, still meets the goal.
  await field.evaluate(async (el) => {
    const own = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (this: HTMLCanvasElement, type?: string, q?: unknown) { return own.call(this, type === 'image/webp' ? 'image/png' : type, q); };
    const c = document.createElement('canvas'), px = 700;
    c.width = px; c.height = px;
    const g = c.getContext('2d')!, d = g.createImageData(px, px);
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
      const i = (y * px + x) * 4, r = Math.hypot(x - px / 2, y - px / 2) / 300, n = (Math.random() - 0.5) * 16;
      if (r > 1) continue;
      d.data[i] = 200 * (1 - r) + 40 + n + 30 * Math.sin(x / 7); d.data[i + 1] = 120 + 60 * Math.cos(y / 11) + n; d.data[i + 2] = 80 + 100 * r + n; d.data[i + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    const blob = await new Promise<Blob>((ok) => c.toBlob((x) => ok(x!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'photo.png', { type: 'image/png' }));
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: dt });
    el.dispatchEvent(ev);
  });
  await sheet.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(sent).toHaveCount(5, { timeout: 30_000 });
  const png = await sent.last().evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    return { head: img.src.slice(0, img.src.indexOf(',') + 1), bytes: (img.src.length - img.src.indexOf(',') - 1) * 0.75, long: Math.max(img.naturalWidth, img.naturalHeight) };
  });
  info.annotations.push({ type: 'png sticker', description: JSON.stringify(png) });
  expect(png.head).toBe('data:image/png;base64,');
  expect(png.bytes).toBeLessThanOrEqual(60_000);
  expect(png.long).toBeGreaterThanOrEqual(192);
  await expect(recent).toHaveCount(2); // a new one from the box goes first in the row
  expect(await noSideScroll(a.page)).toBe(true);
  await a.page.screenshot({ path: `${SHOTS}/thread-stickers.png` });
  await info.attach('thread-stickers', { path: `${SHOTS}/thread-stickers.png`, contentType: 'image/png' });

  // B: Today says "sent a sticker" (never the image), and the thread shows them, theirs on the left.
  await b.page.reload();
  await expect(b.page.getByRole('button', { name: new RegExp(`^@${a.name} sent a sticker`) })).toBeVisible();
  await goto(b.page, 'Friends');
  await expect(crew(b.page).getByTestId(`crew-${a.name}`)).toContainText('sent a sticker');
  await crew(b.page).getByTestId(`crew-${a.name}`).getByRole('button', { name: new RegExp(`^Message @${a.name}`) }).click();
  await expect(sheetOf(b.page, a.name).locator('.bubble.theirs.sticker img')).toHaveCount(5);
  await b.page.screenshot({ path: `${SHOTS}/thread-stickers-theirs.png` });
});

// ---- iOS's emoji keyboard (owner, 2026-11-12): its Stickers, Memoji and Genmoji go only into a rich-text field, which in
// WebKit is a contenteditable; there it puts an <img>, or a <picture> (a HEIC source, a PNG <img> to fall back on). Headless
// WebKit has no such keyboard: these put the nodes in as WebKit does, and the real keyboard is the phone's to check. ----

/** A 200px transparent PNG with a disc of `colour` in it, as a data URL; run in the page. */
const DISC = `(colour) => { const c = document.createElement('canvas'); c.width = c.height = 200; const g = c.getContext('2d');
  g.fillStyle = colour; g.beginPath(); g.arc(100, 100, 70, 0, Math.PI * 2); g.fill(); return c.toDataURL('image/png'); }`;
/** The middle pixel of the sticker waiting in the box, as [r, g, b]. */
const middle = (l: ReturnType<Page['locator']>) => l.evaluate(async (img: HTMLImageElement) => {
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  return Array.from(g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data.slice(0, 3));
});
const near = (got: number[], want: number[]) => got.every((v, i) => Math.abs(v - want[i]) <= 16);

test('a sticker the keyboard puts in the box waits there for Send, the words round it stay, and typing and Send work as ever', async ({ browser }, info) => {
  const [a, b] = await Promise.all([person(browser), person(browser)]);
  await befriend(b, a, b.name);
  await crew(a.page).getByTestId(`crew-${b.name}`).getByRole('button', { name: `Message @${b.name}` }).click();
  const sheet = sheetOf(a.page, b.name);
  const field = sheet.getByRole('textbox', { name: `Message @${b.name}` });
  await expect(sheet.getByRole('button', { name: 'Send 💪 Strong' })).toBeEnabled();
  // Rich text, so iOS offers its stickers (plaintext-only would hide them), and 16px (iOS zooms a smaller field).
  expect(await field.evaluate((el) => (el as HTMLElement).contentEditable)).toBe('true');
  expect(await fontPx(field)).toBeGreaterThanOrEqual(16);
  await expect(field).toHaveAttribute('aria-placeholder', 'Message');
  await field.click();
  await field.pressSequentially('Nice');
  await expect(sheet.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();

  // A sticker from the keyboard: an <img> at the caret, then the input event. It's out of the box before the next frame.
  const left = await field.evaluate(async (el, disc) => {
    const img = document.createElement('img');
    img.src = (0, eval)(disc)('#2a9d8f'); img.alt = 'Sticker';
    getSelection()!.getRangeAt(0).insertNode(img);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    await new Promise((ok) => requestAnimationFrame(ok));
    return el.querySelectorAll('img, picture').length;
  }, DISC);
  expect(left, 'gone before it was drawn').toBe(0);
  const waiting = sheet.getByRole('img', { name: 'Sticker to send' });
  await expect(waiting).toBeVisible();
  expect(near(await middle(waiting), [0x2a, 0x9d, 0x8f]), 'the teal one waits').toBe(true);
  await expect.poll(() => boxValue(field)).toBe('Nice');

  // A Genmoji or HEIC sticker: a <picture>, put in mid-word with no input event at all (only the observer sees it). Its HEIC
  // source this WebKit can't draw; the PNG it falls back on becomes the sticker, in place of the one waiting.
  const left2 = await field.evaluate(async (el, disc) => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let t: Text | null = null;
    while (walk.nextNode()) if ((walk.currentNode as Text).data.includes('Ni')) { t = walk.currentNode as Text; break; }
    const pic = document.createElement('picture');
    const src = document.createElement('source');
    src.type = 'image/x-apple-adaptive-glyph'; src.srcset = 'data:image/heic;base64,AAAAGGZ0eXBoZWljAAAAAG1pZjE=';
    const img = document.createElement('img');
    img.src = (0, eval)(disc)('#e76f51'); img.alt = 'Genmoji of a flexed arm';
    pic.append(src, img);
    const r = document.createRange();
    r.setStart(t!, t!.data.indexOf('Ni') + 2); r.collapse(true);
    r.insertNode(pic);
    await new Promise((ok) => requestAnimationFrame(ok));
    return el.querySelectorAll('img, picture, source').length;
  }, DISC);
  expect(left2).toBe(0);
  await expect.poll(async () => near(await middle(waiting), [0xe7, 0x6f, 0x51]), 'the orange one waits now').toBe(true);
  await expect(waiting).toHaveCount(1);
  await expect.poll(() => boxValue(field)).toBe('Nice');

  // Words pasted with their formatting go in as words alone, at the caret.
  await field.evaluate((el) => {
    const sel = getSelection()!;
    sel.selectAllChildren(el); sel.collapseToEnd();
    const dt = new DataTransfer();
    dt.setData('text/html', '<b style="color:red"> big</b> <i>lift</i>');
    dt.setData('text/plain', ' big lift');
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: dt });
    el.dispatchEvent(ev);
  });
  await expect.poll(() => boxValue(field)).toBe('Nice big lift');
  await expect(field.locator('b, i, [style]')).toHaveCount(0);
  await a.page.screenshot({ path: `${SHOTS}/sticker-from-keyboard.png` });
  await info.attach('sticker-from-keyboard', { path: `${SHOTS}/sticker-from-keyboard.png`, contentType: 'image/png' });

  // Typing goes on where it was; Send sends the sticker, then the words, and empties the box.
  await field.pressSequentially('!');
  await sheet.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(sheet.getByRole('status')).toHaveText('Sent');
  await expect(sheet.locator('.bubble.mine.sticker img')).toHaveCount(1);
  expect(near(await middle(sheet.locator('.bubble.mine.sticker img')), [0xe7, 0x6f, 0x51])).toBe(true);
  await expect(sheet.locator('.bubble.mine .bubble-text')).toHaveText(['Nice big lift!']);
  await expect(waiting).toHaveCount(0);
  await expect.poll(() => boxValue(field)).toBe('');
  await expect(sheet.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  // And again, with no sticker: a plain message.
  await field.fill('Same time tomorrow?');
  await sheet.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(sheet.locator('.bubble.mine .bubble-text')).toHaveText(['Nice big lift!', 'Same time tomorrow?']);
  await expect.poll(() => boxValue(field)).toBe('');
});

// ---- A send the server never answers (owner, 2026-11-12: "I tried to send a sticker and it all looked good but never shows up
// in the chat"; no write of it ever reached Firestore, and the box had let it go at the tap). ----

test('a sticker and words that get no answer stay, and the line says so; Send then sends each once', async ({ browser }) => {
  test.setTimeout(120_000);
  const [a, b] = await Promise.all([person(browser), person(browser)]);
  await befriend(b, a, b.name);
  await crew(a.page).getByTestId(`crew-${b.name}`).getByRole('button', { name: `Message @${b.name}` }).click();
  const sheet = sheetOf(a.page, b.name);
  const field = sheet.getByRole('textbox', { name: `Message @${b.name}` });
  await expect(sheet.getByRole('button', { name: 'Send 💪 Strong' })).toBeEnabled();
  // Every write held unanswered, as on the phone, until the line comes back; what was held is then dropped, never landing.
  let back!: () => void;
  const line = new Promise<void>((ok) => { back = ok; });
  const commit = (u: URL) => u.pathname.endsWith(':commit');
  await a.page.route(commit, async (route) => { await line; await route.abort(); });

  await field.evaluate(async (el) => {
    const c = document.createElement('canvas');
    c.width = c.height = 200;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2a9d8f'; g.beginPath(); g.arc(100, 100, 70, 0, Math.PI * 2); g.fill();
    const blob = await new Promise<Blob>((ok) => c.toBlob((x) => ok(x!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'sticker.png', { type: 'image/png' }));
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: dt });
    el.dispatchEvent(ev);
  });
  const waiting = sheet.getByRole('img', { name: 'Sticker to send' });
  await expect(waiting).toBeVisible();
  await field.click();
  await field.pressSequentially('Got it?');
  const send = sheet.getByRole('button', { name: 'Send', exact: true });
  await send.click();

  // On its way: the sticker stays in the box marked as sending (Send can't send it twice), and the line says it's going.
  await expect(sheet.locator('.compose-sticker')).toHaveAttribute('aria-busy', 'true');
  await expect(send).toBeDisabled();
  await expect(sheet.getByRole('status')).toHaveText('Sending…');
  await a.page.screenshot({ path: `${SHOTS}/sticker-sending.png` });
  // No answer: the line says so, and the sticker and the words are both still there to send.
  await expect(sheet.getByRole('alert')).toHaveText(/no answer/i, { timeout: 30_000 });
  await expect(waiting).toBeVisible();
  await expect(sheet.locator('.compose-sticker')).not.toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => boxValue(field)).toBe('Got it?');
  await expect(sheet.locator('.bubble.mine')).toHaveCount(0);
  await a.page.screenshot({ path: `${SHOTS}/sticker-no-answer.png` });

  // Sent again and the sheet closed while it waits, then opened again: when it fails, both come back to the box, with why.
  await send.click();
  await expect(sheet.locator('.compose-sticker')).toHaveAttribute('aria-busy', 'true');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await crew(a.page).getByTestId(`crew-${b.name}`).getByRole('button', { name: `Message @${b.name}` }).click();
  await expect(sheet.getByRole('alert')).toHaveText(/no answer/i, { timeout: 30_000 });
  await expect(waiting).toBeVisible();
  await expect.poll(() => boxValue(field)).toBe('Got it?');

  // The line is back: Send sends them, each once.
  back();
  await a.page.unroute(commit);
  await expect(send).toBeEnabled();
  await send.click();
  await expect(sheet.getByRole('status')).toHaveText('Sent');
  await expect(waiting).toHaveCount(0);
  await expect(sheet.locator('.bubble.mine.sticker img')).toHaveCount(1);
  await expect(sheet.locator('.bubble.mine .bubble-text')).toHaveText(['Got it?']);
  await expect.poll(() => boxValue(field)).toBe('');
});

// ---- Your stickers (owner, 2026-11-16: "stickers send now but the process of sending them is still pretty clunky"): the sticker
// button opens every sticker sent, added or received, in the keyboard's place; a tap sends one. ----

const COLOURS = [['#e63946', 'PR'], ['#2a9d8f', 'GO'], ['#f4a261', '+5'], ['#457b9d', 'LFG'], ['#8338ec', 'W'], ['#06d6a0', 'OK'], ['#ff006e', 'NICE']] as const;
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** A PNG to pick from Photos: a disc of `colour` with a word on its top half, on clear; `colour` null, clear all over. */
async function photo(page: Page, name: string, colour: string | null, word = '') {
  const b64 = await page.evaluate(([colour, word]) => {
    const c = document.createElement('canvas');
    c.width = c.height = 240;
    const g = c.getContext('2d')!;
    if (colour) {
      g.fillStyle = colour; g.beginPath(); g.arc(120, 120, 96, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.fillText(word, 120, 92);
    }
    return c.toDataURL('image/png').split(',')[1];
  }, [colour, word] as const);
  return { name, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

test('your stickers: the button opens them in the keyboard’s place; Add from Photos takes several, a tap sends, a friend’s is kept, a favourite goes first', async ({ browser }, info) => {
  test.setTimeout(180_000);
  const [a, b] = await Promise.all([person(browser), person(browser)]);
  await befriend(b, a, b.name);
  await crew(a.page).getByTestId(`crew-${b.name}`).getByRole('button', { name: `Message @${b.name}` }).click();
  const sheet = sheetOf(a.page, b.name);
  const field = sheet.getByRole('textbox', { name: `Message @${b.name}` });
  await expect(sheet.getByRole('button', { name: 'Send 💪 Strong' })).toBeEnabled();

  // Typing, then the sticker button: the box lets go of the keyboard and the drawer comes up in its place (no photo picker).
  await field.click();
  const open = sheet.getByRole('button', { name: 'Stickers' });
  await open.click();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  const drawer = sheet.getByRole('region', { name: 'Your stickers' });
  await expect(drawer).toBeVisible();
  expect(await field.evaluate((el) => document.activeElement === el)).toBe(false);
  await expect(drawer).toContainText('Stickers you send, and the ones friends send you, are kept here.');
  await a.page.screenshot({ path: `${SHOTS}/drawer-empty.png` });

  // Add from Photos: several at once, each made a sticker, the first picked first; one with nothing in it says why.
  await drawer.getByLabel('Add from Photos').setInputFiles([...await Promise.all(COLOURS.map(([c, w], i) => photo(a.page, `s${i}.png`, c, w))), await photo(a.page, 'blank.png', null)]);
  await expect(sheet.getByRole('alert')).toHaveText(`Added ${COLOURS.length} stickers. 1 couldn’t be: That image is empty.`);
  const cells = drawer.getByRole('group', { name: 'Stickers' }).getByRole('button');
  await expect(cells).toHaveCount(COLOURS.length);
  for (const k of [0, 2, 6]) expect(near(await middle(cells.nth(k).locator('img')), rgb(COLOURS[k][0]))).toBe(true);

  // A tap sends it at once; tapped again and again where it is, every tap sends and the grid holds still under the finger.
  const sent = sheet.locator('.bubble.mine.sticker img');
  const at = await mid(cells.nth(2));
  await a.page.touchscreen.tap(at.x, at.y);
  await expect(sent).toHaveCount(1);
  for (let i = 0; i < 2; i++) await a.page.touchscreen.tap(at.x, at.y);
  await expect(sent).toHaveCount(3, { timeout: 30_000 });
  expect(near(await middle(cells.nth(2).locator('img')), rgb(COLOURS[2][0]))).toBe(true);
  for (let k = 0; k < 3; k++) expect(near(await middle(sent.nth(k)), rgb(COLOURS[2][0]))).toBe(true);
  expect(await noSideScroll(a.page)).toBe(true);
  // The drawer on the screen, clear of the home bar.
  const foot = (await drawer.boundingBox())!;
  expect(foot.y + foot.height).toBeLessThanOrEqual(812 - BOTTOM);
  await a.page.screenshot({ path: `${SHOTS}/drawer.png` });
  await info.attach('drawer', { path: `${SHOTS}/drawer.png`, contentType: 'image/png' });

  // A tap in the box: the drawer folds away for the keyboard, and the recent row has the one sent.
  await field.click();
  await expect(drawer).toHaveCount(0);
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await expect(sheet.getByRole('group', { name: 'Recent stickers' }).getByRole('button')).toHaveCount(1);

  // B: A's sticker came in and is one of B's own now, kept once though it came three times.
  await b.page.reload();
  await goto(b.page, 'Friends');
  await crew(b.page).getByTestId(`crew-${a.name}`).getByRole('button', { name: new RegExp(`^Message @${a.name}`) }).click();
  const bs = sheetOf(b.page, a.name);
  const theirs = bs.locator('.bubble.theirs.sticker');
  await expect(theirs.locator('img')).toHaveCount(3);
  const bOpen = bs.getByRole('button', { name: 'Stickers' });
  await bOpen.click();
  const bd = bs.getByRole('region', { name: 'Your stickers' });
  const bcells = bd.getByRole('group', { name: 'Stickers' }).getByRole('button');
  await expect(bcells).toHaveCount(1);
  expect(near(await middle(bcells.first().locator('img')), rgb(COLOURS[2][0]))).toBe(true);
  // B adds one of their own and sends it from the drawer: it goes first, being newest.
  await bd.getByLabel('Add from Photos').setInputFiles([await photo(b.page, 'b.png', '#ffbe0b', 'B')]);
  await expect(bs.getByRole('status')).toHaveText('Added the sticker.');
  await expect(bcells).toHaveCount(2);
  await bcells.first().click();
  await expect(bs.locator('.bubble.mine.sticker img')).toHaveCount(1);
  await bOpen.click();
  await expect(bd).toHaveCount(0);
  // The recent row is what B sent: A's only came in.
  const row = bs.getByRole('group', { name: 'Recent stickers' }).getByRole('button');
  await expect(row).toHaveCount(1);
  expect(near(await middle(row.first().locator('img')), rgb('#ffbe0b'))).toBe(true);

  // A's sticker in the thread, tapped, offers Favourite: then it's first in the row, marked, ahead of what B sent.
  await theirs.first().getByRole('button', { name: 'Sticker' }).click();
  const fav = theirs.first().getByRole('button', { name: 'Favourite' });
  await expect(fav).toHaveAttribute('aria-pressed', 'false');
  await fav.click();
  await expect(fav).toHaveAttribute('aria-pressed', 'true');
  await expect(bs.getByRole('status')).toHaveText('Added to your favourites.');
  await expect(row).toHaveCount(2);
  await expect(row.first()).toHaveAccessibleName('Send sticker 1, a favourite');
  expect(near(await middle(row.first().locator('img')), rgb(COLOURS[2][0]))).toBe(true);
  await expect(row.nth(1)).toHaveAccessibleName('Send sticker 2');
  await b.page.screenshot({ path: `${SHOTS}/recent-row.png` });
  await info.attach('recent-row', { path: `${SHOTS}/recent-row.png`, contentType: 'image/png' });
  // And first in the drawer.
  await bOpen.click();
  await expect(bcells.first()).toHaveAccessibleName('Send sticker 1, a favourite');
  expect(near(await middle(bcells.first().locator('img')), rgb(COLOURS[2][0]))).toBe(true);

  // Held down: Edit (the hold makes nothing a favourite). × takes one out, with Undo in its place; Done, and it's gone, and a
  // thread that still has it doesn't bring it back on the next launch.
  // A finger held down, then lifted: as on the phone, the click lands where it lifts, on whatever Edit has put there by then.
  const hold = await mid(bcells.nth(1));
  await bcells.nth(1).dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, clientX: hold.x, clientY: hold.y });
  await b.page.waitForTimeout(700);
  await b.page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y) as HTMLElement;
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }));
    el.click();
  }, hold);
  await expect(bd.getByRole('button', { name: 'Done' })).toBeVisible();
  await b.page.waitForTimeout(500); // what a stray click would have done is kept and shown by now
  expect(await bd.getByRole('button', { name: 'Favourite sticker 1' }).getAttribute('aria-pressed')).toBe('true');
  expect(await bd.getByRole('button', { name: 'Favourite sticker 2' }).getAttribute('aria-pressed'), 'the hold made nothing a favourite').toBe('false');
  // And the sticker held is where it was: Edit moved nothing under the finger.
  const held = await mid(bd.getByRole('button', { name: 'Favourite sticker 2' }));
  expect(Math.abs(held.x - hold.x) + Math.abs(held.y - hold.y)).toBeLessThanOrEqual(1);
  await bd.getByRole('button', { name: 'Remove sticker 2' }).click();
  await expect(bd.getByRole('button', { name: 'Put sticker 2 back' })).toBeVisible();
  await b.page.screenshot({ path: `${SHOTS}/drawer-edit.png` });
  await bd.getByRole('button', { name: 'Done' }).click();
  await expect(bcells).toHaveCount(1);
  await b.page.reload();
  await goto(b.page, 'Friends');
  await crew(b.page).getByTestId(`crew-${a.name}`).getByRole('button', { name: new RegExp(`^Message @${a.name}`) }).click();
  await expect(bs.locator('.bubble.mine.sticker img')).toHaveCount(1);
  await bOpen.click();
  await expect(bcells).toHaveCount(1);
  await expect(bcells.first()).toHaveAccessibleName('Send sticker 1, a favourite');
});
