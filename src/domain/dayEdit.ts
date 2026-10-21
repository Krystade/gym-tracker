import { derivedFlags } from './buildSet';
import { sameExercise, byOrderDone } from './stats';
import type { SetEntry } from './types';

// History → a day → Fix sets: logged sets corrected in place. Each change is a copy of the set with only what was fixed, kept
// under its own id, so it saves through the store's ordinary edit (stamped editedAt: it syncs, backs up and wins on every phone).

/**
 * A lift's sets that day moved to another lift (a paste that read "Incline bench push downs" as Cable Pushdown, say): the
 * same sets, renamed, numbered on after any sets of that lift the day already has. Nothing when it is the same lift.
 */
export function changeLift(day: readonly SetEntry[], from: string, to: string): SetEntry[] {
  if (sameExercise(from, to)) return [];
  const moving = day.filter((e) => sameExercise(e.exercise, from)).sort(byOrderDone);
  let n = Math.max(0, ...day.filter((e) => sameExercise(e.exercise, to)).map((e) => e.setNo));
  return moving.map((e) => ({ ...e, exercise: to, setNo: ++n }));
}

/** The picked sets at one weight (an empty bar logged as 0 or BW, say), flags following the number. Unchanged sets and cardio left out. */
export function setWeight(day: readonly SetEntry[], ids: readonly string[], weight: number): SetEntry[] {
  const picked = new Set(ids);
  return day.filter((e) => picked.has(e.id) && !e.cardio && e.weight !== weight)
    .map((e) => ({ ...e, weight, flags: derivedFlags(e.flags, weight, e.reps) }));
}
