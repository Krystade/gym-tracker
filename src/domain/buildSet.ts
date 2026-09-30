import { setId } from './ids';
import { canonicalName, sameExercise } from './stats';
import type { Flag, SetEntry } from './types';

export interface NewSetInput { date: string; exercise: string; weight: number; reps: number | null; rir?: number; flags: Flag[]; note?: string }

/** partial and bodyweight follow from the numbers, so an edit that fills in reps or adds weight clears them. */
export function derivedFlags(flags: Flag[], weight: number, reps: number | null): Flag[] {
  const rest = flags.filter((f) => f !== 'partial' && f !== 'bodyweight');
  return [...(weight === 0 ? (['bodyweight'] as Flag[]) : []), ...rest, ...(reps === null ? (['partial'] as Flag[]) : [])];
}

export function buildAppSet(existing: SetEntry[], input: NewSetInput, now: Date): SetEntry {
  const exercise = canonicalName(existing, input.exercise);
  const setNo = 1 + Math.max(0, ...existing.filter((e) => e.date === input.date && sameExercise(e.exercise, exercise)).map((e) => e.setNo));
  const flags = derivedFlags(input.flags, input.weight, input.reps);
  return {
    id: setId('app', input.date, exercise, setNo),
    date: input.date, seq: now.getTime(), loggedAt: now.toISOString(),
    exercise, setNo, weight: input.weight, reps: input.reps, flags, source: 'app',
    ...(input.rir !== undefined && { rir: input.rir }),
    ...(input.note?.trim() && { note: input.note.trim() }),
  };
}
