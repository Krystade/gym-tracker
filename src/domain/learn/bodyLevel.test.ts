import { describe, expect, it } from 'vitest';
import type { SetEntry } from '../types';
import { addDays } from '../analytics';
import { aheadVar, e1rmAdjusted, fitCore, type Core, type LiftCore } from './capacity';
import { bodyRepsSeries, bodyStrengthOf, levelSeries, strengthOf } from './strength';
import { bodyLog, type BodySimOptions } from './bodySim.sample';

// Item 14 in the learning core: a bodyweight lift's level, from a synthetic lifter whose strength and body mass are KNOWN
// (bodySim.sample). The app is never told the body mass, so the level is in units of it: ln(E / mass).

const DIPS = 'Forward-Lean Dips';
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const bodyLift = (c: Core): LiftCore => [...c.lifts.values()].find((l) => l.name === DIPS)!;
/** Mean error (ln) of the smoothed level against the truth over every session, for a log made with `o`, over seeds 1–n. */
const levelErr = (o: BodySimOptions, n: number, fit: (e: SetEntry[]) => Core = (e) => fitCore(e)) => {
  const errs: number[] = [];
  for (let seed = 1; seed <= n; seed++) {
    const sim = bodyLog(seed, o);
    for (const p of bodyLift(fit(sim.entries)).level) errs.push(p.x - sim.levels.get(p.date)!);
  }
  return mean(errs);
};

describe('learn/capacity: a bodyweight lift’s level (item 14)', () => {
  it('is read in body mass from its sets at bodyweight, and recovered within its uncertainty at the last session in ≥ 9 of 10 seeds', () => {
    let hits = 0;
    const errs: number[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const sim = bodyLog(seed, { sessions: 40, order: 'mixed' });
      const c = fitCore(sim.entries);
      const l = bodyLift(c);
      expect(l.unit).toBe('body');
      expect([...c.lifts.values()].find((x) => x.name === 'Bench Press')!.unit).toBe('lb');
      const last = l.level.at(-1)!;
      const s = bodyStrengthOf(c, DIPS, last.date)!;
      const err = last.x - sim.levels.get(last.date)!;
      errs.push(err);
      if (Math.abs(err / s.u) < 1.96) hits++;
      // What it means at bodyweight: the fresh reps to failure, against the truth's κ·(E/(f·mass) − 1).
      const E = Math.exp(sim.levels.get(last.date)!) * sim.truth.mass;
      const truthReps = sim.truth.kappa * (E / (sim.share * sim.truth.mass) - 1);
      expect(Math.abs(s.reps - truthReps), `seed ${seed}`).toBeLessThan(2.5 * s.repsSd);
      expect(bodyRepsSeries(c, DIPS).at(-1)!.reps).toBeCloseTo(s.reps, 9);
    }
    expect(hits).toBeGreaterThanOrEqual(9);
    expect(Math.abs(mean(errs))).toBeLessThan(0.02);
  });

  it('knows where in the session each set was: done after the bench (shared muscles) it isn’t read as weaker than done before it', () => {
    // The order alternates, so the cross-lift fatigue is identified; the raw reps of a session after the bench sit > 3 % lower.
    const truth = { aCross: 1.2, gamma: 0.2 };
    const core = { after: [] as number[], before: [] as number[] }, raw = { after: [] as number[], before: [] as number[] };
    for (let seed = 1; seed <= 10; seed++) {
      const sim = bodyLog(seed, { sessions: 60, order: 'mixed', truth });
      const c = fitCore(sim.entries);
      const first = new Map<string, { body: boolean; reps: number | null }>();
      for (const e of sim.entries) {
        if (!first.has(e.date)) first.set(e.date, { body: e.exercise === DIPS, reps: null });
        const f = first.get(e.date)!;
        if (e.exercise === DIPS && f.reps == null) f.reps = e.reps;
      }
      for (const o of bodyLift(c).obs) core[first.get(o.date)!.body ? 'before' : 'after'].push(o.z - sim.levels.get(o.date)!);
      // The raw reading: the first set's reps plus the habit, no fatigue put back.
      for (const [d, f] of first) raw[f.body ? 'before' : 'after'].push(Math.log(sim.share) + Math.log1p((f.reps! + 2) / 30) - sim.levels.get(d)!);
    }
    const gap = (x: { after: number[]; before: number[] }) => mean(x.after) - mean(x.before);
    expect(gap(raw)).toBeLessThan(-0.03);
    expect(Math.abs(gap(core))).toBeLessThan(0.015);
    expect(Math.abs(gap(core))).toBeLessThan(Math.abs(gap(raw)) / 3);
  });

  it('a set stopped at its logged target is a lower bound: the level stays near the truth; read as the habit it sits low', () => {
    const o = { sessions: 40, order: 'mixed' as const, targets: 8 };
    const on = levelErr(o, 8), off = levelErr(o, 8, (e) => fitCore(e, { censor: false }));
    expect(Math.abs(on)).toBeLessThan(0.025);
    expect(off).toBeLessThan(-0.04);
  });

  it('bodyweight sets after a heavier set that day (weight added) are ramps: lower bounds, not habit readings', () => {
    const o = { sessions: 40, order: 'mixed' as const, weightedFirst: true };
    const on = levelErr(o, 8), off = levelErr(o, 8, (e) => fitCore(e, { light: false }));
    expect(Math.abs(on)).toBeLessThan(0.025);
    expect(off).toBeLessThan(-0.04);
  });

  it('a set with help or weight added can’t be placed without his body weight: no reading, but it tires the sets after it', () => {
    const at = (weight: number, setNo: number, note?: string): SetEntry => ({
      id: `h${setNo}`, date: '2026-03-02', seq: setNo, loggedAt: `2026-03-02T18:0${setNo}:00.000Z`, exercise: DIPS, setNo, weight, reps: 10,
      flags: weight <= 0 ? ['bodyweight'] : [], source: 't', ...(note && { note }),
    });
    const c = fitCore([at(-30, 1), at(25, 2), at(0, 3)]);
    expect(c.features.has('h1')).toBe(false);
    expect(c.features.has('h2')).toBe(false);
    expect(c.features.get('h3')!.nS).toBe(2); // both earlier sets of the lift count as fatigue
    // An older import's "assisted -30 lb" note on a set at 0 reads the same as the signed weight.
    const sim = bodyLog(3, { sessions: 30, assisted: 'weight' }), old = bodyLog(3, { sessions: 30, assisted: 'note' });
    expect(old.entries.some((e) => e.weight === 0 && e.note === 'assisted -15 lb')).toBe(true);
    const json = (x: Core) => JSON.stringify([...x.lifts.values()].map((l) => [l.level, l.kappa, l.aSame]));
    expect(json(fitCore(old.entries))).toBe(json(fitCore(sim.entries)));
  });

  it('is never read as lb: no e1RM, no lb level or series; a layoff widens its uncertainty by the drift and layoff terms', () => {
    const sim = bodyLog(5, { sessions: 30 });
    const c = fitCore(sim.entries);
    const last = bodyLift(c).level.at(-1)!;
    expect(strengthOf(c, DIPS, last.date)).toBeNull();
    expect(levelSeries(c, DIPS)).toEqual([]);
    expect(e1rmAdjusted(c, sim.entries.find((e) => e.exercise === DIPS && e.weight === 0)!)).toBeNull();
    expect(strengthOf(c, 'Bench Press', last.date)).not.toBeNull(); // a loaded lift beside it: lb as before
    expect(bodyStrengthOf(c, 'Bench Press', last.date)).toBeNull();
    const now = bodyStrengthOf(c, DIPS, last.date)!, later = bodyStrengthOf(c, DIPS, addDays(last.date, 70))!;
    expect(later.sd ** 2 - now.sd ** 2).toBeCloseTo(aheadVar(c, 70), 12);
    expect(later.u).toBeGreaterThan(now.u);
    expect(later.repsSd).toBeGreaterThan(now.repsSd);
    // In reps, that uncertainty is the level's carried through the capacity equation (first order): reps' slope in ln E, times u.
    const h = 1e-4, at = (x: number) => now.kappa * (Math.exp(x) / now.share - 1);
    expect(now.repsSd).toBeCloseTo((at(now.x + h) - at(now.x - h)) / (2 * h) * now.u, 6);
    expect(now.reps).toBeCloseTo(at(now.x), 9);
  });
});
