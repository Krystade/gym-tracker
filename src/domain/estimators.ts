import { addDays } from './analytics';
import { isHoldLift } from './care';
import { liftKey } from './ids';
import { coreBefore, testSd } from './learn';
import { floorRung, ladderOf, nextRung } from './learn/ladder';
import { levelSeries, strengthOf, weightFor, type Strength } from './learn/strength';
import { REACCLIMATION, runIndex } from './learn/trend';
import { dayOf } from './learn/capacity';
import { painRisk, zoneOf } from './learn/pain';
import { painGate } from './painPlan';
import { liftSets, type SeriesPoint } from './stats';
import type { SetEntry } from './types';
import { isCardio } from './cardio';

export type Formula = 'epley' | 'wd';
const KG = 0.45359237;

/**
 * Epley below 10 kg, the weight-dependent formula above 30 kg, and a linear blend between. The weight-dependent
 * formula's denominator shrinks toward zero at light loads (a 10 lb raise × 12 would "estimate" 27 lb), and a hard
 * cutoff makes the curve jump, which breaks the rep-max inversion. The blend keeps it continuous and increasing.
 */
export function oneRm(f: Formula, w: number, r: number): number | null {
  if (!(w > 0) || !(r >= 1) || r > 30) return null;
  if (r === 1) return w;
  const epley = w * (1 + r / 30);
  if (f === 'epley') return epley;
  const kg = w * KG;
  const t = Math.min(1, Math.max(0, (kg - 10) / 20));
  if (t === 0) return epley;
  const wd = w * (1 + Math.pow(r - 1, 0.85) / (-2.55 + 4.58 * Math.log(kg)));
  return (1 - t) * epley + t * wd;
}

export function weightForReps(f: Formula, oneRmLb: number, r: number): number {
  if (r <= 1) return oneRmLb;
  let lo = 0.01, hi = oneRmLb;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if ((oneRm(f, mid, r) ?? 0) > oneRmLb) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}

/**
 * A lift's strength on `date` from everything logged up to and including it (learn/strength: the learning core's fatigue-adjusted
 * level, with its uncertainty); null when the core has no level for it (a hold, bodyweight only, cardio, nothing logged).
 */
export function strength(entries: readonly SetEntry[], exercise: string, date: string): Strength | null {
  const core = coreBefore(entries, addDays(date, 1));
  return core && strengthOf(core, exercise, date);
}

/** The lift's level at each session up to `date`, oldest first, as chart points (no records: a level isn't a set); null without one. */
export function strengthSeries(entries: readonly SetEntry[], exercise: string, date: string): SeriesPoint[] | null {
  const core = coreBefore(entries, addDays(date, 1));
  const pts = core ? levelSeries(core, exercise) : [];
  return pts.length ? pts.map((p) => ({ date: p.date, e1rm: p.e1rm, pr: false })) : null;
}

/**
 * Item 04: the e1RM from sets before `beforeDate`: the learning core's level at the lift's latest session (every set, its RIR or the
 * habit, its session fatigue put back; test sets calibrate the RIR bias), not the best Epley reading of recent sets.
 */
export function calibratedE1rm(entries: readonly SetEntry[], exercise: string, beforeDate = '9999-12-31'): number | null {
  const core = coreBefore(entries, beforeDate);
  return core && (strengthOf(core, exercise, beforeDate)?.e1rm ?? null);
}

/** (a) The reps a test reads the level best at: the RIR error model (04 §3: 0.5 reps, +0.3 per rep past 10) over κ + reps is least at 10. */
export const TEST_REPS = 10;

/**
 * Item 08 (b): how much more uncertain a lift must be for a test to pay, given the chance p that it hurts (learn/pain). A set
 * that hurts is pain-limited, a lower bound that reads nothing of the level (learn/capacity), so the expected variance after a
 * test is p·u² + (1 − p)·u²σ²/(u² + σ²); it is at most half of u² only when u > σ/√(1 − 2p). p = 0 is the plain rule; at p ≥ ½
 * (hurting the likelier outcome) no test can pay. p is for the lift's session, a floor for a set to failure.
 */
export const painFactor = (p: number): number => (p < 0.5 ? 1 / Math.sqrt(1 - 2 * p) : Infinity);

/**
 * Item 05: a test is due when it would at least halve what the app doesn't know: the lift's uncertainty u (its level's SD on the
 * day, grown by drift and layoffs, with the systematic SD only tests fix: learn/strength) is above what one test reads the level
 * to (σ_test: learn testSd), raised for the chance the test hurts (painFactor). `weight`: the loadable weight for TEST_REPS to failure; `jump`: today's target is an increase, and
 * its first set at the new weight is the test (no extra set). `after`: u once the test is in (u·σ/√(u² + σ²)).
 */
export interface TestDue { weight: number; reps: number; u: number; after: number; jump: boolean }
/** `st`: the lift's settings (a typed increment wins over the learned ladder); `target`: today's target, when known. */
export function testDue(entries: readonly SetEntry[], exercise: string, today: string, st?: { increment: number },
  target?: { kind: string; weight: number | null } | null): TestDue | null {
  if (isCardio(exercise) || isHoldLift(exercise, entries)) return null;
  // (a) One failure set a day: sets to failure need longer recovery (Morán-Navarro 2017), so not two tests in a workout.
  if (entries.some((e) => e.date === today && e.flags.includes('test'))) return null;
  // Item 08 (a): not while pain holds or eases the lift (moderate or worse last time, or in a region it loads within 3 days:
  // painPlan), nor once it has hurt today.
  if (painGate(entries, exercise, today) || zoneOf(liftSets(entries, exercise).filter((e) => e.date === today)) > 0) return null;
  // Owner rule: not in a lift's first 2 sessions, nor the first 2 after a layoff (learn/trend): today counts as one.
  const days = [...new Set(liftSets(entries, exercise).filter((e) => e.date < today && e.reps != null && !e.flags.includes('warmup')).map((e) => e.date))].sort().map(dayOf);
  if (runIndex([...days, dayOf(today)]).at(-1)! < REACCLIMATION) return null;
  const core = coreBefore(entries, addDays(today, 1));
  const s = core && strengthOf(core, exercise, today);
  if (!core || !s) return null;
  const sigma = testSd(core, liftKey(exercise), TEST_REPS);
  const k = painFactor(painRisk(entries, exercise, today).p);
  if (!(s.u > sigma * k)) return null;
  const after = s.u * sigma / Math.hypot(s.u, sigma);
  // Today's increase is a test if it reads the level at least as well: the same test, without an extra set.
  if (target?.kind === 'increase' && target.weight != null && target.weight > 0) {
    const reps = Math.round(s.kappa * (s.e1rm / target.weight - 1));
    if (reps >= 1 && s.u > testSd(core, liftKey(exercise), reps) * k) return { weight: target.weight, reps, u: s.u, after, jump: true };
  }
  // The loadable weight either side of the one for TEST_REPS (the learned ladder; a typed increment wins), whichever reads the
  // level more precisely at the reps it should take.
  const want = weightFor(s, TEST_REPS);
  const lad = st && st.increment !== 5 ? null : ladderOf(entries, exercise);
  const inc = st?.increment ?? 5;
  const lo = lad ? floorRung(lad, want) : Math.floor(want / inc + 1e-9) * inc;
  const hi = lad ? nextRung(lad, lo) : lo + inc;
  const repsAt = (w: number) => Math.round(s.kappa * (s.e1rm / w - 1));
  const sdAt = (w: number) => (w > 0 && repsAt(w) >= 1 ? testSd(core, liftKey(exercise), repsAt(w)) : Infinity);
  const weight = sdAt(hi) < sdAt(lo) ? hi : lo;
  if (!Number.isFinite(sdAt(weight))) return null;
  return { weight, reps: repsAt(weight), u: s.u, after, jump: false };
}
