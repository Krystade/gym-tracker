import { liftKey } from './ids';
import { resolveLift } from './lifts';
import { byOrderDone } from './stats';
import type { SetEntry } from './types';

// The same sets brought in twice by two imports (a paste of a notes log and a CSV made from the same log, say): found by
// lining up each day's sets from the two imports in the order each import read them, lift by lift, set by set. Never by value
// alone: two sets of 100×12 in one session are two sets, and each pairs with exactly one twin or with none.

/** Sets logged in the app are live; every other source is an import (a paste, a CSV, the converter's history.csv). */
export const isImported = (e: SetEntry): boolean => e.source !== 'app';
/** The in-app "Paste from notes" importer's source: an import checked line by line before it was added. */
export const PASTE_SOURCE = 'notes';

/** The values that say what was done. Provenance (id, source, seq, set number, as written, times) is not compared. */
export type DupField = 'exercise' | 'flags' | 'note' | 'rir' | 'pain' | 'tags' | 'cardio';
const FIELDS: [DupField, (e: SetEntry) => string][] = [
  ['exercise', (e) => liftKey(e.exercise)],
  ['flags', (e) => [...e.flags].sort().join(';')],
  ['note', (e) => (e.note ?? '').trim()],
  ['rir', (e) => String(e.rir ?? '')],
  ['pain', (e) => `${e.painRegion ?? ''}|${e.painSeverity ?? ''}`],
  ['tags', (e) => [...(e.tags ?? [])].sort().join(';')],
  ['cardio', (e) => JSON.stringify(e.cardio ?? null)],
];
export const differences = (a: SetEntry, b: SetEntry): DupField[] => FIELDS.filter(([, f]) => f(a) !== f(b)).map(([k]) => k);

/** One set imported twice: the copy to keep, the copy to remove, and the values on which they differ (none: identical). */
export interface DuplicatePair { keep: SetEntry; remove: SetEntry; differs: DupField[] }
/** A day two imports both cover: its pairs in the order done, and the lifts they're on. */
export interface DuplicateDay { date: string; pairs: DuplicatePair[]; lifts: string[] }
export interface DuplicateImports { pairs: DuplicatePair[]; days: DuplicateDay[]; identical: number; differing: number }

interface Session { key: string; name: string; source: string; rows: SetEntry[] }
/** One source's sets on one day, a session per lift, in the order the lifts were started. */
function sessions(rows: readonly SetEntry[]): Session[] {
  const by = new Map<string, Session>();
  for (const e of [...rows].sort(byOrderDone)) {
    const k = liftKey(e.exercise);
    let s = by.get(k);
    if (!s) by.set(k, (s = { key: k, name: e.exercise, source: e.source, rows: [] }));
    s.rows.push(e);
  }
  return [...by.values()];
}

const valueKey = (e: SetEntry) => `${e.weight}x${e.reps ?? '-'}${e.cardio ? `|${JSON.stringify(e.cardio)}` : ''}`;
const sequence = (s: Session) => s.rows.map(valueKey).join(' ');
/** The catalog lift a name is, by its own name or another it goes by; null for a name the catalog doesn't list. */
const catalogLift = (name: string) => { const r = resolveLift(name); return r.how === 'catalog' || r.how === 'alias' ? r.lift ?? null : null; };

/**
 * Which session on one side is which on the other: the same lift by name; else the same catalog lift by another name it goes
 * by; else, for a lift the two imports named differently, the same weight×reps sequence. Each session matches at most once,
 * the earliest in the day first.
 */
export function matchSessions(a: Session[], b: Session[]): [Session, Session][] {
  const out: [Session, Session][] = [];
  const freeA = new Set(a), freeB = new Set(b);
  const pass = (same: (x: Session, y: Session) => boolean) => {
    for (const x of a) {
      if (!freeA.has(x)) continue;
      const y = b.find((y) => freeB.has(y) && same(x, y));
      if (y) { out.push([x, y]); freeA.delete(x); freeB.delete(y); }
    }
  };
  pass((x, y) => x.key === y.key);
  pass((x, y) => { const l = catalogLift(x.name); return l != null && l === catalogLift(y.name); });
  pass((x, y) => sequence(x) === sequence(y));
  return out;
}

/** The sets of two matched sessions that are one set: the longest run in order with equal weight and reps, one to one. */
function pairRows(x: SetEntry[], y: SetEntry[]): [SetEntry, SetEntry][] {
  const n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i][j] = valueKey(x[i]) === valueKey(y[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: [SetEntry, SetEntry][] = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (valueKey(x[i]) === valueKey(y[j])) { out.push([x[i], y[j]]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return out;
}

/** How much a copy says beyond weight×reps: its flags (warm-up, unsure, 2×pulley…), note, RIR, pain and tags. */
const detail = (e: SetEntry) => e.flags.length + (e.note?.trim() ? 1 : 0) + (e.rir != null ? 1 : 0) + (e.painRegion ? 1 : 0) + (e.painSeverity ? 1 : 0) + (e.tags?.length ?? 0);

/**
 * Of two copies of one set, the one to keep (negative: `a`): one changed by hand since, then the one with more detail, then
 * the paste (read line by line before it was added), then the import that holds more of that day, then by source name.
 * Undo's `restoredAt` doesn't count: a copy put back after a removal is no more deliberate than its twin.
 */
function keepFirst(a: SetEntry, b: SetEntry, daySize: (source: string) => number): number {
  return (b.editedAt ?? 0) - (a.editedAt ?? 0) || detail(b) - detail(a)
    || Number(b.source === PASTE_SOURCE) - Number(a.source === PASTE_SOURCE)
    || daySize(b.source) - daySize(a.source) || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
}

/** Sets that two different imports both brought in, paired one to one, with the copy to keep picked for each pair. */
export function findDuplicateImports(entries: readonly SetEntry[]): DuplicateImports {
  const byDate = new Map<string, Map<string, SetEntry[]>>();
  for (const e of entries) {
    if (!isImported(e)) continue;
    let d = byDate.get(e.date);
    if (!d) byDate.set(e.date, (d = new Map()));
    const xs = d.get(e.source);
    if (xs) xs.push(e); else d.set(e.source, [e]);
  }
  const pairs: DuplicatePair[] = [], days: DuplicateDay[] = [];
  for (const [date, bySource] of [...byDate].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (bySource.size < 2) continue;
    const sources = [...bySource.keys()].sort();
    const size = (s: string) => bySource.get(s)?.length ?? 0;
    const removed = new Set<string>(), keeper = new Map<string, SetEntry>();
    const dayPairs: DuplicatePair[] = [];
    for (let i = 0; i < sources.length; i++) for (let j = i + 1; j < sources.length; j++) {
      const live = (s: string) => sessions(bySource.get(s)!.filter((e) => !removed.has(e.id)));
      for (const [x, y] of matchSessions(live(sources[i]), live(sources[j]))) {
        for (const [p, q] of pairRows(x.rows, y.rows)) {
          const [keep, remove] = keepFirst(p, q, size) <= 0 ? [p, q] : [q, p];
          removed.add(remove.id);
          keeper.set(remove.id, keep);
          dayPairs.push({ keep, remove, differs: [] });
        }
      }
    }
    if (!dayPairs.length) continue;
    // With three imports of one day, a copy kept against one may lose to the third: each pair then keeps that one.
    for (const p of dayPairs) {
      while (removed.has(p.keep.id)) p.keep = keeper.get(p.keep.id)!;
      p.differs = differences(p.keep, p.remove);
    }
    dayPairs.sort((a, b) => byOrderDone(a.keep, b.keep));
    pairs.push(...dayPairs);
    days.push({ date, pairs: dayPairs, lifts: [...new Set(dayPairs.map((p) => p.keep.exercise))] });
  }
  const identical = pairs.filter((p) => !p.differs.length).length;
  return { pairs, days, identical, differing: pairs.length - identical };
}

/** Incoming sets held back from an import: a day and lift the log already has from another source. */
export interface OverlapGroup { date: string; exercise: string; source: string; sets: number; existing: string; existingSource: string }

/**
 * The paste screen's "already in your log" check, for every import: incoming sets on a day and lift the log already has from
 * a different source are held back. The same lift by name or catalog name, or, named differently, the same weight×reps
 * sequence. More sets from the same source (a later export of the same log) are not held back.
 */
export function importOverlap(existing: readonly SetEntry[], incoming: readonly SetEntry[]): { held: SetEntry[]; groups: OverlapGroup[] } {
  const have = new Map<string, SetEntry[]>();
  for (const e of existing) { const xs = have.get(e.date); if (xs) xs.push(e); else have.set(e.date, [e]); }
  const groups = new Map<string, SetEntry[]>();
  for (const e of incoming) {
    if (!have.has(e.date)) continue;
    const k = `${e.date}\u0000${e.source}`;
    const xs = groups.get(k);
    if (xs) xs.push(e); else groups.set(k, [e]);
  }
  const held: SetEntry[] = [], out: OverlapGroup[] = [];
  for (const rows of groups.values()) {
    const { date, source } = rows[0];
    const others = have.get(date)!.filter((e) => e.source !== source);
    if (!others.length) continue;
    // Each other source's sessions apart, so one lift logged under two sources is two sessions to match against.
    const bySource = new Map<string, SetEntry[]>();
    for (const e of others) { const xs = bySource.get(e.source); if (xs) xs.push(e); else bySource.set(e.source, [e]); }
    const theirs = [...bySource.values()].flatMap(sessions);
    for (const [mine, them] of matchSessions(sessions(rows), theirs)) {
      held.push(...mine.rows);
      out.push({ date, exercise: mine.name, source, sets: mine.rows.length, existing: them.name, existingSource: them.source });
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { held, groups: out };
}
