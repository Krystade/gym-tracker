import { liftKey, normalizeName } from './ids';
import type { SetEntry } from './types';

const key = liftKey;
export const sameExercise = (a: string, b: string) => a === b || key(a) === key(b);

// Indexes of one log array, built on first use. The store never changes a log array in place: every add, edit, delete,
// sync or reload makes a new one (state/useSets), so an index can't go stale; a changed log is a new array with its own.
// The length is checked too, so an array pushed to after it was read is indexed again rather than read stale.
interface Indexed<T> { n: number; v: T }
export function perLog<T>(build: (entries: readonly SetEntry[]) => T): (entries: readonly SetEntry[]) => T {
  const cache = new WeakMap<readonly SetEntry[], Indexed<T>>();
  return (entries) => {
    const hit = cache.get(entries);
    if (hit && hit.n === entries.length) return hit.v;
    const v = build(entries);
    cache.set(entries, { n: entries.length, v });
    return v;
  };
}
function bucket<K>(entries: readonly SetEntry[], by: (e: SetEntry) => K): Map<K, SetEntry[]> {
  const out = new Map<K, SetEntry[]>();
  for (const e of entries) {
    const k = by(e);
    const list = out.get(k);
    if (list) list.push(e); else out.set(k, [e]);
  }
  return out;
}

/** Each lift's sets in log order, by lift key, lifts in the order first logged. Read-only: it's shared. */
export const liftIndex: (entries: readonly SetEntry[]) => ReadonlyMap<string, readonly SetEntry[]> = perLog((entries) => bucket(entries, (e) => key(e.exercise)));
const NONE: readonly SetEntry[] = Object.freeze([]);
/** One lift's sets, in log order: `entries.filter((e) => sameExercise(e.exercise, exercise))`, without the scan. Read-only. */
export const liftSets = (entries: readonly SetEntry[], exercise: string): readonly SetEntry[] => liftIndex(entries).get(key(exercise)) ?? NONE;

const dayIndex = perLog((entries) => bucket(entries, (e) => e.date));
/** One day's sets, in log order: `entries.filter((e) => e.date === date)`, without the scan. Read-only. */
export const daySets = (entries: readonly SetEntry[], date: string): readonly SetEntry[] => dayIndex(entries).get(date) ?? NONE;

export function e1rm(s: SetEntry): number | null {
  if (s.weight <= 0 || s.reps == null || s.reps < 1 || s.reps > 20) return null;
  if (s.flags.some((f) => f === 'bodyweight' || f === 'partial' || f === 'warmup' || f === 'hold')) return null;
  return s.reps === 1 ? s.weight : s.weight * (1 + s.reps / 30);
}

export const estimateWeightForReps = (e1: number, reps: number): number => (reps <= 1 ? e1 : e1 / (1 + reps / 30));

export interface Session { date: string; sets: SetEntry[] }

function group(entries: readonly SetEntry[]): Session[] {
  return [...bucket(entries, (e) => e.date).entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, sets]) => ({ date, sets }));
}

// Sorting and every whole-log time pass read loggedAt, so each distinct time is parsed once. Bounded: a long log is
// tens of thousands of sets.
const TIMES = new Map<string, number>();
const MAX_TIMES = 100_000;
/** When a set was done, in epoch ms: NaN without a time (pasted, imported without times, untimed late sets). */
export function doneAt(e: SetEntry): number {
  const s = e.loggedAt;
  if (!s) return NaN;
  let t = TIMES.get(s);
  if (t === undefined) {
    t = Date.parse(s);
    if (TIMES.size >= MAX_TIMES) TIMES.clear();
    TIMES.set(s, t);
  }
  return t;
}
/** The order sets were done: sets with a time by that time, then sets without one (pasted, imported without times, untimed late sets) in the order entered. */
export function byOrderDone(a: SetEntry, b: SetEntry): number {
  const ta = doneAt(a), tb = doneAt(b);
  const na = Number.isNaN(ta), nb = Number.isNaN(tb);
  if (na !== nb) return na ? 1 : -1;
  return (na ? 0 : ta - tb) || a.seq - b.seq || a.setNo - b.setNo;
}

export const sessionsFor = (entries: readonly SetEntry[], exercise: string): Session[] =>
  group(liftSets(entries, exercise)).map((x) => ({ ...x, sets: [...x.sets].sort(byOrderDone) }));

export const sessionsByDate = (entries: SetEntry[]): Session[] =>
  group(entries).map((x) => ({ ...x, sets: [...x.sets].sort(byOrderDone) }));

export const lastSession = (entries: SetEntry[], exercise: string, beforeDate: string): Session | null =>
  sessionsFor(entries, exercise).find((x) => x.date < beforeDate) ?? null;

export interface SeriesPoint { date: string; e1rm: number; pr: boolean }

export function e1rmSeries(entries: SetEntry[], exercise: string): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let top = -Infinity;
  for (const x of [...sessionsFor(entries, exercise)].reverse()) {
    const vals = x.sets.map(e1rm).filter((v): v is number => v != null);
    if (!vals.length) continue;
    const v = Math.max(...vals);
    out.push({ date: x.date, e1rm: v, pr: v > top });
    top = Math.max(top, v);
  }
  return out;
}

export const currentE1rm = (series: SeriesPoint[]): number | null =>
  series.length ? Math.max(...series.slice(-3).map((p) => p.e1rm)) : null;

/** One display spelling per exercise (the most recent), most recently used first. */
export function exerciseNames(entries: SetEntry[]): string[] {
  const latest = new Map<string, SetEntry>();
  for (const e of entries) {
    const k = key(e.exercise);
    const cur = latest.get(k);
    if (!cur || e.date > cur.date || (e.date === cur.date && e.seq > cur.seq)) latest.set(k, e);
  }
  return [...latest.values()].sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq).map((e) => normalizeName(e.exercise));
}

export const canonicalName = (entries: SetEntry[], name: string): string =>
  exerciseNames(entries).find((n) => sameExercise(n, name)) ?? normalizeName(name);

/** A day's lifts in the order each was started: adding a set later in the day never moves a lift. */
export function dayOrder(entries: SetEntry[], date: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [...daySets(entries, date)].sort(byOrderDone)) {
    const k = key(e.exercise);
    if (!seen.has(k)) { seen.add(k); out.push(normalizeName(e.exercise)); }
  }
  return out;
}
