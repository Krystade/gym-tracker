import { sameExercise, sessionsFor } from './stats';
import type { SetEntry } from './types';
import { addDays } from './analytics';

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

const usable = (s: SetEntry) => s.reps != null && s.weight > 0 && !s.flags.some((f) => f === 'warmup' || f === 'partial' || f === 'bodyweight');
const isTest = (s: SetEntry) => s.flags.includes('test');
/** A test set's true capacity: the reps done plus any reps it was stopped short of. */
const testReps = (s: SetEntry) => (s.reps as number) + (s.rir ?? 0);

function rawE1rm(entries: SetEntry[], exercise: string, f: Formula, beforeDate: string): number | null {
  const vals = sessionsFor(entries.filter((x) => !isTest(x)), exercise).filter((x) => x.date < beforeDate).slice(0, 3)
    .flatMap((x) => x.sets.filter(usable).map((s) => oneRm(f, s.weight, s.reps as number))).filter((v): v is number => v != null);
  return vals.length ? Math.max(...vals) : null;
}

export interface Calibration { formula: Formula; factor: number; tests: number; errorPct: number | null }

/**
 * Per-exercise correction learned from test sets before `beforeDate`: each test's capacity ÷ what training predicted.
 * The factor is the mean ratio (clamped 0.8–1.2). A formula is only *chosen* with two or more tests, by which one's
 * ratios agree best once the factor is applied (their spread); with one test either would fit exactly, so Epley.
 */
export function calibrate(entries: SetEntry[], exercise: string, beforeDate = '9999-12-31'): Calibration {
  const tests = entries.filter((s) => sameExercise(s.exercise, exercise) && isTest(s) && usable(s) && s.date < beforeDate);
  const fit = (f: Formula) => {
    const ratios = tests.map((t) => {
      const predicted = rawE1rm(entries, exercise, f, t.date);
      const actual = oneRm(f, t.weight, testReps(t));
      return predicted && actual ? actual / predicted : null;
    }).filter((v): v is number => v != null);
    if (!ratios.length) return null;
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const spread = 100 * ratios.reduce((a, r) => a + Math.abs(r / mean - 1), 0) / ratios.length;
    return { formula: f, factor: Math.min(1.2, Math.max(0.8, mean)), tests: ratios.length, errorPct: ratios.length >= 2 ? spread : null };
  };
  const epley = fit('epley');
  if (!epley) return { formula: 'epley', factor: 1, tests: 0, errorPct: null };
  const wd = epley.tests >= 2 ? fit('wd') : null;
  return wd && wd.errorPct! < epley.errorPct! ? wd : epley;
}

/** Best of: training's recent best corrected by the calibration factor, and any test set taken at face value. */
export function calibratedE1rm(entries: SetEntry[], exercise: string, beforeDate = '9999-12-31'): number | null {
  const c = calibrate(entries, exercise, beforeDate);
  const raw = rawE1rm(entries, exercise, c.formula, beforeDate);
  const tests = entries.filter((s) => sameExercise(s.exercise, exercise) && isTest(s) && usable(s) && s.date < beforeDate)
    .map((s) => oneRm(c.formula, s.weight, testReps(s))).filter((v): v is number => v != null);
  const vals = [...(raw == null ? [] : [raw * c.factor]), ...tests];
  return vals.length ? Math.max(...vals) : null;
}

export function testDue(entries: SetEntry[], exercise: string, today: string): boolean {
  const mine = entries.filter((s) => sameExercise(s.exercise, exercise));
  const recentDays = new Set(mine.filter((s) => s.date >= addDays(today, -56)).map((s) => s.date));
  if (recentDays.size < 4) return false;
  const lastTest = mine.filter((s) => s.flags.includes('test')).map((s) => s.date).sort().at(-1);
  return !lastTest || lastTest < addDays(today, -42);
}
