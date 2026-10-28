import { liftKey } from '../ids';
import { doneAt, learnable } from '../stats';
import { inOrder } from './num';
import type { SetEntry } from '../types';
import { pool } from './pool';
import { liftSimilarity } from './tags';

// The pace layer (00-core §3): how long this person takes from one set of a lift to the next, learned at the PERSON level as
// soon as there are 3 timed gaps in total (not 3 per lift: the per-lift threshold is why session length never learned), then
// shrunk per lift toward the person and similar lifts (learn/pool). In logs: gaps are skewed, and "half as long" and "twice as
// long" are equally far. Until there are 3 gaps, null: callers use their defaults (timing.ts DEFAULT_PACE, (c)).

/** Gaps above this are a break, not a rest (timing.ts MAX_SAME). */
const MAX_GAP = 600;
/** Gaps in total before the person level replaces the defaults (00-core §3). */
export const PERSON_MIN = 3;
/**
 * (c) Prior for the pooling only: a lift's usual gap may sit ~30 % from the person's (log SD 0.3); the pool learns the actual
 * spread. The person's own level needs no prior: it is the median of their gaps.
 */
export const LIFT_LOG_SD = 0.3;

export interface Pace {
  /** The person's typical gap between sets of one lift, s (median), and its log SD across gaps; n gaps. */
  gap: number; logSd: number; n: number;
  /** A lift's usual gap, s, pooled (its own median with many gaps, the person's / family's with few). */
  lift(name: string): { gap: number; sd: number; n: number };
}

// One day's same-lift gaps (lift key, ln s), cached by the day's sets: the store never changes a set in place, so the same
// objects in the same order are the same day (as learn/capacity's session cache).
interface Gaps { keys: string[]; xs: Float64Array }
const DAYS = new WeakMap<SetEntry, { d: readonly SetEntry[]; gaps: Gaps }>();
function cached(d: readonly SetEntry[]): Gaps | null {
  const hit = DAYS.get(d[0]);
  if (!hit || hit.d.length !== d.length) return null;
  for (let i = 0; i < d.length; i++) if (hit.d[i] !== d[i]) return null;
  return hit.gaps;
}
function dayGaps(d: SetEntry[]): Gaps {
  const hit = cached(d);
  if (hit) return hit;
  const order = (a: SetEntry, b: SetEntry) => doneAt(a) - doneAt(b);
  if (!inOrder(d, order)) { d.sort(order); const h = cached(d); if (h) return h; }
  const keys: string[] = [], xs: number[] = [];
  for (let i = 1; i < d.length; i++) {
    const g = (doneAt(d[i]) - doneAt(d[i - 1])) / 1000;
    const k = liftKey(d[i].exercise);
    if (g > 0 && g <= MAX_GAP && k === liftKey(d[i - 1].exercise)) { keys.push(k); xs.push(Math.log(g)); }
  }
  const gaps = { keys, xs: new Float64Array(xs) };
  DAYS.set(d[0], { d: [...d], gaps });
  return gaps;
}

export function paceOf(entries: readonly SetEntry[]): Pace | null {
  entries = learnable(entries); // the log without sets marked not used (stats.learnable)
  const days = new Map<string, SetEntry[]>();
  for (const e of entries) {
    if (!e.loggedAt || e.flags.includes('warmup')) continue;
    const d = days.get(e.date);
    if (d) d.push(e); else days.set(e.date, [e]);
  }
  const dg: Gaps[] = [];
  let n = 0;
  for (const d of days.values()) { const g = dayGaps(d); dg.push(g); n += g.xs.length; }
  if (n < PERSON_MIN) return null;
  // Every gap (sorted below, for the median and IQR), and per lift the running sum and count (for its mean), in log order.
  const sorted = new Float64Array(n);
  const per = new Map<string, { sum: number; n: number }>();
  let j = 0;
  for (const { keys, xs } of dg) {
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i];
      sorted[j++] = x;
      const q = per.get(keys[i]);
      if (q) { q.sum += x; q.n++; } else per.set(keys[i], { sum: x, n: 1 });
    }
  }
  sorted.sort(); // a typed array sorts numerically, without a comparator call per step
  const med = sorted[sorted.length >> 1];
  // Robust spread: the interquartile range of a normal is 1.349 SD.
  const iqr = sorted[Math.floor(sorted.length * 0.75)] - sorted[Math.floor(sorted.length * 0.25)];
  const logSd = Math.max(0.05, iqr / 1.349);
  const items = [...per].map(([key, q]) => ({ key, est: q.sum / q.n, v: logSd ** 2 / q.n }));
  const p = pool(items, liftSimilarity, { mean: med, personSd: logSd / Math.sqrt(n), liftSd: LIFT_LOG_SD });
  return {
    gap: Math.exp(med), logSd, n,
    lift: (name) => {
      const k = liftKey(name), post = p.lift(k);
      return { gap: Math.exp(post.mean), sd: post.sd, n: per.get(k)?.n ?? 0 };
    },
  };
}
