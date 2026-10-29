// The day Gym Buddies count from (plan §16, owner 2026-10-21: everyone starts from 0, no history): like achievements' `since`,
// each profile keeps the day it first ran a build with buddies, and a sync keeps the earliest of the phones'. A buddy then
// counts only what was logged on or after the day it joined, which is never before this start (no catch-up, §16.6).

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A kept value that is a day, else none (a bad synced value starts again rather than counting from nonsense). */
export const asDay = (v: unknown): string | undefined => (typeof v === 'string' && DAY.test(v) ? v : undefined);

/** The start to keep: the earliest real day among the phones' (and this one's `today` when none has one yet). */
export function startDay(today: string, ...kept: unknown[]): string {
  return kept.map(asDay).reduce<string>((a, d) => (d && d < a ? d : a), today);
}

/** The day a buddy counts from: the day it joined, never before the start (a clock gone back can't buy it history). */
export const countsFrom = (joined: string, start: string): string => (asDay(joined) && joined > start ? joined : start);
