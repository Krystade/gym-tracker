import { describe, expect, it } from 'vitest';
import { MUSCLES, type Muscle } from '../../domain/muscles';
import { defaultProfile } from '../../domain/profile';
import { BACK, FRONT } from './paths';
import { legendOf, LIST_ONLY, muscleAt, recoveryTone, recoveryTones, REGIONS, statusTones, weightTone, weightTones, type Side, type Slug } from './regions';

const SHAPES: Record<Side, readonly (readonly [Slug, string])[]> = { front: FRONT, back: BACK };
const order = (side: Side, slug: Slug) => SHAPES[side].findIndex(([s]) => s === slug);

describe('the body map: where each of the 18 muscles is drawn', () => {
  it('maps every muscle, or says it is list-only, and only Abductors is list-only', () => {
    expect(MUSCLES).toHaveLength(18);
    expect(Object.keys(REGIONS).sort()).toEqual([...MUSCLES].sort());
    for (const m of MUSCLES) {
      const r = REGIONS[m];
      if (r === 'list') continue;
      expect(r.length, m).toBeGreaterThan(0);
    }
    expect(LIST_ONLY).toEqual(['Abductors']);
  });

  it('draws every mapped shape: its slug is in that side’s paths, as an SVG path', () => {
    let n = 0;
    for (const m of MUSCLES) {
      const r = REGIONS[m];
      if (r === 'list') continue;
      for (const { side, slug } of r) {
        n++;
        const i = order(side, slug);
        expect(i, `${m}: ${side} ${slug}`).toBeGreaterThanOrEqual(0);
        expect(SHAPES[side][i][1]).toMatch(/^M[\d.]+ [\d.]+[a-zA-Z]/);
      }
    }
    expect(n).toBe(25); // 17 muscles drawn, 6 of them on two shapes and Mid-Back on three
  });

  it('gives each shape one muscle at most, and names it back', () => {
    const seen = new Map<string, Muscle>();
    for (const m of MUSCLES) {
      const r = REGIONS[m];
      if (r === 'list') continue;
      for (const { side, slug } of r) {
        expect(seen.get(`${side}:${slug}`), `${side}:${slug}`).toBeUndefined();
        seen.set(`${side}:${slug}`, m);
        expect(muscleAt(side, slug)).toBe(m);
      }
    }
    for (const [slug] of [...FRONT, ...BACK]) if (['head', 'hair', 'hands', 'feet', 'knees', 'ankles', 'neck', 'tibialis'].includes(slug)) {
      expect(muscleAt('front', slug)).toBeNull();
      expect(muscleAt('back', slug)).toBeNull();
    }
  });

  it('cuts Side Delts, Lats and Mid-Back the way the plan says', () => {
    expect(REGIONS['Side Delts']).toEqual([{ side: 'front', slug: 'deltoids' }]);
    expect(REGIONS['Front Delts']).toEqual([{ side: 'front', slug: 'frontDeltoid' }]);
    // The front head is cut from the deltoid and drawn over it: what's left showing is the side head's cap.
    expect(order('front', 'frontDeltoid')).toBeGreaterThan(order('front', 'deltoids'));
    expect(REGIONS.Lats).toEqual([{ side: 'back', slug: 'upperBack' }]);
    expect(REGIONS['Mid-Back']).toContainEqual({ side: 'back', slug: 'rhomboids' });
    // The rhomboids and the lower trapezius sit inside the trapezius, drawn over it; the traps keep the part above them.
    for (const s of ['rhomboids', 'lowerTrapezius'] as const) expect(order('back', s)).toBeGreaterThan(order('back', 'trapezius'));
    expect(REGIONS.Abs).toEqual([{ side: 'front', slug: 'abs' }, { side: 'front', slug: 'obliques' }]);
  });
});

describe('the body map’s tones', () => {
  it('Stats: the bars’ statuses, and no target for a muscle whose range tops out at 0', () => {
    const p = defaultProfile();
    p.tiers.Calves = 4; // [0, 0]
    const sets = Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
    Object.assign(sets, { Chest: 5, Lats: 9, Biceps: 2, Calves: 3 });
    const t = statusTones(sets, p, 1, Object.fromEntries(MUSCLES.map((m) => [m, 3])) as Record<Muscle, number>);
    expect(t.Chest).toBe('on'); // 4–6
    expect(t.Lats).toBe('over');
    expect(t.Biceps).toBe('pace'); // 2 short, a session left can add 3
    expect(t.Quads).toBe('under'); // 4 short, only 3 to come
    expect(t.Calves).toBe('none');
  });

  it('Why: 80% and up ready, 50 to 79% recovering, under 50% not yet; untrained muscles ready', () => {
    expect([100, 80, 79, 50, 49, 0].map(recoveryTone)).toEqual(['ready', 'ready', 'recovering', 'recovering', 'notyet', 'notyet']);
    const t = recoveryTones([{ muscle: 'Chest', pct: 30 }, { muscle: 'Triceps', pct: 65 }]);
    expect(t.Chest).toBe('notyet');
    expect(t.Triceps).toBe('recovering');
    expect(t.Quads).toBe('ready');
    expect(t.Abductors).toBeUndefined(); // not drawn, not in the table
    expect(recoveryTones([{ muscle: 'Abductors', pct: 40 }]).Abductors).toBe('notyet');
  });

  it('a lift: four steps by what a set counts for, nothing at 0', () => {
    expect([1, 0.75, 0.5, 0.25, 0, -1].map(weightTone)).toEqual(['w100', 'w75', 'w50', 'w25', null, null]);
    // Anything between rounds to the nearest step.
    expect([0.9, 0.7, 0.6, 0.4, 0.3, 0.1].map(weightTone)).toEqual(['w100', 'w75', 'w50', 'w50', 'w25', 'w25']);
    expect(weightTones({ Chest: 1, Triceps: 0.5, 'Front Delts': 0.5 })).toEqual({ Chest: 'w100', Triceps: 'w50', 'Front Delts': 'w50' });
    expect(weightTones(null)).toEqual({});
  });

  it('the legend names each colour painted, in a fixed order, and not a list-only muscle’s', () => {
    expect(legendOf({ Chest: 'over', Lats: 'under', Biceps: 'on' })).toEqual(['under', 'on', 'over']);
    expect(legendOf({ Abductors: 'under', Chest: 'on' })).toEqual(['on']);
    expect(legendOf({})).toEqual([]);
  });
});
