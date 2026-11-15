import { expect, test, type Locator, type Page } from '@playwright/test';
import { over, WEAR, wearFor, wearFromMarks, type Wear } from '../src/domain/buddies/wear';

// The accessory placer (public/tools/accessory-placer.html) by touch, on the phone's engine with a touchscreen: a drag moves the
// item as far as the finger goes from wherever it went down (never jumping under it), Mirror flips it and keeps it, a two-finger
// twist tilts it on past a half turn and a spread sizes it, its shape kept. The touches are pointer events made by hand, as
// Playwright's touchscreen only taps. It starts from the marks baked into the app (domain/buddies/marks), this phone's own over
// them frame by frame; its guesses fill the rest, the very numbers the app draws.

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
  // Baked into the app: shown as set, and there's nothing of this phone's to drop.
  await expect(page.locator('#state')).toHaveText('Set by you');
  await expect(page.locator('#why')).toHaveText('Set by you, and in the app for everyone.');
  const back = page.locator('#reset');
  await expect(back).toHaveText('Back to the app’s');
  await expect(back).toBeDisabled();
  const cv = page.locator('#cv');
  // Canvas px a character pixel, where the frame's top left is, and css px a canvas px: a character pixel to css px from the canvas.
  const g = await cv.evaluate((el: HTMLCanvasElement) => ({ s: Number(el.dataset.s), o: Number(el.dataset.o), k: el.getBoundingClientRect().width / el.width }));
  const css = ([x, y]: Pt): Pt => [(g.o + x * g.s) * g.k, (g.o + y * g.s) * g.k];
  // Room all round: the frame in the middle of the stage, not on its floor.
  const size = (await cv.boundingBox())!;
  expect(css([0, 16])[1]).toBeLessThan(size.height - 9 * g.s * g.k);
  // The sword where the app draws it: its baked mark.
  const baked = WEAR.ckbirb[0], base: Pt = [baked.x, baked.y], half = (v: number) => Math.round(v * 2) / 2;

  // From 40 × 30 css px off the sword's base, 6 character pixels right and 4 down: the sword moves 6 and 4, the gap kept.
  const at = css(base), down: Pt = [at[0] + 40, at[1] + 30];
  await fingers(cv, [Array.from({ length: 7 }, (_, i): Pt => [down[0] + (6 * g.s * g.k * i) / 6, down[1] + (4 * g.s * g.k * i) / 6])]);
  await expect.poll(() => held(page)).toMatchObject({ x: half(base[0] + 6), y: half(base[1] + 4), w: baked.w, h: baked.h, r: baked.r, f: baked.f });
  const placed = await held(page);
  await expect(page.locator('#state')).toHaveText('Set by you');
  await expect(page.locator('#why')).toContainText('the app has your earlier mark');
  await expect(back).toBeEnabled();

  // Mirror: drawn the other way round, saved, and still mirrored after a reload; again, back.
  const mirror = page.getByRole('button', { name: 'Mirror' });
  const plain = await picture(cv);
  await mirror.tap();
  await expect(mirror).toHaveAttribute('aria-pressed', 'true');
  expect(await held(page)).toEqual({ ...placed, f: !baked.f });
  expect(await picture(cv)).not.toBe(plain);
  await page.reload();
  await expect(page.locator('#fno')).toHaveText('Frame 1 of 4');
  await expect(mirror).toHaveAttribute('aria-pressed', String(!baked.f));
  await mirror.tap();
  await expect(mirror).toHaveAttribute('aria-pressed', String(baked.f));
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
  await expect.poll(() => held(page)).toMatchObject({ x: placed.x, y: placed.y, w: placed.w, h: placed.h, r: -160, f: !baked.f });
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

  // Back to the app's: this phone's mark dropped, the baked one showing again.
  await back.tap();
  await expect.poll(() => held(page)).toBeUndefined();
  await expect(page.locator('#why')).toHaveText('Set by you, and in the app for everyone.');
  await expect(tilt).toHaveValue(String(baked.r));
});

test('guesses: learned from the marks, Accept keeps the app’s own numbers, this phone’s marks win frame by frame, and Copy sends all', async ({ page }) => {
  await page.goto('tools/accessory-placer.html');
  const seed = { held: { ckbrown: { idle: { 0: { x: 7.5, y: 2, w: 9, h: 7, r: 20, f: true } } } }, head: { ckbrown: { idle: { 0: { x: 1, y: 1, w: 3 } } } } };
  await page.evaluate((m) => localStorage.setItem('acc-marks', JSON.stringify(m)), seed);
  await page.reload();
  // What the app draws with this phone's marks: its own over the baked ones, frame by frame.
  const drawn = (m: unknown) => over(WEAR, wearFromMarks(m));
  // As Accept saves a guess: to the hundredth (one moved with the head can carry float dust, 23.09 + 44 - 44).
  const cents = (w: Wear | null) => w && { ...w, x: Math.round(w.x * 100) / 100, y: Math.round(w.y * 100) / 100 };
  // Mr. Dude, never placed: a guess learned from the marks, in the guess colour.
  await open(page, 'Mr. Dude');
  await expect(page.locator('#state')).toHaveText('Guess');
  await expect(page.locator('#why')).toContainText('learned from');
  expect(await page.locator('#state').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(250, 147, 78)');
  await expect(page.locator('#reset')).toHaveText('Back to guess');
  // Accept: saved as the app would draw it, to the hundredth; the next frame then follows it, moved with the head.
  await page.getByRole('button', { name: 'Accept ›' }).tap();
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('acc-marks') ?? '{}'));
  let m = await saved();
  expect(m.held.dudemr.idle[0]).toEqual(cents(wearFor(drawn(seed), 'dudemr', 0)));
  await expect(page.locator('#fno')).toHaveText('Frame 2 of 14');
  await expect(page.locator('#why')).toContainText('its other frames');
  // Accept all for this buddy: every frame, each as the app guesses it from what's set.
  const before = drawn(m);
  await page.getByRole('button', { name: 'Accept all for this buddy' }).tap();
  m = await saved();
  for (let f = 1; f < 14; f++) expect(m.held.dudemr.idle[f], `frame ${f}`).toEqual(cents(wearFor(before, 'dudemr', f)));
  await expect(page.locator('#cmeta')).toContainText('14 of 14 set');
  // The old stand-in slot's mark is kept, untouched; the baked marks stay out of this phone's own.
  expect(m.head).toEqual(seed.head);
  expect(m.held.c017).toBeUndefined();
  // The brown goat: this phone's mark on its first frame, the baked one on the next.
  await open(page, 'Moko');
  const tilt = page.getByRole('spinbutton', { name: 'Tilt in degrees' });
  await expect(page.locator('#why')).toContainText('the app has your earlier mark');
  await expect(tilt).toHaveValue('20');
  await page.getByRole('button', { name: 'Next frame' }).tap();
  await expect(page.locator('#why')).toHaveText('Set by you, and in the app for everyone.');
  await expect(tilt).toHaveValue(String(WEAR.ckbrown[1].r));
  // A Tiny buddy of four poses, baked: a nudge saves that pose alone, under its poses, a pixel on from the app's.
  await open(page, 'Bosy');
  await expect(page.locator('#fno')).toHaveText('Pose 1 of 4');
  await expect(page.locator('#state')).toHaveText('Set by you');
  await page.getByRole('button', { name: 'Right' }).tap();
  await expect.poll(() => saved().then((x) => Object.keys(x.held.d090?.poses ?? {}))).toEqual(['0']);
  expect((await saved()).held.d090.poses[0]).toMatchObject({ x: WEAR.d090[0].x + 1, y: WEAR.d090[0].y });
  // Copy: everything, the baked marks with this phone's over them.
  await page.getByText('Send my marks to Claude').tap();
  await page.getByRole('button', { name: 'Copy my marks' }).tap();
  const copy = JSON.parse(await page.locator('#bk').inputValue());
  expect(copy.held.c017.poses[0]).toEqual(WEAR.c017[0]);
  expect(copy.held.d090.poses).toMatchObject({ 0: { x: WEAR.d090[0].x + 1 }, 1: WEAR.d090[1] });
  expect(copy.held.ckbrown.idle[0]).toEqual(seed.held.ckbrown.idle[0]);
  expect(copy.head).toEqual(seed.head);
  expect(wearFromMarks(copy)).toEqual(drawn(await saved()));
});
