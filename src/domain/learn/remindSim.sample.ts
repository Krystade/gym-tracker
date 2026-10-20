import { addDays } from '../analytics';
import type { SetEntry } from '../types';
import { rng } from './num';
import { wallClock } from './remind';

// Synthetic training calendars with known truth, for the reminder fit (item 16). Nobody's log.

/** The instant (ISO) that is `min` minutes after local midnight of `date` in `tz`. */
export function atLocal(date: string, min: number, tz: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const want = Date.UTC(y, m - 1, d) + min * 60_000;
  let t = want;
  for (let i = 0; i < 3; i++) {
    const w = wallClock(new Date(t).toISOString(), tz)!;
    const [wy, wm, wd] = w.date.split('-').map(Number);
    t += want - (Date.UTC(wy, wm - 1, wd) + Math.round(w.min * 60_000));
  }
  return new Date(t).toISOString();
}

export interface Truth {
  /** P(trains) per weekday, 0 = Sunday. */
  p: readonly number[];
  /** A start time in minutes after midnight for weekday `wd`, or null for an untimed (imported) date. */
  start: (wd: number, r: ReturnType<typeof rng>) => number | null;
}

let seq = 0;
/** One date's sets: the first at `min` (or untimed), two more a few minutes apart. */
export function day(date: string, min: number | null, tz = 'UTC', opts: { enteredAt?: string } = {}): SetEntry[] {
  return [0, 1, 2].map((k) => ({
    id: `s|${date}|${seq}|${k}`, date, seq: seq++, exercise: 'Bench Press', setNo: k + 1, weight: 100, reps: 8, flags: [],
    source: min == null ? 'import' : 'app',
    ...(min != null && { loggedAt: atLocal(date, min + 4 * k, tz) }),
    ...(k === 0 && opts.enteredAt && { enteredAt: opts.enteredAt }),
  }));
}

/** `weeks` weeks from Monday `from`, drawn from `truth`; weeks in `skip` (0-based) are a layoff with nothing logged. */
export function simulate(truth: Truth, from: string, weeks: number, seed: number, tz = 'UTC', skip: ReadonlySet<number> = new Set()): SetEntry[] {
  const r = rng(seed);
  const out: SetEntry[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let k = 0; k < 7; k++) {
      const date = addDays(from, 7 * w + k);
      const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
      const go = r.next() < truth.p[wd];
      const start = truth.start(wd, r);
      if (go && !skip.has(w)) out.push(...day(date, start, tz));
    }
  }
  return out;
}
