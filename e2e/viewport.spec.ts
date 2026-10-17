import { expect, test, type Page } from '@playwright/test';

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
