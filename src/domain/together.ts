import { addDays, weekStart } from './analytics';
import { isCardioEntry } from './cardio';
import type { SetEntry } from './types';

// Together (achievements plan §10, owner 2026-10-22: yes to all ten). Six families about you and your friends, worked out on
// your phone from raw sets: yours (only you write them) and each friend's Crew window (only they write theirs), never from
// anything a phone claims to have earned. Each phone does the same sums, so both of a pair reach the same count.
//
// - A session day is a day with a working set or cardio. Goal weeks count days with a working lift set, as Stats does.
// - Counting starts at the later of the two starts (each profile's achievements start, domain/achievements `since`), so
//   everyone starts at 0, and a pair counts from the same day on both phones. Days from before you were friends in the app
//   count (they're in the window), provided both had started.
// - Together: the same day, and visits (first to last set) that share 20 minutes or more, whatever gym each names: time
//   decides it, not the gym (owner 2026-10-29). A gym of the same name (trimmed, spaces collapsed, case folded) on both only
//   loosens it: each visit padded 10 minutes either side, as before. Only sets logged as they were done count for it: a set
//   entered late, or with its time edited (`enteredAt`), never does. Sets an hour or more apart are two visits.
// - Windows reach 8 weeks back, but nothing earned is taken away: what a window shows is kept in a ledger (the one stored
//   thing, users/{uid}/private/together, only yours to read), a union, so two phones merge it without conflict. A friend
//   removed or blocked keeps what you earned together ("a former friend"); nothing new comes from them.
// - Weeks older than the window: their Compare summary's 52-week goal string (only its shape is checked by the rules, which
//   is why it's only used where their sets can't be read). Only weeks wholly after the pair's start.
// - Every family needs your own session that day or week, read from your log as it is now: delete yours and it goes.
// - Never in your Compare summary or the feed: a Together unlock names the other person, so only the two of you see it.

/** Overlap needed, in minutes. */
export const OVERLAP_MIN = 20;
/** Each visit's span reaches this far either side of its first and last set, in minutes. */
export const PAD_MIN = 10;
/** Sets this far apart or more are two visits (a morning and an evening at the same gym), in minutes. */
export const VISIT_GAP_MIN = 60;
const MIN = 60_000;

/** A friend, as your phone has them: their window of sets, their goal and start, and their summary's goal weeks. */
export interface FriendSide {
  uid: string;
  /** Their achievements' start day (their synced `achievements` item). None: not started, so nothing with them counts yet. */
  start?: string | null;
  /** Their sessions-a-week goal. */
  goal: number;
  /** Their sets from `from` on (the Crew window). */
  sets: readonly SetEntry[];
  /** The window's first day: a day before it isn't a rest day, it's unknown. */
  from: string;
  /** Their Compare summary's last 52 weeks ('1': met their own goal), and the day it was worked out (their today). */
  met?: { day: string; met: string } | null;
}

/** You and one friend: days you both trained, days you trained together, and weeks you both met your goals (Monday → day). */
export interface Pair { day: ReadonlySet<string>; tog: ReadonlySet<string>; week: ReadonlyMap<string, string> }
/** Per friend uid. */
export type Ledger = Readonly<Record<string, Pair>>;
export const NO_LEDGER: Ledger = Object.freeze({});
export interface TogetherCtx { friends: readonly FriendSide[]; ledger: Ledger }

const isDay = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const later = (a: string, b: string) => (a > b ? a : b);
/** A day with a working set or cardio: what makes it a session day. */
const trained = (e: SetEntry) => isCardioEntry(e) || !e.flags.includes('warmup');
/** A day with a working lift set: what a goal week counts (domain/analytics weeklySummary). */
const lifted = (e: SetEntry) => !isCardioEntry(e) && !e.flags.includes('warmup');
/** Logged in the app as it was done: a time, not entered late or with its time changed since, and not imported. */
const live = (e: SetEntry) => e.source === 'app' && !!e.loggedAt && !e.enteredAt && Number.isFinite(Date.parse(e.loggedAt));
/** A gym's name as two phones compare it. Empty: no gym. */
export const gymKey = (g: string | undefined): string => (g ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

function byDate(sets: readonly SetEntry[], from: string, to: string): Map<string, SetEntry[]> {
  const out = new Map<string, SetEntry[]>();
  for (const e of sets) if (e.date >= from && e.date <= to) (out.get(e.date) ?? out.set(e.date, []).get(e.date)!).push(e);
  return out;
}

/** A visit: its first and last live set (ms), and the gyms its sets name (gymKey → the name as first written). */
interface Visit { s: number; e: number; gyms: Map<string, string> }
/** A day's visits, whatever gym each set names (or none): first to last live set, split where sets are VISIT_GAP_MIN apart. */
function visits(day: readonly SetEntry[]): Visit[] {
  const sets = day.filter((e) => trained(e) && live(e)).map((e) => ({ t: Date.parse(e.loggedAt!), e })).sort((a, b) => a.t - b.t);
  const out: Visit[] = [];
  let v: Visit | null = null;
  for (const { t, e } of sets) {
    if (!v || t - v.e >= VISIT_GAP_MIN * MIN) out.push(v = { s: t, e: t, gyms: new Map() });
    v.e = t;
    const k = gymKey(e.gym);
    if (k && !v.gyms.has(k)) v.gyms.set(k, e.gym!.trim());
  }
  return out;
}

/**
 * Two people's sets on one day together: the gym (as yours names it, when yours names one) and when both were there (ms);
 * null if they weren't. Time decides it, never the gym (owner 2026-10-29: two people at one gym may each have made their own):
 * - any gym, or none: their visits (first to last set) share OVERLAP_MIN minutes or more, i.e. both logging sets through the
 *   same 20 minutes (about five sets each at the usual 2–4 minutes a set);
 * - a gym of the same name on both: the looser rule from before, each visit padded PAD_MIN either side, so a short visit or a
 *   friend arriving as you finish still counts. The name is an extra signal, not a requirement.
 */
export interface Met { gym?: string; from: number; to: number }
export function togetherOn(mine: readonly SetEntry[], theirs: readonly SetEntry[]): Met | null {
  const a = visits(mine), b = visits(theirs), pad = PAD_MIN * MIN;
  let best: Met | null = null, most = 0;
  for (const v of a) for (const w of b) {
    const shared = [...v.gyms.keys()].find((k) => w.gyms.has(k));
    let from: number, to: number;
    if (shared) {
      const pf = Math.max(v.s, w.s) - pad, pt = Math.min(v.e, w.e) + pad;
      if (pt - pf < OVERLAP_MIN * MIN) continue;
      from = Math.max(pf, Math.min(v.s, w.s)); to = Math.min(pt, Math.max(v.e, w.e));
    } else {
      from = Math.max(v.s, w.s); to = Math.min(v.e, w.e);
      if (to - from < OVERLAP_MIN * MIN) continue;
    }
    if (best && to - from <= most) continue;
    most = to - from;
    const name = shared ? v.gyms.get(shared) : v.gyms.values().next().value;
    best = { ...(name && { gym: name }), from, to };
  }
  return best;
}

/** The day a pair starts counting: the later of the two starts; null when either hasn't started. */
export const pairStart = (since: string | null | undefined, theirs: string | null | undefined): string | null =>
  isDay(since) && isDay(theirs) ? later(since, theirs) : null;

/** Days in a week (Monday `w`) from `lo` up to `hi`, with a set `pick` takes, oldest first. */
function weekDays(by: Map<string, SetEntry[]>, w: string, lo: string, hi: string, pick: (e: SetEntry) => boolean): string[] {
  const out: string[] = [];
  for (let k = 0; k < 7; k++) {
    const d = addDays(w, k);
    if (d < lo || d > hi) continue;
    if (by.get(d)?.some(pick)) out.push(d);
  }
  return out;
}

/** Their summary said they met their goal in week `w` (52 weeks ending at their summary day's week). */
function summaryMet(met: FriendSide['met'], w: string): boolean {
  if (!met || !isDay(met.day) || typeof met.met !== 'string' || !/^[01]{52}$/.test(met.met)) return false;
  const back = Math.round((Date.parse(`${weekStart(met.day)}T12:00:00Z`) - Date.parse(`${w}T12:00:00Z`)) / (7 * 864e5));
  return back >= 0 && back < 52 && met.met[51 - back] === '1';
}

/** What the windows show now, per friend: the ledger's bits as they'd be read from today's sets. `gyms`: each together day's gym. */
export interface Seen { pairs: Record<string, Pair>; gyms: Record<string, Map<string, Met>> }
export function windowPairs(mine: readonly SetEntry[], since: string, goal: number, friends: readonly FriendSide[], today: string): Seen {
  const pairs: Record<string, Pair> = {}, gyms: Record<string, Map<string, Met>> = {};
  const my = byDate(mine, since, today);
  for (const f of friends) {
    const s = pairStart(since, f.start);
    if (!s || !isDay(f.from)) continue;
    const lo = later(s, f.from);
    const theirs = byDate(f.sets, lo, today);
    const day = new Set<string>(), tog = new Set<string>(), week = new Map<string, string>(), at = new Map<string, Met>();
    for (const [d, ts] of theirs) {
      const ms = my.get(d);
      if (!ms?.some(trained) || !ts.some(trained)) continue;
      day.add(d);
      const m = togetherOn(ms, ts);
      if (m) { tog.add(d); at.set(d, m); }
    }
    // Weeks, from the pair's start: their sets where the window holds every day counted, their summary where it doesn't.
    const theirGoal = Math.min(7, Math.max(1, Math.round(f.goal) || 2)), myGoal = Math.min(7, Math.max(1, Math.round(goal) || 2));
    const summaryFrom = weekStart(s) === s ? s : addDays(weekStart(s), 7); // only weeks wholly after the start
    for (let w = weekStart(f.met && summaryFrom < weekStart(lo) ? summaryFrom : lo); w <= today; w = addDays(w, 7)) {
      const first = later(w, s), last = addDays(w, 6) < today ? addDays(w, 6) : today;
      const mineIn = weekDays(my, w, first, last, lifted);
      if (mineIn.length < myGoal) continue;
      const theirsIn = weekDays(theirs, w, later(first, f.from), last, lifted);
      if (theirsIn.length >= theirGoal) week.set(w, later(mineIn[myGoal - 1], theirsIn[theirGoal - 1]));
      else if (f.from > first && w >= summaryFrom && summaryMet(f.met, w)) week.set(w, last);
    }
    if (day.size || week.size) { pairs[f.uid] = { day, tog, week }; gyms[f.uid] = at; }
  }
  return { pairs, gyms };
}

// ---- The ledger: union only ----

const union = <T,>(a: ReadonlySet<T>, b: ReadonlySet<T>): Set<T> => new Set([...a, ...b]);
/** Two ledgers as one: every day either has; a week either has, reached on the earlier of the two days. */
export function mergeLedgers(a: Ledger, b: Ledger): Ledger {
  const out: Record<string, Pair> = { ...a };
  for (const [uid, p] of Object.entries(b)) {
    const q = out[uid];
    if (!q) { out[uid] = p; continue; }
    const week = new Map(q.week);
    for (const [w, d] of p.week) { const had = week.get(w); if (!had || d < had) week.set(w, d); }
    out[uid] = { day: union(q.day, p.day), tog: union(q.tog, p.tog), week };
  }
  return out;
}
/** Whether `more` holds anything `base` hasn't: a day, a together day, a week, or a week reached earlier. */
export function hasNew(base: Ledger, more: Ledger): boolean {
  for (const [uid, p] of Object.entries(more)) {
    const q = base[uid];
    if (!q) { if (p.day.size || p.tog.size || p.week.size) return true; continue; }
    for (const d of p.day) if (!q.day.has(d)) return true;
    for (const d of p.tog) if (!q.tog.has(d)) return true;
    for (const [w, d] of p.week) { const had = q.week.get(w); if (!had || d < had) return true; }
  }
  return false;
}

// Stored: per friend, an origin (a Monday, as a day number), each kind of day as bits from it in base64, and the weeks as a
// character each from it ('0' none, '1'–'7' the weekday it was reached on). About 100 bytes a friend a year.
export interface StoredPair { o: number; d?: string; t?: string; w?: string }
export interface StoredLedger { v: 1; f: Record<string, StoredPair> }
const DAY_MS = 864e5;
const dayNo = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS);
const noDay = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_CHARS = 4096;

function toBits(days: Iterable<string>, o: number): string | undefined {
  const bytes: number[] = [];
  for (const d of days) { const i = dayNo(d) - o; if (i < 0) continue; while (bytes.length <= i >> 3) bytes.push(0); bytes[i >> 3] |= 1 << (i & 7); }
  return bytes.length ? btoa(String.fromCharCode(...bytes)) : undefined;
}
function fromBits(b: unknown, o: number): Set<string> | null {
  if (b === undefined) return new Set();
  if (typeof b !== 'string' || b.length > MAX_CHARS || !B64.test(b)) return null;
  let raw: string;
  try { raw = atob(b); } catch { return null; }
  const out = new Set<string>();
  for (let i = 0; i < raw.length; i++) { const x = raw.charCodeAt(i); for (let k = 0; k < 8; k++) if (x & (1 << k)) out.add(noDay(o + i * 8 + k)); }
  return out;
}

export function encodeLedger(l: Ledger): StoredLedger {
  const f: Record<string, StoredPair> = {};
  for (const [uid, p] of Object.entries(l)) {
    const all = [...p.day, ...p.tog, ...p.week.keys()].sort();
    if (!all.length) continue;
    const o = dayNo(weekStart(all[0]));
    let w = '';
    for (const [mon, d] of [...p.week].sort(([a], [b]) => a.localeCompare(b))) {
      const i = (dayNo(mon) - o) / 7;
      if (!Number.isInteger(i) || i < w.length) continue; // not a Monday: never made here
      w = w.padEnd(i, '0') + String(1 + Math.min(6, Math.max(0, dayNo(d) - dayNo(mon))));
    }
    const d = toBits(p.day, o), t = toBits(p.tog, o);
    f[uid] = { o, ...(d && { d }), ...(t && { t }), ...(w && { w }) };
  }
  return { v: 1, f };
}

/** A stored ledger read back, as untrusted: a friend's entry not in shape is left out, the rest kept. */
export function decodeLedger(x: unknown): Ledger {
  const f = (x as { f?: unknown } | null | undefined)?.f;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return NO_LEDGER;
  const out: Record<string, Pair> = {};
  for (const [uid, raw] of Object.entries(f as Record<string, unknown>)) {
    const p = raw as StoredPair | null;
    if (!uid || uid.length > 128 || !p || typeof p !== 'object' || !Number.isInteger(p.o) || p.o < 0 || p.o > 200_000) continue;
    const mon = noDay(p.o);
    if (weekStart(mon) !== mon) continue;
    const day = fromBits(p.d, p.o), tog = fromBits(p.t, p.o);
    if (!day || !tog || (p.w !== undefined && (typeof p.w !== 'string' || p.w.length > MAX_CHARS || !/^[0-7]*$/.test(p.w)))) continue;
    const week = new Map<string, string>();
    [...(p.w ?? '')].forEach((c, i) => { if (c !== '0') { const w = noDay(p.o + 7 * i); week.set(w, addDays(w, Number(c) - 1)); } });
    out[uid] = { day, tog, week };
  }
  return out;
}

// ---- What counts: the ledger and what the windows show, against your log as it is ----

/**
 * Per friend, what counts now: the ledger with today's windows added, each day one you still trained on (and each week one you
 * still met your goal in), from your start and, for a friend still here, theirs. `gyms`: together days the windows show.
 */
export function effective(mine: readonly SetEntry[], since: string, goal: number, t: TogetherCtx, today: string): Seen {
  const seen = windowPairs(mine, since, goal, t.friends, today);
  const all = mergeLedgers(t.ledger, seen.pairs);
  const my = byDate(mine, since, today);
  const myGoal = Math.min(7, Math.max(1, Math.round(goal) || 2));
  const metWeek = new Map<string, boolean>();
  const met = (w: string) => {
    let v = metWeek.get(w);
    if (v === undefined) metWeek.set(w, v = weekDays(my, w, later(w, since), today, lifted).length >= myGoal);
    return v;
  };
  const startOf = new Map(t.friends.map((f) => [f.uid, pairStart(since, f.start)]));
  const pairs: Record<string, Pair> = {};
  for (const [uid, p] of Object.entries(all)) {
    const s = startOf.get(uid) ?? since; // a former friend: from your own start
    const ok = (d: string) => d >= s && d <= today && !!my.get(d)?.some(trained);
    const day = new Set([...p.day].filter(ok)), tog = new Set([...p.tog].filter(ok));
    const week = new Map([...p.week].filter(([w, d]) => addDays(w, 6) >= s && d <= today && met(w)));
    if (day.size || tog.size || week.size) pairs[uid] = { day, tog, week };
  }
  return { pairs, gyms: seen.gyms };
}

/** One step toward a family's next level: the day, the value then, and who it was with. */
export interface TogetherStep { date: string; value: number; with: string[]; gym?: string }
export const TOGETHER_IDS = ['trained-together', 'gym-crew', 'same-week', 'crew-streak', 'crew-day', 'full-house'] as const;
export type TogetherId = (typeof TOGETHER_IDS)[number];

/** Each day (or week) and the friends it was with, oldest first. */
function by<K extends 'day' | 'tog'>(pairs: Record<string, Pair>, k: K): [string, string[]][] {
  const m = new Map<string, string[]>();
  for (const [uid, p] of Object.entries(pairs)) for (const d of p[k]) (m.get(d) ?? m.set(d, []).get(d)!).push(uid);
  return [...m].map(([d, us]) => [d, us.sort()] as [string, string[]]).sort(([a], [b]) => a.localeCompare(b));
}
/** Each week: its Monday, and each friend with the day you both had it, earliest first. */
function weeksOf(pairs: Record<string, Pair>): [string, [string, string][]][] {
  const m = new Map<string, [string, string][]>();
  for (const [uid, p] of Object.entries(pairs)) for (const [w, d] of p.week) (m.get(w) ?? m.set(w, []).get(w)!).push([d, uid]);
  return [...m].map(([w, xs]) => [w, xs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))] as [string, [string, string][]])
    .sort(([a], [b]) => a.localeCompare(b));
}
const counted = (xs: [string, string[]][], min: number, gym?: (d: string, us: string[]) => string | undefined): TogetherStep[] =>
  xs.filter(([, us]) => us.length >= min).map(([date, us], i) => {
    const g = gym?.(date, us);
    return { date, value: i + 1, with: us, ...(g && { gym: g }) };
  });

/** Every Together family's steps, from what counts (effective). */
export function togetherSteps(seen: Seen): Record<TogetherId, TogetherStep[]> {
  const { pairs, gyms } = seen;
  const tog = by(pairs, 'tog');
  const weeks = weeksOf(pairs);
  const sameWeek = weeks.map(([, xs], i) => ({ date: xs[0][0], value: i + 1, with: xs.map((x) => x[1]).sort() }));
  const streak: TogetherStep[] = [];
  let run = 0, best = 0, prev = '';
  for (const [w, xs] of weeks) {
    run = prev && addDays(prev, 7) === w ? run + 1 : 1;
    prev = w;
    if (run > best) { best = run; streak.push({ date: xs[0][0], value: best, with: xs.map((x) => x[1]).sort() }); }
  }
  // Full house: in each week you met yours, each friend at theirs as they got there (the k-th is k friends).
  const house = weeks.flatMap(([, xs]) => xs.map(([d], k) => ({ date: d, value: k + 1, with: xs.slice(0, k + 1).map((x) => x[1]).sort() })));
  return {
    'trained-together': counted(tog, 1, (d, us) => us.map((u) => gyms[u]?.get(d)?.gym).find(Boolean)),
    'gym-crew': counted(tog, 2, (d, us) => us.map((u) => gyms[u]?.get(d)?.gym).find(Boolean)),
    'same-week': sameWeek,
    'crew-streak': streak,
    'crew-day': counted(by(pairs, 'day'), 2),
    'full-house': house,
  };
}

// ---- For the screens ----

/** Each friend in a family's "With" list (only you see it): how many, the last day, and its gym when the window still shows it. */
export interface WithRow { uid: string; n: number; last: string; gym?: string }
export function withList(seen: Seen, id: TogetherId): WithRow[] {
  const rows: WithRow[] = [];
  for (const [uid, p] of Object.entries(seen.pairs)) {
    const ds = id === 'trained-together' ? [...p.tog]
      : id === 'gym-crew' ? [...p.tog].filter((d) => Object.values(seen.pairs).filter((q) => q.tog.has(d)).length >= 2)
      : id === 'crew-day' ? [...p.day].filter((d) => Object.values(seen.pairs).filter((q) => q.day.has(d)).length >= 2)
      : [...p.week.values()];
    if (!ds.length) continue;
    const last = ds.sort().at(-1)!, g = id === 'trained-together' || id === 'gym-crew' ? seen.gyms[uid]?.get(last)?.gym : undefined;
    rows.push({ uid, n: ds.length, last, ...(g && { gym: g }) });
  }
  return rows.sort((a, b) => b.n - a.n || b.last.localeCompare(a.last) || a.uid.localeCompare(b.uid));
}

/** This week, against each one's own goal: you, and each friend who has started (Full house's rings). Counted as the weeks are. */
export interface Ring { uid: string | null; sessions: number; goal: number; met: boolean }
export function weekRings(mine: readonly SetEntry[], since: string, goal: number, friends: readonly FriendSide[], today: string): Ring[] {
  const w = weekStart(today);
  const myGoal = Math.min(7, Math.max(1, Math.round(goal) || 2));
  const mineIn = weekDays(byDate(mine, since, today), w, later(w, since), today, lifted).length;
  const out: Ring[] = [{ uid: null, sessions: mineIn, goal: myGoal, met: mineIn >= myGoal }];
  for (const f of friends) {
    const s = pairStart(since, f.start);
    if (!s) continue;
    const g = Math.min(7, Math.max(1, Math.round(f.goal) || 2));
    const n = weekDays(byDate(f.sets, later(s, f.from), today), w, later(later(w, s), f.from), today, lifted).length;
    out.push({ uid: f.uid, sessions: n, goal: g, met: n >= g });
  }
  return out;
}

/** A friend's card in your feed: you and they trained together that day (Trained together's rule), and where and when. */
export function togetherDay(mine: readonly SetEntry[], since: string | null, f: FriendSide, date: string): Met | null {
  const s = pairStart(since, f.start);
  if (!s || date < s || date < f.from) return null;
  return togetherOn(mine.filter((e) => e.date === date), f.sets.filter((e) => e.date === date));
}
