import { setId } from './ids';
import { canonicalName, sameExercise } from './stats';
import type { CardioData, Flag, Region, SetEntry } from './types';

export interface NewSetInput { date: string; exercise: string; weight: number; reps: number | null; rir?: number; flags: Flag[]; note?: string; painRegion?: Region; painSeverity?: 1 | 2 | 3; target?: SetEntry['target']; gym?: string;
  /** When it was done, for a set entered late: a time, or null for unknown. Absent: now. */
  at?: Date | null;
  cardio?: CardioData;
  tags?: string[];
}

/** partial and bodyweight follow from the numbers, so an edit that fills in reps or adds weight clears them. */
export function derivedFlags(flags: Flag[], weight: number, reps: number | null): Flag[] {
  // A cardio bout has no weight or reps by design: neither bodyweight nor partial.
  if (flags.includes('cardio')) return flags.filter((f) => f !== 'partial' && f !== 'bodyweight');
  const rest = flags.filter((f) => f !== 'partial' && f !== 'bodyweight');
  return [...(weight === 0 ? (['bodyweight'] as Flag[]) : []), ...rest, ...(reps === null ? (['partial'] as Flag[]) : [])];
}

export const buildAppSet = (existing: SetEntry[], input: NewSetInput, now: Date): SetEntry =>
  buildNamedSet(existing, { ...input, exercise: canonicalName(existing, input.exercise) }, now);

/**
 * buildAppSet with the name already resolved against the whole log (canonicalName): `sameDay` need only hold the sets of
 * `input.date`, since the set number counts that day's sets of the lift. Saving reads just that day (db addSet).
 */
export function buildNamedSet(sameDay: readonly SetEntry[], input: NewSetInput, now: Date): SetEntry {
  const exercise = input.exercise;
  const setNo = 1 + Math.max(0, ...sameDay.filter((e) => e.date === input.date && sameExercise(e.exercise, exercise)).map((e) => e.setNo));
  const flags = derivedFlags(input.cardio && !input.flags.includes('cardio') ? [...input.flags, 'cardio'] : input.flags, input.weight, input.reps);
  const late = input.at !== undefined;
  const done = late ? input.at : now;
  return {
    id: setId('app', input.date, exercise, setNo),
    date: input.date, seq: (done ?? now).getTime(),
    ...(done && { loggedAt: done.toISOString() }),
    ...(late && { enteredAt: now.toISOString() }),
    exercise, setNo, weight: input.weight, reps: input.reps, flags, source: 'app',
    ...(input.rir !== undefined && { rir: input.rir }),
    ...(input.note?.trim() && { note: input.note.trim() }),
    ...(flags.includes('pain') && input.painRegion && { painRegion: input.painRegion }),
    ...(flags.includes('pain') && input.painSeverity && { painSeverity: input.painSeverity }),
    ...(input.target && { target: input.target }),
    ...(input.gym && { gym: input.gym }),
    ...(input.cardio && { cardio: input.cardio }),
    ...(input.tags?.length && { tags: input.tags }),
  };
}
