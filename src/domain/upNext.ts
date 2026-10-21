import { isWorking } from './progression';
import { sameExercise } from './stats';
import type { SetEntry } from './types';

/** What comes after the last planned set of the day's last planned lift. */
export const PLAN_DONE = 'Plan done';
/** The label for a set still to come on lift `exercise` ("Bench Press · set 4 next"): the bar shows "Set 4 next". */
export const setNext = (exercise: string, n: number) => `${exercise} · set ${n} next`;
/** The label for the next lift once this one's planned sets are done ("Next: Leg Press"). */
export const NEXT = 'Next: ';

/**
 * What the rest after a set leads to, as the rest bar and the lock-screen alert say it. `entries`: the log with that set in it;
 * `planned(lift)`: its sets planned today (null for none); `left`: the plan's lifts not yet done, in its order, as they stood
 * before the set; `round`: inside a superset whose round the set ended, its lifts in order.
 *
 * Never a set past the plan (owner, 2026-10-20: the 4th of 4 said "set 5 next"): once a lift's planned sets are done, the plan's
 * next lift with sets left, or PLAN_DONE. A lift with no planned count counts on. A superset's next round starts on its first
 * lift with sets left.
 */
export function upNext(o: { exercise: string; entries: readonly SetEntry[]; date: string; planned: (exercise: string) => number | null | undefined;
  left: readonly string[]; round?: readonly string[] }): string {
  const done = (lift: string) => o.entries.filter((e) => e.date === o.date && sameExercise(e.exercise, lift) && isWorking(e)).length;
  const more = (lift: string) => { const p = o.planned(lift); return p == null || p <= 0 || done(lift) < p; };
  const again = o.round?.find(more) ?? (more(o.exercise) ? o.exercise : undefined);
  if (again) return setNext(again, done(again) + 1);
  const next = o.left.find((l) => !sameExercise(l, o.exercise) && !o.round?.some((r) => sameExercise(r, l)) && more(l));
  return next ? `${NEXT}${next}` : PLAN_DONE;
}
