import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { goto } from './nav';

// Every screen and overlay at four phone sizes, with a notched phone's safe areas. Headless browsers report insets of 0,
// so the shipped CSS and HTML are served with each env(safe-area-inset-*) replaced by the 13 mini's: 47px top, 34px bottom.
const TOP = 47, BOTTOM = 34;
const SIZES = [[375, 812], [320, 568], [390, 844], [430, 932]] as const;
const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');
const SHOTS = 'screenshots/devices';
mkdirSync(SHOTS, { recursive: true });

// A service worker would answer from its cache, past the rewrite.
test.use({ serviceWorkers: 'block' });

async function notched(page: Page) {
  const inset = (s: string) => s.replace(/env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,[^)]*)?\)/g, (_, side: string) => `${side === 'top' ? TOP : side === 'bottom' ? BOTTOM : 0}px`);
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (!req.url().startsWith('http://127.0.0.1')) return route.abort(); // web fonts: offline, like a phone in a basement gym
    if (!['document', 'stylesheet'].includes(req.resourceType())) return route.continue();
    const res = await route.fetch();
    return route.fulfill({ response: res, body: inset(await res.text()) });
  });
}

/** What is wrong with the screen as it is now, measured in the page at the top and at the bottom of its scroll. */
function problems({ top, bottom }: { top: number; bottom: number }) {
  const out: string[] = [];
  const was = scrollY;
  const label = (el: Element) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`;
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    // WebKit gives a closed <details>' contents a box, though nothing of them is drawn or tappable.
    for (let d = el.parentElement?.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])')) {
      if (!d.querySelector(':scope > summary')?.contains(el)) return false;
    }
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const TAP = 'button, a[href], input:not([type=hidden]), select, textarea, summary, label.button, [role=button]';
  const bar = document.querySelector('nav.tabs');
  const taps = [...document.querySelectorAll(TAP)].filter((el) => shown(el) && !bar?.contains(el));
  const isBack = (el: Element) => el.classList.contains('back')
    || /^(‹|Back$|Back to you$|Close$|Cancel$|Done$|Skip$|×$)/.test((el.getAttribute('aria-label') ?? el.textContent ?? '').trim());

  // No sideways scroll, and nothing pushed off the side where body's overflow clip would hide it.
  if (document.documentElement.scrollWidth > innerWidth) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${innerWidth}`);
  for (const el of document.body.querySelectorAll('*')) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= innerWidth + 0.5 && r.left >= -0.5) continue;
    let clipped = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') { clipped = true; break; }
    if (!clipped) out.push(`off the side: ${label(el)} ${Math.round(r.left)}–${Math.round(r.right)}`);
  }

  // iOS zooms the page into a field under 16px when it's focused, and stays zoomed after: the fixed tab bar and status
  // backdrop then sit wherever the zoom left them. Every field you type in or pick from is 16px or more (a checkbox,
  // radio or slider takes no focus zoom).
  for (const el of document.querySelectorAll('input:not([type=hidden], [type=checkbox], [type=radio], [type=range]), select, textarea')) {
    if (!shown(el)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 16) out.push(`field under 16px (iOS zooms on focus): ${label(el)} ${size}px`);
  }

  // At the top: the heading, Back and everything else tappable clear the status bar.
  scrollTo(0, 0);
  const h1 = [...document.querySelectorAll('h1')].find(shown);
  if (h1 && h1.getBoundingClientRect().top < top) out.push(`heading under the status bar: ${label(h1)} at ${Math.round(h1.getBoundingClientRect().top)}`);
  // A heading is read whole: an ellipsis on it (Today's date, "Fri, O…") hides what the screen is.
  for (const h of document.querySelectorAll('h1')) if (shown(h) && h.scrollWidth > h.clientWidth + 0.5) out.push(`heading cut off: ${label(h)} ${h.scrollWidth} > ${h.clientWidth}`);
  for (const el of taps) {
    const r = el.getBoundingClientRect();
    if (r.bottom > 0 && r.top < top - 0.5) out.push(`tappable under the status bar: ${label(el)} at ${Math.round(r.top)}`);
    if (isBack(el) && (r.height < 44 || r.width < 44)) out.push(`back/close smaller than 44px: ${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }

  // At the bottom: the last of the page scrolls clear of the tab bar and of any sheet docked above it (the rest timer,
  // the walkthrough), the sheets sit on the bar, and the bar clears the home indicator.
  scrollTo(0, document.documentElement.scrollHeight);
  const barTop = bar ? bar.getBoundingClientRect().top : innerHeight - bottom;
  if (bar) for (const b of bar.querySelectorAll('button')) {
    if (b.getBoundingClientRect().bottom > innerHeight - bottom + 0.5) out.push(`tab over the home indicator: ${label(b)}`);
  }
  const sheets = [...document.body.querySelectorAll('*')].filter((el) => el !== bar && shown(el) && getComputedStyle(el).position === 'fixed'
    && getComputedStyle(el).pointerEvents !== 'none' && el.getBoundingClientRect().top > innerHeight / 2);
  for (const s of sheets) if (s.getBoundingClientRect().bottom > barTop + 0.5) out.push(`sheet over the ${bar ? 'tab bar' : 'home indicator'}: ${label(s)}`);
  const floor = Math.min(barTop, ...sheets.map((s) => s.getBoundingClientRect().top));
  for (const el of taps) {
    if (sheets.some((s) => s.contains(el))) continue;
    const r = el.getBoundingClientRect();
    if (r.top < innerHeight && r.bottom > floor + 0.5) out.push(`tappable under the ${floor < barTop ? 'sheet' : bar ? 'tab bar' : 'home indicator'}: ${label(el)} ${Math.round(r.top)}–${Math.round(r.bottom)}, floor ${Math.round(floor)}`);
  }
  scrollTo(0, was); // back where it was, so the screenshot shows what the person sees
  return out;
}

const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/**
 * What sits under (or over) the element at any point of the page's scroll: a button floating over the page covers
 * whatever scrolls beneath it, which a check at the top and the bottom alone never sees. Fixed chrome (the tab bar, the
 * status backdrop) is left out: the page scrolls under that by design, with room at the bottom to clear it.
 */
function coveredAtAnyScroll(sel: string) {
  const el = document.querySelector(sel);
  if (!el) return [`${sel} not found`];
  const fixed = (x: Element) => { for (let p: Element | null = x; p; p = p.parentElement) if (getComputedStyle(p).position === 'fixed') return true; return false; };
  const LABELLED = 'button, a[href], input:not([type=hidden]), select, textarea, summary, label, h1, h2, h3, [aria-label], [role=button]';
  const out = new Set<string>();
  const was = scrollY;
  for (let y = 0; y <= document.documentElement.scrollHeight - innerHeight + 24; y += 24) {
    scrollTo(0, y);
    const r = el.getBoundingClientRect();
    for (const o of document.querySelectorAll(LABELLED)) {
      if (o === el || o.contains(el) || el.contains(o) || (fixed(o) && !fixed(el))) continue;
      const q = o.getBoundingClientRect();
      if (q.width && q.height && q.left < r.right - 0.5 && q.right > r.left + 0.5 && q.top < r.bottom - 0.5 && q.bottom > r.top + 0.5) {
        out.add(`${o.tagName.toLowerCase()} "${(o.getAttribute('aria-label') ?? o.textContent ?? '').trim().slice(0, 30)}"`);
      }
    }
  }
  scrollTo(0, was);
  return [...out];
}

/** The screen at every size: no problems, and a screenshot of each to look at. */
async function check(page: Page, name: string, app = true) {
  await page.locator(app ? 'main.screen:visible' : 'h1:visible').first().waitFor();
  // The rewrite reached the page, or the whole check is measuring a phone with no notch.
  if (app) expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sat').trim())).toBe(`${TOP}px`);
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await frames(page);
    // Polled: a spotlight that follows a resize gets a frame or two to catch up; a real problem stays.
    await expect.poll(() => page.evaluate(problems, { top: TOP, bottom: BOTTOM }), { message: `${name} at ${width}×${height}`, timeout: 2000 }).toEqual([]);
    await frames(page);
    await page.screenshot({ path: `${SHOTS}/${name}-${width}.png` });
  }
  await page.setViewportSize({ width: 375, height: 812 });
}

const addLift = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name, exact: true }).click();
};
const back = (page: Page, name = '‹ More') => page.getByRole('button', { name, exact: true }).click();

const row = (page: Page, name: string) => page.getByRole('list', { name: 'More screens' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
/** A notched phone with some history on it, left on More. */
async function start(page: Page) {
  test.setTimeout(120_000);
  await notched(page);
  await page.goto('/');
  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
}

test('Today on a new phone fits each phone', async ({ page }) => {
  await notched(page);
  await page.goto('/');
  await check(page, 'today-empty');
});

test('Today’s date heading fits each phone, on a long date and on a past year’s', async ({ page }) => {
  await notched(page);
  await page.clock.install({ time: new Date('2026-09-30T12:00:00') }); // Wed, Sep 30: wide letters, two-digit day
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Wed, Sep 30', level: 1 })).toBeVisible();
  await check(page, 'today-long-date');
  await page.clock.setSystemTime(new Date('2026-01-01T12:00:00'));
  await page.reload();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByRole('heading', { name: 'Dec 31, 2025', level: 1 })).toBeVisible();
  await check(page, 'today-past-year');
});

test('More and every screen it opens fit each phone', async ({ page }) => {
  await start(page);
  await check(page, 'more');
  await row(page, 'Characters');
  await expect(page.locator('.char canvas').first()).toBeVisible();
  await check(page, 'characters');
  await back(page);
  await row(page, 'Photos');
  await check(page, 'photos');
  await back(page);
  await page.getByRole('button', { name: 'Paste from notes' }).click();
  await check(page, 'paste');
  await page.getByLabel('Workout notes').fill('9/28/26\nBench: 135x8 felt heavy\n9/29/26 Row 100x10\nCurl 30x10\nTreadmill 20 min 1.2 mi');
  await page.getByRole('button', { name: 'Read notes' }).click();
  await check(page, 'paste-review');
  await page.getByRole('button', { name: '‹ Edit the text' }).click();
  await back(page);
});

test('the Friends tab fits each phone, signed out', async ({ page }) => {
  await start(page);
  await goto(page, 'Friends');
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Friends', exact: true })).toHaveAttribute('aria-current', 'page');
  await check(page, 'friends-signed-out');
});

test('Gym and Program fit each phone', async ({ page }) => {
  await start(page);
  await goto(page, 'Gym');
  await check(page, 'gym-empty');
  await page.getByRole('button', { name: 'Add gym', exact: true }).click();
  await page.getByLabel('Gym name').fill('Garage Gym With A Long Name Downtown');
  await page.getByRole('button', { name: 'Full gym: tick all gear' }).click();
  await check(page, 'gym');
  await page.getByRole('button', { name: '+ Add gym' }).click();
  await page.getByLabel('Gym name').fill('Hotel');
  await page.getByRole('group', { name: 'Active gym' }).getByRole('button', { name: /^Garage/ }).click();
  await goto(page, 'Today');
  await expect(page.getByRole('button', { name: /^at Garage/ })).toBeVisible();
  await check(page, 'today-gym-line');

  await goto(page, 'More');
  await row(page, 'Program');
  await check(page, 'program-builder');
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A/ })).toBeVisible();
  await check(page, 'program');
  await page.locator('details.builder summary').click();
  await check(page, 'program-rebuild');
  await page.getByRole('button', { name: 'Change' }).click();
  await check(page, 'program-gym');
});

test('Today with a plan, its forms and editors, History, Lifts and Stats fit each phone', async ({ page }) => {
  await start(page);
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Build program' }).click();
  await expect(page.getByRole('heading', { name: /^Day A/ })).toBeVisible();
  await goto(page, 'Today');
  await check(page, 'today-plan');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await check(page, 'picker');
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await page.getByRole('textbox', { name: 'Weight' }).first().fill('135');
  await page.getByRole('textbox', { name: 'Reps' }).first().fill('8');
  await check(page, 'today-form');
  await page.getByRole('button', { name: 'Details' }).first().click();
  await check(page, 'today-form-more');
  await page.getByRole('button', { name: 'Add set' }).first().click();
  await expect(page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.locator('.rest-timer')).toBeVisible();
  await check(page, 'today-rest-timer');
  await page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('button').first().click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await check(page, 'set-editor');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await addLift(page, 'Treadmill');
  const tread = page.locator('[data-card="treadmill"]');
  await tread.getByRole('button', { name: 'Log cardio' }).click();
  await tread.getByRole('list', { name: 'Sessions for Treadmill' }).getByRole('button').first().click();
  await expect(tread.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await check(page, 'cardio-editor');
  await tread.getByRole('button', { name: 'Cancel', exact: true }).click();

  await goto(page, 'History');
  await check(page, 'history');
  await goto(page, 'Lifts');
  await check(page, 'lifts');
  await page.getByRole('button', { name: /Bench Press/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Bench Press', level: 1 })).toBeVisible();
  await check(page, 'exercise');
  await back(page, '‹ Back');
  await goto(page, 'Stats');
  await check(page, 'stats');
});

test('the walkthrough fits each phone on every card', async ({ page }) => {
  await notched(page);
  await page.goto('/');
  await goto(page, 'More');
  await page.getByRole('button', { name: 'Show walkthrough' }).click();
  const sheet = page.getByRole('dialog', { name: 'Walkthrough' });
  for (let n = 1; n <= 5; n++) {
    await expect(sheet).toContainText(`${n} of 5`);
    await check(page, `walkthrough-${n}`);
    if (n < 5) await sheet.getByRole('button', { name: 'Next' }).click();
  }
});

// A friend's screens need two accounts on the local emulators. Synthetic users only.
async function person(browser: Browser, bench = false) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 375, height: 812 },
    storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
  const page = await ctx.newPage();
  await notched(page);
  await page.goto('/');
  if (bench) {
    await addLift(page, 'Bench Press');
    await page.getByRole('textbox', { name: 'Weight' }).first().fill('135');
    await page.getByRole('textbox', { name: 'Reps' }).first().fill('8');
    await page.getByRole('button', { name: 'Add set' }).first().click();
  }
  const name = `u${Math.random().toString(36).slice(2, 10)}`;
  await goto(page, 'Friends');
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  const account = page.getByRole('region', { name: 'Account' });
  await account.getByRole('textbox', { name: 'Email' }).fill(`${name}@test.local`);
  await account.getByLabel('Password').fill('synthetic-pass-1');
  await account.getByRole('button', { name: 'Create account' }).click();
  await expect(account.getByRole('status')).toHaveText(/^Synced/);
  await goto(page, 'Friends');
  const friends = page.getByRole('region', { name: 'Friends', exact: true });
  await friends.getByRole('textbox', { name: 'Username' }).fill(name);
  await friends.getByRole('button', { name: 'Save username' }).click();
  await expect(friends).toContainText(`You’re @${name}`);
  return { page, name, friends };
}

test('Friends and a friend’s view fit each phone', async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await person(browser, true);
  const b = await person(browser);
  await a.friends.getByRole('button', { name: 'Make an invite link' }).click();
  const link = await a.friends.getByRole('textbox', { name: 'Your invite link' }).inputValue();
  await check(a.page, 'friends-invite-link');
  await b.page.goto(link);
  await check(b.page, 'friends-invite');
  await b.friends.getByRole('region', { name: 'Invite' }).getByRole('button', { name: 'Accept' }).click();
  await expect(b.friends.getByRole('status')).toHaveText(/are now friends/);
  await check(b.page, 'friends');
  // With fewer than three friends there's an Invite button: nothing you can read or tap is ever under it.
  await expect(b.page.getByRole('button', { name: 'Invite a friend' })).toBeVisible();
  for (const [width, height] of SIZES) {
    await b.page.setViewportSize({ width, height });
    await frames(b.page);
    expect(await b.page.evaluate(coveredAtAnyScroll, '.crew-invite, .crew-fab'), `under Invite at ${width}×${height}`).toEqual([]);
  }
  await b.page.setViewportSize({ width: 375, height: 812 });
  await b.page.getByRole('region', { name: 'Crew' }).getByRole('button', { name: `@${a.name}`, exact: true }).click();
  await expect(b.page.getByRole('region', { name: 'Viewing a friend' })).toBeVisible();
  await check(b.page, 'friend-stats');
  await goto(b.page, 'History');
  await check(b.page, 'friend-history');
  await goto(b.page, 'Lifts');
  await check(b.page, 'friend-lifts');
  await b.page.getByRole('button', { name: /Bench Press/ }).click();
  await check(b.page, 'friend-exercise');
});

test('the accessory placer fits each phone, its Back clear of the notch', async ({ page }) => {
  await notched(page);
  await page.goto('tools/accessory-placer.html');
  await expect(page.getByRole('heading', { name: 'Accessory Placer' })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).paddingTop)).toBe(`${TOP + 12}px`);
  await check(page, 'accessory-placer', false);
});
