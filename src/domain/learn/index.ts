import { perLog } from '../stats';
import type { SetEntry } from '../types';
import { fitCore, type Core } from './capacity';
import { paceOf, type Pace } from './pace';

// The learning core's one entry point (00-core): fitted once per log array, like every other index (stats.perLog), so each
// profile's log learns on its own and a screen that asks twice pays once. A new set makes a new array and a refit; sessions
// whose sets are unchanged reuse their cached blocks and rows (learn/capacity), so the refit is the solve, not the bookkeeping.
export interface Learned { core: Core; pace: Pace | null }
export const learn: (entries: readonly SetEntry[]) => Learned = perLog((entries) => ({ core: fitCore(entries), pace: paceOf(entries) }));
export { aheadVar, dayOf, decay, e1rmAdjusted, fatigueOf, testSd, type Core, type LiftCore, type Est, type Features } from './capacity';
export { type Pace } from './pace';

const BEFORE = new WeakMap<readonly SetEntry[], { n: number; by: Map<string, readonly SetEntry[]> }>();
/** The log without `date` and later, the same array for the same log and day (so what is learned from it is cached). */
export function logBefore(entries: readonly SetEntry[], date: string): readonly SetEntry[] {
  let hit = BEFORE.get(entries);
  if (!hit || hit.n !== entries.length) BEFORE.set(entries, hit = { n: entries.length, by: new Map() });
  let out = hit.by.get(date);
  if (!out) {
    out = entries.some((e) => e.date >= date) ? entries.filter((e) => e.date < date) : entries;
    if (hit.by.size > 8) hit.by.clear();
    hit.by.set(date, out);
  }
  return out;
}

/** The core as of the days before `date` (a target or a prompt doesn't move under you while you train); null if it can't fit. */
export function coreBefore(entries: readonly SetEntry[], date: string): Core | null {
  try { return learn(logBefore(entries, date)).core; } catch { return null; } // a refinement: never a reason to fail
}
