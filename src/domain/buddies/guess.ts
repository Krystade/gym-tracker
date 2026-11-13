// A held item's placement, learned from the ones placed by hand (owner 2026-11-12: "learn accessory placement based on other
// sprites I already set"). Shared word for word by the app (domain/buddies/wear, ui/buddies/BuddySprite), the accessory placer
// (public/tools/accessory-placer.html, a generated copy that guess.test checks) and the accuracy check (scripts/guess-eval.mjs,
// which node runs on this file as it is): so it imports nothing, and every buddy's shape comes in as a World.
// A frame nobody placed takes, in turn: the same buddy's nearest placed frame or pose, moved as the head anchor moves; else the
// placed buddies shaped most like it (a placement read against the head anchor, in units of the silhouette's size, and mirrored
// when the two face opposite ways); else the nearest of its own pack; else nothing, and the item sits on the head anchor.

/**
 * One frame's placement, in that frame's own pixels: the item's base (anchors HELD) at (x, y), its sprite drawn w × h, turned r
 * degrees clockwise about the base, and mirrored left to right about it when f (mirrored first, then turned, as the placer draws).
 */
export interface Wear { x: number; y: number; w: number; h: number; r: number; f: boolean }
/** Placements by buddy, then frame (a Tiny buddy's pose, in its roster order). */
export type Marks = Readonly<Record<string, Readonly<Record<number, Wear>>>>;
/** One frame as the guesses see it, in its own pixels: its head anchor, the box its solid pixels fill [x, y, w, h], their width
 *  across the box's top fifth, and the top edge's depth into the box at eight columns across it (anchors LOOK). */
export interface Look { head: readonly [number, number]; box: readonly [number, number, number, number]; neck: number; top: readonly number[] }
/** A buddy: its pack, the strip of the placer's marks that is the app's (a Tiny buddy's poses, else its idle or still strip),
 *  where the item sits unplaced on its card (`sink` px into the head anchor, `size` px square), and each frame's look. */
export interface Body { pack: string; strip: 'poses' | 'idle' | 'still'; sink: number; size: number; looks: readonly Look[] }
export type World = Readonly<Record<string, Body>>;
/** A guess: the placement, how it was found (the same buddy's frames, buddies shaped like it, or its pack's) and from whom. */
export interface Guess { wear: Wear; how: 'own' | 'like' | 'pack'; from: string[] }

/** How unlike two frames' shapes may be for one to teach the other (features' distance), and how many teach at most. */
export const NEAR = 0.2;
export const MOST = 3;

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
 * The placer's marks (its Copy, or its saved copy in this browser: slot → buddy → strip → frame → mark) as what each buddy wears
 * a frame: its Held slot's, on the strip the app shows (Body strip). A buddy the world doesn't have, a frame past its strip's end
 * and a mark that doesn't read are left out; so are the other slots (the placer's old stand-ins), which the app doesn't draw.
 */
export function learnFrom(x: unknown, world: World): Record<string, Record<number, Wear>> {
  const out: Record<string, Record<number, Wear>> = {};
  const held = (x as { held?: unknown } | null)?.held;
  if (!held || typeof held !== 'object') return out;
  for (const [id, anims] of Object.entries(held as Record<string, unknown>)) {
    const body = Object.hasOwn(world, id) ? world[id] : undefined, a = anims as Record<string, unknown> | null;
    const frames = body && a && typeof a === 'object' ? a[body.strip] : null;
    if (!body || !frames || typeof frames !== 'object') continue;
    const mine: Record<number, Wear> = {};
    for (const [k, v] of Object.entries(frames as Record<string, unknown>)) {
      const f = Number(k), w = parseWear(v);
      if (Number.isInteger(f) && f >= 0 && f < body.looks.length && w) mine[f] = w;
    }
    if (Object.keys(mine).length) out[id] = mine;
  }
  return out;
}

/**
 * What the item wears on frame `f`: that frame's mark, else the nearest one marked before it (else after), moved as the head
 * anchor moves between the two frames. None marked: null.
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

/** Where the item sits on frame `f` when nothing is placed or learned: its base on the head anchor, sunk, at its card's size. */
export function plainWear(body: Body, f: number): Wear {
  const [x, y] = body.looks[f].head;
  return { x, y: y + body.sink, w: body.size, h: body.size, r: 0, f: false };
}

/** A frame's shape as numbers that don't care how big it's drawn: its box's proportions, its head's width and where the anchor
 *  is in it, and its top edge (each depth half weight, as there are eight). */
export function features({ head: [hx, hy], box: [bx, by, bw, bh], neck, top }: Look): number[] {
  return [Math.log(bw / bh), neck / bw, (hx - bx) / bw, (hy - by) / bh, ...top.map((t) => t / bh / 2)];
}
const apart = (a: readonly number[], b: readonly number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
/** Which way it faces, by where its head is: right 1, left -1, or 0 when the head is near the middle. */
export function facing({ head: [hx], box: [bx, , bw] }: Look): -1 | 0 | 1 {
  const c = (hx - bx) / bw - 0.5;
  return c > 0.15 ? 1 : c < -0.15 ? -1 : 0;
}
/** The silhouette's size, a frame's pixels: one unit of a placement read from it. */
const unit = ({ box: [, , bw, bh] }: Look) => Math.sqrt(bw * bh);

interface Rel { dx: number; dy: number; w: number; h: number; r: number; f: boolean }
/** A mark on `from` as `to` would wear it: from the head anchor in silhouette units, mirrored when the two face opposite ways. */
function relOf(w: Wear, from: Look, to: Look): Rel {
  const u = unit(from), rel = { dx: (w.x - from.head[0]) / u, dy: (w.y - from.head[1]) / u, w: w.w / u, h: w.h / u, r: w.r, f: w.f };
  return facing(from) * facing(to) < 0 ? { ...rel, dx: -rel.dx, r: turn(-rel.r), f: !rel.f } : rel;
}
const cent = (v: number) => Math.round(v * 100) / 100;
/** Some teachers' placements, nearer ones counting more, as `to` wears them: on whole hundredths (a tenth of a degree), so the
 *  app and the placer, on different engines, land on the same numbers. */
function blend(ex: readonly { d: number; rel: Rel }[], to: Look): Wear {
  let n = 0, dx = 0, dy = 0, w = 0, h = 0, s = 0, c = 0, f = 0;
  for (const { d, rel } of ex) {
    const k = 1 / (d + 0.05), a = (rel.r * Math.PI) / 180;
    n += k; dx += k * rel.dx; dy += k * rel.dy; w += k * rel.w; h += k * rel.h; s += k * Math.sin(a); c += k * Math.cos(a); f += rel.f ? k : -k;
  }
  const u = unit(to), r = ex.length === 1 ? ex[0].rel.r : (Math.atan2(s, c) * 180) / Math.PI;
  return { x: cent(to.head[0] + (dx / n) * u), y: cent(to.head[1] + (dy / n) * u), w: Math.max(0.5, cent((w / n) * u)), h: Math.max(0.5, cent((h / n) * u)), r: Math.round(turn(r) * 10) / 10, f: f > 0 };
}

/** What buddy `id` wears on frame `f` given `marks`: its own mark there, else learned from the others; null when nothing teaches it. */
export function guess(marks: Marks, world: World, id: string, f: number): Guess | null {
  const body = Object.hasOwn(world, id) ? world[id] : undefined, look = body?.looks[f];
  if (!body || !look) return null;
  const own = Object.hasOwn(marks, id) ? wearOn(marks[id], f, (k) => body.looks[k].head) : null;
  if (own) return { wear: own, how: 'own', from: [id] };
  // Each other placed buddy teaches once: from its placed frame shaped most like this one.
  const me = features(look), ex: { id: string; d: number; rel: Rel; pack: string }[] = [];
  for (const [o, fs] of Object.entries(marks)) {
    const ob = Object.hasOwn(world, o) ? world[o] : undefined;
    if (o === id || !ob) continue;
    let best: { id: string; d: number; rel: Rel; pack: string } | null = null;
    for (const [k, w] of Object.entries(fs)) {
      const lk = ob.looks[Number(k)];
      if (!lk) continue;
      const d = apart(me, features(lk));
      if (!best || d < best.d) best = { id: o, d, rel: relOf(w, lk, look), pack: ob.pack };
    }
    if (best) ex.push(best);
  }
  ex.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const like = ex.filter((e) => e.d <= NEAR).slice(0, MOST), pack = like.length ? [] : ex.filter((e) => e.pack === body.pack).slice(0, MOST);
  const by = like.length ? like : pack;
  if (!by.length) return null;
  return { wear: blend(by, look), how: like.length ? 'like' : 'pack', from: by.map((e) => e.id) };
}

/** One placed frame guessed with its own mark left out: how far off the guess was (the head anchor's when nothing taught it). */
export interface Miss { id: string; f: number; how: Guess['how'] | 'anchor'; from: string[]; pos: number; size: number; tilt: number; flip: boolean }
export interface Tally { n: number; pos: number; size: number; tilt: number; flips: number }
export interface Report extends Tally { by: Record<Miss['how'], Tally>; misses: Miss[] }

const tally = (ms: readonly Miss[]): Tally => {
  const n = ms.length, mean = (k: 'pos' | 'size' | 'tilt') => (n ? ms.reduce((s, m) => s + m[k], 0) / n : 0);
  return { n, pos: mean('pos'), size: mean('size'), tilt: mean('tilt'), flips: ms.filter((m) => m.flip).length };
};
/**
 * Leave one out: each placed frame guessed from all the other marks, against where it was placed. Position off in the frame's own
 * pixels, size off as a fraction (of the mark's, w and h together), tilt off in degrees, and whether the mirror was wrong.
 */
export function leaveOneOut(marks: Marks, world: World): Report {
  const misses: Miss[] = [];
  for (const [id, fs] of Object.entries(marks)) for (const [k, truth] of Object.entries(fs)) {
    const f = Number(k), body = Object.hasOwn(world, id) ? world[id] : undefined;
    if (!body?.looks[f]) continue;
    const rest: Record<number, Wear> = { ...fs };
    delete rest[f];
    const others: Record<string, Readonly<Record<number, Wear>>> = { ...marks };
    if (Object.keys(rest).length) others[id] = rest; else delete others[id];
    const g = guess(others, world, id, f), w = g?.wear ?? plainWear(body, f);
    misses.push({
      id, f, how: g?.how ?? 'anchor', from: g?.from ?? [], pos: Math.hypot(w.x - truth.x, w.y - truth.y),
      size: Math.abs(Math.sqrt((w.w * w.h) / (truth.w * truth.h)) - 1), tilt: Math.abs(turn(w.r - truth.r)), flip: w.f !== truth.f,
    });
  }
  const hows = ['own', 'like', 'pack', 'anchor'] as const;
  return { ...tally(misses), by: Object.fromEntries(hows.map((h) => [h, tally(misses.filter((m) => m.how === h))])) as Report['by'], misses };
}
