import { liftKey } from '../ids';
import { aheadVar, dayOf, type Core } from './capacity';

// Item 04: a lift's strength is the learning core's fatigue-adjusted level (00-core §1.2), not the best Epley reading of recent
// sets. Every set informs it (reps + logged RIR, or the habit; a set stopped at its target as a lower bound), with its session's
// fatigue put back, so a late or pre-fatigued set isn't read as lost strength (b). The level is a random walk in ln e1RM: its
// SD grows with the learned drift and with layoffs (a: Bosquet 2013) until the next session, and it carries the systematic SD of
// what only test sets fix, the RIR bias and the habit (b, first-order error propagation).

export interface Strength {
  /** The e1RM, lb: exp of the level at the lift's latest session (a random walk's best guess for any later day). */
  e1rm: number;
  /** ln e1RM, and its SD on `date` (the latest level's, grown by the drift and any layoff since). */
  x: number; sd: number;
  /** The SD from the RIR bias and habit (ln): only tests shrink it. */
  sys: number;
  /** The whole uncertainty, √(sd² + sys²), ln e1RM: about a fraction of the e1RM (0.04 is ±4 %). */
  u: number;
  /** The lift's reps–load slope κ: the weight for r reps to failure is e1rm / (1 + r/κ). */
  kappa: number;
  /** The latest session the level is from, and the days from it to `date`. */
  last: string; days: number;
  /** Test sessions (any lift) that calibrated the RIR bias and the habit: tests are pooled across lifts. */
  tests: number;
}

/** A lift's strength on `date` from a fitted core; null for a lift the core has no level for (a hold, bodyweight, cardio, none). */
export function strengthOf(core: Core, exercise: string, date: string): Strength | null {
  const l = core.lifts.get(liftKey(exercise));
  const p = l?.level.at(-1);
  if (!l || !p) return null;
  const days = Math.max(0, dayOf(date) - p.day);
  const sd = Math.sqrt(p.sd * p.sd + aheadVar(core, days));
  return { e1rm: Math.exp(p.x), x: p.x, sd, sys: l.sys, u: Math.hypot(sd, l.sys), kappa: l.kappa.mean, last: p.date, days, tests: core.tests };
}

/** The weight that leaves `reps` reps to failure at this strength: the capacity equation at C = reps. */
export const weightFor = (s: { e1rm: number; kappa: number }, reps: number): number => s.e1rm / (1 + reps / s.kappa);

/** The level at each of the lift's sessions, oldest first (smoothed: what all the data says it was then), as e1RM in lb. */
export function levelSeries(core: Core, exercise: string): { date: string; e1rm: number; sd: number }[] {
  return (core.lifts.get(liftKey(exercise))?.level ?? []).map((p) => ({ date: p.date, e1rm: Math.exp(p.x), sd: p.sd }));
}
