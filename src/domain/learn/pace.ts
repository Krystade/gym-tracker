import { liftKey } from '../ids';
import { doneAt } from '../stats';
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
const LIFT_LOG_SD = 0.3;

export interface Pace {
  /** The person's typical gap between sets of one lift, s (median), and its log SD across gaps; n gaps. */
  gap: number; logSd: number; n: number;
  /** A lift's usual gap, s, pooled (its own median with many gaps, the person's / family's with few). */
  lift(name: string): { gap: number; sd: number; n: number };
}

// One day's same-lift gaps (lift key, ln s), cached by the day's sets: the store never changes a set in place, so the same
// objects in the same order are the same day (as learn/capacity's session cache).
const DAYS = new WeakMap<SetEntry, { d: readonly SetEntry[]; gaps: [string, number][] }>();
function dayGaps(d: SetEntry[]): [string, number][] {
  const same = () => { const hit = DAYS.get(d[0]); return hit && hit.d.length === d.length && hit.d.every((e, i) => e === d[i]) ? hit : null; };
  const hit = same();
  if (hit) return hit.gaps;
  const order = (a: SetEntry, b: SetEntry) => doneAt(a) - doneAt(b);
  if (!inOrder(d, order)) { d.sort(order); const h = same(); if (h) return h.gaps; }
  const gaps: [string, number][] = [];
  for (let i = 1; i < d.length; i++) {
    const g = (doneAt(d[i]) - doneAt(d[i - 1])) / 1000;
    const k = liftKey(d[i].exercise);
    if (g > 0 && g <= MAX_GAP && k === liftKey(d[i - 1].exercise)) gaps.push([k, Math.log(g)]);
  }
  DAYS.set(d[0], { d: [...d], gaps });
  return gaps;
}

export function paceOf(entries: readonly SetEntry[]): Pace | null {
  const days = new Map<string, SetEntry[]>();
  for (const e of entries) {
    if (!e.loggedAt || e.flags.includes('warmup')) continue;
    const d = days.get(e.date);
    if (d) d.push(e); else days.set(e.date, [e]);
  }
  const per = new Map<string, number[]>();
  const all: number[] = [];
  for (const d of days.values()) {
    for (const [k, x] of dayGaps(d)) {
      all.push(x);
      const xs = per.get(k);
      if (xs) xs.push(x); else per.set(k, [x]);
    }
  }
  if (all.length < PERSON_MIN) return null;
  const sorted = [...all].sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  // Robust spread: the interquartile range of a normal is 1.349 SD.
  const iqr = sorted[Math.floor(sorted.length * 0.75)] - sorted[Math.floor(sorted.length * 0.25)];
  const logSd = Math.max(0.05, iqr / 1.349);
  const items = [...per].map(([key, xs]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return { key, est: m, v: logSd ** 2 / xs.length };
  });
  const counts = new Map([...per].map(([k, xs]) => [k, xs.length]));
  const p = pool(items, liftSimilarity, { mean: med, personSd: logSd / Math.sqrt(all.length), liftSd: LIFT_LOG_SD });
  return {
    gap: Math.exp(med), logSd, n: all.length,
    lift: (name) => {
      const k = liftKey(name), post = p.lift(k);
      return { gap: Math.exp(post.mean), sd: post.sd, n: counts.get(k) ?? 0 };
    },
  };
}
