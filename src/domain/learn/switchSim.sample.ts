import { addDays } from '../analytics';
import type { SetEntry } from '../types';
import { rng } from './num';

// Synthetic sessions with known truth, for superset detection and the learned switch (item 15). Nobody's log. As the research
// sim (15-superset-sim.py): a gap is the time to the next set's start (a rest, or a switch's walk and setup) plus that set
// itself, each log-normal with SD 0.25, and the logging is late by 0–5 s a set, 10–60 s more for 15 % of them.

/** A lifter: the switch's walk and setup, a set's length, his rest; medians, s. */
export interface Profile { walk: number; set: number; rest: number }
/** How the pair is done that day: as a superset (A B, rest, A B…), alternated with a full rest each way, or straight. */
export type Kind = 'superset' | 'alternate' | 'straight';

export const A = 'Cable Curl', B = 'Cable Pushdown', C = 'Bench Press';

let seq = 0;
/**
 * One session on `date`: three straight sets of the bench, then the curl and pushdown, three sets each, done as `kind`.
 * `o.lateFrom`: sets from this index on are entered late (`enteredAt`), so their times are guesses. `o.pace`: the day's own
 * pace, multiplying every rest and walk (a slow day is slow throughout).
 */
export function session(p: Profile, kind: Kind, date: string, r: ReturnType<typeof rng>, o: { rounds?: number; lateFrom?: number; pace?: number } = {}): SetEntry[] {
  const ln = (m: number) => m * Math.exp(r.normal(0, 0.25));
  const late = () => r.next() * 5 + (r.next() < 0.15 ? 10 + r.next() * 50 : 0);
  const rounds = o.rounds ?? 3;
  const order: { ex: string; before: 'rest' | 'walk' }[] = [C, C, C].map((ex) => ({ ex, before: 'rest' as const }));
  if (kind === 'straight') for (const ex of [A, B]) for (let i = 0; i < rounds; i++) order.push({ ex, before: i ? 'rest' : 'walk' });
  else for (let i = 0; i < rounds; i++) { order.push({ ex: A, before: 'rest' }); order.push({ ex: B, before: kind === 'superset' ? 'walk' : 'rest' }); }
  let t = 0, last = -Infinity;
  return order.map(({ ex, before }, i) => {
    t += (i === 0 ? 0 : (o.pace ?? 1) * (before === 'rest' ? ln(p.rest) : ln(p.walk))) + ln(p.set);
    seq++;
    // Logged late, but never before the set before it was.
    const at = (last = Math.max(last + 1000, Date.parse(`${date}T18:00:00Z`) + (t + late()) * 1000));
    return {
      id: `w|${date}|${seq}`, date, seq, exercise: ex, setNo: i + 1, weight: 50, reps: 10, flags: [], source: 'app',
      loggedAt: new Date(at).toISOString(),
      ...(o.lateFrom != null && i >= o.lateFrom && { enteredAt: new Date(at + 3600_000).toISOString() }),
    } satisfies SetEntry;
  });
}

/** `days` sessions two days apart from `from`, each one's kind drawn by `kind(i, r)`; `daySd`: the SD of a day's own pace, in logs. */
export function simulate(p: Profile, from: string, days: number, seed: number, kind: (i: number, r: ReturnType<typeof rng>) => Kind, daySd = 0): SetEntry[] {
  const r = rng(seed);
  const out: SetEntry[] = [];
  for (let i = 0; i < days; i++) out.push(...session(p, kind(i, r), addDays(from, 2 * i), r, { pace: Math.exp(r.normal(0, daySd)) }));
  return out;
}

/** The research sim's 27 lifters: walk 15/35/60 s, sets 25/45/75 s, rests 75/120/180 s. */
export const PROFILES: Profile[] = [15, 35, 60].flatMap((walk) => [25, 45, 75].flatMap((set) => [75, 120, 180].map((rest) => ({ walk, set, rest }))));
