import { describe, expect, it } from 'vitest';
import { setWorksLike } from '../lifts';
import { catalogTags, equipSimilarity, liftSimilarity, overlap, tagsOf } from './tags';
import { resolveLift } from '../lifts';

describe('learn/tags', () => {
  it('tags every catalog lift with a movement and an implement', () => {
    const missing = catalogTags().filter((x) => !x.tags.move || !x.tags.imp).map((x) => x.name);
    expect(missing).toEqual([]);
  });

  it('reads the implement, angle, grip and side from the name', () => {
    expect(tagsOf('Incline DB Press')).toMatchObject({ move: 'Horizontal press', imp: 'dumbbell', ang: 'incline' });
    expect(tagsOf('Decline Bench Press')).toMatchObject({ imp: 'barbell', ang: 'decline' });
    expect(tagsOf('Close-Grip Bench Press').grip).toBe('close');
    expect(tagsOf('Cable Kickback').move).toBe('glute');
    expect(tagsOf('Single-Arm Cable Row').uni).toBe(true);
    expect(tagsOf('Seated Cable Row')).toMatchObject({ move: 'Horizontal pull', imp: 'cable', uni: false });
  });

  it('every gear class pools with at least two catalog lifts of the same movement', () => {
    const by = new Map<string, number>();
    for (const { tags } of catalogTags()) { const k = `${tags.move}|${tags.imp}`; by.set(k, (by.get(k) ?? 0) + 1); }
    for (const imp of ['barbell', 'dumbbell', 'cable', 'machine']) expect([...by].some(([k, n]) => k.endsWith(`|${imp}`) && n >= 2)).toBe(true);
  });

  it('similarity: 1 for the same lift, 0 across movements, ordered by how close the variation is', () => {
    expect(liftSimilarity('bench press', 'bench press')).toBeCloseTo(1, 9);
    expect(liftSimilarity('bench press', 'lat pulldown')).toBe(0);
    const flatDb = liftSimilarity('bench press', 'db bench press');
    const inclineDb = liftSimilarity('bench press', 'incline db press');
    const machine = liftSimilarity('bench press', 'machine chest press');
    expect(flatDb).toBeGreaterThan(inclineDb);
    expect(flatDb).toBeGreaterThan(machine);
    expect(flatDb).toBeLessThan(1);
  });

  it('equipment similarity: same > same cluster > across clusters', () => {
    expect(equipSimilarity('barbell', 'barbell')).toBe(1);
    expect(equipSimilarity('barbell', 'dumbbell')).toBeGreaterThan(equipSimilarity('barbell', 'cable'));
    expect(equipSimilarity('cable', 'machine')).toBeGreaterThan(equipSimilarity('cable', 'bodyweight'));
  });

  it('overlap is the share of the lift\'s muscles a prior lift already worked (1 for itself, 0 for disjoint)', () => {
    const bench = resolveLift('Bench Press').m, curl = resolveLift('DB Curl').m, legPress = resolveLift('Leg Press').m;
    expect(overlap(bench, bench)).toBeCloseTo(1, 9);
    expect(overlap(legPress, curl)).toBe(0);
    expect(overlap(bench, resolveLift('Cable Pushdown').m)).toBeGreaterThan(0);
  });

  it('follows "works like" links and drops cached tags when the lift facts change', () => {
    expect(tagsOf('Zorbo Thing').move).toBeNull();
    setWorksLike([['Zorbo Thing', 'Lat Pulldown']]);
    try { expect(tagsOf('Zorbo Thing').move).toBe('Vertical pull'); } finally { setWorksLike([]); }
    expect(tagsOf('Zorbo Thing').move).toBeNull();
  });
});
