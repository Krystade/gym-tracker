import { normalizeName } from './ids';
import type { SetEntry } from './types';

const key = (name: string) => normalizeName(name).toLowerCase();
export const sameExercise = (a: string, b: string) => key(a) === key(b);

export function e1rm(s: SetEntry): number | null {
  if (s.weight <= 0 || s.reps == null || s.reps < 1 || s.reps > 20) return null;
  if (s.flags.some((f) => f === 'bodyweight' || f === 'partial' || f === 'warmup' || f === 'hold')) return null;
  return s.reps === 1 ? s.weight : s.weight * (1 + s.reps / 30);
}

export const estimateWeightForReps = (e1: number, reps: number): number => (reps <= 1 ? e1 : e1 / (1 + reps / 30));

export interface Session { date: string; sets: SetEntry[] }

function group(entries: SetEntry[]): Session[] {
  const by = new Map<string, SetEntry[]>();
  for (const e of entries) {
    const list = by.get(e.date);
    if (list) list.push(e); else by.set(e.date, [e]);
  }
  return [...by.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, sets]) => ({ date, sets }));
}

const doneAt = (e: SetEntry) => (e.loggedAt ? Date.parse(e.loggedAt) : NaN);
/** The order sets were done: sets with a time by that time, then sets without one (pasted, imported without times, untimed late sets) in the order entered. */
export function byOrderDone(a: SetEntry, b: SetEntry): number {
  const ta = doneAt(a), tb = doneAt(b);
  const na = Number.isNaN(ta), nb = Number.isNaN(tb);
  if (na !== nb) return na ? 1 : -1;
  return (na ? 0 : ta - tb) || a.seq - b.seq || a.setNo - b.setNo;
}

export const sessionsFor = (entries: SetEntry[], exercise: string): Session[] =>
  group(entries.filter((e) => sameExercise(e.exercise, exercise))).map((x) => ({ ...x, sets: [...x.sets].sort(byOrderDone) }));

export const sessionsByDate = (entries: SetEntry[]): Session[] =>
  group(entries).map((x) => ({ ...x, sets: [...x.sets].sort(byOrderDone) }));

export const lastSession = (entries: SetEntry[], exercise: string, beforeDate: string): Session | null =>
  sessionsFor(entries, exercise).find((x) => x.date < beforeDate) ?? null;

export function bestSet(entries: SetEntry[], exercise: string): { set: SetEntry; e1rm: number } | null {
  let best: { set: SetEntry; e1rm: number } | null = null;
  for (const e of entries) {
    if (!sameExercise(e.exercise, exercise)) continue;
    const v = e1rm(e);
    if (v != null && (!best || v > best.e1rm)) best = { set: e, e1rm: v };
  }
  return best;
}

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
  for (const e of entries.filter((x) => x.date === date).sort(byOrderDone)) {
    const k = key(e.exercise);
    if (!seen.has(k)) { seen.add(k); out.push(normalizeName(e.exercise)); }
  }
  return out;
}
