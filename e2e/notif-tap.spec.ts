import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { goto } from './nav';

// A notification tap lands where it says, whatever the app was doing: a friend's push on their thread, the recap on the
// week's digest. The tap arrives as the URL a push carries (`navigate`, `#open=<route>`): a launch on it, or a hash change
// in an app already open, or the service worker's message. Synthetic accounts on the local emulators, at the 13 mini's
// 375×812 with its notch and home-bar insets served into the CSS (headless browsers report 0).
const PASSWORD = 'synthetic-pass-1';
const SHOTS = 'screenshots/notif-tap';
mkdirSync(SHOTS, { recursive: true });
const TOP = 47, BOTTOM = 34;
const rand = () => Math.random().toString(36).slice(2, 10);
const friends = (page: Page) => page.getByRole('region', { name: 'Friends', exact: true });
const crew = (page: Page) => page.getByRole('region', { name: 'Crew' });
const sheetOf = (page: Page, name: string) => page.getByRole('dialog', { name: `Messages with @${name}` });
const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });
const APP = `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}/`;
/** What the push's `navigate` is: absolute, inside the app (src/push/payload.ts buildPayload). */
const navigate = (route: string) => new URL(`#open=${route}`, APP).href;

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

/** A phone with an account and a username, on Friends; `uid` is the account's, as a push's route names it. */
async function person(browser: Browser) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: APP.slice(0, -1), localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
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
  const uid = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((r) => { const q = indexedDB.open('firebaseLocalStorageDb'); q.onsuccess = () => r(q.result); });
    const all = await new Promise<{ value: { uid?: string } }[]>((r) => { const q = db.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll(); q.onsuccess = () => r(q.result); });
    return all.find((x) => x.value?.uid)!.value.uid!;
  });
  return { page, name, uid };
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

/** The sheet is up and whole on the screen: below the notch, above the home bar. */
async function onScreen(page: Page, sheet: ReturnType<Page['getByRole']>) {
  await expect(sheet).toBeInViewport({ ratio: 1 });
  const box = (await sheet.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(TOP);
  const field = (await sheet.getByRole('textbox').boundingBox())!;
  expect(field.y + field.height).toBeLessThanOrEqual(812 - BOTTOM);
}

test('a friend’s message push opens their thread: on a launch, on a tap with the app open elsewhere (twice), and from the service worker', async ({ browser }, info) => {
  const [a, b] = await Promise.all([person(browser), person(browser)]);
  await befriend(b, a, b.name);
  // A writes to B: the push B gets names A (route friend.<A's uid>).
  await crew(a.page).getByTestId(`crew-${b.name}`).getByRole('button', { name: `Message @${b.name}` }).click();
  const toB = sheetOf(a.page, b.name);
  await toB.getByRole('textbox', { name: `Message @${b.name}` }).fill('leg day?');
  await toB.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(toB.getByRole('status')).toHaveText('Sent');

  // The tap launches the app on its URL: A's thread, with the message in it, over Friends.
  const route = `friend.${a.uid}`;
  const sheet = sheetOf(b.page, a.name);
  await b.page.goto('about:blank');
  await b.page.goto(navigate(route));
  await expect(sheet.getByRole('list', { name: 'Messages' }).locator('.bubble-text')).toHaveText(['leg day?']);
  await expect(tab(b.page, 'Friends')).toHaveAttribute('aria-current', 'page');
  await onScreen(b.page, sheet);
  // The hash is gone once followed, so the next tap on the same friend is a change the app hears.
  expect(new URL(b.page.url()).hash).toBe('');
  await b.page.screenshot({ path: `${SHOTS}/1-thread-launch.png` });
  await info.attach('thread-launch', { path: `${SHOTS}/1-thread-launch.png`, contentType: 'image/png' });

  // The app already open on another tab, then on A's log: the same push tapped twice lands both times. A tap on an app
  // that's open moves it to the push's URL in the same page, which only says anything if the URL is a change.
  for (const place of ['Stats', 'A’s log'] as const) {
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
    if (place === 'Stats') {
      await goto(b.page, 'Stats');
      await expect(tab(b.page, 'Stats')).toHaveAttribute('aria-current', 'page');
    } else {
      await crew(b.page).getByTestId(`crew-${a.name}`).getByRole('button', { name: `@${a.name}`, exact: true }).click();
      await expect(b.page.getByRole('region', { name: 'Viewing a friend' })).toContainText(`Viewing @${a.name}`);
    }
    await b.page.evaluate((u) => { location.href = u; }, navigate(route));
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('list', { name: 'Messages' }).locator('.bubble-text')).toHaveText(['leg day?']);
    await expect(tab(b.page, 'Friends')).toHaveAttribute('aria-current', 'page');
    await onScreen(b.page, sheet);
    await expect(b.page.getByRole('region', { name: 'Viewing a friend' })).toHaveCount(0);
    expect(new URL(b.page.url()).hash).toBe('');
  }

  // The service worker's word to a window already open (notificationclick, where it runs): the same thread.
  await sheet.getByRole('button', { name: 'Close' }).click();
  await goto(b.page, 'Lifts');
  await b.page.evaluate((r) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open', route: r } })), route);
  await expect(sheet).toBeVisible();
  await expect(tab(b.page, 'Friends')).toHaveAttribute('aria-current', 'page');
  await onScreen(b.page, sheet);
  await b.page.screenshot({ path: `${SHOTS}/2-thread-open-app.png` });
  await Promise.all([a.page.context().close(), b.page.context().close()]);
});

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,duration_s,distance_mi';
// Synthetic. The week before the recap's (Oct 5–11): one session. The recap's week (Oct 12–18): two sessions, 7 sets.
const ROWS = [
  '2026-10-06,Bench Press,,1,135,8,,,,sample,,', '2026-10-06,Bench Press,,2,135,8,,,,sample,,',
  '2026-10-13,Bench Press,,1,140,8,,,,sample,,', '2026-10-13,Bench Press,,2,140,8,,,,sample,,', '2026-10-13,Lat Pulldown,,1,120,10,,,,sample,,',
  '2026-10-16,Leg Press,,1,200,10,,,,sample,,', '2026-10-16,Leg Press,,2,200,10,,,,sample,,', '2026-10-16,Leg Press,,3,200,10,,,,sample,,', '2026-10-16,Lat Pulldown,,1,120,10,,,,sample,,',
];

test('the recap push opens the week’s digest on Today: from another tab, hidden for the week, folded, or under the exercise picker', async ({ page }, info) => {
  await notched(page);
  // Monday morning: the recap went out last night, about the week just gone.
  await page.clock.install({ time: new Date('2026-10-19T08:00:00') });
  await page.goto('/');
  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...ROWS].join('\n')) });
  await expect(page.getByText(`✓ Imported ${ROWS.length} new sets`)).toBeVisible();
  const digest = page.getByRole('region', { name: 'Last week' });
  const toggle = digest.getByRole('button', { name: /^Last week/ });
  /** The digest is open and on the screen at the top of Today, below the notch. */
  const shown = async () => {
    await expect(tab(page, 'Today')).toHaveAttribute('aria-current', 'page');
    await expect(digest.getByRole('heading', { level: 2 })).toHaveText(/Last week\s*· Oct 12–18/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(digest.locator('.digest-lines')).toBeInViewport();
    expect((await digest.boundingBox())!.y).toBeGreaterThanOrEqual(TOP);
    expect(new URL(page.url()).hash).toBe('');
  };

  // Hidden for the week, then the tap with the app on Stats.
  await goto(page, 'Today');
  await digest.getByRole('button', { name: 'Hide until next week' }).click();
  await expect(digest).toHaveCount(0);
  await goto(page, 'Stats');
  await page.goto(navigate('recap'));
  await shown();
  await page.screenshot({ path: `${SHOTS}/3-recap.png` });
  await info.attach('recap', { path: `${SHOTS}/3-recap.png`, contentType: 'image/png' });

  // Folded, the app on History: the next tap opens it again.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await goto(page, 'History');
  await page.goto(navigate('recap'));
  await shown();

  // On Today with the exercise picker up (it takes Today's place): the tap puts the digest back.
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search exercises' })).toBeVisible();
  await expect(digest).toHaveCount(0);
  await page.goto(navigate('recap'));
  await expect(page.getByRole('searchbox', { name: 'Search exercises' })).toHaveCount(0);
  await shown();
  await page.screenshot({ path: `${SHOTS}/4-recap-from-picker.png` });
});
