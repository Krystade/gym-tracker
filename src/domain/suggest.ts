import { isHold, isHoldLift } from './care';
import { defaultSettings, isTest, isWorking, nextTarget, type ExerciseSettings, type Target } from './progression';
import type { DayPlan, Program } from './program';
import { daySets, sameExercise, sessionsFor } from './stats';
import type { SetEntry } from './types';
import { addDays } from './analytics';

export interface Ramp { weight: number; reps: number }
export interface Suggestion {
  weight: number | null; reps: number; repMax: number; sets: number;
  setsFrom: 'program' | 'last' | 'default'; kind: Target['kind'] | 'new'; reason: string; warmups: Ramp[];
  /** ' s' for timed holds, so reps read as seconds. */
  unit: '' | ' s';
  /** Same weight, more reps: each set's own target, one per set (`reps` is the lowest), and the rule in a few words. */
  perSet?: number[]; why?: string;
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

/** Minutes planned today for this cardio machine (its own slot or the one it was swapped into); null when it has no cardio slot. */
export function plannedMinutes(program: Program | null, plan: DayPlan | null, exercise: string): number | null {
  if (!program || !plan) return null;
  for (const slot of plan.slots ?? program.days[plan.day]?.slots ?? []) {
    if (slot.minutes == null || plan.skips.some((x) => sameExercise(x, slot.exercise))) continue;
    if (sameExercise(plan.swaps[slot.exercise] ?? slot.exercise, exercise)) return slot.minutes;
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
  daySets(entries, date).some((e) => isWorking(e) && !sameExercise(e.exercise, exercise) && warmups(e.weight, e.exercise).length > 0);

/** What to do next time: weight and reps from double progression, sets from the program or last session. Ignores `date`'s own sets. */
export function suggest(entries: SetEntry[], exercise: string, st: ExerciseSettings, date: string, planned: number | null): Suggestion {
  const t = nextTarget(entries, exercise, st, date, planned);
  // Sets as in the last session of working sets: a test counts toward the weight, not the set count.
  const training = (e: SetEntry) => isWorking(e) && !isTest(e);
  const last = sessionsFor(entries, exercise).find((x) => x.date < date && !(x.sets.some(isTest) && !x.sets.some(training)));
  const lastWorking = last ? last.sets.filter(training).length : 0;
  const [sets, setsFrom]: [number, Suggestion['setsFrom']] =
    planned != null ? [planned, 'program'] : lastWorking ? [lastWorking, 'last'] : [3, 'default'];
  const clamped = Math.min(6, Math.max(1, sets));
  const unit = isHoldLift(exercise, entries) ? ' s' : '';
  if (!t) return { unit, weight: null, reps: st.repMin, repMax: st.repMax, sets: clamped, setsFrom, kind: 'new', warmups: [],
    reason: `No history yet: pick a weight you can do about ${st.repMax} times, and log every set.` };
  const reason = t.kind === 'increase' ? `${t.done!.total}${unit || ' reps'} last time, within 2 of ${t.done!.sets} × ${st.repMax}${unit}, so +${st.increment} lb.`
    : t.kind === 'repeat' ? 'Last time had no complete sets: repeat the weight and log every rep.'
    : t.kind === 'maxed' ? `You held about ${st.repMax}${unit} a set: add weight, or move to a harder variation.`
    : t.kind === 'test' ? `Your test set puts ${st.repMax} reps at about ${t.weight} lb, so that’s the working weight now.`
    : t.kind === 'carry' ? `An estimate carried over from your ${st.seed?.from ?? 'last variation'}, on the light side: adjust after the first set.`
    : t.perSet ? `Same weight; each set aims at last time’s same set. ${t.why}.`
    : `Same weight; beat last time with ${t.reps}${unit}+ on every set.`;
  // One target a set: the plan's count, or last time's; a set past last time's aims at the last one's number.
  const perSet = t.perSet && Array.from({ length: clamped }, (_, i) => t.perSet![Math.min(i, t.perSet!.length - 1)]);
  return { unit, weight: t.weight, reps: perSet ? Math.min(...perSet) : t.reps, repMax: st.repMax, sets: clamped, setsFrom, kind: t.kind, reason,
    warmups: warmAlready(entries, exercise, date) ? [] : warmups(t.weight, exercise), ...(perSet && { perSet, why: t.why }) };
}

/**
 * For the exercise screen's "Next time": before training it today, today's suggestion (with today's program sets);
 * once it has working sets today, the session after — today counts as the last session.
 */
export function nextTime(entries: SetEntry[], exercise: string, st: ExerciseSettings, date: string, planned: number | null): { s: Suggestion; trainedToday: boolean } {
  const trainedToday = daySets(entries, date).some((e) => sameExercise(e.exercise, exercise) && isWorking(e));
  return trainedToday ? { s: suggest(entries, exercise, st, addDays(date, 1), null), trainedToday } : { s: suggest(entries, exercise, st, date, planned), trainedToday };
}

/** How many warm-up sets the next session of this lift would suggest (default rep range), for time estimates. */
export const warmupCount = (entries: SetEntry[], exercise: string, date: string): number =>
  warmups(suggest(entries, exercise, defaultSettings(exercise), date, null).weight ?? 0, exercise).length;
