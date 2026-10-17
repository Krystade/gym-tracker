import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { goto } from './nav';

// Orbit against the local Auth and Firestore emulators. Synthetic users only.
// Today at 18:00 (Sunday when today is a Monday, so the day before is in the same week); the emulator's tokens use the real clock.
const now = new Date(new Date().setHours(18, 0, 0, 0));
const T = new Date(now.getDay() === 1 ? now.getTime() - 864e5 : now.getTime());
const Y = new Date(T.getTime() - 864e5);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const PASSWORD = 'synthetic-pass-1';
const SHOTS = 'screenshots/orbit';
mkdirSync(SHOTS, { recursive: true });
const rand = () => Math.random().toString(36).slice(2, 10);
const friends = (page: Page) => page.getByRole('region', { name: 'Friends', exact: true });
const orbit = (page: Page) => page.getByRole('region', { name: 'Orbit' });
const TOP = 47, BOTTOM = 34;

// The notched phone's insets, served into the CSS (headless browsers report 0); a service worker would answer past the rewrite.
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

async function lift(page: Page, name: string, sets: [number, number][]) {
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name, exact: true }).click();
  for (const [w, r] of sets) {
    await page.getByRole('textbox', { name: 'Weight' }).first().fill(String(w));
    await page.getByRole('textbox', { name: 'Reps' }).first().fill(String(r));
    await page.getByRole('button', { name: 'Add set' }).first().click();
  }
  await expect(page.getByText(`${sets.at(-1)![0]} × ${sets.at(-1)![1]}`).first()).toBeVisible();
}

/** A phone with an account and a username; `days` are logged first, oldest first, each on its own day. */
async function person(browser: Browser, days: { at: Date; lift: string; sets: [number, number][] }[] = []) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
  const page = await ctx.newPage();
  await notched(page);
  await page.clock.install({ time: days[0]?.at ?? T });
  await page.goto('/');
  for (const d of days) {
    if (d !== days[0]) { await page.clock.setSystemTime(d.at); await page.reload(); }
    await lift(page, d.lift, d.sets);
  }
  if (days.length && days.at(-1)!.at !== T) { await page.clock.setSystemTime(T); await page.reload(); }
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

async function setStatus(page: Page, text: string) {
  await orbit(page).getByTestId('orbit-me').getByRole('button', { name: '+ Status' }).click();
  const input = orbit(page).getByRole('textbox', { name: 'Your status' });
  // 16px or more, so iOS doesn't zoom the page when it's focused.
  expect(parseFloat(await input.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await input.fill(text);
  await orbit(page).getByRole('button', { name: 'Save' }).click();
  await expect(orbit(page).getByTestId('orbit-me').getByRole('button', { name: `Your status: ${text}. Change it` })).toBeVisible();
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);

test('Orbit shows a friend’s week as kinds, their status and numbers, at 375×812; a stranger never appears', async ({ browser }, info) => {
  // Three phones at once: each is independent until B asks A.
  const [b, a, c] = await Promise.all([
    person(browser, [
      { at: Y, lift: 'Barbell Squat', sets: [[185, 5], [185, 5]] },
      { at: T, lift: 'Bench Press', sets: [[135, 8], [135, 8], [135, 7]] },
    ]),
    person(browser),
    person(browser, [{ at: T, lift: 'Lat Pulldown', sets: [[100, 10]] }]),
  ]);

  // B: their own row first, with this week's numbers; a status phrase set inline, capped at 24 characters.
  await expect(orbit(b.page).getByTestId('orbit-me')).toContainText('2 sessions · 5 sets');
  await orbit(b.page).getByTestId('orbit-me').getByRole('button', { name: '+ Status' }).click();
  await orbit(b.page).getByRole('textbox', { name: 'Your status' }).fill('x'.repeat(25));
  await expect(orbit(b.page).getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(orbit(b.page)).toContainText('25/24');
  await orbit(b.page).getByRole('textbox', { name: 'Your status' }).press('Escape');
  await setStatus(b.page, 'Leg day survivor 🦵');
  await setStatus(c.page, 'stranger danger');

  // A and B become friends; C stays a stranger.
  await friends(b.page).getByRole('textbox', { name: 'Their username' }).fill(a.name);
  await friends(b.page).getByRole('button', { name: 'Send request' }).click();
  await a.page.reload();
  await goto(a.page, 'Friends');
  await friends(a.page).getByRole('region', { name: 'Requests' }).getByRole('button', { name: 'Accept' }).click();
  await expect(friends(a.page).getByRole('status')).toHaveText(`You and @${b.name} are now friends.`);

  const row = orbit(a.page).getByTestId(`orbit-${b.name}`);
  // B's status syncs a few seconds after it's saved: Refresh until it's there.
  await expect(async () => {
    await orbit(a.page).getByRole('button', { name: 'Refresh' }).click();
    await expect(row.locator('.orbit-bubble')).toHaveText('Leg day survivor 🦵', { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(row.getByRole('button', { name: `@${b.name}`, exact: true })).toBeVisible();
  await expect(row).toContainText('2 sessions · 5 sets');
  await expect(row.locator(`[data-date="${iso(Y)}"]`)).toHaveAttribute('data-kind', 'legs');
  await expect(row.locator(`[data-date="${iso(T)}"]`)).toHaveAttribute('data-kind', 'push');
  await expect(row.locator('[data-date]')).toHaveCount(2);
  // The same, not by colour: the table names each day's kind.
  await orbit(a.page).getByText('Table').click();
  const tableRow = orbit(a.page).getByRole('row', { name: new RegExp(`@${b.name}`) });
  await expect(tableRow).toContainText(/Legs, .* Push$/);
  // You first, then B; never C, who isn't a friend.
  await expect(orbit(a.page).locator('.orbit-row')).toHaveCount(2);
  await expect(orbit(a.page).locator('.orbit-row').first()).toHaveAttribute('data-testid', 'orbit-me');
  await expect(orbit(a.page)).not.toContainText(c.name);
  await expect(orbit(a.page)).not.toContainText('stranger danger');
  // Fewer than three friends: Invite floats above the tab bar, clear of it.
  const fab = a.page.getByRole('button', { name: 'Invite a friend' });
  const [fb, tabs] = [await fab.boundingBox(), await a.page.getByRole('navigation', { name: 'Sections' }).boundingBox()];
  expect(fb!.y + fb!.height).toBeLessThanOrEqual(tabs!.y);
  expect(await noSideScroll(a.page)).toBe(true);
  // The heading starts below the notch.
  expect((await a.page.getByRole('heading', { name: 'Friends', level: 1 }).boundingBox())!.y).toBeGreaterThanOrEqual(TOP);
  await orbit(a.page).getByText('Table').click();
  await a.page.screenshot({ path: `${SHOTS}/orbit-a.png` });
  await info.attach('orbit-a', { path: `${SHOTS}/orbit-a.png`, contentType: 'image/png' });

  // Invite brings the invite controls up.
  await fab.click();
  await expect(friends(a.page).getByRole('region', { name: 'Add a friend' })).toBeInViewport();

  // Tapping B's row opens B's log; your own row opens your History.
  await row.getByRole('button', { name: `@${b.name}`, exact: true }).click();
  await expect(a.page.getByRole('region', { name: 'Viewing a friend' })).toContainText(`Viewing @${b.name}`);
  await a.page.getByRole('button', { name: 'Back to you' }).click();
  await orbit(a.page).getByTestId('orbit-me').getByRole('button', { name: 'You', exact: true }).click();
  await expect(a.page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible();

  // B's own Orbit: their bubble, editable and clearable.
  await b.page.reload();
  await goto(b.page, 'Friends');
  await b.page.screenshot({ path: `${SHOTS}/orbit-b-status.png` });
  await orbit(b.page).getByRole('button', { name: 'Your status: Leg day survivor 🦵. Change it' }).click();
  await b.page.screenshot({ path: `${SHOTS}/orbit-b-editing.png` });
  await orbit(b.page).getByRole('button', { name: 'Clear' }).click();
  await expect(orbit(b.page).getByTestId('orbit-me').getByRole('button', { name: '+ Status' })).toBeVisible();
  await b.page.screenshot({ path: `${SHOTS}/orbit-b.png` });
});

test('the lines scroll back together by dragging, up to 8 weeks, and Today jumps back', async ({ browser }) => {
  const b = await person(browser, [{ at: T, lift: 'Bench Press', sets: [[135, 8]] }]);
  const page = b.page;
  const me = orbit(page).getByTestId('orbit-me');
  const seg = me.locator(`[data-date="${iso(T)}"]`);
  await expect(seg).toHaveCount(1);
  await expect(orbit(page).getByRole('button', { name: 'Today' })).toHaveCount(0);
  const box = (await orbit(page).locator('.orbit-rows').boundingBox())!;
  const x0 = (await seg.boundingBox())!.x;
  const col = box.width / 14;

  // Drag right three days: the line moves with it, snapped to whole days.
  await page.mouse.move(box.x + 40, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 40 + col * 1.5, box.y + 62, { steps: 4 });
  await page.mouse.move(box.x + 40 + col * 3, box.y + 62, { steps: 4 });
  await page.mouse.up();
  await expect(orbit(page).getByRole('button', { name: 'Today' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/orbit-dragged.png` });
  // Today's segment is now off the right edge.
  await expect(seg).toHaveCount(0);
  // Dragging never scrolls the page sideways, and a drag isn't a tap: still on Friends.
  expect(await noSideScroll(page)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Friends', level: 1 })).toBeVisible();

  // Way further back stops at 8 weeks: the oldest day shown is 55 days ago.
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(box.x + 20, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 10, box.y + 60, { steps: 6 });
    await page.mouse.up();
  }
  const oldest = new Date(T.getTime() - 55 * 864e5);
  await orbit(page).getByText('Table').click();
  await expect(orbit(page).locator('caption')).toContainText(oldest.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }));

  await orbit(page).getByRole('button', { name: 'Today' }).click();
  await expect(orbit(page).getByRole('button', { name: 'Today' })).toHaveCount(0);
  await expect(seg).toHaveCount(1);
  expect(Math.abs((await seg.boundingBox())!.x - x0)).toBeLessThan(1);

  // The keyboard moves a week at a time.
  await orbit(page).locator('.orbit-rows').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(orbit(page).getByRole('button', { name: 'Today' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(orbit(page).getByRole('button', { name: 'Today' })).toHaveCount(0);
});
