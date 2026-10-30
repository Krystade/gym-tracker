import { describe, expect, it } from 'vitest';
import { geohash, isPlaceKey, MAX_FRIENDS, neighbours, newPlaceKey, parsePlace, placeCodes, samePlace } from './place';

// Location for Together's codes (domain/place). Synthetic points and keys only.
const ANA = 'anaanaanaanaanaanaana1', BEN = 'benbenbenbenbenbenben2', CAT = 'catcatcatcatcatcatcat3';
const DAY = '2026-11-02';
const GYM = { lat: 40.74844, lng: -73.98566 };
/** A cell over: the next cell east, then two over; geohash 7 is 360/2^18 degrees wide. */
const W = 360 / 2 ** 18;
const east = (n: number) => ({ lat: GYM.lat, lng: GYM.lng + n * W });
const codes = async (at: { lat: number; lng: number }, mine: string, theirs: string[], day = DAY) => parsePlace(await placeCodes(at.lat, at.lng, day, mine, theirs))!;

describe('cells', () => {
  it('the geohash of a point, as everyone writes it', () => {
    expect(geohash(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
    expect(geohash(57.64911, 10.40744)).toBe('u4pruyd');
  });
  it('eight neighbours, all different, each one cell away, and the cell is each one’s neighbour back', () => {
    const c = geohash(GYM.lat, GYM.lng), ns = neighbours(c);
    expect(new Set(ns).size).toBe(8);
    expect(ns).not.toContain(c);
    for (const n of ns) expect(neighbours(n)).toContain(c);
    expect(ns).toContain(geohash(east(1).lat, east(1).lng));
    expect(ns).not.toContain(geohash(east(2).lat, east(2).lng));
  });
  it('wraps at 180° east–west', () => {
    const c = geohash(10, 179.9999);
    expect(neighbours(c)).toContain(geohash(10, -179.9999));
  });
});

describe('codes', () => {
  it('a new key is 16 random bytes, base64url', () => {
    const k = newPlaceKey();
    expect(isPlaceKey(k)).toBe(true);
    expect(newPlaceKey()).not.toBe(k);
    for (const bad of [undefined, '', 'short', `${ANA}x`, 'anaanaanaanaanaanaan!1', 42]) expect(isPlaceKey(bad)).toBe(false);
  });
  it('per friend, a cell and its 8 neighbours: "<cells>.<neighbours>", 8 characters each, sorted', async () => {
    const loc = await placeCodes(GYM.lat, GYM.lng, DAY, ANA, [BEN, CAT]);
    expect(loc).toMatch(/^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{128}$/);
    const p = parsePlace(loc)!;
    expect([...p.c]).toEqual([...p.c].sort());
    expect(p.c.size).toBe(2);
    expect(p.n.size).toBe(16);
  });
  it('none without a friend to make them for, a key of yours, or a point (your own key is never a friend’s)', async () => {
    expect(await placeCodes(GYM.lat, GYM.lng, DAY, ANA, [])).toBeNull();
    expect(await placeCodes(GYM.lat, GYM.lng, DAY, ANA, [ANA, 'nope'])).toBeNull();
    expect(await placeCodes(GYM.lat, GYM.lng, DAY, 'nope', [BEN])).toBeNull();
    expect(await placeCodes(NaN, GYM.lng, DAY, ANA, [BEN])).toBeNull();
  });
  it('at most 50 friends a visit', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `friend${String(i).padStart(16, '0')}`);
    expect(parsePlace(await placeCodes(GYM.lat, GYM.lng, DAY, ANA, many))!.c.size).toBe(MAX_FRIENDS);
  });
  it('the point, its cell and its neighbours are nowhere in them', async () => {
    const loc = (await placeCodes(GYM.lat, GYM.lng, DAY, ANA, [BEN, CAT]))!;
    const cell = geohash(GYM.lat, GYM.lng);
    for (const x of ['40.7', '73.9', '4074', '7398', cell.slice(0, 4), ...neighbours(cell).map((n) => n.slice(0, 4))]) expect(loc).not.toContain(x);
  });
});

describe('the same place: only the two of you can tell', () => {
  it('Ana’s codes for Ben and Ben’s for Ana match in one cell, either way round', async () => {
    const a = await codes(GYM, ANA, [BEN, CAT]), b = await codes(GYM, BEN, [ANA]);
    expect(samePlace(a, b)).toBe(true);
    expect(samePlace(b, a)).toBe(true);
  });
  it('the next cell matches (one gym on two cells’ edge); two cells over doesn’t', async () => {
    const a = await codes(GYM, ANA, [BEN]);
    expect(samePlace(a, await codes(east(1), BEN, [ANA]))).toBe(true);
    expect(samePlace(await codes(east(1), BEN, [ANA]), a)).toBe(true);
    expect(samePlace(a, await codes(east(2), BEN, [ANA]))).toBe(false);
    expect(samePlace(await codes(east(2), BEN, [ANA]), a)).toBe(false);
  });
  it('another day, the same cell: other codes (they can’t be joined across days)', async () => {
    expect(samePlace(await codes(GYM, ANA, [BEN]), await codes(GYM, BEN, [ANA], '2026-11-03'))).toBe(false);
  });
  it('Cat, a friend of both, at the same place: her codes match neither Ana’s for Ben nor Ben’s for Ana', async () => {
    const aForBen = await codes(GYM, ANA, [BEN]), bForAna = await codes(GYM, BEN, [ANA]), cat = await codes(GYM, CAT, [ANA, BEN]);
    expect(samePlace(cat, aForBen)).toBe(false);
    expect(samePlace(cat, bForAna)).toBe(false);
    // With her own codes from each, she matches each of them, as a friend at the same place should.
    expect(samePlace(cat, await codes(GYM, ANA, [CAT]))).toBe(true);
  });
  it('a key changed since (switched off and on): no match until the other phone reads the new one', async () => {
    expect(samePlace(await codes(GYM, ANA, [BEN]), await codes(GYM, BEN, ['ananewananewananewana9']))).toBe(false);
  });
});

describe('codes as read (untrusted)', () => {
  it('its own shape only', async () => {
    const loc = (await placeCodes(GYM.lat, GYM.lng, DAY, ANA, [BEN]))!;
    expect(parsePlace(loc)).not.toBeNull();
    for (const bad of [undefined, 7, '', '.', `.${loc.split('.')[1]}`, loc.replace('.', ''), `${loc}.`, `${loc}x`, `a${loc}`, `${loc.replace(/^./, '!')}`, `${'a'.repeat(3600)}.${'b'.repeat(8)}`]) {
      expect(parsePlace(bad)).toBeNull();
    }
  });
});
