import { sameExercise, sessionsFor } from './stats';
import type { SetEntry } from './types';
import { addDays } from './analytics';

export type Formula = 'epley' | 'wd';
const KG = 0.45359237;

export function oneRm(f: Formula, w: number, r: number): number | null {
  if (!(w > 0) || !(r >= 1) || r > 30) return null;
  if (r === 1) return w;
  if (f === 'wd' && w * KG >= 4) return w * (1 + Math.pow(r - 1, 0.85) / (-2.55 + 4.58 * Math.log(w * KG)));
  return w * (1 + r / 30);
}

export function weightForReps(f: Formula, oneRmLb: number, r: number): number {
  if (r <= 1) return oneRmLb;
  let lo = 0.01, hi = oneRmLb;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if ((oneRm(f, mid, r) ?? 0) > oneRmLb) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}

const usable = (s: SetEntry) => s.reps != null && s.weight > 0 && !s.flags.some((f) => f === 'warmup' || f === 'partial' || f === 'bodyweight');

function rawE1rm(entries: SetEntry[], exercise: string, f: Formula, beforeDate: string): number | null {
  const vals = sessionsFor(entries, exercise).filter((x) => x.date < beforeDate).slice(0, 3)
    .flatMap((x) => x.sets.filter(usable).map((s) => oneRm(f, s.weight, s.reps as number))).filter((v): v is number => v != null);
  return vals.length ? Math.max(...vals) : null;
}

export interface Calibration { formula: Formula; factor: number; tests: number; errorPct: number | null }

export function calibrate(entries: SetEntry[], exercise: string): Calibration {
  const tests = entries.filter((s) => sameExercise(s.exercise, exercise) && s.flags.includes('test') && usable(s));
  if (!tests.length) return { formula: 'epley', factor: 1, tests: 0, errorPct: null };
  let best: Calibration | null = null;
  for (const f of ['epley', 'wd'] as Formula[]) {
    const ratios = tests.map((t) => {
      const predicted = rawE1rm(entries.filter((x) => !x.flags.includes('test')), exercise, f, t.date);
      const actual = oneRm(f, t.weight, t.reps as number);
      return predicted && actual ? actual / predicted : null;
    }).filter((v): v is number => v != null);
    if (!ratios.length) continue;
    const factor = Math.min(1.2, Math.max(0.8, ratios.reduce((a, b) => a + b, 0) / ratios.length));
    const errorPct = 100 * ratios.reduce((a, r) => a + Math.abs(r - 1), 0) / ratios.length;
    if (!best || errorPct < (best.errorPct ?? Infinity)) best = { formula: f, factor, tests: tests.length, errorPct };
  }
  return best ?? { formula: 'epley', factor: 1, tests: tests.length, errorPct: null };
}

export function calibratedE1rm(entries: SetEntry[], exercise: string, beforeDate = '9999-12-31'): number | null {
  const c = calibrate(entries, exercise);
  const raw = rawE1rm(entries, exercise, c.formula, beforeDate);
  return raw == null ? null : raw * c.factor;
}

export function testDue(entries: SetEntry[], exercise: string, today: string): boolean {
  const mine = entries.filter((s) => sameExercise(s.exercise, exercise));
  const recentDays = new Set(mine.filter((s) => s.date >= addDays(today, -56)).map((s) => s.date));
  if (recentDays.size < 4) return false;
  const lastTest = mine.filter((s) => s.flags.includes('test')).map((s) => s.date).sort().at(-1);
  return !lastTest || lastTest < addDays(today, -42);
}
