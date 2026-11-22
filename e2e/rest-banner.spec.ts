import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto } from './nav';

// The rest's end with the app open (owner, 2026-11-21): a banner at the top, under the notch, on any screen and over a sheet;
// a tap goes to the lift on Today. At the 13 mini's 375×812 with its notch (insets faked as in e2e/superset).
const TOP = 47, BOTTOM = 34;
const SHOTS = 'screenshots/rest-banner';
mkdirSync(SHOTS, { recursive: true });
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
/** navigator.vibrate, recorded (WebKit has none): the buzz at the end. */
const buzzes = (page: Page) => page.addInitScript(() => {
  const w = window as unknown as { buzz: unknown[] };
  w.buzz = [];
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p: unknown) => { w.buzz.push(p); return true; } });
});
async function addCard(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  return page.locator(`[data-card="${name.toLowerCase()}"]`);
}
async function oneSet(page: Page) {
  await notched(page);
  await buzzes(page);
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  // Two cards, the curl's at the top: the tap has to bring the curl back up from wherever the page is.
  const curl = await addCard(page, 'Cable Curl');
  await addCard(page, 'Cable Pushdown');
  await curl.getByRole('textbox', { name: 'Weight' }).fill('40');
  await curl.getByRole('textbox', { name: 'Reps' }).fill('12');
  await page.clock.pauseAt(new Date('2026-10-16T18:30:00'));
  await curl.getByRole('button', { name: /^Add set/ }).click();
  await expect(page.getByRole('timer', { name: 'Rest' })).toContainText('2:00');
  return curl;
}
const banner = (page: Page) => page.locator('.rest-banner');
/** The running rest's time left as the bar shows it, in ms (read on Today, where the bar is). */
async function left(page: Page) {
  const [m, s] = (await page.locator('.rest-timer .rest-main > b').innerText()).split(':').map(Number);
  return (m * 60 + s) * 1000;
}
/** A set on the first card, then off to Log: the ms until its rest ends. The clock's jumps fire the page's timers at their end. */
async function setThenLog(page: Page) {
  await goto(page, 'Today');
  await page.getByRole('button', { name: /^Add set/ }).first().click();
  await expect(page.getByRole('timer', { name: 'Rest' })).toContainText(/[1-9]:\d\d/);
  const ms = await left(page);
  await goto(page, 'Log');
  return ms;
}
/** The banner's slide-in done, so its box is where it rests. */
const settled = (page: Page) => banner(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

test('the rest ends on another tab, over a sheet: a banner under the notch, and a tap goes to the lift on Today', async ({ page }) => {
  const curl = await oneSet(page);
  await goto(page, 'Stats');
  await page.getByRole('region', { name: 'This week', exact: true }).getByRole('button').click();
  const sheet = page.getByRole('dialog', { name: 'This week' });
  await expect(sheet).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
  await page.clock.fastForward(121_000);
  await expect(banner(page)).toBeVisible();
  await expect(banner(page).getByRole('button')).toHaveAccessibleName('Rest’s up — Cable Curl · set 2: go to it');
  await expect(banner(page)).toContainText('Rest’s up');
  await expect(banner(page)).toContainText('Cable Curl · set 2');
  expect(await page.evaluate(() => (window as unknown as { buzz: unknown[] }).buzz)).toHaveLength(1);
  await settled(page);
  // Under the notch, inside the screen, and on top of the sheet: what's at its middle is the banner.
  const b = (await banner(page).boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(TOP);
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.rest-banner'), [b.x + b.width / 2, b.y + b.height / 2])).toBe(true);
  await page.screenshot({ path: `${SHOTS}/1-over-sheet.png` });

  await banner(page).getByRole('button').click();
  await expect(banner(page)).toHaveCount(0);
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Today', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(curl.locator('.card-head .link')).toBeFocused();
  const c = (await curl.boundingBox())!;
  expect(c.y).toBeLessThan(TOP + 140);
  await expect(page.getByRole('timer', { name: 'Rest' })).toContainText('Rest done');
  await page.screenshot({ path: `${SHOTS}/2-after-tap.png` });
});

test('on Today with the bar in view, no banner (the bar says "Rest done"); elsewhere it goes after 6 s, or with a swipe up; none when seen late', async ({ page }) => {
  await oneSet(page);
  await page.clock.fastForward(121_000);
  await expect(page.getByRole('timer', { name: 'Rest' })).toContainText('Rest done');
  await expect(banner(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { buzz: unknown[] }).buzz)).toHaveLength(1);

  // A new rest, ended on Log: up, then gone by itself.
  await page.clock.fastForward(await setThenLog(page) + 500);
  await expect(banner(page)).toBeVisible();
  await settled(page);
  await page.screenshot({ path: `${SHOTS}/3-on-log.png` });
  await page.clock.fastForward(6_500);
  await expect(banner(page)).toHaveCount(0);

  // And again, put away with a swipe up: still on Log.
  await page.clock.fastForward(await setThenLog(page) + 500);
  await expect(banner(page)).toBeVisible();
  await settled(page);
  const b = (await banner(page).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 20, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 50, { steps: 4 });
  await page.mouse.up();
  await expect(banner(page)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Log', exact: true })).toHaveAttribute('aria-current', 'page');

  // An end the page only sees well after it (hidden, its timers held back): no banner; the lock-screen alert had it.
  await page.clock.fastForward(await setThenLog(page) + 10_000);
  await page.clock.runFor(1_000);
  await expect(banner(page)).toHaveCount(0);
});
