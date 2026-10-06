import { isHold, isHoldLift } from './care';
import { defaultSettings, isWorking, nextTarget, type ExerciseSettings, type Target } from './progression';
import type { DayPlan, Program } from './program';
import { sameExercise, sessionsFor } from './stats';
import type { SetEntry } from './types';
import { addDays } from './analytics';

export interface Ramp { weight: number; reps: number }
export interface Suggestion {
  weight: number | null; reps: number; repMax: number; sets: number;
  setsFrom: 'program' | 'last' | 'default'; kind: Target['kind'] | 'new'; reason: string; warmups: Ramp[];
  /** ' s' for timed holds, so reps read as seconds. */
  unit: '' | ' s';
}

/** Sets planned today for this lift: its own slot, or the slot it was swapped into. A skipped slot plans nothing. */
export function plannedSets(program: Program | null, plan: DayPlan | null, exercise: string): number | null {
  if (!program || !plan) return null;
  const slots = plan.slots ?? program.days[plan.day]?.slots ?? [];
  for (const slot of slots) {
    if (plan.skips.some((x) => sameExercise(x, slot.exercise))) continue;
    const doing = plan.swaps[slot.exercise] ?? slot.exercise;
    if (sameExercise(doing, exercise)) return slot.sets;
  }
  return null;
}

const ISOLATION = (name: string) => defaultSettings(name).repMin >= 10;
const r5 = (w: number) => Math.round(w / 5) * 5;

/**
 * One ramp set at about 55% for compound lifts of 60 lb or more; nothing under 20 lb is listed. Warm-up sets only
 * measurably help near-maximal loads, and this is 8–15 rep work, so it's the least that still grooves the lift.
 */
export function warmups(weight: number, exercise: string): Ramp[] {
  if (weight < 60 || isHold(exercise) || ISOLATION(exercise)) return [];
  const w = r5(weight * 0.55);
  return w >= 20 && w < weight ? [{ weight: w, reps: 5 }] : [];
}

/** A compound lift already worked on `date` (not this one) means the session is warm: only the first compound ramps. */
const warmAlready = (entries: SetEntry[], exercise: string, date: string) =>
  entries.some((e) => e.date === date && isWorking(e) && !sameExercise(e.exercise, exercise) && warmups(e.weight, e.exercise).length > 0);

/** What to do next time: weight and reps from double progression, sets from the program or last session. Ignores `date`'s own sets. */
export function suggest(entries: SetEntry[], exercise: string, st: ExerciseSettings, date: string, planned: number | null): Suggestion {
  const t = nextTarget(entries, exercise, st, date);
  const last = sessionsFor(entries, exercise).find((x) => x.date < date);
  const lastWorking = last ? last.sets.filter(isWorking).length : 0;
  const [sets, setsFrom]: [number, Suggestion['setsFrom']] =
    planned != null ? [planned, 'program'] : lastWorking ? [lastWorking, 'last'] : [3, 'default'];
  const clamped = Math.min(6, Math.max(1, sets));
  const unit = isHoldLift(exercise, entries) ? ' s' : '';
  if (!t) return { unit, weight: null, reps: st.repMin, repMax: st.repMax, sets: clamped, setsFrom, kind: 'new', warmups: [],
    reason: `No history yet: pick a weight you can do about ${st.repMax} times, and log every set.` };
  const reason = t.kind === 'increase' ? `You hit ${st.repMax}${unit} on every set last time, so +${st.increment} lb.`
    : t.kind === 'repeat' ? 'Last time had no complete sets: repeat the weight and log every rep.'
    : t.kind === 'maxed' ? `You held ${st.repMax}${unit} on every set: add weight, or move to a harder variation.`
    : `Same weight; beat last time with ${t.reps}${unit}+ on every set.`;
  return { unit, weight: t.weight, reps: t.reps, repMax: st.repMax, sets: clamped, setsFrom, kind: t.kind, reason, warmups: warmAlready(entries, exercise, date) ? [] : warmups(t.weight, exercise) };
}

/**
 * For the exercise screen's "Next time": before training it today, today's suggestion (with today's program sets);
 * once it has working sets today, the session after — today counts as the last session.
 */
export function nextTime(entries: SetEntry[], exercise: string, st: ExerciseSettings, date: string, planned: number | null): { s: Suggestion; trainedToday: boolean } {
  const trainedToday = entries.some((e) => e.date === date && sameExercise(e.exercise, exercise) && isWorking(e));
  return trainedToday ? { s: suggest(entries, exercise, st, addDays(date, 1), null), trainedToday } : { s: suggest(entries, exercise, st, date, planned), trainedToday };
}

/** How many warm-up sets the next session of this lift would suggest (default rep range), for time estimates. */
export const warmupCount = (entries: SetEntry[], exercise: string, date: string): number =>
  warmups(suggest(entries, exercise, defaultSettings(exercise), date, null).weight ?? 0, exercise).length;
