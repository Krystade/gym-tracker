import { describe, expect, it } from 'vitest';
import { AWAY_MIN_POINTS, AWAY_PRIOR_SD, awayShift, awaySlope, type AwayPoint } from './away';

// Worked by hand: x̄ 7, r̄ 0.5, Sxx 200, Sxy 40, so least squares gives 0.2 a day; its residuals are ±0.5, s² = 2/6. Under the
// N(0, 0.05²) prior the precision is 200·3 + 400 = 1000, so c = 40·3 / 1000 = 0.12 and its SD √(1/1000).
const HAND: AwayPoint[] = [[2, -1], [2, 0], [2, -1], [2, 0], [12, 1], [12, 2], [12, 1], [12, 2]].map(([x, r]) => ({ x, r }));

describe('awaySlope: the per-day coefficient, shrunk toward none', () => {
  it('a worked example: 0.2 a day read, 0.12 kept under the prior', () => {
    expect(AWAY_PRIOR_SD).toBe(0.05);
    const f = awaySlope(HAND);
    expect(f.ols).toBeCloseTo(0.2, 9);
    expect(f.c).toBeCloseTo(0.12, 9);
    expect(f.sd).toBeCloseTo(Math.sqrt(1 / 1000), 9);
    expect(f).toMatchObject({ ref: 7, n: 8 });
    // No prior: least squares itself.
    expect(awaySlope(HAND, Infinity).c).toBeCloseTo(0.2, 9);
  });
  it('the same sessions read more noisily keep less (the prior weighs more against a looser fit)', () => {
    const noisy = HAND.map((p, i) => ({ ...p, r: p.r + (i % 2 ? 1.5 : -1.5) }));
    const f = awaySlope(noisy);
    expect(f.ols).toBeCloseTo(0.2, 9);
    expect(f.c).toBeGreaterThan(0);
    expect(f.c).toBeLessThan(0.06);
  });
  it('nothing to fit: no points, too few, or every one the same days away', () => {
    expect(awaySlope([]).c).toBe(0);
    expect(awaySlope(HAND.slice(0, AWAY_MIN_POINTS - 1)).c).toBe(0);
    expect(awaySlope(HAND.map((p) => ({ ...p, x: 5 }))).c).toBe(0);
  });
  it('many sessions pin a real slope: shrunk a little, not to none', () => {
    // 0.3 a day, a fixed ±1 wobble, 200 sessions over 1–14 days.
    const pts = Array.from({ length: 200 }, (_, i) => { const x = 1 + (i % 14); return { x, r: 0.3 * (x - 7.5) + (i % 3 === 0 ? 1 : i % 3 === 1 ? -1 : 0) }; });
    const f = awaySlope(pts);
    expect(f.c).toBeGreaterThan(0.25);
    expect(f.c).toBeLessThan(f.ols!);
  });
});

describe('awayShift: whole reps a set at a number of days away', () => {
  const fit = { c: 0.12, ref: 7, sd: 0.03, n: 40, ols: 0.2 };
  it('c × (days − his usual), rounded', () => {
    expect(awayShift(fit, 12, 15)).toBe(1); // +0.6
    expect(awayShift(fit, 2, 15)).toBe(-1); // −0.6
    expect(awayShift(fit, 9, 15)).toBe(0); // +0.24
    expect(awayShift({ ...fit, c: 0.3 }, 14, 15)).toBe(2); // +2.1
  });
  it('capped at 14 days, and none from the layoff on or under a day', () => {
    expect(awayShift({ ...fit, c: 0.3 }, 14, 99)).toBe(awayShift({ ...fit, c: 0.3 }, 30, 99));
    expect(awayShift({ ...fit, c: 0.3 }, 13, 99)).toBe(2); // 1.8, under the cap
    expect(awayShift(fit, 15, 15)).toBe(0);
    expect(awayShift(fit, 40, 15)).toBe(0);
    expect(awayShift(fit, 0, 15)).toBe(0);
  });
  it('half a rep moves alike either way', () => {
    expect(awayShift({ ...fit, c: 0.1 }, 12, 15)).toBe(1);
    expect(awayShift({ ...fit, c: 0.1 }, 2, 15)).toBe(-1);
  });
  it('no coefficient: nothing moves', () => {
    expect(awayShift({ ...fit, c: 0 }, 14, 15)).toBe(0);
  });
});
