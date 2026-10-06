import { muscleVector, type Muscle } from './muscles';
import { isWorking } from './progression';
import { byOrderDone, e1rm, lastSession, sameExercise } from './stats';
import type { SetEntry } from './types';

const key = (s: string) => s.trim().toLowerCase();
const chrono = (a: SetEntry, b: SetEntry) => (a.date < b.date ? -1 : a.date > b.date ? 1 : byOrderDone(a, b));

/** Every set that beat all earlier sets of its lift (by e1RM) when it was done. A lift's first set ever isn't one. One pass per lift. */
export function prIds(entries: SetEntry[]): Set<string> {
  const byLift = new Map<string, SetEntry[]>();
  for (const e of entries) (byLift.get(key(e.exercise)) ?? byLift.set(key(e.exercise), []).get(key(e.exercise))!).push(e);
  const out = new Set<string>();
  for (const sets of byLift.values()) {
    let top = -Infinity;
    for (const e of sets.sort(chrono)) {
      const v = e1rm(e);
      if (v == null) continue;
      if (Number.isFinite(top) && v > top) out.add(e.id);
      top = Math.max(top, v);
    }
  }
  return out;
}

/** The PR sets done on `date`. */
export const prSetIds = (entries: SetEntry[], date: string): Set<string> => {
  const day = new Set(entries.filter((e) => e.date === date).map((e) => e.id));
  return new Set([...prIds(entries)].filter((id) => day.has(id)));
};

/** The heaviest working set, more reps breaking a tie. */
const topSet = (sets: SetEntry[]) => sets.reduce((a, b) => (b.weight > a.weight || (b.weight === a.weight && (b.reps ?? 0) > (a.reps ?? 0)) ? b : a));

export interface DaySummary {
  lifts: { exercise: string; top: SetEntry; last: SetEntry | null; pr: boolean }[];
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
    return { exercise, top: topSet(sets), last: prev.length ? topSet(prev) : null, pr: sets.some((e) => prs.has(e.id)) };
  });
  const per = new Map<Muscle, number>();
  for (const e of today) for (const [m, f] of Object.entries(muscleVector(e.exercise) ?? {}) as [Muscle, number][]) per.set(m, (per.get(m) ?? 0) + f);
  const muscles = [...per].sort((a, b) => b[1] - a[1]);
  return { lifts, muscles };
}
