import { isHoldLift } from './care';
import { fmtClock } from './cardio';
import { fmtWeight } from './format';
import { normalizeName } from './ids';
import { byOrderDone, e1rm, sameExercise } from './stats';
import type { SetEntry } from './types';

// Records and PRs: one pass over a lift's log, oldest set first. A record is the best value of its kind so far; a PR is
// a set that beat a record that already stood (a lift's first set beats nothing). Nothing is stored, so an edit, a
// delete, a rename or a sync changes the records with the log. The History badge, the banner on saving a set, the day
// summary and the weekly recap all read prKinds; the Records section reads the same pass's holders.

/** "At least N reps": a 10-rep set stands as the 8-rep max too. */
export const REP_MAXES = [1, 3, 5, 8, 10, 12] as const;
export type RepMax = (typeof REP_MAXES)[number];
export type RecordKind =
  | 'e1rm' | 'heaviest' | `rm${RepMax}` | 'reps' | 'setVolume' | 'sessionVolume' // weighted sets
  | 'mostReps' | 'sessionReps' // bodyweight
  | 'hold' // timed holds, in seconds
  | 'time' | 'distance' | 'floors' | 'pace'; // cardio

/** Who holds a record: the set (null for a whole session, with its count of sets) and its day. `reps` is never held: it's
 * "more reps than any set at this weight or heavier", which the rep maxes show. */
export interface Held { kind: RecordKind; value: number; date: string; set: SetEntry | null; sets?: number }

const key = (s: string) => normalizeName(s).toLowerCase();
const chrono = (a: SetEntry, b: SetEntry) => (a.date < b.date ? -1 : a.date > b.date ? 1 : byOrderDone(a, b));
// Pace is time per mile: lower is better. A tie never beats a record, so the earliest set keeps it.
const beats = (kind: RecordKind, v: number, than: number) => (kind === 'pace' ? v < than : v > than);
/** Reps counted: a partial set (no rep count, or flagged partial) and a set of 0 reps aren't. */
const full = (s: SetEntry) => s.reps != null && s.reps >= 1 && !s.flags.includes('partial');

/** `tally`: for a set that broke a session record, the day's total at that set. */
interface Scan { broke: Map<string, RecordKind[]>; held: Map<RecordKind, Held>; tally: Map<string, number> }

/** One lift's sets, in any order. */
function scan(lift: SetEntry[]): Scan {
  const broke = new Map<string, RecordKind[]>();
  const held = new Map<RecordKind, Held>();
  const tally = new Map<string, number>();
  if (!lift.length) return { broke, held, tally };
  const hold = isHoldLift(lift[0].exercise, lift);
  const offer = (out: RecordKind[], kind: RecordKind, value: number, s: SetEntry) => {
    const h = held.get(kind);
    if (h && !beats(kind, value, h.value)) return;
    if (h) out.push(kind);
    held.set(kind, { kind, value, date: s.date, set: s });
  };
  // A day's running total breaks the record once, on the set that takes it past every earlier day's best.
  const day = { sessionVolume: { date: '', total: 0, sets: 0, broke: false }, sessionReps: { date: '', total: 0, sets: 0, broke: false } };
  const close = (kind: keyof typeof day) => {
    const d = day[kind], h = held.get(kind);
    if (d.sets && (!h || d.total > h.value)) held.set(kind, { kind, value: d.total, date: d.date, set: null, sets: d.sets });
  };
  const add = (out: RecordKind[], kind: keyof typeof day, value: number, s: SetEntry) => {
    if (day[kind].date !== s.date) { close(kind); day[kind] = { date: s.date, total: 0, sets: 0, broke: false }; }
    const d = day[kind], h = held.get(kind);
    d.total += value; d.sets++;
    if (h && !d.broke && d.total > h.value) { out.push(kind); d.broke = true; tally.set(s.id, d.total); }
  };
  // The sets no earlier set was both as heavy as and did as many reps as: what "more reps at a weight" has to beat.
  let front: { w: number; r: number }[] = [];

  for (const s of [...lift].sort(chrono)) {
    if (s.flags.includes('warmup')) continue;
    const out: RecordKind[] = [];
    if (s.cardio) {
      const { seconds, miles, floors } = s.cardio;
      if (seconds > 0) offer(out, 'time', seconds, s);
      if (miles != null && miles > 0) offer(out, 'distance', miles, s);
      if (floors != null && floors > 0) offer(out, 'floors', floors, s);
      if (miles != null && miles > 0 && seconds > 0) offer(out, 'pace', seconds / miles, s);
    } else if (hold) {
      // A hold counts its seconds, weighted or not; its weight sets no weight record.
      if (s.reps != null && s.reps > 0) offer(out, 'hold', s.reps, s);
    } else if (s.weight <= 0 || s.flags.includes('bodyweight')) {
      if (full(s)) { offer(out, 'mostReps', s.reps!, s); add(out, 'sessionReps', s.reps!, s); }
    } else if (!full(s)) {
      // A partial set was lifted, so it counts for heaviest weight; without its reps it counts for nothing else.
      if (s.reps == null || s.flags.includes('partial')) offer(out, 'heaviest', s.weight, s);
    } else {
      const w = s.weight, r = s.reps!;
      const v = e1rm(s);
      if (v != null) offer(out, 'e1rm', v, s);
      offer(out, 'heaviest', w, s);
      for (const n of REP_MAXES) if (r >= n) offer(out, `rm${n}`, w, s);
      if (front.some((p) => p.w >= w) && !front.some((p) => p.w >= w && p.r >= r)) out.push('reps');
      front = [...front.filter((p) => p.w > w || p.r > r), { w, r }];
      offer(out, 'setVolume', w * r, s);
      add(out, 'sessionVolume', w * r, s);
    }
    if (out.length) broke.set(s.id, out);
  }
  close('sessionVolume'); close('sessionReps');
  return { broke, held, tally };
}

function byLift(entries: SetEntry[]): SetEntry[][] {
  const out = new Map<string, SetEntry[]>();
  for (const e of entries) {
    const k = key(e.exercise);
    const list = out.get(k);
    if (list) list.push(e); else out.set(k, [e]);
  }
  return [...out.values()];
}

/** Every set that broke a record when it was done, with the records it broke. */
export function prKinds(entries: SetEntry[]): Map<string, RecordKind[]> {
  const out = new Map<string, RecordKind[]>();
  for (const lift of byLift(entries)) for (const [id, kinds] of scan(lift).broke) out.set(id, kinds);
  return out;
}

/** The PR sets: History's badge, and what the recap counts. */
export const prIds = (entries: SetEntry[]): Set<string> => new Set(prKinds(entries).keys());

/** What a lift holds now, by kind. */
export const records = (entries: SetEntry[], exercise: string): Map<RecordKind, Held> =>
  scan(entries.filter((e) => sameExercise(e.exercise, exercise))).held;

const trim = (n: number) => String(Math.round(n * 100) / 100);
const lb = (n: number) => `${fmtWeight(n)} lb`;

/** A record's name and its value as shown. */
export function recordLabel(kind: RecordKind): string {
  switch (kind) {
    case 'e1rm': return 'Best e1RM';
    case 'heaviest': return 'Heaviest';
    case 'reps': return 'Most reps';
    case 'setVolume': return 'Best set volume';
    case 'sessionVolume': return 'Best session volume';
    case 'mostReps': return 'Most reps';
    case 'sessionReps': return 'Most reps in a session';
    case 'hold': return 'Longest hold';
    case 'time': return 'Longest';
    case 'distance': return 'Farthest';
    case 'floors': return 'Most floors';
    case 'pace': return 'Best pace';
    default: return `${kind.slice(2)}-rep max`;
  }
}
export function fmtRecord(kind: RecordKind, v: number): string {
  switch (kind) {
    case 'e1rm': return `${Math.round(v)} lb`;
    case 'setVolume': case 'sessionVolume': return `${Math.round(v).toLocaleString('en-US')} lb`;
    case 'mostReps': case 'sessionReps': case 'reps': case 'floors': return String(v);
    case 'hold': return `${v} s`;
    case 'time': return fmtClock(v);
    case 'distance': return `${trim(v)} mi`;
    case 'pace': return `${fmtClock(v)} /mi`;
    default: return lb(v);
  }
}

// The banner names one record: the first of these the set broke. A set that beats a lower rep max beats the higher
// ones it qualifies for too, so the lowest is the bigger news.
const RANK: RecordKind[] = ['e1rm', 'heaviest', ...REP_MAXES.map((n) => `rm${n}` as RecordKind), 'reps', 'setVolume', 'sessionVolume',
  'mostReps', 'sessionReps', 'hold', 'distance', 'floors', 'pace', 'time'];

/** The banner for a set just saved ("PR! Best e1RM: 209 lb"), or null. `entries` may or may not include it yet. */
export function prToast(entries: SetEntry[], set: SetEntry): string | null {
  const lift = entries.filter((e) => e.id !== set.id && sameExercise(e.exercise, set.exercise));
  const { broke, tally } = scan([...lift, set]);
  const kind = RANK.find((k) => broke.get(set.id)?.includes(k));
  if (!kind) return null;
  if (kind === 'reps') return `PR! Most reps at ${lb(set.weight)}: ${set.reps}`;
  // A session record's value is the day's total so far; every other one is this set's own.
  const v = kind === 'sessionVolume' || kind === 'sessionReps' ? tally.get(set.id)!
    : kind === 'e1rm' ? e1rm(set)!
    : kind === 'setVolume' ? set.weight * set.reps!
    : kind === 'time' ? set.cardio!.seconds
    : kind === 'distance' ? set.cardio!.miles!
    : kind === 'floors' ? set.cardio!.floors!
    : kind === 'pace' ? set.cardio!.seconds / set.cardio!.miles!
    : kind === 'heaviest' || kind.startsWith('rm') ? set.weight
    : set.reps!;
  return `PR! ${recordLabel(kind)}: ${fmtRecord(kind, v)}`;
}
