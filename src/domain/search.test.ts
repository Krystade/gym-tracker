import { describe, expect, it } from 'vitest';
import { COMMON } from './catalog';
import { liftsBeforeSearch, searchLifts } from './search';

describe('searching for a lift', () => {
  it('typed words in any order, each the start of a word: "inc db pr" is Incline DB Press', () => {
    expect(searchLifts('inc db pr', [])[0]).toBe('Incline DB Press');
    expect(searchLifts('dumbbell incline', [])).toContain('Incline DB Press');
    expect(searchLifts('press incline db', [])[0]).toBe('Incline DB Press');
    expect(searchLifts('inc db pr', [])).not.toContain('Flat DB Press');
  });
  it('finds a lift by another name it goes by, and lists it by its own', () => {
    expect(searchLifts('skull crusher ez', [])).toContain('EZ-Bar Skullcrusher');
    expect(searchLifts('hex bar', [])).toContain('Trap Bar Deadlift');
    expect(searchLifts('yates', [])).toEqual(['Reverse-Grip Barbell Row']);
    expect(searchLifts('dumbbell bicep curl', [])).toContain('DB Curl');
  });
  it('ranks logged names, then names starting with the first word, then common lifts, then the rest', () => {
    const r = searchLifts('curl', ['Spider Curl Thing']);
    expect(r[0]).toBe('Spider Curl Thing');
    // Starts with "curl"? none does; common (DB Curl) before uncommon (Zottman Curl).
    expect(r.indexOf('DB Curl')).toBeLessThan(r.indexOf('Zottman Curl'));
    const s = searchLifts('row', []);
    // "Row" alone starts no catalog name but rows; a common row ranks before an uncommon one.
    expect(s.indexOf('Seated Cable Row')).toBeLessThan(s.indexOf('Smith Row'));
    const b = searchLifts('bench', []);
    // Bench Dip (uncommon) starts with the word, so it beats Incline Bench Press (common) that only contains it.
    expect(b.indexOf('Bench Dip')).toBeLessThan(b.indexOf('Incline Bench Press'));
    expect(b[0]).toBe('Bench Press');
  });
  it('leaves out a catalog lift his own name already stands for, by its name or another', () => {
    expect(searchLifts('dip', ['Dips'])).toContain('Dips');
    expect(searchLifts('dip', ['Dips'])).not.toContain('Forward-Lean Dips');
    expect(searchLifts('dip', [])).toContain('Forward-Lean Dips');
    expect(searchLifts('bench', ['bench press'])).not.toContain('Bench Press');
    expect(searchLifts('bench', ['bench press'])[0]).toBe('bench press');
  });
  it('nothing typed: logged, then the common lifts, not all of them', () => {
    const before = liftsBeforeSearch(['Dips', 'Mystery Lift']);
    expect(before.slice(0, 2)).toEqual(['Dips', 'Mystery Lift']);
    expect(before).not.toContain('Forward-Lean Dips');
    expect(before).toContain('Bench Press');
    expect(before).not.toContain('Zottman Curl');
    expect(searchLifts('  ', [])).toEqual(liftsBeforeSearch([]));
    expect(COMMON.length).toBeGreaterThanOrEqual(110);
    expect(COMMON.length).toBeLessThanOrEqual(130);
  });
  it('a half-typed word is not folded as a plural', () => {
    expect(searchLifts('pres', [])).toContain('Bench Press');
    expect(searchLifts('curls', [])).toContain('DB Curl');
  });
});
