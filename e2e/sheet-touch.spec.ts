import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { drag, mid } from './finger';
import { notched } from './layout';
import { goto } from './nav';

// Every bottom sheet (ui/useSheet), on a buddy's: a swipe down closes it from its head or its body at the top, never from
// one mostly sideways or from the body scrolled down; the page behind can't be dragged; and holding a buddy or a button selects
// nothing (owner's 13 mini, 2026-11-12). Touches are synthetic here: what iOS itself does with a real finger can't be run.
const SHOTS = 'screenshots/sheet-touch';
mkdirSync(SHOTS, { recursive: true });
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

test('a buddy sheet closes on a swipe down, holds the page still, and nothing in the app selects on a long press', async ({ page }) => {
  await notched(page);
  await page.goto('/');
  await goto(page, 'Buddies');
  const offer = page.getByRole('group', { name: 'Your first buddy' }).getByRole('button');
  const first = (await offer.first().locator('b').textContent())!;
  await offer.first().click();
  await page.getByRole('button', { name: `Pick ${first}` }).click();
  await expect(page.getByRole('region', { name: `${first}’s card` })).toBeVisible();

  // Long-press: chrome, cards and sprites select nothing, and no double tap zooms. (The callout and the tap flash are iOS-only
  // properties this WebKit drops, so they can't be read back here.)
  const css = (sel: string) => page.locator(sel).first().evaluate((el) => {
    const s = getComputedStyle(el) as CSSStyleDeclaration & Record<string, string>;
    return `${s.webkitUserSelect || s.userSelect} | ${s.touchAction}`;
  });
  for (const sel of ['h1', '.bu-hero img', '.bu-hero', 'button', '.tabs']) expect(await css(sel), sel).toBe('none | manipulation');

  const get = page.getByRole('region', { name: 'Get more' }).getByRole('button', { name: /^Pull/ });
  const sheet = page.getByRole('dialog', { name: /^(Pull|Choose one)$/ }); // named for its mode
  await get.click();
  await expect(sheet).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/pull-sheet.png` });
  const head = sheet.locator('.sheet-head');
  const body = sheet.locator('.bu-sheet-body').first();
  // The page behind: a drag on the dim, or on the head, is refused; the root can't scroll.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe('hidden');
  expect(await drag(page.locator('.sheet-backdrop'), { x: 180, y: 20 }, 0, -200)).toEqual(Array(6).fill(true));
  expect(await drag(head, await mid(head), 0, -150)).toEqual(Array(6).fill(true));
  // Mostly sideways is no close.
  await drag(head, await mid(head), 160, 60);
  await expect(sheet).toBeVisible();
  // From the head, down: closed.
  await drag(head, await mid(head), 0, 150);
  await expect(sheet).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).not.toBe('hidden');

  // The body (Choose: every buddy, longer than the screen): scrolled down, a swipe down scrolls it (not ours, not refused); at
  // its top, it closes the sheet.
  await get.click();
  await sheet.getByRole('button', { name: 'Choose', exact: true }).click();
  await expect(sheet).toHaveAccessibleName('Choose one');
  await page.screenshot({ path: `${SHOTS}/choose-sheet.png` });
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight + 1), 'its body scrolls').toBe(true);
  await body.evaluate((el) => { el.scrollTop = 80; });
  expect(await drag(body, await mid(body), 0, 150)).toEqual(Array(6).fill(false));
  await expect(sheet).toBeVisible();
  await body.evaluate((el) => { el.scrollTop = 0; });
  await drag(body, await mid(body), 0, 150);
  await expect(sheet).toHaveCount(0);
});
