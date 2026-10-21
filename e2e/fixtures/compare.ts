import type { APIRequestContext } from '@playwright/test';
import { summarize, type Summary } from '../../src/domain/compare';
import type { SetEntry } from '../../src/domain/types';
import { iso, put, session, Ts, type Seeded, type Set0 } from '../seed';

// Compare (round 22): friends' logs, made up, and the summary each one's phone would publish from it (domain/compare summarize),
// put straight into the emulator as an admin. Synthetic people, lifts and numbers only.

const POOL: [string, number][] = [['Bench Press', 135], ['Barbell Squat', 185], ['Deadlift', 225], ['Overhead Press', 85], ['Barbell Row', 115], ['Lat Pulldown', 100]];

/**
 * A friend’s four months: `days` sessions a week, each of three lifts from the pool, climbing `rate` lb a week from their own start
 * (some barely, some fast, one going backwards), and a first pull-up a fortnight ago for those who `pull`.
 */
export function friendLog(k: number, today: Date, o: { days?: number; rate?: number; pull?: boolean; weeks?: number } = {}): Set0[] {
  const days = o.days ?? 2 + (k % 3), rate = o.rate ?? [0.5, 1.5, 3, -0.5, 2, 1][k % 6], weeks = o.weeks ?? 16;
  const out: Set0[] = [];
  for (let w = weeks; w >= 0; w--) {
    for (let d = 0; d < days; d++) {
      const t = new Date(today.getTime() - (w * 7 + (days - 1 - d) * 2 + 1) * 864e5);
      t.setHours(7 + (k % 10), 0, 0, 0);
      const lifts = [0, 1, 2].map((j) => POOL[(k + d + j) % POOL.length]);
      out.push(...session(t, lifts.map(([name, start]) => [name, [[Math.round((start + (weeks - w) * rate) / 2.5) * 2.5, 5], [Math.round((start + (weeks - w) * rate) / 2.5) * 2.5, 5]]] as [string, [number, number][]])));
    }
  }
  if (o.pull ?? k % 4 === 1) {
    const t = new Date(today.getTime() - 14 * 864e5);
    t.setHours(19, 0, 0, 0);
    out.push(...session(t, [['Pull-up', [[0, 1], [0, 1]]]]));
  }
  return out;
}

/** What their phone would publish from that log. */
export const summaryOf = (sets: Set0[], today: Date, goal: number): Summary => summarize(sets as unknown as SetEntry[], iso(today), goal);

/** Their summary, written as their phone writes it (users/{uid}/summary/compare, at the server's time). */
export async function publish(request: APIRequestContext, who: Seeded, s: Summary) {
  await put(request, `users/${who.uid}/summary/compare`, { ...s, at: new Ts(Date.now()) } as unknown as Record<string, unknown>);
}
