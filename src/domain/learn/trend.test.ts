import { describe, expect, it } from 'vitest';
import { flatness, LAYOFF_DAYS, runIndex, slopeOf, trendPrior } from './trend';
import { trendLog, weekEnd, type TrendLift } from './trendSim.sample';
import { learn } from '.';

describe('runIndex', () => {
  it('counts sessions within a run and restarts after a gap of LAYOFF_DAYS or more', () => {
    expect(runIndex([0, 7, 14, 14 + LAYOFF_DAYS - 1, 14 + LAYOFF_DAYS - 1 + LAYOFF_DAYS, 14 + LAYOFF_DAYS - 1 + LAYOFF_DAYS + 7])).toEqual([0, 1, 2, 3, 0, 1]);
    expect(runIndex([])).toEqual([]);
  });
});

describe('slopeOf', () => {
  it('recovers a known slope per week, and its SE from the readings’ variances when they fit', () => {
    const pts = [0, 7, 14, 21, 28].map((day) => ({ day, z: 5 + 0.01 * day / 7, v: 0.0004 }));
    const s = slopeOf(pts)!;
    expect(s.m).toBeCloseTo(0.01, 12);
    expect(s.se).toBeCloseTo(Math.sqrt(0.0004 / 10), 12); // Σ(x−x̄)² = 10 weeks²; Birge ratio floored at 1
    expect(s).toMatchObject({ n: 5, days: 28 });
  });
  it('widens the SE by the Birge ratio when the scatter exceeds the variances', () => {
    const z = [0, 0.05, -0.05, 0.05, 0];
    const tight = slopeOf(z.map((dz, i) => ({ day: i * 7, z: dz, v: 1e-4 })))!;
    const loose = slopeOf(z.map((dz, i) => ({ day: i * 7, z: dz, v: 1 })))!;
    expect(tight.m).toBeCloseTo(loose.m, 12);
    expect(tight.se).toBeGreaterThan(Math.sqrt(1e-4 / 10) * 3);
    expect(loose.se).toBeCloseTo(Math.sqrt(1 / 10), 12);
  });
  it('needs 3 readings over at least 14 days', () => {
    expect(slopeOf([{ day: 0, z: 0, v: 1 }, { day: 20, z: 0, v: 1 }])).toBeNull();
    expect(slopeOf([{ day: 0, z: 0, v: 1 }, { day: 6, z: 0, v: 1 }, { day: 13, z: 0, v: 1 }])).toBeNull();
    expect(slopeOf([{ day: 0, z: 0, v: 1 }, { day: 6, z: 0, v: 1 }, { day: 14, z: 0, v: 1 }])).not.toBeNull();
  });
});

describe('trendPrior and flatness on synthetic logs with known trends', () => {
  const lifts: TrendLift[] = [
    { name: 'Bench Press', E0: 250, step: 5, slope: (w) => (w < 12 ? 0.012 : 0) },
    { name: 'Lat Pulldown', E0: 200, step: 5, slope: (w) => (w < 12 ? 0.012 : 0) },
    { name: 'Leg Press', E0: 500, step: 10, slope: (w) => (w < 12 ? 0.012 : 0) },
    { name: 'Seated Cable Row', E0: 220, step: 5, slope: () => 0.012 },
  ];
  // Six seeded logs: three lifts gain 1.2 %/wk for 12 weeks then hold, one keeps gaining. One 8-week window is noisy (SE ≈ 0.4 %/wk),
  // so the checks are on the averages.
  const cores = [1, 2, 3, 4, 5, 6].map((seed) => learn(trendLog(seed, lifts, { weeks: 24 })).core);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  it('learns a plateau share between the extremes and a progress rate near the true one', () => {
    const ps = cores.map(trendPrior);
    expect(Math.min(...ps.map((p) => p.blocks))).toBeGreaterThanOrEqual(8);
    expect(mean(ps.map((p) => p.pi))).toBeGreaterThan(0.1);
    expect(mean(ps.map((p) => p.pi))).toBeLessThan(0.6);
    expect(mean(ps.map((p) => p.mu.mean))).toBeGreaterThan(0.005);
    expect(mean(ps.map((p) => p.mu.mean))).toBeLessThan(0.015);
    expect(trendPrior(cores[0])).toBe(ps[0]); // cached per core
  });
  it('reads held lifts as flatter than progressing ones, and the same lift flatter after it holds than before', () => {
    const d = weekEnd(23);
    const held = mean(cores.flatMap((c) => ['Bench Press', 'Lat Pulldown', 'Leg Press'].map((n) => flatness(c, n, d)!.p)));
    const going = mean(cores.map((c) => flatness(c, 'Seated Cable Row', d)!.p));
    const before = mean(cores.flatMap((c) => ['Bench Press', 'Lat Pulldown', 'Leg Press'].map((n) => flatness(c, n, weekEnd(10))!.p)));
    expect(held).toBeGreaterThan(0.3);
    expect(going).toBeLessThan(0.15);
    expect(before).toBeLessThan(0.15);
    expect(flatness(cores[0], 'Cable Curl', d)).toBeNull();
  });
  it('a plateau-heavy history never pushes P past even odds on its own: the window has to show it (prior odds capped at 1, c)', () => {
    const flat: TrendLift[] = lifts.map((l, i) => ({ ...l, slope: () => (i === 3 ? 0.015 : 0) }));
    const c = learn(trendLog(3, flat, { weeks: 40 })).core;
    const prior = trendPrior(c);
    expect(prior.pi).toBeGreaterThan(0.5);
    const npdf = (x: number, v: number) => Math.exp(-0.5 * x * x / v) / Math.sqrt(2 * Math.PI * v);
    for (const n of flat.slice(0, 3).map((l) => l.name)) {
      const f = flatness(c, n, weekEnd(39))!;
      const v = f.slope.se ** 2, lr = npdf(f.slope.m, v) / npdf(f.slope.m - f.mu.mean, prior.tau ** 2 + f.mu.sd ** 2 + v);
      expect(f.p).toBeCloseTo(lr / (1 + lr), 9);
    }
  });
});
