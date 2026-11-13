import { BUDDY } from './roster';

// A held item placed by hand on an older character (owner 2026-11-12): in the accessory placer (public/tools/accessory-placer.html,
// its Held slot) he drags it, sizes it, stretches its width and height apart, tilts it a full turn and mirrors it, frame by frame
// of the strip the app shows (the placer's idle strip, or a still picture's one frame: the same files, pixel for pixel). Its
// marks reach the app two ways: on the phone that made them at once (the placer saves them in this site's storage, which
// ui/buddies/BuddySprite reads), and for everyone once its Copy is pasted into WEAR here (wearFromMarks). Read as untrusted.

/** A held item's sprite: 16 × 16 (Tiny Dungeon and Tiny Town). */
export const ITEM = 16;

/**
 * One frame's placement, in that frame's own pixels: the item's base (anchors HELD) at (x, y), its sprite drawn w × h, turned r
 * degrees clockwise about the base, and mirrored left to right about it when f (mirrored first, then turned, as the placer draws).
 */
export interface Wear { x: number; y: number; w: number; h: number; r: number; f: boolean }
export type WearMap = Readonly<Record<string, Readonly<Record<number, Wear>>>>;

/** Placed by hand for everyone: the owner's Held marks, from the placer's Copy through wearFromMarks. None sent yet. */
export const WEAR: WearMap = {};

/** A tilt as one turn: (-180, 180]. */
export const turn = (r: number): number => { const t = (((r % 360) + 360) % 360); return t > 180 ? t - 360 : t; };

const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** One mark, or null when it doesn't read. One from before width and height came apart has a width only: its height is the same
 *  (the sprite is square), so it keeps its shape. */
export function parseWear(x: unknown): Wear | null {
  const p = x as Partial<Wear> | null;
  if (!p || typeof p !== 'object' || !num(p.x, -1000, 1000) || !num(p.y, -1000, 1000) || !num(p.w, 0.01, 1000)) return null;
  const h = p.h === undefined ? p.w : p.h;
  if (!num(h, 0.01, 1000) || (p.r !== undefined && !num(p.r, -1e6, 1e6))) return null;
  return { x: p.x, y: p.y, w: p.w, h, r: turn(p.r ?? 0), f: p.f === true };
}

/**
 * The placer's marks (its Copy, or its saved copy in this browser: slot → character → strip → frame → mark) as what each older
 * character wears a frame: its Held slot's, on the strip the app shows. A character the roster doesn't draw from a strip, a
 * frame past its strip's end and a mark that doesn't read are left out.
 */
export function wearFromMarks(x: unknown): Record<string, Record<number, Wear>> {
  const out: Record<string, Record<number, Wear>> = {};
  const held = (x as { held?: unknown } | null)?.held;
  if (!held || typeof held !== 'object') return out;
  for (const [id, anims] of Object.entries(held as Record<string, unknown>)) {
    const n = BUDDY.get(id)?.art?.n, a = anims as { idle?: unknown; still?: unknown } | null;
    const frames = a && typeof a === 'object' ? (a.idle ?? a.still) : null;
    if (!n || !frames || typeof frames !== 'object') continue;
    const mine: Record<number, Wear> = {};
    for (const [k, v] of Object.entries(frames as Record<string, unknown>)) {
      const f = Number(k), w = parseWear(v);
      if (Number.isInteger(f) && f >= 0 && f < n && w) mine[f] = w;
    }
    if (Object.keys(mine).length) out[id] = mine;
  }
  return out;
}

/**
 * What the item wears on frame `f`: that frame's mark, else the nearest one marked before it (else after), moved as the head
 * anchor moves between the two frames (the placer guesses its unmarked Held frames the same way). None marked: null, and the
 * item sits on the anchor as it always has.
 */
export function wearOn(marks: Readonly<Record<number, Wear>> | undefined, f: number, head: (f: number) => readonly [number, number]): Wear | null {
  if (!marks) return null;
  if (marks[f]) return marks[f];
  const set = Object.keys(marks).map(Number), before = set.filter((k) => k < f), after = set.filter((k) => k > f);
  const k = before.length ? Math.max(...before) : after.length ? Math.min(...after) : null;
  if (k === null) return null;
  const [ax, ay] = head(f), [bx, by] = head(k);
  return { ...marks[k], x: marks[k].x + ax - bx, y: marks[k].y + ay - by };
}

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
