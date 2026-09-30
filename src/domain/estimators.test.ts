import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { calibrate, calibratedE1rm, oneRm, testDue, weightForReps } from './estimators';

let seq = 0;
const s = (date: string, weight: number, reps: number, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `t${seq}`, date, seq: seq++, exercise: 'Curl', setNo: 1, weight, reps, flags: [], source: 't', ...over,
});

describe('oneRm', () => {
  it('matches Epley and the weight-dependent formula', () => {
    expect(oneRm('epley', 100, 10)).toBeCloseTo(133.33, 1);
    // 100 lb = 45.36 kg; wd factor = 1 + 9^0.85/(−2.55+4.58·ln 45.36) = 1 + 6.47/14.92
    expect(oneRm('wd', 100, 10)).toBeCloseTo(143.4, 0);
    expect(oneRm('wd', 100, 1)).toBe(100);
  });
  it('stays finite and positive at very light loads (falls back to Epley below 4 kg)', () => {
    const v = oneRm('wd', 5, 12)!;
    expect(Number.isFinite(v) && v > 5).toBe(true);
    expect(v).toBeCloseTo(oneRm('epley', 5, 12)!, 5);
  });
  it('rejects unusable sets', () => {
    expect(oneRm('epley', 0, 10)).toBeNull();
    expect(oneRm('wd', 100, 0)).toBeNull();
    expect(oneRm('wd', 100, 31)).toBeNull();
  });
  it('inverts both formulas', () => {
    expect(weightForReps('epley', 120, 6)).toBeCloseTo(100, 3);
    const w = weightForReps('wd', 143.4, 10);
    expect(oneRm('wd', w, 10)).toBeCloseTo(143.4, 1);
  });
});

describe('calibration', () => {
  it('defaults to uncalibrated Epley with no tests', () => {
    expect(calibrate([s('2026-01-01', 30, 10)], 'Curl')).toEqual({ formula: 'epley', factor: 1, tests: 0, errorPct: null });
  });
  it('learns a factor from test sets and prefers the formula with lower error', () => {
    // Training sets predict ~40 (Epley); the to-failure test at 30 lb went 16 reps (Epley 1RM 46) → Epley under-predicts by ~15%.
    const e = [s('2026-01-01', 30, 10), s('2026-01-08', 30, 10), s('2026-02-15', 30, 16, { flags: ['test'], rir: 0 })];
    const c = calibrate(e, 'Curl');
    expect(c.tests).toBe(1);
    expect(c.factor).toBeGreaterThan(1);
    expect(c.factor).toBeLessThanOrEqual(1.2);
    expect(calibratedE1rm(e, 'Curl', '2026-02-15')!).toBeGreaterThan(oneRm(c.formula, 30, 10)!);
  });
  it('flags a test as due after 6 weeks for a regularly trained lift', () => {
    const e = ['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07'].map((d) => s(d, 30, 10));
    expect(testDue(e, 'Curl', '2026-09-30')).toBe(true);
    expect(testDue([...e, s('2026-09-01', 30, 14, { flags: ['test'] })], 'Curl', '2026-09-30')).toBe(false);
    expect(testDue(e.slice(0, 2), 'Curl', '2026-09-30')).toBe(false);
  });
});
