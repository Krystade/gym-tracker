import { expect, test, type Locator, type Page } from '@playwright/test';
import { FRAMES } from '../src/domain/buddies/anchors';
import { wearFor, wearFromMarks } from '../src/domain/buddies/wear';

// The accessory placer (public/tools/accessory-placer.html) by touch, on the phone's engine with a touchscreen: a drag moves the
// item as far as the finger goes from wherever it went down (never jumping under it), Mirror flips it and keeps it, a two-finger
// twist tilts it on past a half turn and a spread sizes it, its shape kept. The touches are pointer events made by hand, as
// Playwright's touchscreen only taps. And its guesses: learned from one buddy's mark, the very numbers the app draws.

type Pt = [number, number];
/** Touch pointers on the canvas: each finger's path in css px from its top left, all down, moved a step at a time, all up. */
const fingers = (cv: Locator, paths: Pt[][]) => cv.evaluate((el, paths) => {
  const r = el.getBoundingClientRect();
  const send = (type: string, i: number, [x, y]: Pt) => el.dispatchEvent(new PointerEvent(type, {
    pointerId: 20 + i, pointerType: 'touch', isPrimary: i === 0, clientX: r.left + x, clientY: r.top + y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true,
  }));
  paths.forEach((p, i) => send('pointerdown', i, p[0]));
  for (let s = 1; s < paths[0].length; s++) paths.forEach((p, i) => send('pointermove', i, p[s]));
  paths.forEach((p, i) => send('pointerup', i, p[p.length - 1]));
}, paths);
/** Birb's first idle frame in the Held slot, as saved. */
const held = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('acc-marks') ?? '{}').held?.ckbirb?.idle?.[0]);
const picture = (cv: Locator) => cv.evaluate((el: HTMLCanvasElement) => el.toDataURL());
/** Open a buddy from the list, found by its name. */
async function open(page: Page, name: string) {
  await page.getByRole('button', { name: 'Buddies', exact: true }).tap();
  await page.getByRole('searchbox', { name: /Find a buddy/ }).fill(name);
  await page.locator('#names').getByRole('button', { name: new RegExp(`^${name}`) }).tap();
  await expect(page.locator('#cname')).toHaveText(name);
}

test('the placer by touch: a drag keeps its offset, Mirror flips and keeps, a twist tilts past a half turn', async ({ page }) => {
  await page.goto('tools/accessory-placer.html');
  await expect(page.locator('#heldItem')).toHaveValue('d120');
  await open(page, 'Tupip'); // the Birb
  await expect(page.locator('#fno')).toHaveText('Frame 1 of 4');
  await expect(page.locator('#state')).toHaveText('Head anchor');
  const cv = page.locator('#cv');
  // Canvas px a character pixel, where the frame's top left is, and css px a canvas px: a character pixel to css px from the canvas.
  const g = await cv.evaluate((el: HTMLCanvasElement) => ({ s: Number(el.dataset.s), o: Number(el.dataset.o), k: el.getBoundingClientRect().width / el.width }));
  const css = ([x, y]: Pt): Pt => [(g.o + x * g.s) * g.k, (g.o + y * g.s) * g.k];
  // Room all round: the frame in the middle of the stage, not on its floor.
  const size = (await cv.boundingBox())!;
  expect(css([0, 16])[1]).toBeLessThan(size.height - 9 * g.s * g.k);
  // Unplaced, the sword is where the app draws it: its base on the head anchor, a pixel into the head.
  const [hx, hy] = FRAMES.ckbirb.head[0], base: Pt = [hx, hy + 1];

  // From 40 × 30 css px off the sword's base, 6 character pixels right and 4 down: the sword moves 6 and 4, the gap kept.
  const at = css(base), down: Pt = [at[0] + 40, at[1] + 30];
  await fingers(cv, [Array.from({ length: 7 }, (_, i): Pt => [down[0] + (6 * g.s * g.k * i) / 6, down[1] + (4 * g.s * g.k * i) / 6])]);
  await expect.poll(() => held(page)).toMatchObject({ x: base[0] + 6, y: base[1] + 4, r: 0, f: false });
  const placed = await held(page);
  await expect(page.locator('#state')).toHaveText('Set by you');

  // Mirror: drawn the other way round, saved, and still mirrored after a reload; again, back.
  const mirror = page.getByRole('button', { name: 'Mirror' });
  const plain = await picture(cv);
  await mirror.tap();
  await expect(mirror).toHaveAttribute('aria-pressed', 'true');
  expect(await held(page)).toEqual({ ...placed, f: true });
  expect(await picture(cv)).not.toBe(plain);
  await page.reload();
  await expect(page.locator('#fno')).toHaveText('Frame 1 of 4');
  await expect(mirror).toHaveAttribute('aria-pressed', 'true');
  await mirror.tap();
  await expect(mirror).toHaveAttribute('aria-pressed', 'false');
  expect(await held(page)).toEqual(placed);
  await expect.poll(() => picture(cv)).toBe(plain);
  await mirror.tap();

  // Tilt 170°, then a two-finger twist of 30° (the fingers' line through 180° on the way): 200°, a turn round as -160°.
  const tilt = page.getByRole('spinbutton', { name: 'Tilt in degrees' });
  await tilt.fill('170');
  await tilt.press('Enter');
  await expect.poll(() => held(page).then((m) => m.r)).toBe(170);
  const box = (await cv.boundingBox())!, c: Pt = [box.width / 2, box.height / 2];
  const ring = (deg: number, side: number, rad = 60): Pt => [c[0] + side * rad * Math.cos((deg * Math.PI) / 180), c[1] + side * rad * Math.sin((deg * Math.PI) / 180)];
  const twist = Array.from({ length: 7 }, (_, i) => -15 + i * 5); // the second finger from the first: 165° to 195°
  await fingers(cv, [twist.map((a) => ring(a, 1)), twist.map((a) => ring(a, -1))]);
  await expect.poll(() => held(page)).toMatchObject({ x: placed.x, y: placed.y, w: placed.w, h: placed.h, r: -160, f: true });
  await expect(tilt).toHaveValue('-160');
  await expect(page.locator('#tilt')).toHaveValue('-160');

  // Spread from 40 to 80 css px apart: twice the size both ways, tilt and place kept.
  const spread = [40, 50, 60, 70, 80];
  await fingers(cv, [spread.map((r) => ring(0, 1, r)), spread.map((r) => ring(0, -1, r))]);
  await expect.poll(() => held(page)).toMatchObject({ x: placed.x, y: placed.y, w: placed.w * 2, h: placed.h * 2, r: -160 });
  // Width alone: the height stays.
  const wide = page.getByRole('spinbutton', { name: 'Width in pixels' });
  await wide.fill('5');
  await wide.press('Enter');
  await expect.poll(() => held(page)).toMatchObject({ w: 5, h: placed.h * 2 });
});

test('guesses: one goat’s mark teaches the others, Accept keeps the app’s own numbers, and a Tiny buddy goes pose by pose', async ({ page }) => {
  await page.goto('tools/accessory-placer.html');
  const seed = { held: { ckbrown: { idle: { 0: { x: 7.5, y: 2, w: 9, h: 7, r: 20, f: true } } } }, head: { ckbrown: { idle: { 0: { x: 1, y: 1, w: 3 } } } } };
  await page.evaluate((m) => localStorage.setItem('acc-marks', JSON.stringify(m)), seed);
  await page.reload();
  // The white goat, never placed: a guess from Moko (the brown one), in the guess colour.
  await open(page, 'Lumi');
  await expect(page.locator('#state')).toHaveText('Guess');
  await expect(page.locator('#why')).toContainText('learned from Moko');
  expect(await page.locator('#state').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(250, 147, 78)');
  // Accept: saved as the app would draw it, to the hundredth; the next frame then follows it, moved with the head.
  await page.getByRole('button', { name: 'Accept ›' }).tap();
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('acc-marks') ?? '{}'));
  let m = await saved();
  expect(m.held.ckwhite.idle[0]).toEqual(wearFor(wearFromMarks(seed), 'ckwhite', 0));
  await expect(page.locator('#fno')).toHaveText('Frame 2 of 4');
  await expect(page.locator('#why')).toContainText('its other frames');
  // Accept all for this buddy: every frame, each as the app guesses it from what's set.
  const before = wearFromMarks(m);
  await page.getByRole('button', { name: 'Accept all for this buddy' }).tap();
  m = await saved();
  for (const f of [1, 2, 3]) expect(m.held.ckwhite.idle[f], `frame ${f}`).toEqual(wearFor(before, 'ckwhite', f));
  await expect(page.locator('#cmeta')).toContainText('4 of 4 set');
  // The old stand-in slot's mark is kept, untouched.
  expect(m.head).toEqual(seed.head);
  // Nothing like a truck is placed, and none of its pack: the head anchor.
  await open(page, 'Tubo');
  await expect(page.locator('#state')).toHaveText('Head anchor');
  // A Tiny buddy of four poses: placed pose by pose, saved under its poses.
  await open(page, 'Bosy');
  await expect(page.locator('#fno')).toHaveText('Pose 1 of 4');
  await page.getByRole('button', { name: 'Right' }).tap();
  await expect.poll(() => saved().then((x) => Object.keys(x.held.d090?.poses ?? {}))).toEqual(['0']);
});
