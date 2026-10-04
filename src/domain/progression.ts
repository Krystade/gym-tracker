import { normalizeName } from './ids';
import { e1rm, sameExercise, sessionsFor } from './stats';
import type { SetEntry } from './types';
import { isHold, isHoldLift } from './care';

// testSnoozedUntil: the "time for a test" banner stays hidden until this day.
export interface ExerciseSettings { key: string; repMin: number; repMax: number; increment: number; testSnoozedUntil?: string }

export const settingsKey = (name: string): string => normalizeName(name).toLowerCase();

const ISOLATION = /(curl|raise|fly|flye|extension|pushdown|push down|kickback|crunch|calf|face pull|rear delt|shrug|pec deck|pull-in|pullover|wrist|leg raise|sit-up|rotation|abduction|adduction)/i;

/** `hold`: the lift is timed — known by name, or by its log (callers that have the log pass it). */
export function defaultSettings(name: string, hold = isHold(name)): ExerciseSettings {
  // Holds count seconds: 20–40 s, as in the back-resilience block.
  if (hold) return { key: settingsKey(name), repMin: 20, repMax: 40, increment: 5 };
  const iso = ISOLATION.test(name);
  return { key: settingsKey(name), repMin: iso ? 10 : 8, repMax: iso ? 15 : 12, increment: 5 };
}

export const isWorking = (s: SetEntry): boolean => !s.flags.includes('warmup') && !s.flags.includes('partial') && s.reps != null && s.reps > 0;

export function priorE1rm(entries: SetEntry[], exercise: string, beforeDate: string): number | null {
  const vals = sessionsFor(entries, exercise).filter((x) => x.date < beforeDate).slice(0, 3)
    .flatMap((x) => x.sets.map(e1rm)).filter((v): v is number => v != null);
  return vals.length ? Math.max(...vals) : null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Reps the prior e1RM predicts at this weight, minus reps done: how far short of the recent best the set was. */
const shortfall = (set: SetEntry, prior: number): number => (set.weight >= prior ? 1 : 30 * (prior / set.weight - 1)) - (set.reps as number);

/** Recent bests are rarely taken to failure, so "matched my best" still leaves reps in reserve; ~2 is typical. */
export const DEFAULT_RIR_OFFSET = 2;

/** Sets done before this one: by position (callers pass sets in the order done); by set number if it isn't in the list. */
const doneBefore = (set: SetEntry, sessionSets: SetEntry[]): SetEntry[] => {
  const i = sessionSets.findIndex((x) => x.id === set.id);
  return i < 0 ? sessionSets.filter((x) => x.setNo < set.setNo) : sessionSets.slice(0, i);
};

const isFirstAtWeight = (set: SetEntry, sessionSets: SetEntry[]) =>
  !doneBefore(set, sessionSets).some((x) => x.weight === set.weight && isWorking(x));

/**
 * Learn the offset from first working sets where RIR was logged: mean(logged − shortfall), once there are 3,
 * clamped 0..3. Later sets at a weight are fatigue-confounded (the same reason `estimateRir` skips them).
 * One pass, oldest session first, carrying the last three sessions' best e1RM as the prior.
 */
export function rirOffset(entries: SetEntry[], exercise: string): number {
  const window: (number | null)[] = [];
  const diffs: number[] = [];
  for (const session of [...sessionsFor(entries, exercise)].reverse()) {
    const known = window.filter((v): v is number => v != null);
    const prior = known.length ? Math.max(...known) : null;
    if (prior != null) {
      for (const x of session.sets) {
        if (x.rir == null || !isWorking(x) || x.weight <= 0 || x.flags.includes('bodyweight') || !isFirstAtWeight(x, session.sets)) continue;
        diffs.push(x.rir - shortfall(x, prior));
      }
    }
    const vals = session.sets.map(e1rm).filter((v): v is number => v != null);
    window.push(vals.length ? Math.max(...vals) : null);
    if (window.length > 3) window.shift();
  }
  if (diffs.length < 3) return DEFAULT_RIR_OFFSET;
  return clamp(Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length), 0, 3);
}

/**
 * Estimated reps in reserve for a set without a logged RIR; null when it can't be estimated honestly.
 * Only the first working set at a weight gets a prior-based estimate: later sets lose reps to fatigue,
 * which would read as *more* reserve. `sessionSets` in the order done.
 */
export function estimateRir(set: SetEntry, sessionSets: SetEntry[], prior: number | null, offset = DEFAULT_RIR_OFFSET): number | null {
  if (set.rir != null || !isWorking(set) || set.weight <= 0 || set.flags.includes('bodyweight')) return null;
  const i = sessionSets.findIndex((x) => x.id === set.id);
  const after = i < 0 ? sessionSets.find((x) => x.setNo === set.setNo + 1) : sessionSets[i + 1];
  const next = after && after.weight === set.weight && after.reps != null ? after : undefined;
  if (next && (set.reps as number) - (next.reps as number) >= 3) return 1;
  if (prior == null) return null;
  if (!isFirstAtWeight(set, sessionSets)) return null;
  return clamp(Math.round(shortfall(set, prior) + offset), 0, 5);
}

export interface Target { kind: 'increase' | 'reps' | 'repeat' | 'maxed'; weight: number; reps: number; last: SetEntry[]; text: string }

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
  const unit = isHoldLift(exercise, entries) ? 's' : '';
  const atTop = working.filter((x) => x.weight === top);
  const minReps = Math.min(...atTop.map((x) => x.reps as number));
  if (top > 0 && minReps >= st.repMax) {
    const w = top + st.increment;
    return { kind: 'increase', weight: w, reps: st.repMin, last: last.sets, text: `Go up: ${lb(w)} × ${st.repMin}${unit}+` };
  }
  // A bodyweight hold at the top of its range has nowhere to go in time: add weight or a harder variation.
  if (unit && top === 0 && minReps >= st.repMax) {
    return { kind: 'maxed', weight: 0, reps: st.repMax, last: last.sets, text: `BW × ${st.repMax}s on every set: add weight or try a harder variation` };
  }
  // Bodyweight reps have no weight to add, so their target is not capped by the range. Holds step in 5 s, like the stepper.
  const step = unit ? 5 : 1;
  const reps = top === 0 && !unit ? minReps + step : Math.min(minReps + step, st.repMax);
  return { kind: 'reps', weight: top, reps, last: last.sets, text: `${lb(top)} × ${reps}${unit}+ on every set` };
}

export interface PrResult { e1rm: boolean; reps: boolean }

export function prCheck(entries: SetEntry[], set: SetEntry): PrResult {
  if (set.flags.includes('hold')) return { e1rm: false, reps: false };
  // Every other set of the lift, whatever its date: a late set on an old day isn't a PR if it has since been beaten.
  const others = entries.filter((x) => x.id !== set.id && sameExercise(x.exercise, set.exercise));
  const v = e1rm(set);
  const best = Math.max(-Infinity, ...others.map(e1rm).filter((n): n is number => n != null));
  const repsBest = Math.max(-Infinity, ...others.filter((x) => x.weight >= set.weight && x.reps != null && !x.flags.includes('warmup')).map((x) => x.reps as number));
  return {
    e1rm: v != null && Number.isFinite(best) && v > best,
    reps: set.reps != null && Number.isFinite(repsBest) && !set.flags.includes('warmup') && set.reps > repsBest,
  };
}
