import { describe, expect, it } from 'vitest';
import type { SetEntry } from '../types';
import { setWorksLike } from '../lifts';
import { liftKey } from '../ids';
import { e1rm } from '../stats';
import { B_PRIOR, decay, e1rmAdjusted, fitCore, type Core, type Est } from './capacity';
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

  it('00-core §9 gate: per-lift loss per set (A·K at the usual gap) — EB RMSE below no pooling and within 2× of complete pooling', () => {
    for (const sessions of [50, 150]) for (const backoff of [false, true]) {
      const eb: number[] = [], none: number[] = [], all: number[] = [];
      for (let seed = 1; seed <= 12; seed++) {
        const { entries, truth } = simulate(seed, { sessions, backoff });
        const c = fitCore(entries);
        const g = 280, Kt = truth.rho + (1 - truth.rho) * Math.exp(-g / truth.tau), Kf = decay(c, g);
        SIM_LIFTS.forEach((l, i) => {
          const L = liftOf(c, l.name), t = truth.aLift[i] * Kt;
          expect(L.aSameOwn).not.toBeNull();
          eb.push(L.aSame.mean * Kf - t); none.push(L.aSameOwn!.mean * Kf - t); all.push(c.fit.theta[0] * Kf - t);
        });
      }
      expect(eb.length).toBe(120);
      expect(rms(eb), `${sessions} sessions, back-off ${backoff}`).toBeLessThan(rms(none));
      expect(rms(eb), `${sessions} sessions, back-off ${backoff}`).toBeLessThan(2 * rms(all));
    }
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

  it('ramp and back-off sets without RIR are lower bounds: easy back-offs (the first set’s reps again, lighter) leave κ, A_same and the noise alone; read by the habit they drag κ to its floor', () => {
    const fit = (light: boolean) => {
      const k: number[] = [], a: number[] = [], n: number[] = [];
      for (let seed = 1; seed <= 6; seed++) {
        const { entries, truth } = simulate(seed, { sessions: 150, backoff: true, easyBackoff: true, pLog: 0 });
        const c = fitCore(entries, { light });
        SIM_LIFTS.forEach((l, i) => k.push(Math.log(liftOf(c, l.name).kappa.mean / truth.kappa[i])));
        a.push(z(c.aSame, truth.aSame)); n.push(c.noise);
      }
      return { k: mean(k), a: mean(a), n: mean(n) };
    };
    const on = fit(true), off = fit(false);
    // No RIR and no other load contrast: κ stays on its prior (the truth sits 0.1 above it in logs on average).
    expect(Math.abs(on.k + 0.1)).toBeLessThan(0.1);
    expect(Math.abs(on.a)).toBeLessThan(1);
    expect(on.n).toBeLessThan(0.7);
    expect(off.k).toBeLessThan(-0.5);
    expect(off.a).toBeGreaterThan(2);
    expect(off.n).toBeGreaterThan(2);
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

  it('cached rows are reused only up to the first session that changed (a deleted session, a new lift, another log in between)', () => {
    const { entries } = simulate(8, { sessions: 40, backoff: true });
    fitCore(entries);
    // A whole session deleted from the middle: every later session moves up.
    const day = entries[entries.length >> 1].date;
    const dropped = entries.filter((e) => e.date !== day);
    expect(numbers(fitCore(dropped))).toBe(numbers(fitCore(cold(dropped))));
    // A lift seen for the first time in the last session, after a fit that never saw it.
    const last = entries.at(-1)!;
    const withNew = [...entries, { ...last, id: `${last.id}|new`, exercise: 'Hack Squat', weight: 200, reps: 8, seq: last.seq + 1 }];
    fitCore(entries);
    expect(numbers(fitCore(withNew))).toBe(numbers(fitCore(cold(withNew))));
    // Then the original again (the new lift must be gone), after another profile's log in between.
    fitCore(simulate(9, { sessions: 20 }).entries);
    expect(numbers(fitCore([...entries]))).toBe(numbers(fitCore(cold(entries))));
  });

  it('new lift facts rebuild every session; a new typical gap rebuilds the untimed ones; censoring never sticks to the rows', () => {
    const { entries } = simulate(10, { sessions: 50, timedFrac: 0.5, targets: true });
    fitCore(entries);
    // "Works like": Cable Curl now counts as Bench Press (its muscles, so its overlaps with the other lifts, change).
    setWorksLike([['Cable Curl', 'Bench Press']]);
    try {
      expect(numbers(fitCore([...entries]))).toBe(numbers(fitCore(cold(entries))));
    } finally { setWorksLike([]); }
    expect(numbers(fitCore([...entries]))).toBe(numbers(fitCore(cold(entries))));
    // Timed days spaced twice as far apart: the typical gap moves, and with it every untimed day's set times.
    const slow = entries.map((e) => (e.loggedAt ? { ...e, loggedAt: new Date(Date.parse(`${e.date}T17:00:00Z`) + 2 * (Date.parse(e.loggedAt) - Date.parse(`${e.date}T17:00:00Z`))).toISOString() } : e));
    const before = fitCore(entries), after = fitCore(slow);
    expect(after.gap).not.toBe(before.gap);
    expect(numbers(after)).toBe(numbers(fitCore(cold(slow))));
    // The negative control on the cached rows, then straight away the censored fit on the same rows.
    fitCore([...entries]);
    const uncensored = fitCore([...entries], { censor: false });
    const censored = fitCore([...entries]);
    expect(numbers(uncensored)).toBe(numbers(fitCore(cold(entries), { censor: false })));
    expect(numbers(censored)).toBe(numbers(fitCore(cold(entries))));
    expect(numbers(censored)).not.toBe(numbers(uncensored));
  });

  it('an empty log or a single set gives the priors without throwing', () => {
    const c0 = fitCore([]);
    expect(c0.lifts.size).toBe(0);
    expect(c0.aSame.mean).toBeCloseTo(1, 6);
    const one = simulate(1, { sessions: 1 }).entries.slice(0, 1);
    expect(fitCore(one).lifts.size).toBe(1);
  });
});

describe('learn/capacity: test sets teach the RIR bias and the habit (00-core §1.2)', () => {
  // The lifter under-reports RIR by ~2.5 (the prior says 0.95), stops 4 short of failure and logs RIR on half the sets; a third of
  // sessions open with a test. Every lift's true reps–load slope is Epley's 30, so what is measured is b alone.
  const truth = { b: 2.5, muR: 4, kappa: Array<number>(10).fill(30) };
  type Sim = ReturnType<typeof simulate>;
  /** The bias logged RIR really carries in a simulated log (the simulator clamps logged RIR to 0–4): mean(true left − logged). */
  const bEff = ({ entries, sets }: Sim) => mean(entries.filter((e) => e.rir != null && e.rir < 4 && !e.flags.includes('test')).map((e) => sets.get(e.id)!.left - e.rir!));
  /** Mean log error of the smoothed level over every session's latent truth. */
  const levelErr = (c: Core, { entries, sets }: Sim) => {
    const errs: number[] = [];
    for (const l of c.lifts.values()) for (const at of l.level) {
      const e = entries.find((x) => x.exercise === l.name && x.date === at.date)!;
      errs.push(at.x - Math.log(sets.get(e.id)!.E));
    }
    return mean(errs);
  };

  it('b is recovered: z against the truth inside ±2 in ≥ 9 of 10 seeds, its SD under a third of the prior; unlearned it stays at the prior', () => {
    let hits = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const sim = simulate(seed, { sessions: 120, pLog: 0.5, testFrac: 0.35, truth });
      const c = fitCore(sim.entries), b = bEff(sim);
      expect(b).toBeGreaterThan(2); // the negative control below needs a truth far from the prior
      expect(c.tests).toBeGreaterThan(20);
      if (Math.abs(z(c.bias, b)) < 2) hits++;
      expect(c.bias.sd).toBeLessThan(B_PRIOR.sd / 3);
      const off = fitCore(sim.entries, { learnBias: false });
      expect(off.bias).toEqual({ mean: B_PRIOR.mean, sd: B_PRIOR.sd });
      expect(Math.abs(z({ mean: off.bias.mean, sd: c.bias.sd }, b))).toBeGreaterThan(2); // the prior is well outside what was learned
    }
    expect(hits).toBeGreaterThanOrEqual(9);
  });

  it('a learned b takes the bias out of the e1RM level: |error| at least halved, under 1.5 %', () => {
    const on: number[] = [], off: number[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const sim = simulate(seed, { sessions: 120, pLog: 0.5, testFrac: 0.35, truth });
      on.push(levelErr(fitCore(sim.entries), sim));
      off.push(levelErr(fitCore(sim.entries, { learnBias: false }), sim));
    }
    expect(mean(off)).toBeLessThan(-0.02); // the prior b under-reads every RIR set: the level sits low
    expect(Math.abs(mean(on))).toBeLessThan(Math.abs(mean(off)) / 2);
    expect(Math.abs(mean(on))).toBeLessThan(0.015);
  });

  it('with no RIR logged at all, tests teach the habit (true RIR 3.5 against a prior of 2) and lift the level to the truth', () => {
    const t = { muR: 3.5, kappa: Array<number>(10).fill(30) };
    const on: number[] = [], off: number[] = [], habit: number[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const sim = simulate(seed, { sessions: 120, pLog: 0, testFrac: 0.35, truth: t });
      const c = fitCore(sim.entries);
      habit.push(c.habit.mean);
      on.push(levelErr(c, sim));
      off.push(levelErr(fitCore(sim.entries, { learnBias: false }), sim));
    }
    expect(Math.abs(mean(habit) - 3.5)).toBeLessThan(0.5);
    expect(mean(off)).toBeLessThan(-0.02);
    expect(Math.abs(mean(on))).toBeLessThan(Math.abs(mean(off)) / 2);
  });

  it('the systematic SD: carried by every lift before a test, smaller after tests, ~0 for a lift read only from tests', () => {
    const { entries } = simulate(4, { sessions: 120, pLog: 0.5, truth });
    const before = fitCore(entries);
    const sys0 = [...before.lifts.values()].map((l) => l.sys);
    expect(sys0.length).toBe(10);
    for (const x of sys0) expect(x).toBeGreaterThan(0.01); // ~1.5 reps of b at 10–15 reps: 3 %+
    const tested = fitCore(simulate(4, { sessions: 120, pLog: 0.5, testFrac: 0.35, truth }).entries);
    expect(mean([...tested.lifts.values()].map((l) => l.sys))).toBeLessThan(mean(sys0) / 2);
    // Every set a test: nothing leans on b or the habit.
    const allTests = entries.map((e) => ({ ...e, rir: 0, flags: ['test' as const] }));
    for (const l of fitCore(allTests).lifts.values()) expect(l.sys).toBeLessThan(1e-9);
  });

  it("e1rmAdjusted reads a test's RIR as true and an ordinary set's RIR plus the lift's bias", () => {
    const { entries } = simulate(5, { sessions: 60, pLog: 0.5, testFrac: 0.35, truth });
    const c = fitCore(entries);
    const t = entries.find((e) => e.flags.includes('test'))!;
    const plain = { ...t, flags: [] };
    expect(c.features.get(t.id)).toBeTruthy();
    const k = c.lifts.get(liftKey(t.exercise))!;
    expect(k.bias.mean).toBeGreaterThan(1);
    // The same set without the flag reads its RIR plus the bias: exactly w·b/κ more.
    expect(e1rmAdjusted(c, plain)! - e1rmAdjusted(c, t)!).toBeCloseTo(t.weight * k.bias.mean / k.kappa.mean, 6);
  });

  it('a fit that reuses cached sessions equals a cold refit with test sets in the log', () => {
    const { entries } = simulate(12, { sessions: 60, pLog: 0.5, testFrac: 0.3, truth });
    const cold = entries.map((e) => structuredClone(e));
    fitCore(entries.slice(0, -10));
    const json = (c: Core) => JSON.stringify([c.bias, c.habit, c.tests, [...c.lifts.values()].map((l) => [l.bias, l.sys, l.level.at(-1)])]);
    expect(json(fitCore(entries))).toBe(json(fitCore(cold)));
  });
});
