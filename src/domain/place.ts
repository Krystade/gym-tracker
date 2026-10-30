// Where a visit was, for Together (owner 2026-10-29: location + time; .superpowers/together-location-plan.md), without the place
// ever leaving the phone. Off until Location for Together is turned on (Profile `placeKey`).
//
// - One rough fix at a visit's first set (state/usePlace), its cell: geohash precision 7, about 150 m a side. The fix and the cell
//   are dropped as soon as the codes are made; nothing stores either, here or in the account.
// - What the set carries (`loc`), per friend with it on: a code for the cell and one for each of its 8 neighbours (a wall between
//   two cells doesn't split one gym), each an HMAC of the cell and the day under a key only the two of you can make (pairKey: both
//   profiles' random keys, each readable by that profile's friends alone, so a third person never has both). Codes change daily.
// - Compared on the phone: two visits were in one place when either's own cell is the other's cell or a neighbour. Only the codes
//   of the same two people under the same key can ever be equal, so whose code is whose never needs saying, and isn't.
// - A friend's phone is told only "the same place as me that day". Holding the pair's key, it could still try cells one by one
//   and find a visit's cell (about 150 m): about what the gym your sets name already tells a friend. Nobody else holds a key.

/** The cell's size: geohash precision 7, about 153 m by 153 m (less east–west away from the equator). */
export const PRECISION = 7;
/** Characters in one code: 6 bytes of the HMAC, base64url. */
const CODE = 8;
/** Codes for at most this many friends a visit (9 each): beyond it, the rest aren't made. */
export const MAX_FRIENDS = 50;
const MAX_LEN = MAX_FRIENDS * 9 * CODE + 1;
const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const URL64 = /^[A-Za-z0-9_-]*$/;
/** A profile's key: 16 random bytes, base64url. */
export const isPlaceKey = (k: unknown): k is string => typeof k === 'string' && k.length === 22 && URL64.test(k);

/** The geohash of a point: alternate bits of longitude and latitude, halving each range. */
export function geohash(lat: number, lng: number, n = PRECISION): string {
  const lo = [-90, -180], hi = [90, 180];
  let out = '', ch = 0, bits = 0, lon = true;
  while (out.length < n) {
    const i = lon ? 1 : 0, mid = (lo[i] + hi[i]) / 2;
    if ((lon ? lng : lat) >= mid) { ch = ch * 2 + 1; lo[i] = mid; } else { ch *= 2; hi[i] = mid; }
    lon = !lon;
    if (++bits === 5) { out += B32[ch]; ch = 0; bits = 0; }
  }
  return out;
}

/** A cell's middle and its height and width, in degrees. */
function box(cell: string): { lat: number; lng: number; h: number; w: number } {
  const lo = [-90, -180], hi = [90, 180];
  let lon = true;
  for (const c of cell) {
    const v = B32.indexOf(c);
    for (let b = 4; b >= 0; b--) {
      const i = lon ? 1 : 0, mid = (lo[i] + hi[i]) / 2;
      if ((v >> b) & 1) lo[i] = mid; else hi[i] = mid;
      lon = !lon;
    }
  }
  return { lat: (lo[0] + hi[0]) / 2, lng: (lo[1] + hi[1]) / 2, h: hi[0] - lo[0], w: hi[1] - lo[1] };
}

/** The 8 cells around one (fewer at a pole), longitude wrapping at 180°. */
export function neighbours(cell: string): string[] {
  const { lat, lng, h, w } = box(cell), out: string[] = [];
  for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) {
    if (!dy && !dx) continue;
    const y = lat + dy * h, x = ((lng + dx * w + 540) % 360) - 180;
    if (y > -90 && y < 90) out.push(geohash(y, x, cell.length));
  }
  return out;
}

const enc = new TextEncoder();
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** A new profile key. */
export const newPlaceKey = (): string => b64url(crypto.getRandomValues(new Uint8Array(16)));

/** The key two profiles share: the same from either side, and made only from both their keys. */
async function pairKey(a: string, b: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`gym-tracker together place|${[a, b].sort().join('|')}`));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
const code = async (k: CryptoKey, cell: string, date: string) =>
  b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${cell}|${date}`))).slice(0, 6));

/**
 * A visit's `loc` from one fix: for each friend's key (yours left out, at most MAX_FRIENDS), the code of the cell, then the codes
 * of its neighbours: "<cells>.<neighbours>", each list sorted so its order says nothing of whose is whose. Null with no friend to
 * make codes for. The point and the cell go no further than this function.
 */
export async function placeCodes(lat: number, lng: number, date: string, mine: string, theirs: readonly string[]): Promise<string | null> {
  if (!isPlaceKey(mine) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const keys = [...new Set(theirs.filter((k) => isPlaceKey(k) && k !== mine))].slice(0, MAX_FRIENDS);
  if (!keys.length) return null;
  const cell = geohash(lat, lng), around = neighbours(cell), c: string[] = [], n: string[] = [];
  for (const k of keys) {
    const pk = await pairKey(mine, k);
    c.push(await code(pk, cell, date));
    for (const x of around) n.push(await code(pk, x, date));
  }
  return `${c.sort().join('')}.${n.sort().join('')}`;
}

/** A visit's codes, read: its cells' and its neighbours'. */
export interface Place { c: ReadonlySet<string>; n: ReadonlySet<string> }
const split = (s: string): string[] | null => {
  if (s.length % CODE || !URL64.test(s)) return null;
  const out: string[] = [];
  for (let i = 0; i < s.length; i += CODE) out.push(s.slice(i, i + CODE));
  return out;
};
/** A set's `loc` as read from anyone's log (untrusted): null when it isn't one, or holds no cell. */
export function parsePlace(x: unknown): Place | null {
  if (typeof x !== 'string' || x.length > MAX_LEN) return null;
  const [a, b, more] = x.split('.');
  if (more !== undefined || b === undefined) return null;
  const c = split(a), n = split(b);
  return c?.length && n ? { c: new Set(c), n: new Set(n) } : null;
}
/** Two visits' codes from one place: either's cell is the other's, or one next to it. The same either way round. */
export function samePlace(a: Place, b: Place): boolean {
  for (const h of a.c) if (b.c.has(h) || b.n.has(h)) return true;
  for (const h of b.c) if (a.n.has(h)) return true;
  return false;
}
