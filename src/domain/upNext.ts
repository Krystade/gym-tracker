import { isTraining, isWorking } from './progression';
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
  left: readonly string[]; round?: readonly string[]; on?: string }): string {
  // A test single isn't one of the plan's sets (owner, 2026-10-23).
  const done = (lift: string) => o.entries.filter((e) => e.date === o.date && sameExercise(e.exercise, lift) && isTraining(e)).length;
  const more = (lift: string) => { const p = o.planned(lift); return p == null || p <= 0 || done(lift) < p; };
  const again = o.round?.find(more) ?? (more(o.exercise) ? o.exercise : undefined);
  if (again) return setNext(again, done(again) + 1);
  if (o.on && !sameExercise(o.on, o.exercise) && more(o.on)) return setNext(o.on, done(o.on) + 1);
  const next = o.left.find((l) => !sameExercise(l, o.exercise) && !o.round?.some((r) => sameExercise(r, l)) && more(l));
  return next ? `${NEXT}${next}` : PLAN_DONE;
}

/**
 * The lift he's on besides `exercise`, as a set on it is saved: of the day's other lifts (`lifts`, Today's cards) with sets
 * still to do, the one touched last, a set logged on it or its card tapped (`touched`, epoch ms), if that was since this
 * lift's first set today: he went to it while this one was going. None when he hasn't.
 */
export function onLift(o: { exercise: string; entries: readonly SetEntry[]; date: string; planned: (exercise: string) => number | null | undefined;
  lifts: readonly string[]; touched: (lift: string) => number | undefined }): string | undefined {
  const day = o.entries.filter((e) => e.date === o.date);
  const at = (e: SetEntry) => (e.loggedAt ? Date.parse(e.loggedAt) : e.seq);
  const mine = day.filter((e) => sameExercise(e.exercise, o.exercise) && isWorking(e)).map(at);
  if (!mine.length) return undefined;
  const since = Math.min(...mine);
  let best: { lift: string; t: number } | undefined;
  for (const lift of o.lifts) {
    if (sameExercise(lift, o.exercise)) continue;
    const sets = day.filter((e) => sameExercise(e.exercise, lift) && isWorking(e));
    const p = o.planned(lift);
    if (p != null && p > 0 && sets.filter(isTraining).length >= p) continue; // done
    const t = Math.max(o.touched(lift) ?? -Infinity, ...sets.map(at));
    if (t > since && (!best || t > best.t)) best = { lift, t };
  }
  return best?.lift;
}
