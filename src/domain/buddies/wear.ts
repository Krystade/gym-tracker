import { headOf } from './anchorFix';
import { FRAMES, LOOK } from './anchors';
import { guess, learnFrom, turn, type Body, type Look, type Marks, type Wear, type World } from './guess';
import { PLACED } from './marks';
import { BUDDIES, packOf } from './roster';
import { SUPERSEDED, TRACKED } from './tracked';

// A held item placed by hand (owner 2026-11-12): in the accessory placer (public/tools/accessory-placer.html) he drags it, sizes
// it, stretches its width and height apart, tilts it a full turn and mirrors it, frame by frame of the strip the app shows (an
// older character's idle strip or still picture, a Tiny buddy's poses: the same files, pixel for pixel), on any buddy. Its marks
// reach the app two ways: on the phone that made them at once (the placer saves them in this site's storage, which
// ui/buddies/BuddySprite reads over WEAR, frame by frame), and for everyone once its Copy is baked into domain/buddies/marks
// (scripts/bake-marks.mjs), which is WEAR here. Read as untrusted.
// Every frame of a buddy that moves is then kept on its hand (owner 2026-11-16, domain/buddies/tracked from
// scripts/track-held.mjs): the hand followed frame to frame in the sprite's own pixels, his mark kept where it sits on it.
// A frame nobody placed takes a guess learned from the frames that were (domain/buddies/guess, which the placer shares), else
// the head anchor as it always has.

export { parseWear, turn, wearOn, type Wear } from './guess';
export type WearMap = Marks;

/** A held item's sprite: 16 × 16 (Tiny Dungeon and Tiny Town). */
export const ITEM = 16;
/** How far a held item sits into the head: the Tiny sprites' outline is two pixels thick (the older characters', one). */
export const SINK = 2, SINK_OLD = 1;

/** Some marks over others, frame by frame: `top`'s frame where it has one, else `base`'s (this phone's marks over WEAR). */
export function over(base: WearMap, top: WearMap): WearMap {
  const out: Record<string, Readonly<Record<number, Wear>>> = { ...base };
  for (const [id, fs] of Object.entries(top)) out[id] = { ...(Object.hasOwn(base, id) ? base[id] : {}), ...fs };
  return out;
}

/** For everyone: the owner's Held marks, baked from the placer's Copy (domain/buddies/marks, 2026-11-12), with every frame of a
 *  buddy that moves on its hand (domain/buddies/tracked, owner 2026-11-16: his mark where it sits on the hand, else moved there). */
export const WEAR: WearMap = over(PLACED, TRACKED);

const same = (a: Wear, b: Wear) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.r === b.r && a.f === b.f;
/** This phone's own marks less the ones WEAR has since moved onto the hand (tracked SUPERSEDED: exactly the mark he placed
 *  there), so the phone that placed them draws them on the hand too; one placed there anew still wins. */
export function unmoved(mine: WearMap): WearMap {
  const out: Record<string, Readonly<Record<number, Wear>>> = {};
  for (const [id, fs] of Object.entries(mine)) {
    const old = Object.hasOwn(SUPERSEDED, id) ? SUPERSEDED[id] : {};
    const kept = Object.entries(fs).filter(([f, w]) => !(Object.hasOwn(old, f) && same(old[Number(f)], w)));
    if (kept.length) out[id] = Object.fromEntries(kept);
  }
  return out;
}

const lookOf = ([bx, by, bw, bh, neck, ...top]: readonly number[], head: readonly [number, number]): Look => ({ head, box: [bx, by, bw, bh], neck, top });
/** An older character's held item unplaced on its card (the hero: Tiny scale 8 where that fits 280 × 144 css px, else as large
 *  as fits on a 3× screen; the item at half the Tiny scale), in the character's own pixels. */
function cardSize(id: string): number {
  const [, , bw, bh] = FRAMES[id].box;
  const s = bw * 8 <= 280 && bh * 8 <= 144 ? 8 : Math.max(1, Math.floor(Math.min(280 / bw, 144 / bh) * 3 + 1e-9)) / 3;
  return Math.round(((ITEM * 4) / s) * 100) / 100;
}
/** Every buddy as the guesses see it (domain/buddies/guess): a Tiny buddy's poses, an older character's frames. */
export const WORLD: World = Object.fromEntries(BUDDIES.map((b): [string, Body] => [b.id, b.art
  ? { pack: packOf(b.id), strip: b.art.n > 1 ? 'idle' : 'still', sink: SINK_OLD, size: cardSize(b.id), looks: LOOK[b.id].map((l, f) => lookOf(l, headOf(b.id, f))) }
  : { pack: packOf(b.id), strip: 'poses', sink: SINK, size: ITEM / 2, looks: b.poses.map((p) => lookOf(LOOK[p][0], headOf(p))) }]));

/**
 * The placer's marks (its Copy, or its saved copy in this browser: slot → buddy → strip → frame → mark) as what each buddy wears
 * a frame: its Held slot's, on the strip the app shows. A buddy not in the roster, a frame past its strip's end and a mark that
 * doesn't read are left out.
 */
export const wearFromMarks = (x: unknown): Record<string, Record<number, Wear>> => learnFrom(x, WORLD);

/** What buddy `id` wears on frame (or pose) `f` given `marks`: its mark, else a learned guess, else null (the head anchor). */
export const wearFor = (marks: WearMap, id: string, f: number): Wear | null => guess(marks, WORLD, id, f)?.wear ?? null;

export interface HeldStyle { left: number; top: number; width: number; height: number; transformOrigin?: string; transform?: string }
/**
 * Where a held item's sprite goes, css px from the buddy's top left: its base (bx, by, its own pixels) on (ax, ay), each of its
 * pixels kx wide and ky tall, turned r° clockwise about the base and mirrored about it when f. On whole css px, so an item
 * neither turned nor mirrored sits as it always did, with no transform.
 */
export function heldStyle([bx, by]: readonly [number, number], [ax, ay]: readonly [number, number], kx: number, ky = kx, r = 0, f = false): HeldStyle {
  const left = Math.round(ax - bx * kx), top = Math.round(ay - by * ky), box = { left, top, width: ITEM * kx, height: ITEM * ky };
  if (!turn(r) && !f) return box;
  return { ...box, transformOrigin: `${ax - left}px ${ay - top}px`, transform: `rotate(${turn(r)}deg)${f ? ' scaleX(-1)' : ''}` };
}
