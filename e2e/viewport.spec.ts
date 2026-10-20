import { expect, test, type Page } from '@playwright/test';
import { goto } from './nav';

// The fixed chrome on an iPhone after a picker or keyboard: the owner's 13 mini showed the tab bar halfway up the screen
// with the page below it, and a time input's "6:00 PM" over the clock. iOS 26 leaves visualViewport offset from the
// layout viewport once the keyboard closes and says nothing (src/ui/viewportPin.ts). WebKit on a desktop has no
// keyboard, so each test drives a stand-in visualViewport the way the phone's behaves.
const TOP = 47, BOTTOM = 34;
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

/** window.visualViewport replaced before the app loads; window.__vv(patch, fire) moves it, firing resize or not. */
async function fakeViewport(page: Page) {
  await page.addInitScript(() => {
    const st: { offsetTop: number; height: number | null; scale: number } = { offsetTop: 0, height: null, scale: 1 };
    const vv = new EventTarget();
    const get = (f: () => number) => ({ get: f, configurable: true });
    Object.defineProperties(vv, {
      offsetTop: get(() => st.offsetTop), offsetLeft: get(() => 0), pageTop: get(() => scrollY + st.offsetTop), pageLeft: get(() => scrollX),
      height: get(() => st.height ?? innerHeight), width: get(() => innerWidth), scale: get(() => st.scale),
    });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    (window as unknown as { __vv: (p: Partial<typeof st>, fire?: boolean) => void }).__vv = (p, fire = true) => {
      Object.assign(st, p);
      if (fire) vv.dispatchEvent(new Event('resize'));
    };
  });
}
const vv = (page: Page, patch: { offsetTop?: number; height?: number | null }, fire = true) =>
  page.evaluate(([p, f]) => (window as unknown as { __vv: (p: object, f: boolean) => void }).__vv(p, f), [patch, fire] as const);
const box = (page: Page, sel: string) => page.evaluate((s) => { const r = document.querySelector(s)!.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }, sel);

/** Today with Bench Press's form open at Details → Did this earlier?, its When field showing, and page to scroll. */
async function whenField(page: Page) {
  await notched(page);
  await fakeViewport(page);
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sat').trim())).toBe(`${TOP}px`);
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  const bench = page.locator('[data-card="bench press"]');
  await bench.getByRole('button', { name: 'Details' }).click();
  await bench.getByRole('button', { name: 'Did this earlier?' }).click();
  const when = page.getByRole('textbox', { name: 'When' });
  await expect(when).toBeVisible();
  // Room below the form, so it can scroll up to the top of the screen (a long Today does the same).
  await page.locator('main.screen:visible').evaluate((el) => { el.style.paddingBottom = '1500px'; });
  return when;
}

test('the tab bar sits on the bottom of the screen after a time picker, closed cleanly or left stuck', async ({ page }) => {
  const when = await whenField(page);
  const H = 812;
  expect((await box(page, 'nav.tabs')).bottom).toBe(H);

  // The picker up: the visual viewport shrinks, and the bar stays where it is, behind the picker, as in any app.
  await when.focus();
  await vv(page, { height: 520 });
  await page.waitForTimeout(150);
  expect((await box(page, 'nav.tabs')).bottom).toBe(H);
  // Closed cleanly: everything back to where it was.
  await vv(page, { height: null }, false);
  await when.blur();
  await vv(page, {});
  await expect.poll(() => box(page, 'nav.tabs').then((b) => b.bottom)).toBe(H);

  // Closed and stuck (the owner's screen): the screen shows the layout from 300px down, 24px short of its height,
  // and no event says so. The bar and the status backdrop follow the screen.
  await when.focus();
  await vv(page, { height: 520 });
  await vv(page, { offsetTop: 300, height: H - 24 }, false);
  await when.blur();
  await expect.poll(() => box(page, 'nav.tabs').then((b) => b.bottom)).toBe(300 + H - 24);
  await expect.poll(() => box(page, '.status-backdrop').then((b) => [b.top, b.bottom])).toEqual([300, 300 + TOP]);
  await page.screenshot({ path: 'test-results/viewport-stuck.png' });

  // And when the phone sorts itself out, the chrome goes home.
  await vv(page, { offsetTop: 0, height: null });
  await expect.poll(() => box(page, 'nav.tabs').then((b) => b.bottom)).toBe(H);
  expect((await box(page, '.status-backdrop')).top).toBe(0);
});

/** What is drawn at (x, y) in the top inset: the backdrop is pointer-events: none, so it's let take the hit to be found. */
const topmost = (page: Page, x: number, y: number) => page.evaluate(([x, y]) => {
  const bd = document.querySelector<HTMLElement>('.status-backdrop')!;
  bd.style.pointerEvents = 'auto';
  const el = document.elementFromPoint(x, y);
  bd.style.pointerEvents = '';
  return el === bd ? 'backdrop' : `${el?.tagName.toLowerCase()} ${el?.getAttribute('aria-label') ?? ''}`.trim();
}, [x, y] as const);

test('a time field scrolled up under the status bar is covered by the backdrop, on a stuck screen too', async ({ page }) => {
  const when = await whenField(page);
  // Scroll the field until its top is 10px from the top of the screen, inside the 47px inset.
  const under = async (screenTop: number) => {
    const r = await when.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top + scrollY, x: r.left + r.width / 2 }; });
    await page.evaluate((y) => scrollTo(0, y), r.top - screenTop - 10);
    const now = await when.evaluate((el) => el.getBoundingClientRect().top);
    expect(now, 'the page scrolls far enough to put the field under the inset').toBe(screenTop + 10);
    return r.x;
  };
  // The probe finds the field when nothing covers it: the check below can tell the two apart.
  const x0 = await under(200);
  expect(await topmost(page, x0, 220)).toBe('input When');

  const x = await under(0);
  expect(await topmost(page, x, 20)).toBe('backdrop');

  await when.focus();
  await vv(page, { height: 520 });
  await vv(page, { offsetTop: 300, height: 812 - 24 }, false);
  await when.blur();
  await expect.poll(() => box(page, '.status-backdrop').then((b) => b.top)).toBe(300);
  await under(300);
  expect(await topmost(page, x, 320)).toBe('backdrop');
  await page.screenshot({ path: 'test-results/viewport-backdrop.png' });
});

test('a sticky header stays at the top of the screen when the screen is stuck below the layout', async ({ page }) => {
  await notched(page);
  await fakeViewport(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  const search = page.getByRole('searchbox', { name: 'Search exercises' });
  await expect(search).toBeFocused();
  // Scrolled down the list, the picker's head is stuck to the top of the layout.
  await page.evaluate(() => scrollTo(0, 600));
  expect(await page.evaluate(() => scrollY), 'the list scrolls far enough for the head to stick').toBe(600);
  expect((await box(page, '.picker-head')).top).toBe(0);

  // The keyboard goes and leaves the screen 300px down the layout: the head follows the screen, as the backdrop does.
  await vv(page, { height: 520 });
  await vv(page, { offsetTop: 300, height: 812 - 24 }, false);
  await search.blur();
  await expect.poll(() => box(page, '.status-backdrop').then((b) => b.top)).toBe(300);
  expect((await box(page, '.picker-head')).top).toBe(300);
  await page.screenshot({ path: 'test-results/viewport-sticky.png' });

  await vv(page, { offsetTop: 0, height: null });
  await expect.poll(() => box(page, '.picker-head').then((b) => b.top)).toBe(0);
});

test('a select still focused after its picker closes lets the chrome follow a stuck screen', async ({ page }) => {
  await notched(page);
  await fakeViewport(page);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Stats', exact: true }).click();
  const biceps = page.getByRole('combobox', { name: 'Biceps' });
  const H = 812;
  // The picker up: the screen shrinks and the bar stays put.
  await biceps.focus();
  await vv(page, { height: 420 });
  await page.waitForTimeout(150);
  expect((await box(page, 'nav.tabs')).bottom).toBe(H);
  // A pick closes it and leaves the screen stuck 200px down and short, with the select still focused and no event.
  await vv(page, { offsetTop: 200, height: 600 }, false);
  await biceps.selectOption('1');
  await expect(biceps).toBeFocused();
  await expect.poll(() => box(page, 'nav.tabs').then((b) => b.bottom)).toBe(200 + 600);
  // Focused again, it can hold a picker up once more.
  await vv(page, { offsetTop: 0, height: null });
  await expect.poll(() => box(page, 'nav.tabs').then((b) => b.bottom)).toBe(H);
  await biceps.blur();
  await biceps.focus();
  await vv(page, { height: 420 });
  await page.waitForTimeout(150);
  expect((await box(page, 'nav.tabs')).bottom).toBe(H);
});

// The owner's 13 mini on More, pulled down past the top: an empty band over "More", the tab bar about 400px up the screen
// with the page below it, and the status backdrop gone off the top. A rubber-band bounce puts the visual viewport off the
// page (above its top, or past its end at full height); that is no stuck screen, and the chrome stays on the screen edges.
test('a rubber-band bounce past the top or the end of a page leaves the tab bar and status backdrop on the screen edges', async ({ page }) => {
  await notched(page);
  await fakeViewport(page);
  await page.goto('/');
  await goto(page, 'More');
  const H = 812;
  const edges = async () => [(await box(page, '.status-backdrop')).top, (await box(page, 'nav.tabs')).bottom];
  expect(await edges()).toEqual([0, H]);
  expect(await page.evaluate(() => document.activeElement === document.body), 'no field focused, no keyboard').toBe(true);

  // Pulled down past the top, and let go: the visual viewport above the page, the event firing at every step.
  for (const d of [120, 400, 250, 60]) {
    await vv(page, { offsetTop: -d });
    expect(await edges(), `${d}px past the top`).toEqual([0, H]);
  }
  await page.screenshot({ path: 'test-results/viewport-overscroll-top.png' });
  await page.waitForTimeout(700); // the twice-a-second check has had a look too
  expect(await edges()).toEqual([0, H]);
  await vv(page, { offsetTop: 0 });

  // Pushed up past the end: at the bottom of the page, the full-height visual viewport runs past its end.
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  for (const d of [80, 300, 120]) {
    await vv(page, { offsetTop: d });
    expect(await edges(), `${d}px past the end`).toEqual([0, H]);
  }
  await page.screenshot({ path: 'test-results/viewport-overscroll-end.png' });
  await page.waitForTimeout(700);
  expect(await edges()).toEqual([0, H]);
  await vv(page, { offsetTop: 0 });

  // The stuck screen on the same page still takes the chrome with it: only the bounce is left alone.
  await vv(page, { offsetTop: 300, height: H - 24 });
  expect(await edges()).toEqual([300, 300 + H - 24]);
  await vv(page, { offsetTop: 0, height: null });
  expect(await edges()).toEqual([0, H]);
});

// Friends, against the emulators (synthetic users only). The owner's phone showed the bar mid-screen again here after typing in
// Add a friend: each test below has the screen stick where the focus and blur checks alone never look again.
const tabBottom = (page: Page) => box(page, 'nav.tabs').then((b) => b.bottom);

/** Signed up on a fresh account, on Friends at the username form. */
async function onFriends(page: Page) {
  await fakeViewport(page);
  await page.goto('/');
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
  return { name, friends, username: friends.getByRole('textbox', { name: 'Username' }) };
}
async function claimed(page: Page) {
  const f = await onFriends(page);
  await f.username.fill(f.name);
  await f.friends.getByRole('button', { name: 'Save username' }).click();
  await expect(f.friends).toContainText(`You’re @${f.name}`);
  return f;
}

test('Friends: a field taken off the page while it has the keyboard lets the bar follow a screen stuck afterwards', async ({ page }) => {
  const { name, friends, username } = await onFriends(page);
  const H = 812;
  // Typing a username, keyboard up; Go saves it and the form gives way to the card, the field still focused. WebKit says
  // nothing when a focused field leaves the page (no blur, no focusout), and the screen settles stuck with no event either.
  await username.focus();
  await vv(page, { height: 450 });
  await username.pressSequentially(name, { delay: 100 });
  await page.waitForTimeout(6000); // a while over the keyboard: every check that followed focusing is long done
  await username.press('Enter');
  await expect(friends).toContainText(`You’re @${name}`);
  expect(await page.evaluate(() => document.activeElement === document.body), 'the field went with focus on it').toBe(true);
  await vv(page, { offsetTop: 300, height: H - 24 }, false);
  await expect.poll(() => tabBottom(page)).toBe(300 + H - 24);
  await page.screenshot({ path: 'test-results/viewport-friends-removed.png' });
  // Sorted out, again with no event: the bar goes home.
  await vv(page, { offsetTop: 0, height: null }, false);
  await expect.poll(() => tabBottom(page)).toBe(H);
});

test('Friends: a screen that sticks a second after the keyboard went, with no event, still takes the bar with it', async ({ page }) => {
  const { friends } = await claimed(page);
  const H = 812;
  const theirs = friends.getByRole('textbox', { name: 'Their username' });
  await theirs.focus();
  await vv(page, { height: 450 });
  await theirs.fill('nobody_here_123');
  await theirs.press('Enter');
  await expect(friends.getByRole('alert')).toContainText('nobody_here_123');
  // The keyboard goes cleanly; the answer and the page moving under it come later, and the screen sticks then, silently.
  await theirs.blur();
  await vv(page, { height: null });
  await page.waitForTimeout(2000);
  expect(await tabBottom(page)).toBe(H);
  await vv(page, { offsetTop: 300, height: H - 24 }, false);
  await expect.poll(() => tabBottom(page)).toBe(300 + H - 24);
  await vv(page, { offsetTop: 0, height: null }, false);
  await expect.poll(() => tabBottom(page)).toBe(H);
});

test('Friends: the invite link raises no keyboard, so focused on a short stuck screen the bar still follows it', async ({ page }) => {
  const { friends } = await claimed(page);
  const H = 812;
  await friends.getByRole('button', { name: 'Make an invite link' }).click();
  const link = friends.getByRole('textbox', { name: 'Your invite link' });
  await expect(link).toHaveAttribute('readonly', '');
  await link.click();
  await expect(link).toBeFocused();
  // Short of four fifths of the screen, as a keyboard leaves it; but a read-only field can't have one up.
  await vv(page, { offsetTop: 200, height: 600 }, false);
  await expect.poll(() => tabBottom(page)).toBe(800);
  // A field that types still holds the bar behind its keyboard, as everywhere else.
  await vv(page, { offsetTop: 0, height: null });
  const theirs = friends.getByRole('textbox', { name: 'Their username' });
  await theirs.focus();
  await vv(page, { height: 450 });
  await page.waitForTimeout(700);
  expect(await tabBottom(page)).toBe(H);
});
