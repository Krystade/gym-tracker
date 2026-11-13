// Stickers in a friend's thread: an image, its transparent border trimmed and shrunk to at most 256px on its long side, stored
// in its own inbox document as a data URL (Spark has no Cloud Storage). This file is the arithmetic; ui/stickerImage draws it.

/** Its longest side, in pixels, as stored. Shown at 120px, so a 3x screen still has two pixels for each of its own. */
export const STICKER_PX = 256;
/** What the shrinking aims for, in bytes of image. */
export const STICKER_GOAL = 60_000;
/** The most it may be, in bytes of image: past this, it's refused. */
export const STICKER_MAX = 90_000;
/**
 * The most characters its data URL may have, as firestore.rules count them: the longest prefix ("data:image/webp;base64,", 23)
 * and STICKER_MAX's bytes in base64 (4 characters for each 3). The rules' number; change both together.
 */
export const MAX_STICKER = 120_023;
/** How many recently sent stickers this phone keeps, newest first. */
export const RECENT_MAX = 12;

const SHAPE = /^data:image\/(webp|png);base64,[A-Za-z0-9+/]+={0,2}$/;
/** A sticker the rules will take: a WebP or PNG data URL in base64, MAX_STICKER characters at most. */
export const stickerOk = (s: unknown): s is string => typeof s === 'string' && s.length <= MAX_STICKER && SHAPE.test(s);
/** Bytes of image in a base64 data URL. */
export const stickerBytes = (s: string) => {
  const b = s.slice(s.indexOf(',') + 1);
  return Math.floor((b.length * 3) / 4) - (b.endsWith('==') ? 2 : b.endsWith('=') ? 1 : 0);
};

/**
 * The box round what isn't transparent in RGBA pixels (`w` × `h`): alpha below `min` counts as clear, so a faint fringe
 * doesn't keep the border. All clear: null.
 */
export function trimBox(px: ArrayLike<number>, w: number, h: number, min = 8): { x: number; y: number; w: number; h: number } | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] < min) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** `w` × `h` shrunk to fit `max` on its long side (never grown), at least 1px each way. */
export function fit(w: number, h: number, max: number): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * The smallest it's tried at, and the sizes and WebP qualities in between: the first that meets the goal wins; none does, the
 * smallest that's under the most; none is, refused. A phone that can't write WebP (Safari: its canvas gives PNG) tries each size
 * as drawn, then with its colours cut to 32 levels each (posterize): a photo-like sticker's PNG at 256px is about twice the goal
 * as drawn, and about the goal cut, with no banding to see at 120px.
 */
export const SIZES = [STICKER_PX, 224, 192, 160, 128] as const;
export const QUALITIES = [0.9, 0.8, 0.7] as const;
export function pick(tries: Iterable<string>): string | null {
  let best: string | null = null;
  for (const s of tries) {
    if (stickerBytes(s) <= STICKER_GOAL && stickerOk(s)) return s;
    if (stickerOk(s) && (!best || s.length < best.length)) best = s;
  }
  return best;
}

/** Each colour channel of RGBA pixels cut to `bits` bits, in place (to the middle of its step); alpha as it was. */
export function posterize(px: { length: number; [i: number]: number }, bits = 5): void {
  const keep = (0xff << (8 - bits)) & 0xff, mid = 1 << (7 - bits);
  for (let i = 0; i < px.length; i += 4) for (let k = i; k < i + 3; k++) px[k] = (px[k] & keep) | mid;
}

/** The recent row after sending `s`: it goes first, once, and the oldest beyond RECENT_MAX go. */
export const withRecent = (list: readonly string[], s: string) => [s, ...list.filter((x) => x !== s)].slice(0, RECENT_MAX);
