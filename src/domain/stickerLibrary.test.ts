import { describe, expect, it } from 'vitest';
import { RECENT_MAX } from './sticker';
import { arrange, keep, LIBRARY_MAX, rankOf, recentRow, ROW_FAVS, stickerId, withFav, type KeptSticker } from './stickerLibrary';

const src = (n: number | string) => `data:image/png;base64,${btoa(`sticker-${n}`).replace(/=+$/, '')}`;
const ids = (l: readonly KeptSticker[]) => l.map((s) => s.src);
const none = new Set<string>();

describe('stickerId', () => {
  it('is the same for the same image and differs for another, whatever the length', () => {
    expect(stickerId(src(1))).toBe(stickerId(src(1)));
    expect(stickerId(src(1))).not.toBe(stickerId(src(2)));
    const big = 'data:image/webp;base64,' + 'A'.repeat(120_000);
    expect(stickerId(big)).not.toBe(stickerId(big.slice(0, -1) + 'B'));
    expect(stickerId(big)).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
  });
});

describe('keep', () => {
  it('keeps each image once, brought forward by its newest coming, with when it was sent and made a favourite', () => {
    let r = keep([], [{ src: src(1), at: 10 }, { src: src(2), at: 20, sent: true }], none, false);
    expect(r.put).toHaveLength(2);
    r = keep(r.lib, [{ src: src(1), at: 30, sent: true }, { src: src(1), at: 5 }], none, true);
    expect(r.lib).toHaveLength(2);
    expect(r.put).toEqual([{ id: stickerId(src(1)), src: src(1), at: 30, sent: 30 }]);
    // Seen again in a thread, older: nothing to write.
    expect(keep(r.lib, [{ src: src(1), at: 12 }], none, false).put).toEqual([]);
  });

  it('past the cap lets the oldest go, never a favourite, and never writes one only to let it go', () => {
    const fav = keep([], [{ src: src('fav'), at: 0, fav: true }], none, true).lib;
    const full = keep(fav, Array.from({ length: LIBRARY_MAX + 5 }, (_, i) => ({ src: src(i), at: 100 + i })), none, false);
    expect(full.lib).toHaveLength(LIBRARY_MAX);
    expect(full.lib.some((s) => s.src === src('fav'))).toBe(true);
    // 206 for 200 places, one the favourite's: the oldest six went.
    expect(full.lib.some((s) => s.src === src(5))).toBe(false);
    expect(full.lib.some((s) => s.src === src(6))).toBe(true);
    expect(full.put).toHaveLength(LIBRARY_MAX - 1);
    expect(full.drop).toEqual([]); // the six never were kept
    // An old one seen again in a thread when full: not written, not kept.
    const again = keep(full.lib, [{ src: src(0), at: 100 }], none, false);
    expect(again.put).toEqual([]);
    expect(again.drop).toEqual([]);
    // A new one pushes out the oldest kept.
    const next = keep(full.lib, [{ src: src('new'), at: 9999 }], none, false);
    expect(next.drop).toEqual([stickerId(src(6))]);
  });

  it('leaves one you removed out when a thread has it again, and takes it back when you send or add it', () => {
    const removed = new Set([stickerId(src(1))]);
    expect(keep([], [{ src: src(1), at: 50 }], removed, false)).toEqual({ lib: [], put: [], drop: [], revived: [] });
    const back = keep([], [{ src: src(1), at: 50, sent: true }], removed, true);
    expect(ids(back.lib)).toEqual([src(1)]);
    expect(back.revived).toEqual([stickerId(src(1))]);
  });
});

describe('the order shown', () => {
  const lib = keep([], [
    { src: src('a'), at: 10, sent: true }, { src: src('b'), at: 40 }, { src: src('c'), at: 30, sent: true },
    { src: src('f1'), at: 1, fav: true }, { src: src('f2'), at: 2, fav: true },
  ], none, true).lib;

  it('puts favourites first, the newest favourite first, then the rest newest first', () => {
    expect(ids(arrange(lib))).toEqual([src('f2'), src('f1'), src('b'), src('c'), src('a')]);
    expect(ids(arrange(lib, { pin: false }))).toEqual([src('b'), src('c'), src('a'), src('f2'), src('f1')]);
  });

  it('holds a laid-out order while what it holds comes again; one it lacks goes ahead', () => {
    const rank = rankOf(arrange(lib));
    const sentAgain = keep(lib, [{ src: src('a'), at: 99, sent: true }], none, true).lib;
    expect(ids(arrange(sentAgain, { rank }))).toEqual([src('f2'), src('f1'), src('b'), src('c'), src('a')]);
    const added = keep(sentAgain, [{ src: src('n'), at: 100 }], none, true).lib;
    expect(ids(arrange(added, { rank }))).toEqual([src('f2'), src('f1'), src('n'), src('b'), src('c'), src('a')]);
    // Editing: a new favourite stays where it was until the grid is laid out again.
    const frozen = rankOf(arrange(added, { rank }));
    const faved = withFav(added, stickerId(src('c')), true, 200);
    expect(ids(arrange(faved, { rank: frozen, pin: false }))).toEqual(ids(arrange(added, { rank })));
    expect(ids(arrange(faved)).slice(0, 3)).toEqual([src('c'), src('f2'), src('f1')]);
  });

  it('makes the recent row your favourites, then what you sent last, never what only came in a thread', () => {
    expect(ids(recentRow(lib))).toEqual([src('f2'), src('f1'), src('c'), src('a')]);
    const many = keep([], [
      ...Array.from({ length: ROW_FAVS + 3 }, (_, i) => ({ src: src(`fav${i}`), at: i, fav: true })),
      ...Array.from({ length: RECENT_MAX + 3 }, (_, i) => ({ src: src(`sent${i}`), at: 100 + i, sent: true })),
    ], none, true).lib;
    const row = recentRow(many);
    expect(row).toHaveLength(ROW_FAVS + RECENT_MAX);
    expect(row[ROW_FAVS].src).toBe(src(`sent${RECENT_MAX + 2}`));
  });

  it('clears a favourite, and leaves the list as it was when nothing changes', () => {
    const id = stickerId(src('f1'));
    expect(withFav(lib, id, true, 5)).toBe(lib);
    expect(withFav(lib, id, false, 5).find((s) => s.id === id)?.fav).toBeUndefined();
  });
});
