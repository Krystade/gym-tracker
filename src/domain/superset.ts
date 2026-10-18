import { normalizeName } from './ids';
import { isWorking, settingsKey } from './progression';
import type { SetEntry } from './types';

/**
 * Lifts done as a superset (three or more: a giant set or circuit), noticed from the log alone: no tap makes one.
 * `lifts`: in round order. A short switch follows each but the last; the full rest follows the last.
 * `live`: still the group for its lifts (false once a lift swapped in has taken over). `after`: each working set done in it,
 * by id, and what followed it: the lift to switch to, or null where the round was done and a full rest was due.
 */
export interface Superset { lifts: string[]; keys: string[]; live: boolean; after: Map<string, string | null> }

/** A switch is under this share of the lift's usual time from one set to the next. */
const SHARE = 0.6;
/** A round's rest over this is a break, not a rest (as for a lift's own sets in timing.ts). */
const MAX_REST = 10 * 60;
/** A switch takes in the next lift's set, so sets seconds apart were entered back to back, not done that way. */
const MIN_GAP = 15;

const secs = (e: SetEntry) => Date.parse(e.loggedAt!) / 1000;
const key = (e: SetEntry) => settingsKey(e.exercise);

interface Cycle { keys: string[]; names: string[]; start: number; end?: number }

/**
 * The lifts from `day[i]` until its lift comes back: all different, at least two, and every gap between them but one at
 * most (the rest after the round) well inside the usual rest. The round starts after that rest: `start`, an index into `day`.
 */
function cycleAt(day: SetEntry[], i: number, usual: (exercise: string) => number): Cycle | null {
  const keys = [key(day[i])];
  let j = i + 1;
  for (; j < day.length && key(day[j]) !== keys[0]; j++) {
    if (keys.includes(key(day[j]))) return null;
    keys.push(key(day[j]));
  }
  if (j >= day.length || keys.length < 2) return null;
  let rest = -1;
  for (let g = 0; g < keys.length; g++) {
    const gap = secs(day[i + g + 1]) - secs(day[i + g]);
    if (gap < MIN_GAP) return null;
    if (gap <= SHARE * usual(day[i + g].exercise)) continue;
    if (rest >= 0 || gap > MAX_REST) return null;
    rest = g;
  }
  const r = (rest + 1) % keys.length;
  const turn = <T,>(xs: T[]) => [...xs.slice(r), ...xs.slice(0, r)];
  return { keys: turn(keys), names: turn(day.slice(i, j).map((e) => normalizeName(e.exercise))), start: i + r };
}

/**
 * What follows each working set of a group, round by round. A round is done once every lift still in it has a set; a lift
 * is out of it once its planned sets are done, or when a round is given up (a lift comes again before the others had a turn).
 */
function rounds(day: SetEntry[], c: Cycle, planned: (exercise: string) => number | null | undefined): Map<string, string | null> {
  const after = new Map<string, string | null>(), count = new Map<string, number>(), dropped = new Set<string>();
  const needed = () => c.keys.filter((k, i) => {
    const p = planned(c.names[i]);
    return !dropped.has(k) && !(p != null && (count.get(k) ?? 0) >= p);
  });
  let cur: string[] = [];
  for (const s of day.slice(c.start, c.end)) {
    const k = key(s);
    if (!c.keys.includes(k)) continue;
    if (cur.includes(k)) { for (const y of needed()) if (!cur.includes(y)) dropped.add(y); cur = []; }
    count.set(k, (count.get(k) ?? 0) + 1);
    dropped.delete(k);
    cur.push(k);
    const missing = needed().filter((y) => !cur.includes(y));
    if (!missing.length) { after.set(s.id, null); cur = []; continue; }
    const at = c.keys.indexOf(k);
    const next = c.keys.map((_, d) => (at + 1 + d) % c.keys.length).find((x) => missing.includes(c.keys[x]))!;
    after.set(s.id, c.names[next]);
  }
  return after;
}

/**
 * The day's supersets: working sets with a time, in the order done, where the lifts go round A→B(→C…)→A with the switches
 * well inside the usual rest (`usual(exercise)`: seconds from one set of it to the next). Warm-ups don't count; moving on to
 * the next lift never comes back round, so it isn't one. Once found, a group stays for the day. `dismissed`: groups (by
 * lift key) marked "Not a superset" that day; a group inside one stays out too. `planned(exercise)`: its sets planned today.
 */
export function supersets(entries: SetEntry[], date: string, usual: (exercise: string) => number,
  { dismissed = [], planned = () => null }: { dismissed?: string[][]; planned?: (exercise: string) => number | null | undefined } = {}): Superset[] {
  const day = entries.filter((e) => e.date === date && e.loggedAt && isWorking(e)).sort((a, b) => secs(a) - secs(b));
  const found: Cycle[] = [];
  for (let i = 0; i < day.length; i++) {
    const c = cycleAt(day, i, usual);
    if (!c) continue;
    const within = (keys: string[]) => c.keys.every((k) => keys.includes(k));
    if (dismissed.some(within)) continue;
    const live = found.filter((f) => f.end == null);
    if (live.some((f) => within(f.keys))) continue; // the same group again, or part of it
    // A lift swapped in partway: the new group takes over from the old.
    for (const f of live) if (f.keys.some((k) => c.keys.includes(k))) f.end = c.start;
    found.push(c);
  }
  return found.map((c) => ({ lifts: c.names, keys: c.keys, live: c.end == null, after: rounds(day, c, planned) }));
}

/** What follows the set `id`: the lift to switch to, null for the full rest after a round, undefined when it's in no superset. */
export const nextAfter = (groups: Superset[], id: string): string | null | undefined => groups.find((g) => g.after.has(id))?.after.get(id);

/** "A", "A and B", "A, B and C". */
export const andList = (xs: string[]) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
