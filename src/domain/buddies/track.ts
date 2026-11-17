// Following a held item's hand from frame to frame (owner 2026-11-16: "fix all the animations and accessory placements for all
// the sprites"). A mark says where the item's base sits on one frame; the hand holding it is the sprite's own pixels along the
// first stretch of the handle. That patch of pixels is looked for in each other frame, near where it was, and the item moves as
// far as the patch did. Shared by scripts/track-held.mjs (which bakes domain/buddies/tracked from the owner's marks) and
// tracked.test (which measures the hand again and holds the baked marks to it), so it imports nothing: node runs it as it is.

/** An image's pixels, RGBA, row by row. */
export interface Img { w: number; h: number; px: Uint8Array }
/** A placement as domain/buddies/guess Wear has it: base at (x, y), drawn w × h, turned r° clockwise, mirrored when f. */
export interface Place { x: number; y: number; w: number; h: number; r: number; f: boolean }
/** A box of pixels [x, y, w, h]. */
export type Box = readonly [number, number, number, number];

/** A non-interlaced 8-bit RGBA PNG (every sprite here is one; anchors.test reads them the same way), given zlib's inflate. */
export function decodePng(d: Uint8Array, inflate: (b: Uint8Array) => Uint8Array): Img {
  const u32 = (i: number) => ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
  const w = u32(16), h = u32(20);
  if (d[24] !== 8 || d[25] !== 6 || d[28] !== 0) throw new Error('not a non-interlaced 8-bit RGBA PNG');
  const parts: Uint8Array[] = [];
  for (let i = 8; i < d.length;) {
    const len = u32(i), type = String.fromCharCode(d[i + 4], d[i + 5], d[i + 6], d[i + 7]);
    if (type === 'IDAT') parts.push(d.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (all.set(p, at), at + p.length), 0);
  const raw = inflate(all), stride = w * 4, px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[y * stride + x - 4] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= 4 && y ? px[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      px[y * stride + x] = (raw[row + x] + pred) & 255;
    }
  }
  return { w, h, px };
}

/** Columns x0 … x0 + w of an image: one frame of a strip. */
export function crop(img: Img, x0: number, w: number): Img {
  const px = new Uint8Array(w * img.h * 4);
  for (let y = 0; y < img.h; y++) px.set(img.px.subarray((y * img.w + x0) * 4, (y * img.w + x0 + w) * 4), y * w * 4);
  return { w, h: img.h, px };
}

const solid = (img: Img, x: number, y: number) => x >= 0 && y >= 0 && x < img.w && y < img.h && img.px[(y * img.w + x) * 4 + 3] >= 128;

/** How much of the handle the hand is looked for along, from the base (of the item's drawn height), and how near it. */
export const GRIP_ALONG = 0.4, GRIP_NEAR = 0.12;

/**
 * The hand holding a placed item: the sprite's solid pixels near the first stretch of its handle (from the base along the item's
 * up, which the tilt turns and the mirror leaves alone), as the box they fill, grown by a margin so the edge round them counts
 * too. Widened step by step when the handle passes no solid pixel; null when there's none anywhere near.
 */
export function gripBox(img: Img, p: Place): Box | null {
  const a = (p.r * Math.PI) / 180, ux = Math.sin(a), uy = -Math.cos(a), len = GRIP_ALONG * p.h;
  for (let near = Math.max(1.5, GRIP_NEAR * p.h); near <= Math.max(6, p.h); near *= 1.5) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      if (!solid(img, x, y)) continue;
      const cx = x + 0.5 - p.x, cy = y + 0.5 - p.y, t = Math.max(0, Math.min(len, cx * ux + cy * uy));
      if (Math.hypot(cx - t * ux, cy - t * uy) > near) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    if (x1 >= x0) {
      const m = Math.max(1, Math.round(p.h / 12));
      const bx = Math.max(0, x0 - m), by = Math.max(0, y0 - m);
      return [bx, by, Math.min(img.w, x1 + m + 1) - bx, Math.min(img.h, y1 + m + 1) - by];
    }
  }
  return null;
}

/** How unlike two pixels are, 0 … 1: both clear 0, one clear 1, else their colours apart (and a soft edge's alpha). */
function apart(a: Img, ax: number, ay: number, b: Img, bx: number, by: number, shape: boolean): number {
  const inA = ax >= 0 && ay >= 0 && ax < a.w && ay < a.h, inB = bx >= 0 && by >= 0 && bx < b.w && by < b.h;
  const i = (ay * a.w + ax) * 4, j = (by * b.w + bx) * 4;
  const aa = inA ? a.px[i + 3] : 0, ba = inB ? b.px[j + 3] : 0;
  if (aa < 128 && ba < 128) return 0;
  if (aa < 128 || ba < 128) return 1;
  if (shape) return 0;
  return (Math.abs(a.px[i] - b.px[j]) + Math.abs(a.px[i + 1] - b.px[j + 1]) + Math.abs(a.px[i + 2] - b.px[j + 2])) / 765;
}

/**
 * How far the pixels in `box` of `from` moved to be in `to`: the whole-pixel shift within `reach` that matches them best
 * (`shape`: by their outline alone, for two characters coloured differently), the nearer of two equal fits. `cost` is the
 * best fit's mismatch per pixel of the box (0 a perfect match), `next` the best fit's at least two pixels away from it.
 */
export function follow(from: Img, to: Img, box: Box, reach: number, shape = false): { dx: number; dy: number; cost: number; next: number } {
  const [bx, by, bw, bh] = box, n = bw * bh, fits: { dx: number; dy: number; c: number }[] = [];
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
    let c = 0;
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) c += apart(from, x, y, to, x + dx, y + dy, shape);
    fits.push({ dx, dy, c: c / n + 1e-4 * Math.hypot(dx, dy) });
  }
  fits.sort((a, b) => a.c - b.c);
  const best = fits[0], next = fits.find((f) => Math.max(Math.abs(f.dx - best.dx), Math.abs(f.dy - best.dy)) >= 2);
  return { dx: best.dx, dy: best.dy, cost: best.c, next: next ? next.c : Infinity };
}
