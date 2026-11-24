import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto } from './nav';
import { notched } from './layout';
import { tapAndSync } from './synced';

// The rest banner's tap (owner, 2026-11-21) goes to the lift's card on Today from whatever is open (owner, 2026-11-23: every
// sheet, modal and overlay, not only the bottom sheets): Today's own pickers, a past day left open on Today, the walkthrough,
// History's and the program's pickers, the camera, a pull's show, a chat. On the 13 mini, notch and home bar included.
// Synthetic lifts and users only.
const SHOTS = 'screenshots/rest-banner';
mkdirSync(SHOTS, { recursive: true });
test.use({ serviceWorkers: 'block' });

const banner = (page: Page) => page.locator('.rest-banner');
const todayTab = (page: Page) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Today', exact: true });

/** A set of Cable Curl at 18:30 on 2026-10-16 (its rest running), the clock held there: the curl's card. */
async function curlSet(page: Page, before?: (page: Page) => Promise<void>): Promise<Locator> {
  await notched(page);
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  await before?.(page);
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Cable Curl');
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  const curl = page.locator('[data-card="cable curl"]');
  await curl.getByRole('textbox', { name: 'Weight' }).fill('40');
  await curl.getByRole('textbox', { name: 'Reps' }).fill('12');
  await page.clock.pauseAt(new Date('2026-10-16T18:30:00'));
  await curl.getByRole('button', { name: /^Add set/ }).click();
  await expect(page.getByRole('timer', { name: 'Rest' })).toContainText('2:00');
  return curl;
}
/** The rest runs out with `over` up; the banner shows over it, and its tap lands on the curl's card on Today. */
async function endAndTap(page: Page, curl: Locator, over: Locator, shot: string) {
  await expect(over).toBeVisible();
  await page.clock.fastForward(121_000);
  await expect(banner(page)).toBeVisible();
  await banner(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await page.screenshot({ path: `${SHOTS}/${shot}-before.png` });
  await banner(page).getByRole('button').click();
  await expect(banner(page)).toHaveCount(0);
  await expect(over).toHaveCount(0);
  await expect(todayTab(page)).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Next day' })).toBeDisabled(); // today's, not a day before it
  await expect(curl.locator('.card-head .link')).toBeFocused();
  await expect(curl).toBeInViewport();
  await expect(page.getByRole('timer', { name: 'Rest' })).toContainText('Rest done');
  await page.screenshot({ path: `${SHOTS}/${shot}-after.png` });
}

test('Today’s own picker (Add exercise), which takes the cards’ place: the tap puts it away', async ({ page }) => {
  const curl = await curlSet(page);
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await endAndTap(page, curl, page.getByRole('searchbox', { name: 'Search exercises' }), 'overlay-today-picker');
});

test('a past day opened on Today, then another tab: the tap comes back to today’s Today, not that day', async ({ page }) => {
  const curl = await curlSet(page);
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByRole('button', { name: 'Next day' })).toBeEnabled();
  await goto(page, 'Stats');
  await endAndTap(page, curl, page.locator('nav.tabs button[aria-current="page"]', { hasText: 'Stats' }), 'overlay-past-day');
});

test('the walkthrough (from More, over Today’s rest bar): the tap closes it', async ({ page }) => {
  const curl = await curlSet(page);
  await goto(page, 'More');
  await page.getByRole('button', { name: 'Show walkthrough' }).click();
  const tour = page.getByRole('dialog', { name: 'Walkthrough' });
  await endAndTap(page, curl, tour, 'overlay-walkthrough');
});

test('History’s picker (Fix sets › Change lift) and the program’s (Add exercise to a day): the tap leaves them', async ({ page }) => {
  const curl = await curlSet(page);
  await goto(page, 'History');
  const day = page.locator('details.day[data-date="2026-10-16"]');
  await page.locator('.day-item', { has: day }).getByRole('button', { name: /^More for / }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Fix sets' }).click();
  await day.getByRole('group', { name: 'Cable Curl' }).getByRole('button', { name: 'Change lift' }).click();
  await endAndTap(page, curl, page.getByRole('heading', { name: /^Change Cable Curl on .* to$/ }), 'overlay-history-picker');

  await curl.getByRole('button', { name: /^Add set/ }).click();
  await expect(page.getByRole('timer', { name: 'Rest' })).toContainText(/[1-9]:\d\d/);
  await goto(page, 'Program');
  await page.getByRole('textbox', { name: 'Days per week' }).fill('2');
  await page.getByRole('button', { name: 'Build program' }).click();
  await page.getByRole('button', { name: /^Add exercise to / }).first().click();
  await endAndTap(page, curl, page.getByRole('searchbox', { name: 'Search exercises' }), 'overlay-program-picker');
});

test('the camera (Photos › Record the 6 poses): the tap closes it, and the camera with it', async ({ page }) => {
  // A camera that counts its starts and its track's stops. WebKit here has no media stack (no MediaRecorder, no streams to
  // play), so the stream is a stand-in a <video> takes without playing, and the recorder one that never records.
  await page.addInitScript(() => {
    const w = window as unknown as { cam: { starts: number; stops: number } };
    w.cam = { starts: 0, stops: 0 };
    const getUserMedia = async () => {
      w.cam.starts++;
      const track = Object.assign(new EventTarget(), { kind: 'video', readyState: 'live', stop() { if (this.readyState === 'live') w.cam.stops++; this.readyState = 'ended'; } });
      return { getTracks: () => [track], getVideoTracks: () => [track] };
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, get: () => null, set: () => {} });
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    (window as unknown as { MediaRecorder: unknown }).MediaRecorder = class { static isTypeSupported = (t: string) => t === 'video/mp4'; };
  });
  const curl = await curlSet(page);
  await goto(page, 'Photos');
  await page.getByRole('button', { name: 'Record the 6 poses' }).click();
  const cap = page.getByRole('dialog');
  await expect(page.locator('html')).toHaveClass(/cap-open/);
  await expect.poll(() => page.evaluate(() => (window as unknown as { cam: { starts: number } }).cam.starts)).toBe(1);
  await endAndTap(page, curl, cap, 'overlay-camera');
  await expect(page.locator('html')).not.toHaveClass(/cap-open/);
  expect(await page.evaluate(() => (window as unknown as { cam: unknown }).cam)).toEqual({ starts: 1, stops: 1 });
});

test('a pull’s show on Buddies: the tap leaves it (the pull is already in the collection)', async ({ page }) => {
  test.setTimeout(90_000);
  const curl = await curlSet(page, async (p) => {
    // The first buddy, then enough sessions for a ticket (every 5 sessions).
    await goto(p, 'Buddies');
    const offer = p.getByRole('group', { name: 'Your first buddy' }).getByRole('button');
    const first = (await offer.first().locator('b').textContent())!;
    await offer.first().click();
    await p.getByRole('button', { name: `Pick ${first}` }).click();
    const days = Array.from({ length: 6 }, (_, k) => `2026-10-${String(3 + 2 * k).padStart(2, '0')}`);
    const rows = days.flatMap((d) => Array.from({ length: 8 }, (_, i) => `${d},Bench Press,${i + 1},135,8,,sample,${d}T17:${String(10 + 3 * i)}:00.000Z`));
    await goto(p, 'Backup');
    await p.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from(['date,exercise,set,weight_lb,reps,flags,source,logged_at', ...rows].join('\n')) });
    await expect(p.getByText(`✓ Imported ${rows.length} new sets`)).toBeVisible();
  });
  await goto(page, 'Buddies');
  await page.getByRole('region', { name: 'Buddies banner' }).getByRole('button', { name: /^Pull with ticket/ }).click();
  const show = page.getByRole('dialog', { name: 'Your pull' });
  await endAndTap(page, curl, show, 'overlay-pull-show');
  await goto(page, 'Buddies');
  await expect(page.getByRole('dialog', { name: 'Your pull' })).toHaveCount(0);
});

test('a chat (a friend’s thread, from a notification’s link): the tap closes it', async ({ page }) => {
  const curl = await curlSet(page, async (p) => {
    await goto(p, 'Account');
    const account = p.getByRole('region', { name: 'Account' });
    await account.getByRole('textbox', { name: 'Email' }).fill(`rb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}@test.local`);
    await account.getByLabel('Password').fill('synthetic-pass-1');
    await tapAndSync(p, account, account.getByRole('button', { name: 'Create account' }));
  });
  await page.evaluate(() => { location.hash = '#open=friend.someoneelse0000000000000'; });
  const chat = page.getByRole('dialog', { name: /^Messages with / });
  await endAndTap(page, curl, chat, 'overlay-chat');
});
