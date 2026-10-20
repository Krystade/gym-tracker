import { perLog } from '../stats';
import { fitCore, type Core } from './capacity';
import { paceOf, type Pace } from './pace';

// The learning core's one entry point (00-core): fitted once per log array, like every other index (stats.perLog), so each
// profile's log learns on its own and a screen that asks twice pays once. A new set makes a new array and a refit; sessions
// whose sets are unchanged reuse their cached features (learn/capacity), so the refit is the solve, not the bookkeeping.
export interface Learned { core: Core; pace: Pace | null }
export const learn: (entries: readonly import('../types').SetEntry[]) => Learned = perLog((entries) => ({ core: fitCore(entries), pace: paceOf(entries) }));
export { decay, e1rmAdjusted, fatigueOf, type Core, type LiftCore, type Est, type Features } from './capacity';
export { type Pace } from './pace';
