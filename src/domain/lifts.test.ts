import { describe, expect, it } from 'vitest';
import { CATALOG, COMMON, PATTERNS, PROGRAM_LIFTS, VARIATIONS } from './catalog';
import { EQUIPMENT, gearOf, NEEDS } from './equipment';
import { LIFTS, resolveLift, wordKey } from './lifts';
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
  it('the catalog keeps its order (the new lifts after), and the rotation its variations', () => {
    expect(CATALOG.slice(0, 97)).toEqual(GOLDEN.filter((g) => g.listed).map((g) => g.name));
    expect(VARIATIONS).toEqual(GOLDEN_VARIATIONS);
  });
  it('a different spelling of a known lift still reads its facts (case and spaces)', () => {
    expect(muscleVector('  bench   PRESS ')).toEqual(muscleVector('Bench Press'));
    expect(resolveLift('lat pulldown').how).toBe('catalog');
    expect(resolveLift('Lat Pulldown').lift?.name).toBe('Lat Pulldown');
  });
});

describe('the lifts table', () => {
  it('has every lift once, in any spelling that folds to the same words', () => {
    const keys = LIFTS.map((l) => wordKey(l.name));
    expect(keys.length).toBeGreaterThan(260);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });
  it('every name and other name reads as one lift: no other name is another lift’s name or another’s other name', () => {
    const all = LIFTS.flatMap((l) => [l.name, ...(l.aka ?? [])].map((n) => [wordKey(n), l.name] as const));
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const [k, n] of all) { if (seen.has(k)) clashes.push(`${k}: ${seen.get(k)} / ${n}`); seen.set(k, n); }
    expect(clashes).toEqual([]);
    expect(all.length - LIFTS.length, 'other names').toBeGreaterThan(150);
    for (const l of LIFTS) for (const a of l.aka ?? []) expect(resolveLift(a), a).toMatchObject({ how: 'alias', lift: l, m: l.m });
  });
  it('about 120 common lifts; the builder’s pool is the lifts listed before round 15 plus the shrugs', () => {
    expect(COMMON.length).toBeGreaterThanOrEqual(110);
    expect(COMMON.length).toBeLessThanOrEqual(130);
    expect(PROGRAM_LIFTS).toEqual([...GOLDEN.filter((g) => g.listed).map((g) => g.name), 'DB Shrug', 'Barbell Shrug']);
  });
  it('weights are 1, ¾, ½ or ¼ over the 18 muscles, and every vector has a direct muscle', () => {
    const vectors = LIFTS.flatMap((l) => (l.m ? [[l.name, l.m] as const] : []));
    expect(vectors.length).toBeGreaterThan(100);
    for (const [name, v] of vectors) {
      for (const [m, w] of Object.entries(v)) {
        expect(MUSCLES, `${name}: ${m}`).toContain(m);
        expect([1, 0.75, 0.5, 0.25], `${name}: ${m}`).toContain(w);
      }
      // {}: a lift for no muscle the app tracks (neck, shins, rotator cuff; owner, Q2).
      if (Object.keys(v).length) expect(Object.values(v), name).toContain(1);
      else expect(name, 'counts for nothing').toMatch(/neck|tibialis|rotation/i);
    }
  });
  it('patterns are the six, gear is gear the app knows', () => {
    for (const l of LIFTS) {
      if (l.p) expect(PATTERNS, l.name).toContain(l.p);
      for (const alt of l.needs ?? []) for (const e of alt) expect(EQUIPMENT, `${l.name}: ${e}`).toContain(e);
    }
  });
  it('a program lift with a pattern is in that pattern’s variations, and a variation has the pattern', () => {
    // Other lifts with a pattern rotate in only once logged or added to the gym (rotation reads those too).
    for (const l of LIFTS) if (l.p && l.program) expect(VARIATIONS[l.p], l.name).toContain(l.name);
    for (const p of PATTERNS) for (const n of VARIATIONS[p]) expect(resolveLift(n).p, n).toBe(p);
  });
  it('every PREFERENCE lift is a program lift that trains its muscle directly (Traps: Face Pull, the old default, after the shrugs)', () => {
    for (const m of MUSCLES) {
      expect(PREFERENCE[m].length, m).toBeGreaterThan(0);
      for (const n of PREFERENCE[m]) {
        expect(PROGRAM_LIFTS, n).toContain(n);
        if (n !== 'Face Pull' || m !== 'Traps') expect(muscleVector(n)?.[m], `${m}: ${n}`).toBe(1);
      }
    }
  });
});

describe('resolveLift', () => {
  it('says how it knows: the table, the words, or not at all', () => {
    expect(resolveLift('Bench Press').how).toBe('catalog');
    expect(resolveLift('Cable Spider Curl')).toMatchObject({ how: 'built', m: { Biceps: 1 }, iso: true, needs: [['cable stack']] });
    expect(resolveLift('Dips')).toMatchObject({ how: 'alias', lift: { name: 'Forward-Lean Dips' } });
    expect(resolveLift('Zercher Thing')).toMatchObject({ how: 'none', m: null, p: null, needs: null, iso: false });
  });
  it('a pattern from the words, unless the lift is isolation or not one of the six', () => {
    expect(resolveLift('Pendlay Row').p).toBe('Horizontal pull');
    expect(resolveLift('Upright Row').p).toBeNull();
    expect(resolveLift('Straight Arm Pulldown').p).toBeNull();
    expect(resolveLift('Pullover Machine').p).toBeNull();
    expect(resolveLift('Leg Press Calf Raise')).toMatchObject({ iso: true, p: null });
  });
  it('lists a lift by its own name, never by another it goes by', () => {
    expect(CATALOG).not.toContain('Dips');
    expect(CATALOG).toContain('Forward-Lean Dips');
    expect(resolveLift('dips')).toMatchObject({ how: 'alias', needs: [['dip station']] });
  });
});
