import { normalizeName } from './ids';
import { e1rm, sessionsFor } from './stats';
import type { SetEntry } from './types';

export interface ExerciseSettings { key: string; repMin: number; repMax: number; increment: number }

export const settingsKey = (name: string): string => normalizeName(name).toLowerCase();

const ISOLATION = /(curl|raise|fly|flye|extension|pushdown|push down|kickback|crunch|calf|face pull|rear delt|shrug|pec deck|pull-in|pullover|wrist|leg raise|sit-up|rotation|abduction|adduction)/i;

export function defaultSettings(name: string): ExerciseSettings {
  const iso = ISOLATION.test(name);
  return { key: settingsKey(name), repMin: iso ? 10 : 8, repMax: iso ? 15 : 12, increment: 5 };
}

export const isWorking = (s: SetEntry): boolean => !s.flags.includes('warmup') && !s.flags.includes('partial') && s.reps != null;

export function priorE1rm(entries: SetEntry[], exercise: string, beforeDate: string): number | null {
  const vals = sessionsFor(entries, exercise).filter((x) => x.date < beforeDate).slice(0, 3)
    .flatMap((x) => x.sets.map(e1rm)).filter((v): v is number => v != null);
  return vals.length ? Math.max(...vals) : null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Estimated reps in reserve for a set without a logged RIR; null when it can't be estimated. */
export function estimateRir(set: SetEntry, sessionSets: SetEntry[], prior: number | null): number | null {
  if (set.rir != null || set.reps == null || set.weight <= 0 || set.flags.includes('bodyweight') || set.flags.includes('partial')) return null;
  const next = sessionSets.find((x) => x.setNo === set.setNo + 1 && x.weight === set.weight && x.reps != null);
  if (next && set.reps - (next.reps as number) >= 3) return 1;
  if (prior == null) return null;
  const predicted = set.weight >= prior ? 1 : 30 * (prior / set.weight - 1);
  return clamp(Math.round(predicted - set.reps), 0, 5);
}

export interface Target { kind: 'increase' | 'reps' | 'repeat'; weight: number; reps: number; last: SetEntry[]; text: string }

const lb = (w: number) => (w === 0 ? 'BW' : `${Math.round(w * 100) / 100} lb`);

export function nextTarget(entries: SetEntry[], exercise: string, st: ExerciseSettings, date: string): Target | null {
  const last = sessionsFor(entries, exercise).find((x) => x.date < date);
  if (!last) return null;
  const working = last.sets.filter(isWorking);
  if (!working.length) {
    const w = Math.max(...last.sets.map((x) => x.weight));
    return { kind: 'repeat', weight: w, reps: st.repMin, last: last.sets, text: `Repeat ${lb(w)} and log every rep` };
  }
  const top = Math.max(...working.map((x) => x.weight));
  const atTop = working.filter((x) => x.weight === top);
  const minReps = Math.min(...atTop.map((x) => x.reps as number));
  if (top > 0 && minReps >= st.repMax) {
    const w = top + st.increment;
    return { kind: 'increase', weight: w, reps: st.repMin, last: last.sets, text: `Go up: ${lb(w)} × ${st.repMin}+` };
  }
  // Bodyweight has no weight to add, so its rep target is not capped by the range.
  const reps = top === 0 ? minReps + 1 : Math.min(minReps + 1, st.repMax);
  return { kind: 'reps', weight: top, reps, last: last.sets, text: `${lb(top)} × ${reps}+ on every set` };
}

export interface PrResult { e1rm: boolean; reps: boolean }

export function prCheck(entries: SetEntry[], set: SetEntry): PrResult {
  const earlier = entries.filter((x) => x.id !== set.id && x.exercise.toLowerCase() === set.exercise.toLowerCase()
    && (x.date < set.date || (x.date === set.date && x.seq < set.seq)));
  const v = e1rm(set);
  const best = Math.max(-Infinity, ...earlier.map(e1rm).filter((n): n is number => n != null));
  const repsBest = Math.max(-Infinity, ...earlier.filter((x) => x.weight >= set.weight && x.reps != null && !x.flags.includes('warmup')).map((x) => x.reps as number));
  return {
    e1rm: v != null && earlier.length > 0 && v > best,
    reps: set.reps != null && earlier.length > 0 && !set.flags.includes('warmup') && set.reps > repsBest,
  };
}
