import { describe, expect, it } from 'vitest';
import type { SetEntry } from '../types';
import { e1rm } from '../stats';
import { decay, e1rmAdjusted, fitCore, type Core, type Est } from './capacity';
import { SIM_LIFTS, simulate } from './coreSim.sample';

// Recovery of KNOWN parameters from the synthetic lifter (coreSim.sample: the prototype's simulator, ported).
// Tolerances are stated per test; the person-level ones are the 00-core §9 gates.

const z = (e: Est, truth: number) => (e.mean - truth) / e.sd;
const liftOf = (c: Core, name: string) => [...c.lifts.values()].find((l) => l.name === name)!;
const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / xs.length);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('learn/capacity: synthetic recovery', () => {
  it('person-level A_same, A_cross, γ, ρ and τ: inside the 95 % (τ: 5–95 %) interval in ≥ 90 % of 30 seeds at 50 sessions; z RMS ≤ 1.25', () => {
    const hits = { a: 0, x: 0, g: 0, r: 0, t: 0 };
    const zs: Record<'a' | 'x' | 'g' | 'r', number[]> = { a: [], x: [], g: [], r: [] };
    for (let seed = 1; seed <= 30; seed++) {
      const { entries, truth } = simulate(seed, { sessions: 50, backoff: seed % 2 === 0 });
      const c = fitCore(entries);
      const q = { a: z(c.aSame, truth.aSame), x: z(c.aCross, truth.aCross), g: z(c.gamma, truth.gamma), r: z(c.rho, truth.rho) };
      for (const k of ['a', 'x', 'g', 'r'] as const) { zs[k].push(q[k]); if (Math.abs(q[k]) < 1.96) hits[k]++; }
      if (truth.tau >= c.tau.lo && truth.tau <= c.tau.hi) hits.t++;
    }
    for (const k of ['a', 'x', 'g', 'r', 't'] as const) expect(hits[k], k).toBeGreaterThanOrEqual(27);
    for (const k of ['a', 'x', 'g', 'r'] as const) expect(rms(zs[k]), k).toBeLessThanOrEqual(1.25);
  });

  it('γ (reps per prior hard set of another lift) is recovered with < 25 % bias at 150 sessions', () => {
    const est: number[] = [];
    for (let seed = 1; seed <= 12; seed++) est.push(fitCore(simulate(seed, { sessions: 150 }).entries).gamma.mean);
    expect(Math.abs(mean(est) / 0.08 - 1)).toBeLessThan(0.25);
  });

  it('per lift: κ (with back-off sets) in its 95 % interval for ≥ 90 % of lifts; the same-lift loss per set at the usual gap for ≥ 80 % (its SD is conditional on the fitted τ, ρ)', () => {
    let n = 0, hk = 0, ha = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { entries, truth } = simulate(seed, { sessions: 150, backoff: true });
      const c = fitCore(entries);
      const g = 280, Kt = truth.rho + (1 - truth.rho) * Math.exp(-g / truth.tau), Kf = decay(c, g);
      SIM_LIFTS.forEach((l, i) => {
        const L = liftOf(c, l.name);
        n++;
        if (Math.abs(z(L.kappa, truth.kappa[i])) < 1.96) hk++;
        if (Math.abs((L.aSame.mean * Kf - truth.aLift[i] * Kt) / (L.aSame.sd * Kf)) < 1.96) ha++;
      });
    }
    expect(hk / n).toBeGreaterThanOrEqual(0.9);
    expect(ha / n).toBeGreaterThanOrEqual(0.8);
  });

  it('κ is learned only from loads changed within a session; without any it stays on the population curve with its prior SD', () => {
    const c = fitCore(simulate(3, { sessions: 150 }).entries);
    for (const l of c.lifts.values()) {
      expect(l.kappa.mean).toBeCloseTo(30, 0);
      expect(l.kappa.sd / l.kappa.mean).toBeGreaterThan(0.3);
    }
  });

  it('target-stopped sets are censored: κ unbiased (|mean log error| < 0.05); read as equalities, the same data bias it by > 25 %', () => {
    const err = (censor: boolean) => {
      const xs: number[] = [];
      for (let seed = 1; seed <= 6; seed++) {
        const { entries, truth } = simulate(seed, { sessions: 150, targets: true, backoff: true });
        const c = fitCore(entries, { censor });
        SIM_LIFTS.forEach((l, i) => xs.push(Math.log(liftOf(c, l.name).kappa.mean / truth.kappa[i])));
      }
      return mean(xs);
    };
    expect(Math.abs(err(true))).toBeLessThan(0.05);
    expect(err(false)).toBeLessThan(-0.25);
  });

  it('the fatigue-adjusted e1RM cuts the late-set bias (set 3+ against set 1) by at least half', () => {
    const late = { raw: [] as number[], adj: [] as number[] }, first = { raw: [] as number[], adj: [] as number[] };
    for (let seed = 1; seed <= 6; seed++) {
      const { entries, sets } = simulate(seed, { sessions: 120 });
      const c = fitCore(entries);
      for (const e of entries.slice(entries.length >> 1)) {
        const E = sets.get(e.id)!.E, r = Math.log(e1rm(e)! / E), a = Math.log(e1rmAdjusted(c, e)! / E);
        if (e.setNo >= 3) { late.raw.push(r); late.adj.push(a); } else if (e.setNo === 1) { first.raw.push(r); first.adj.push(a); }
      }
    }
    const rawGap = mean(late.raw) - mean(first.raw), adjGap = mean(late.adj) - mean(first.adj);
    expect(rawGap).toBeLessThan(-0.005); // the plain reading does fall on tired sets
    expect(Math.abs(adjGap)).toBeLessThan(Math.abs(rawGap) / 2);
  });
});

describe('learn/capacity: incremental equals batch', () => {
  // A deep copy shares no objects with the original, so it sees no cached session features: a cold, full refit.
  const cold = (es: readonly SetEntry[]) => es.map((e) => structuredClone(e));
  const numbers = (c: Core) => JSON.stringify(c, (_, v) => (v instanceof Map ? [...v] : v instanceof Float64Array ? [...v] : typeof v === 'number' ? +v.toPrecision(10) : v));

  it('a fit that reuses cached sessions equals a cold refit (appending sets, and editing an old session)', () => {
    const { entries } = simulate(7, { sessions: 60 });
    const early = entries.slice(0, entries.length - 20);
    fitCore(early); // warms the cache
    expect(numbers(fitCore(entries))).toBe(numbers(fitCore(cold(entries))));
    // Edit a set in an old session (the store replaces the object): the session's features must be rebuilt.
    // A set in the middle of its day (not the first, which keys the cache), renamed to another lift.
    const at = entries.findIndex((e, i) => i > 20 && entries[i - 1].date === e.date && entries[i + 1]?.date === e.date);
    const edited = entries.map((e, i) => (i === at ? { ...e, exercise: 'Lat Pulldown', reps: (e.reps as number) + 3 } : e));
    const warm = fitCore(edited);
    expect(numbers(warm)).toBe(numbers(fitCore(cold(edited))));
    expect(numbers(warm)).not.toBe(numbers(fitCore(entries)));
  });

  it('an empty log or a single set gives the priors without throwing', () => {
    const c0 = fitCore([]);
    expect(c0.lifts.size).toBe(0);
    expect(c0.aSame.mean).toBeCloseTo(1, 6);
    const one = simulate(1, { sessions: 1 }).entries.slice(0, 1);
    expect(fitCore(one).lifts.size).toBe(1);
  });
});
