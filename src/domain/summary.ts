import { muscleVector, type Muscle } from './muscles';
import { isWorking } from './progression';
import { byOrderDone, lastSession, sameExercise } from './stats';
import { prIds } from './records';
import { normalizeName } from './ids';
import type { SetEntry } from './types';

const key = (s: string) => normalizeName(s).toLowerCase();

/** The PR sets done on `date`, by the one rule (domain/records): only the lifts done that day are read. */
export function prSetIds(entries: SetEntry[], date: string): Set<string> {
  const day = entries.filter((e) => e.date === date);
  const done = new Set(day.map((e) => key(e.exercise)));
  const lifts = entries.filter((e) => done.has(key(e.exercise)));
  const ids = new Set(day.map((e) => e.id));
  return new Set([...prIds(lifts)].filter((id) => ids.has(id)));
}

/** The heaviest working set, more reps breaking a tie. */
export const topSet = (sets: SetEntry[]) => sets.reduce((a, b) => (b.weight > a.weight || (b.weight === a.weight && (b.reps ?? 0) > (a.reps ?? 0)) ? b : a));

export interface DaySummary {
  /** `times`: working sets at the top set's weight and reps ("50 × 10 ×2"). */
  lifts: { exercise: string; top: SetEntry; times: number; last: SetEntry | null; pr: boolean }[];
  /** Working sets per muscle (a secondary mover counts its share), most first. */
  muscles: [Muscle, number][];
}

export function daySummary(entries: SetEntry[], date: string): DaySummary {
  const today = entries.filter((e) => e.date === date && isWorking(e)).sort(byOrderDone);
  const prs = prSetIds(entries, date);
  const names: string[] = [];
  for (const e of today) if (!names.some((n) => sameExercise(n, e.exercise))) names.push(e.exercise);
  const lifts = names.map((exercise) => {
    const sets = today.filter((e) => sameExercise(e.exercise, exercise));
    const prev = lastSession(entries, exercise, date)?.sets.filter(isWorking) ?? [];
    const top = topSet(sets);
    const times = sets.filter((e) => e.weight === top.weight && e.reps === top.reps).length;
    // A partial set can be the PR (heaviest weight) without being a working set.
    const pr = entries.some((e) => e.date === date && prs.has(e.id) && sameExercise(e.exercise, exercise));
    return { exercise, top, times, last: prev.length ? topSet(prev) : null, pr };
  });
  const per = new Map<Muscle, number>();
  for (const e of today) for (const [m, f] of Object.entries(muscleVector(e.exercise) ?? {}) as [Muscle, number][]) per.set(m, (per.get(m) ?? 0) + f);
  const muscles = [...per].sort((a, b) => b[1] - a[1]);
  return { lifts, muscles };
}
