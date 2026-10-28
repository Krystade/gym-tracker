import { gearOf } from './equipment';
import { liftKey } from './ids';
import { BAR, isBarLift } from './plates';
import { byOrderDone } from './stats';
import type { SetEntry } from './types';

// Bar lifts logged as the weight on each side, from before the app logged totals (Data → Bar sets logged per side, a one-off
// review). Found from the log alone, nothing about any one person:
// - Each lift's cut-over is its first set logged in the app: from that day on it is totals. Sets before it are read.
// - A session there with a set under the bar's own weight (an empty bar logged as 0, a 35 a side) can't be a total: per side.
// - A session there without one reads per side when 2 × side + bar lands nearer that lift's per-side sessions than the
//   number as logged does; else it already reads as a total, listed unticked.
// - Smith machine sets before the year the app was first used to log: a machine's bar weighs what it weighs, and an old
//   machine's isn't known, so they are neither converted nor guessed: kept as logged and marked not used (SetEntry.excluded).
// - A session imported with its sets twice over (the same run of sets, one after the other): the second run goes.

/** One lift's sets on one day, read per side (`side`, ticked to convert) or as a total already (`total`, unticked). */
export interface PerSideSession { exercise: string; date: string; sets: SetEntry[]; reads: 'side' | 'total' }
/** One lift's sets on one day imported twice: `keep` the first run, `remove` its repeat. */
export interface DoubledSession { exercise: string; date: string; keep: SetEntry[]; remove: SetEntry[] }
export interface PerSideReview {
  convert: PerSideSession[];
  /** Smith machine sets from before `boundary`: kept as logged, marked not used for learning or records. */
  flag: PerSideSession[];
  doubled: DoubledSession[];
  /** The first day of the year the app first logged a set; null when it never has. */
  boundary: string | null;
}

/** The total a weight per side makes: both sides and the bar. */
export const totalOf = (side: number, bar = BAR): number => 2 * side + bar; // as dayEdit.toTotals

const isSmith = (exercise: string) => gearOf(exercise) === 'Smith machine' || /\bsmith\b/i.test(exercise);
const valueKey = (e: SetEntry) => `${e.weight}x${e.reps ?? '-'}`;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

/** The second run of a session whose sets are one run of at least two different sets, twice over; empty when it isn't. */
export function repeatedRun(sets: readonly SetEntry[]): SetEntry[] {
  const n = sets.length, h = n / 2;
  if (n < 4 || n % 2) return [];
  const first = sets.slice(0, h), second = sets.slice(h);
  if (new Set(first.map(valueKey)).size < 2) return []; // 4 × 70 × 8 is four sets, not two twice
  return first.every((e, i) => valueKey(e) === valueKey(second[i])) ? second : [];
}

export function findPerSide(entries: readonly SetEntry[], bar = BAR): PerSideReview {
  const firstApp = entries.reduce<string | null>((d, e) => (e.source === 'app' && (!d || e.date < d) ? e.date : d), null);
  const boundary = firstApp ? `${firstApp.slice(0, 4)}-01-01` : null;
  const lifts = new Map<string, SetEntry[]>();
  for (const e of entries) {
    if (e.cardio || e.excluded || !isBarLift(e.exercise)) continue;
    const k = liftKey(e.exercise), xs = lifts.get(k);
    if (xs) xs.push(e); else lifts.set(k, [e]);
  }
  const out: PerSideReview = { convert: [], flag: [], doubled: [], boundary };
  for (const sets of lifts.values()) {
    const cut = sets.reduce<string | null>((d, e) => (e.source === 'app' && (!d || e.date < d) ? e.date : d), null);
    const days = new Map<string, SetEntry[]>();
    for (const e of sets) {
      if (cut && e.date >= cut) continue;
      const xs = days.get(e.date);
      if (xs) xs.push(e); else days.set(e.date, [e]);
    }
    const sessions: PerSideSession[] = [];
    for (const [date, day] of [...days].sort(([a], [b]) => (a < b ? -1 : 1))) {
      day.sort(byOrderDone);
      // Twice over within one import's session: the repeat goes, and the rest is read as one session.
      const bySource = new Map<string, SetEntry[]>();
      for (const e of day) { const xs = bySource.get(e.source); if (xs) xs.push(e); else bySource.set(e.source, [e]); }
      const gone = new Set<string>();
      for (const [source, xs] of bySource) {
        if (source === 'app') continue;
        const again = repeatedRun(xs);
        if (again.length) {
          out.doubled.push({ exercise: xs[0].exercise, date, keep: xs.slice(0, xs.length / 2), remove: again });
          for (const e of again) gone.add(e.id);
        }
      }
      const kept = day.filter((e) => !gone.has(e.id));
      sessions.push({ exercise: kept[0].exercise, date, sets: kept, reads: 'total' });
    }
    const old = (s: PerSideSession) => boundary != null && s.date < boundary && isSmith(s.exercise);
    out.flag.push(...sessions.filter(old));
    const open = sessions.filter((s) => !old(s));
    const anchors = open.filter((s) => s.sets.some((e) => e.weight < bar));
    if (!anchors.length) continue; // nothing says per side: left as logged
    const ref = median(anchors.flatMap((s) => s.sets.map((e) => totalOf(e.weight, bar))));
    const off = (x: number) => Math.abs(Math.log(x / ref));
    for (const s of open) {
      const w = s.sets.map((e) => e.weight);
      const side = anchors.includes(s) || off(median(w.map((x) => totalOf(x, bar)))) <= off(median(w));
      out.convert.push({ ...s, reads: side ? 'side' : 'total' });
    }
  }
  const byDate = (a: { date: string; exercise: string }, b: { date: string; exercise: string }) => a.date.localeCompare(b.date) || a.exercise.localeCompare(b.exercise);
  out.convert.sort(byDate); out.flag.sort(byDate); out.doubled.sort(byDate);
  return out;
}

/** Whether there's anything to review. */
export const hasPerSide = (r: PerSideReview): boolean => r.convert.some((s) => s.reads === 'side') || r.flag.length > 0 || r.doubled.length > 0;
