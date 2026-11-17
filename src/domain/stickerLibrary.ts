import { RECENT_MAX } from './sticker';

// Your stickers (owner, 2026-11-16: "the process of sending them is still pretty clunky"): every sticker sent from this phone,
// added from Photos or seen in a thread (yours or a friend's) is kept on the phone, once per image, newest first, with your
// favourites ahead of the rest. This file is the arithmetic; state/stickers keeps them and ui/StickerDrawer shows them.

/** The most kept. Past it the oldest go, never a favourite. */
export const LIBRARY_MAX = 200;
/** The most favourites the recent row shows ahead of the recents. */
export const ROW_FAVS = 24;

export interface KeptSticker {
  /** The image's hash (stickerId): the same sticker is kept once, however often it came. */ id: string;
  /** Its data URL, as sent (domain/sticker). */ src: string;
  /** When it last came (ms): sent, added or seen in a thread. Newest first. */ at: number;
  /** When this phone last sent it (ms): the recent row's order. */ sent?: number;
  /** When it was made a favourite (ms): favourites go first, the newest favourite first. */ fav?: number;
}

/** One coming in: `sent` from this phone, `fav` made a favourite, both at `at`. */
export interface Incoming { src: string; at: number; sent?: boolean; fav?: boolean }

/** A 53-bit hash of the sticker's data URL (cyrb53), with its length: the same image gives the same id on every phone. */
export function stickerId(src: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}-${src.length.toString(36)}`;
}

const later = (a: number | undefined, b: number | undefined) => (a == null ? b : b == null ? a : Math.max(a, b));

/**
 * `lib` with `add` kept: a new one goes in, one already kept comes forward (its newest `at`, `sent` and `fav`). Past
 * LIBRARY_MAX the oldest that aren't favourites go. One you removed (`removed`) stays out when it was only seen in a thread;
 * sent, added or made a favourite (`explicit`), it's back, and no longer counts as removed (`revived`).
 * `put`: what to write; `drop`: the ids kept before that go now.
 */
export function keep(lib: readonly KeptSticker[], add: readonly Incoming[], removed: ReadonlySet<string>, explicit: boolean):
  { lib: KeptSticker[]; put: KeptSticker[]; drop: string[]; revived: string[] } {
  const by = new Map(lib.map((s) => [s.id, s]));
  const changed = new Set<string>(), revived = new Set<string>();
  for (const a of add) {
    const id = stickerId(a.src);
    if (removed.has(id)) { if (!explicit) continue; revived.add(id); }
    const was = by.get(id);
    const next: KeptSticker = {
      id, src: a.src, at: Math.max(was?.at ?? a.at, a.at),
      ...(later(was?.sent, a.sent ? a.at : undefined) != null && { sent: later(was?.sent, a.sent ? a.at : undefined) }),
      ...(later(was?.fav, a.fav ? a.at : undefined) != null && { fav: later(was?.fav, a.fav ? a.at : undefined) }),
    };
    if (was && was.at === next.at && was.sent === next.sent && was.fav === next.fav) continue;
    by.set(id, next);
    changed.add(id);
  }
  const all = [...by.values()];
  const favs = all.filter((s) => s.fav != null);
  const rest = all.filter((s) => s.fav == null).sort((a, b) => b.at - a.at);
  const room = Math.max(0, LIBRARY_MAX - favs.length);
  const gone = new Set(rest.slice(room).map((s) => s.id));
  const kept = new Set(lib.map((s) => s.id));
  return {
    lib: all.filter((s) => !gone.has(s.id)),
    put: [...changed].filter((id) => !gone.has(id)).map((id) => by.get(id)!),
    drop: [...gone].filter((id) => kept.has(id)),
    revived: [...revived],
  };
}

/** `lib` with one favourite set or cleared (`at`: when). Unchanged: the same array. */
export function withFav(lib: readonly KeptSticker[], id: string, on: boolean, at: number): KeptSticker[] {
  const s = lib.find((x) => x.id === id);
  if (!s || (s.fav != null) === on) return lib as KeptSticker[];
  const { fav: _fav, ...bare } = s;
  return lib.map((x) => (x.id === id ? (on ? { ...bare, fav: at } : bare) : x));
}

/** Where each one was in a list as shown: what keeps that order from moving under a finger (`arrange`). */
export const rankOf = (list: readonly KeptSticker[]) => new Map(list.map((s, i) => [s.id, i]));

/**
 * In the order shown: favourites first, the newest favourite first (`pin`, the default), then the rest, newest first by `by`.
 * With `rank` (where each was when the list was last laid out) the ones it has keep that order, so a sticker tapped again and
 * again stays under the finger; one it lacks (just added, or just sent from the box) goes ahead of them.
 */
export function arrange(lib: readonly KeptSticker[], o: { rank?: ReadonlyMap<string, number>; by?: 'at' | 'sent'; pin?: boolean } = {}): KeptSticker[] {
  const { rank, by = 'at', pin = true } = o;
  const key = (s: KeptSticker) => s[by] ?? s.at;
  const order = (a: KeptSticker, b: KeptSticker) => {
    const ra = rank?.get(a.id), rb = rank?.get(b.id);
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return 1;
    if (rb != null) return -1;
    return key(b) - key(a);
  };
  if (!pin) return [...lib].sort(order);
  const favs = lib.filter((s) => s.fav != null).sort((a, b) => b.fav! - a.fav!);
  return [...favs, ...lib.filter((s) => s.fav == null).sort(order)];
}

/** The row above the pings: your favourites (ROW_FAVS at most), then the ones you sent last (RECENT_MAX), each once. */
export function recentRow(lib: readonly KeptSticker[], rank?: ReadonlyMap<string, number>): KeptSticker[] {
  const favs = arrange(lib.filter((s) => s.fav != null)).slice(0, ROW_FAVS);
  const sent = arrange(lib.filter((s) => s.fav == null && s.sent != null), { rank, by: 'sent', pin: false }).slice(0, RECENT_MAX);
  return [...favs, ...sent];
}
