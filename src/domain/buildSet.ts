import { setId } from './ids';
import { canonicalName, sameExercise } from './stats';
import type { Flag, SetEntry } from './types';

export interface NewSetInput { date: string; exercise: string; weight: number; reps: number | null; rir?: number; flags: Flag[]; note?: string }

export function buildAppSet(existing: SetEntry[], input: NewSetInput, now: Date): SetEntry {
  const exercise = canonicalName(existing, input.exercise);
  const setNo = 1 + Math.max(0, ...existing.filter((e) => e.date === input.date && sameExercise(e.exercise, exercise)).map((e) => e.setNo));
  const flags: Flag[] = input.weight === 0 && !input.flags.includes('bodyweight') ? ['bodyweight', ...input.flags] : [...input.flags];
  return {
    id: setId('app', input.date, exercise, setNo),
    date: input.date, seq: now.getTime(), loggedAt: now.toISOString(),
    exercise, setNo, weight: input.weight, reps: input.reps, flags, source: 'app',
    ...(input.rir !== undefined && { rir: input.rir }),
    ...(input.note?.trim() && { note: input.note.trim() }),
  };
}
