import { describe, expect, it } from 'vitest';
import { CATALOG, PATTERNS, VARIATIONS } from './catalog';
import { EQUIPMENT, gearOf, NEEDS } from './equipment';
import { liftKey } from './ids';
import { LIFTS, resolveLift } from './lifts';
import { GOLDEN, GOLDEN_VARIATIONS } from './lifts.golden';
import { MUSCLES, muscleVector } from './muscles';
import { PREFERENCE } from './program';
import { defaultSettings } from './progression';
import { patternOf } from './rotation';

describe('golden: every name the app knew before lifts.ts keeps its facts', () => {
  it('covers the 97 catalog lifts and the 12 names muscles.ts knew without listing', () => {
    expect(GOLDEN).toHaveLength(109);
    expect(GOLDEN.filter((g) => g.listed)).toHaveLength(97);
  });
  for (const g of GOLDEN) {
    it(g.name, () => {
      expect(muscleVector(g.name), 'muscles').toEqual(g.m);
      expect(patternOf(g.name), 'pattern').toBe(g.p);
      expect(resolveLift(g.name).needs, 'gear').toEqual(g.needs);
      expect(gearOf(g.name), 'gear word').toBe(g.gear);
      expect(defaultSettings(g.name, false).repMin >= 10, 'isolation').toBe(g.iso);
      expect(CATALOG.includes(g.name), 'listed').toBe(g.listed);
      if (g.listed) expect(NEEDS[g.name]).toEqual(g.needs);
    });
  }
  it('the catalog keeps its order, and the rotation its variations', () => {
    expect(CATALOG).toEqual(GOLDEN.filter((g) => g.listed).map((g) => g.name));
    expect(VARIATIONS).toEqual(GOLDEN_VARIATIONS);
  });
  it('a different spelling of a known lift still reads its facts (case and spaces)', () => {
    expect(muscleVector('  bench   PRESS ')).toEqual(muscleVector('Bench Press'));
    expect(resolveLift('lat pulldown').how).toBe('catalog');
    expect(resolveLift('Lat Pulldown').lift?.name).toBe('Lat Pulldown');
  });
});

describe('the lifts table', () => {
  it('has every lift once', () => {
    const keys = LIFTS.map((l) => liftKey(l.name));
    expect(keys.length).toBeGreaterThan(100);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });
  it('weights are 1, ¾, ½ or ¼ over the 18 muscles, and every vector has a direct muscle', () => {
    const vectors = LIFTS.flatMap((l) => (l.m ? [[l.name, l.m] as const] : []));
    expect(vectors.length).toBeGreaterThan(100);
    for (const [name, v] of vectors) {
      for (const [m, w] of Object.entries(v)) {
        expect(MUSCLES, `${name}: ${m}`).toContain(m);
        expect([1, 0.75, 0.5, 0.25], `${name}: ${m}`).toContain(w);
      }
      expect(Object.values(v), name).toContain(1);
    }
  });
  it('patterns are the six, gear is gear the app knows', () => {
    for (const l of LIFTS) {
      if (l.p) expect(PATTERNS, l.name).toContain(l.p);
      for (const alt of l.needs ?? []) for (const e of alt) expect(EQUIPMENT, `${l.name}: ${e}`).toContain(e);
    }
  });
  it('a lift with a pattern is in that pattern’s variations, and a variation has the pattern', () => {
    for (const l of LIFTS) if (l.p) expect(VARIATIONS[l.p], l.name).toContain(l.name);
    for (const p of PATTERNS) for (const n of VARIATIONS[p]) expect(resolveLift(n).p, n).toBe(p);
  });
  it('every PREFERENCE lift is a listed lift that trains its muscle directly (Traps: Face Pull, the old default)', () => {
    for (const m of MUSCLES) {
      expect(PREFERENCE[m].length, m).toBeGreaterThan(0);
      for (const n of PREFERENCE[m]) {
        expect(CATALOG, n).toContain(n);
        if (m !== 'Traps') expect(muscleVector(n)?.[m], `${m}: ${n}`).toBe(1);
      }
    }
  });
});

describe('resolveLift', () => {
  it('says how it knows: the table, the words, or not at all', () => {
    expect(resolveLift('Bench Press').how).toBe('catalog');
    expect(resolveLift('Spider Curl')).toMatchObject({ how: 'built', m: { Biceps: 1 }, iso: true, needs: null });
    expect(resolveLift('Zercher Thing')).toMatchObject({ how: 'none', m: null, p: null, needs: null, iso: false });
  });
  it('a pattern from the words, unless the lift is isolation or not one of the six', () => {
    expect(resolveLift('Pendlay Row').p).toBe('Horizontal pull');
    expect(resolveLift('Upright Row').p).toBeNull();
    expect(resolveLift('Straight Arm Pulldown').p).toBeNull();
    expect(resolveLift('Pullover Machine').p).toBeNull();
    expect(resolveLift('Leg Press Calf Raise')).toMatchObject({ iso: true, p: null });
  });
  it('keeps a name it doesn’t list out of the catalog', () => {
    expect(CATALOG).not.toContain('dips');
    expect(resolveLift('Dips')).toMatchObject({ how: 'catalog', needs: null });
  });
});
