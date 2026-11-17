import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { FRAMES } from './anchors';
import { PLACED } from './marks';
import { BUDDIES, type BuddyDef } from './roster';
import { crop, decodePng, follow, gripBox, type Img } from './track';
import { SUPERSEDED, TRACKED } from './tracked';
import { over, unmoved, WEAR, wearFor, type Wear, type WearMap } from './wear';

// Held items on the hand in every frame (owner 2026-11-16: "fix all the animations and accessory placements for all the
// sprites"): domain/buddies/tracked, baked by scripts/track-held.mjs. The hand is measured here again from the sprites' own
// pixels (domain/buddies/track) and the marks the app draws are held to it; each bar is shown to fail on the marks as they were
// before (PLACED alone, the rest guessed), so none of them passes for want of looking.

const png = (f: string) => decodePng(readFileSync(new URL(`../../../public/buddies/${f}.png`, import.meta.url)), inflateSync);
const framesOf = (b: BuddyDef): Img[] => {
  if (!b.art) return b.poses.map(png);
  const s = png(b.id), w = b.art.w;
  return Array.from({ length: b.art.n }, (_, f) => crop(s, f * w, w));
};
const count = (b: BuddyDef) => (b.art ? b.art.n : b.poses.length);
const buddy = (id: string) => BUDDIES.find((b) => b.id === id)!;
/** Every frame's placement as the app resolves it from `marks`: its own, else the guess. */
const drawn = (marks: WearMap, b: BuddyDef) => Array.from({ length: count(b) }, (_, f) => wearFor(marks, b.id, f)!);
const grip = (w: Wear) => `${w.w} ${w.h} ${w.r} ${w.f}`;
const apart = (x: number, y: number) => Math.hypot(x, y);
/** The marks before this: his as he placed them, every other frame guessed (and Mr. Dude's all guessed). */
const BEFORE: WearMap = PLACED;

/** An older character's strip, one drawing moving: how far the item strays from the hand. `step`: the most, frame to next frame
 *  (round the loop), that the item's move differs from the hand's, the hand followed from that frame's own grip; `spread`: from
 *  the frame whose hand best explains the rest, how far apart the item's places on the hand are (0: it rides the hand exactly). */
function stray(b: BuddyDef, ws: Wear[]) {
  const fr = framesOf(b), n = fr.length, reach = Math.max(3, Math.round(Math.max(b.art!.w, b.art!.h) / 6));
  let step = 0, spread = Infinity;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n, box = gripBox(fr[k], ws[k]);
    expect(box, `${b.id} ${k}: a hand near the handle`).not.toBeNull();
    const t = follow(fr[k], fr[j], box!, reach);
    step = Math.max(step, apart(ws[j].x - ws[k].x - t.dx, ws[j].y - ws[k].y - t.dy));
  }
  for (let r = 0; r < n; r++) {
    const box = gripBox(fr[r], ws[r])!, on = fr.map((f, k) => { const t = follow(fr[r], f, box, reach); return [ws[k].x - t.dx, ws[k].y - t.dy]; });
    spread = Math.min(spread, Math.max(...on.flatMap((a) => on.map((c) => apart(a[0] - c[0], a[1] - c[1])))));
  }
  return { step, spread, grips: new Set(ws.map(grip)).size };
}
const STRIPS = BUDDIES.filter((b) => b.art && b.art.n > 1);

describe('every frame the app draws', () => {
  it('has a placement, and every frame of a buddy that moves is baked (none left to a guess)', () => {
    const frames = BUDDIES.flatMap((b) => Array.from({ length: count(b) }, (_, f) => [b.id, f] as const));
    expect(frames.length).toBe(250);
    for (const [id, f] of frames) expect(wearFor(WEAR, id, f), `${id} ${f}`).not.toBeNull();
    const moving = BUDDIES.filter((b) => count(b) > 1);
    expect(moving.map((b) => b.id).sort()).toEqual(Object.keys(TRACKED).sort());
    expect(moving.reduce((n, b) => n + count(b), 0)).toBe(106);
    for (const b of moving) for (let f = 0; f < count(b); f++) expect(WEAR[b.id]?.[f], `${b.id} ${f}`).toBeDefined();
    // Before: Mr. Dude had nothing of his own, every frame a guess.
    expect(BEFORE.dudemr).toBeUndefined();
  });
});

describe('an older character’s strip: the item rides the hand', () => {
  it('each frame’s move is the hand’s within a pixel, never a whole pixel off the hand, one size and tilt the whole strip', () => {
    expect(STRIPS.length).toBe(16);
    for (const b of STRIPS) {
      const s = stray(b, drawn(WEAR, b));
      expect(s.step, `${b.id} step`).toBeLessThanOrEqual(1 + 1e-6);
      expect(s.spread, `${b.id} spread`).toBeLessThan(1);
      expect(s.grips, `${b.id} sizes and tilts`).toBe(1);
    }
  });
  it('the same bars catch the marks as they were: Mrs. Dude’s first frames, Mr. Dude’s guesses, the goats’ and Froglet’s pixel off', () => {
    const was = Object.fromEntries(STRIPS.map((b) => [b.id, stray(b, drawn(BEFORE, b))]));
    expect(was.dudemrs.grips).toBe(2);
    expect(was.dudemrs.step).toBeGreaterThan(3);
    expect(was.dudemr.step).toBeGreaterThan(10);
    for (const id of ['ckbrown', 'ckwhite', 'ckblack', 'ckgold', 'ckred', 'cksheep', 'ckfrog', 'ckbirb', 'dinodoux', 'dinomort', 'dinotard', 'dinovita', 'froglet'])
      expect(was[id].spread, id).toBeGreaterThanOrEqual(1);
    expect(was.ckpig.spread).toBe(0); // his pig was on its hand already: left as it was
    expect(WEAR.ckpig).toEqual(PLACED.ckpig);
  });
  it('the hand as followed agrees with Mrs. Dude’s hand as he placed it, frame by frame, better than her head does', () => {
    // His 12 frames placed one by one (3 to 14, at one size and tilt): each one's move predicted from another's, by her hand as
    // followed and by her head anchor (what a guess moves with).
    const b = buddy('dudemrs'), fr = framesOf(b), m = PLACED.dudemrs, ks = Array.from({ length: 12 }, (_, i) => i + 2);
    expect(new Set(ks.map((k) => grip(m[k]))).size).toBe(1);
    const median = (v: number[]) => { const s = [...v].sort((x, y) => x - y); return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2; };
    let best = Infinity;
    for (const r of ks) {
      const box = gripBox(fr[r], m[r])!, rest = ks.filter((k) => k !== r);
      const hand = median(rest.map((k) => { const t = follow(fr[r], fr[k], box, 17); return apart(m[k].x - m[r].x - t.dx, m[k].y - m[r].y - t.dy); }));
      const head = median(rest.map((k) => apart(m[k].x - m[r].x - (FRAMES.dudemrs.head[k][0] - FRAMES.dudemrs.head[r][0]), m[k].y - m[r].y - (FRAMES.dudemrs.head[k][1] - FRAMES.dudemrs.head[r][1]))));
      expect(hand, `from frame ${r + 1}`).toBeLessThan(head);
      best = Math.min(best, hand);
    }
    expect(best).toBeLessThan(1.5);
  });
});

describe('Mrs. and Mr. Dude', () => {
  it('her first two frames hold it as the other twelve do (33.15 wide, tilted 61°, mirrored), where the same hand is drawn again', () => {
    const ws = drawn(WEAR, buddy('dudemrs'));
    for (const w of ws) expect(w).toMatchObject({ w: 33.15, h: 33.15, r: 61, f: true });
    expect(PLACED.dudemrs[0]).toMatchObject({ w: 29.6, r: 35.3 }); // as he had placed them
    // Frames 1–2 and 8–9 draw the very same arms (her loop is 7 frames twice): the item where the hand is, within the half pixel
    // his own mark may keep (frame 9's is his, half a pixel lower).
    const fr = framesOf(buddy('dudemrs'));
    for (const k of [0, 1]) {
      const t = follow(fr[k], fr[k + 7], gripBox(fr[k], ws[k])!, 17);
      expect([t.dx, t.dy, t.cost]).toEqual([0, 0, 0]);
      expect(apart(ws[k].x - ws[k + 7].x, ws[k].y - ws[k + 7].y), `frame ${k + 1}`).toBeLessThanOrEqual(0.5);
    }
    expect(drawn(BEFORE, buddy('dudemrs'))[1]).toMatchObject({ x: 19, y: 85.5 }); // before: 5 px off frame 9's (14, 84.5)
  });
  it('his arms are hers, outline for outline: he holds it frame by frame exactly as she does', () => {
    const his = framesOf(buddy('dudemr')), hers = framesOf(buddy('dudemrs')), ws = drawn(WEAR, buddy('dudemrs'));
    for (let f = 0; f < 14; f++) {
      expect(follow(hers[f], his[f], gripBox(hers[f], ws[f])!, 4, true), `frame ${f}`).toMatchObject({ dx: 0, dy: 0 });
      expect(WEAR.dudemr[f], `frame ${f}`).toEqual(WEAR.dudemrs[f]);
    }
  });
});

describe('a Tiny buddy’s poses (separate drawings)', () => {
  const pixel = (img: Img, x: number, y: number) => Array.from(img.px.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4));
  it('the birds hold it in their feet in both poses: wings raised or folded, one size and tilt, moved as the feet move', () => {
    for (const id of ['c131', 'c133', 'c135', 'c137', 'c139']) {
      const b = buddy(id), [up, perched] = framesOf(b), [a, c] = drawn(WEAR, b);
      // The left foot: the same pixel drawn one higher on the perched bird (the outline round it, not the foot, elsewhere).
      expect(pixel(up, 6, 13), id).toEqual(pixel(perched, 6, 12));
      expect(pixel(up, 6, 13)[3], id).toBe(255);
      expect(pixel(up, 6, 13), id).not.toEqual(pixel(up, 6, 14));
      expect(grip(a), id).toBe(grip(c));
      expect([c.x - a.x, c.y - a.y], id).toEqual([0, -1]);
      expect(c, `${id}: the perched pose as he placed it`).toEqual(PLACED[id][1]);
    }
    // As they were: up by a raised wing on the first pose, another size and tilt.
    for (const id of ['c131', 'c133', 'c135', 'c137', 'c139']) expect(grip(PLACED[id][0]), id).not.toBe(grip(PLACED[id][1]));
    expect(PLACED.c133[0]).toMatchObject({ x: 2, y: 6.5, r: 39.3 });
  });
  it('no hands (Gami, Zari, the mimic): the item stays by its foot, which no pose moves', () => {
    const bottom = (img: Img) => { for (let y = img.h - 1; y >= 0; y--) for (let x = 0; x < img.w; x++) if (img.px[(y * img.w + x) * 4 + 3] >= 128) return y; return -1; };
    for (const id of ['c066', 'c114', 'd090']) {
      const b = buddy(id), fr = framesOf(b), ws = drawn(WEAR, b);
      expect(new Set(fr.map(bottom)).size, id).toBe(1);
      expect(new Set(ws.map(grip)).size, id).toBe(1);
      for (let k = 1; k < ws.length; k++) expect(apart(ws[k].x - ws[0].x, ws[k].y - ws[0].y), `${id} ${k}`).toBeLessThanOrEqual(1);
    }
    expect(WEAR.c066).toEqual(PLACED.c066);
    expect(WEAR.c114).toEqual(PLACED.c114);
    // As they were: the mimic's last two poses up two pixels with its lid.
    expect(PLACED.d090[2].y - PLACED.d090[0].y).toBe(-2);
  });
});

describe('his marks, and this phone’s', () => {
  it('a mark is replaced only where the hand puts it elsewhere: SUPERSEDED is his exactly, WEAR has the new one', () => {
    const n = Object.values(SUPERSEDED).reduce((s, fs) => s + Object.keys(fs).length, 0);
    expect(n).toBe(37);
    for (const [id, fs] of Object.entries(SUPERSEDED)) for (const [f, w] of Object.entries(fs)) {
      expect(w, `${id} ${f}`).toEqual(PLACED[id][Number(f)]);
      expect(WEAR[id][Number(f)], `${id} ${f}`).not.toEqual(w);
    }
    // Every other frame he placed is drawn as he placed it.
    for (const [id, fs] of Object.entries(PLACED)) for (const [f, w] of Object.entries(fs))
      if (!SUPERSEDED[id]?.[Number(f)]) expect(WEAR[id][Number(f)], `${id} ${f}`).toEqual(w);
  });
  it('a phone still holding one he placed before draws the hand’s; one placed anew there still wins', () => {
    const old = SUPERSEDED.dudemrs[0], anew = { ...old, x: old.x + 1 };
    const mine: WearMap = { dudemrs: { 0: old, 2: anew }, c017: { 0: PLACED.c017[0] } };
    expect(unmoved(mine)).toEqual({ dudemrs: { 2: anew }, c017: { 0: PLACED.c017[0] } });
    expect(over(WEAR, unmoved(mine)).dudemrs[0]).toEqual(WEAR.dudemrs[0]);
    expect(over(WEAR, unmoved(mine)).dudemrs[2]).toEqual(anew);
    expect(unmoved({ dudemrs: { 0: old } })).toEqual({});
  });
  it('tracked.ts is what scripts/track-held.mjs writes from the marks and sprites as they are now', () => {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('../../../scripts/track-held.mjs', import.meta.url)), '--check'], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
  });
});
