import { MAX_SHARED, type SharedAch } from './achievements';
import { addDays, weeklySummary } from './analytics';
import { isWorking } from './crew';
import { e1rmChange, weekStreak } from './feed';
import { liftKey, normalizeName } from './ids';
import { resolveLift } from './lifts';
import { isBarbellCompound } from './progression';
import { prIds } from './records';
import { e1rm, liftIndex, sessionsFor } from './stats';
import { rangeDays, rangeFrom, rangeWeeks } from './statsLayout';
import type { SetEntry } from './types';

// Compare (round 22, owner answers 2026-10-21): you and every friend side by side, each against their own start and their own
// goal, never load against load. Each phone publishes one small summary of its own log (summarize, below; cloud/summary
// writes it), so the page costs one read a friend and never reads anybody's sets. Only per-range numbers leave the phone: no
// set, no load but a First's milestone, nothing owner-only (energy, cycle, body) and no pain. Its shape is checked by the
// rules (firestore.rules summaryOk) on the way in and again here (parseSummary) on the way out.

export const COMPARE_RANGES = ['4w', '12w', '1y'] as const;
export type CompareRange = (typeof COMPARE_RANGES)[number];
/** Points in each series: the range's first day, today, and 11 between. */
export const POINTS = 13;
export const MAX_LIFTS = 12;
export const MAX_FIRSTS = 8;
export const NAME_MAX = 60;
/** What a First is: a barbell compound's first working set at a plate milestone, or a first bodyweight pull-up, chin-up or dip. */
export const MILESTONES = [135, 225, 315, 405, 495, 585, 675] as const;
const BW_FIRSTS = ['Pull-up', 'Chin-up', 'Forward-Lean Dips', 'Upright Dips'];
/** A first bodyweight lift counts once the log is this old before it (a log imported or started that day isn't a first). */
const BW_HISTORY = 28;
/** Firsts kept: the last year's. */
const FIRSTS_SPAN = 365;
/** A volume series point needs this share of the range behind it (a day or two of sets says nothing about a month). */
const VOL_SETTLE = 1 / 4;
/** Volume needs this many days of the log before the range, to know their usual. */
const VOL_BASE_MIN = 14;

/** One lift: its name as last written, and its e1RM change from their own start, in %, at each point. */
export interface LiftLine { n: string; s: number[] }
export interface RangeSummary {
  /** Each week of the range, oldest first: '1' met their own weekly goal (this week once met). */ met: string;
  /** Working sets a week so far against their usual (the same span before the range), in %; null until a quarter of the range is in; [] no usual yet. */ vol: (number | null)[];
  /** PRs set in the range, so far, at each point. */ prs: number[];
  /** Their most-trained lifts with a change (e1rmChange), at most 12. */ lifts: LiftLine[];
}
/** A First: the lift, the milestone in lb (0: bodyweight) and the day. */
export interface First { n: string; w: number; d: string }
export interface Summary {
  v: 1;
  /** Their today when it was worked out. */ day: string;
  /** Their weekly goal, in sessions. */ goal: number;
  /** Weeks in a row at it. */ streak: number;
  r: Record<CompareRange, RangeSummary>;
  /** Newest first. */ firsts: First[];
  /**
   * Their achievements, the groups they show (domain/achievements shareOf), newest first, at most 32. None: an app from before
   * them, or one that hasn't read its start day yet.
   */
  ach?: SharedAch[];
}
/** A summary as read: when it was written (ms; 0 unknown). */
export interface ReadSummary extends Summary { at: number }

const round1 = (x: number) => Math.round(x * 10) / 10;
const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);
const daysBetween = (a: string, b: string) => Math.round((dayMs(b) - dayMs(a)) / 864e5);
/** A name cut to what the summary holds (by code point, so no character is split). */
const clip = (s: string) => Array.from(normalizeName(s)).slice(0, NAME_MAX).join('');

/** The 13 days a range's series are read at: its first day, today, and 11 evenly between. */
export function samples(range: CompareRange, today: string): string[] {
  const from = rangeFrom(range, today), n = rangeDays(range);
  return Array.from({ length: POINTS }, (_, k) => addDays(from, Math.round((k * (n - 1)) / (POINTS - 1))));
}

/**
 * One lift's e1RM change at each point, as e1rmChange(from, point) says it (0 until it can: two sessions two weeks apart), in
 * one pass over its sessions rather than 13.
 */
function liftLine(entries: readonly SetEntry[], name: string, from: string, at: readonly string[]): number[] {
  const ss = sessionsFor(entries, name).filter((x) => x.date >= from && x.date <= at[at.length - 1])
    .map((x) => ({ date: x.date, best: Math.max(-Infinity, ...x.sets.map(e1rm).filter((v): v is number => v != null)) }))
    .filter((x) => x.best > 0).reverse();
  if (ss.length < 2) return at.map(() => 0);
  const first = ss[0].date, start = Math.max(...ss.filter((x) => x.date <= addDays(first, 13)).map((x) => x.best));
  return at.map((t) => {
    const upTo = ss.filter((x) => x.date <= t);
    if (upTo.length < 2) return 0;
    const last = upTo[upTo.length - 1].date;
    if (daysBetween(first, last) < 14) return 0;
    const end = Math.max(...upTo.filter((x) => x.date >= addDays(last, -13)).map((x) => x.best));
    return round1(((end - start) / start) * 100);
  });
}

/** Working lift sets on each day, by date. */
function setsByDay(entries: readonly SetEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) if (isWorking(e)) out.set(e.date, (out.get(e.date) ?? 0) + 1);
  return out;
}

function rangeSummary(entries: SetEntry[], range: CompareRange, today: string, goal: number, prDays: readonly string[], perDay: Map<string, number>, firstDay: string | null): RangeSummary {
  const from = rangeFrom(range, today), n = rangeDays(range), at = samples(range, today);
  const met = weeklySummary(entries, rangeWeeks(range), today).map((w) => (w.sessions >= goal ? '1' : '0')).join('');
  const prs = at.map((t) => prDays.filter((d) => d >= from && d <= t).length);
  // Their usual: working sets a day over the same span before the range, or as much of it as the log has (two weeks at least).
  let vol: (number | null)[] = [];
  if (firstDay && firstDay < from) {
    const baseFrom = firstDay > addDays(from, -n) ? firstDay : addDays(from, -n), baseDays = daysBetween(baseFrom, from);
    let base = 0;
    for (const [d, k] of perDay) if (d >= baseFrom && d < from) base += k;
    if (baseDays >= VOL_BASE_MIN && base > 0) {
      const usual = base / baseDays;
      vol = at.map((t) => {
        const elapsed = daysBetween(from, t) + 1;
        if (elapsed < n * VOL_SETTLE) return null;
        let done = 0;
        for (const [d, k] of perDay) if (d >= from && d <= t) done += k;
        return round1((done / elapsed / usual - 1) * 100);
      });
    }
  }
  // The lifts with a change, the most trained first (sessions in the range), at most 12.
  const changed: { n: string; sessions: number }[] = [];
  for (const sets of liftIndex(entries).values()) {
    const inRange = sets.filter((s) => s.date >= from && s.date <= today);
    if (!inRange.length) continue;
    const name = normalizeName(inRange[inRange.length - 1].exercise);
    const c = e1rmChange(entries, name, from, today);
    if (c) changed.push({ n: name, sessions: c.sessions });
  }
  changed.sort((a, b) => b.sessions - a.sessions || a.n.localeCompare(b.n));
  const lifts = changed.slice(0, MAX_LIFTS).map((l) => ({ n: clip(l.n), s: liftLine(entries, l.n, from, at) }));
  return { met, vol, prs, lifts };
}

/**
 * Their Firsts over the last year, newest first, at most 8.
 * - A barbell compound (domain/progression): the first working set at or past a plate milestone (135, 225, 315 … lb), once
 *   there's a lighter one of that lift before it; the highest crossed, if one day crosses more than one.
 * - A pull-up, chin-up or dip: the first one, once the log is four weeks old before it.
 */
export function firsts(entries: readonly SetEntry[], today: string): First[] {
  const out: First[] = [];
  const since = addDays(today, -(FIRSTS_SPAN - 1));
  const logStart = entries.reduce<string | null>((a, e) => (a == null || e.date < a ? e.date : a), null);
  for (const sets of liftIndex(entries).values()) {
    const done = sets.filter((s) => isWorking(s) && s.reps != null && s.reps >= 1 && !s.flags.includes('partial') && !s.flags.includes('hold'))
      .slice().sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq || a.setNo - b.setNo);
    if (!done.length) continue;
    const name = normalizeName(sets[sets.length - 1].exercise);
    const bw = resolveLift(name).lift?.name;
    if (bw && BW_FIRSTS.includes(bw)) {
      const d = done[0].date;
      if (logStart && daysBetween(logStart, d) >= BW_HISTORY && d >= since && d <= today) out.push({ n: clip(name), w: 0, d });
      continue;
    }
    if (!isBarbellCompound(name)) continue;
    let best = -Infinity;
    const byDay = new Map<string, number>();
    for (const s of done) {
      if (s.weight <= 0 || s.flags.includes('bodyweight')) continue;
      if (best > 0) {
        const crossed = MILESTONES.filter((m) => m > best && m <= s.weight);
        if (crossed.length) byDay.set(s.date, Math.max(byDay.get(s.date) ?? 0, crossed[crossed.length - 1]));
      }
      best = Math.max(best, s.weight);
    }
    for (const [d, w] of byDay) if (d >= since && d <= today) out.push({ n: clip(name), w, d });
  }
  return out.sort((a, b) => b.d.localeCompare(a.d) || b.w - a.w || a.n.localeCompare(b.n)).slice(0, MAX_FIRSTS);
}

/** Your summary, from your whole log, for friends to read. `goal`: your weekly goal (sessions). */
export function summarize(entries: SetEntry[], today: string, goal: number, ach?: readonly SharedAch[]): Summary {
  const g = Math.min(7, Math.max(1, Math.round(goal) || 2));
  const byId = new Map(entries.map((e) => [e.id, e]));
  const prDays = [...prIds(entries)].map((id) => byId.get(id)!.date).filter((d) => d <= today);
  const perDay = setsByDay(entries);
  const firstDay = entries.reduce<string | null>((a, e) => (a == null || e.date < a ? e.date : a), null);
  const weeks = firstDay ? Math.min(1001, Math.ceil((daysBetween(firstDay, today) + 1) / 7) + 1) : 1;
  const streak = Math.min(1000, weekStreak(entries, today, g, weeks).current);
  const r = Object.fromEntries(COMPARE_RANGES.map((k) => [k, rangeSummary(entries, k, today, g, prDays, perDay, firstDay)])) as Record<CompareRange, RangeSummary>;
  return { v: 1, day: today, goal: g, streak, r, firsts: firsts(entries, today), ...(ach && { ach: ach.slice(0, MAX_SHARED).map((x) => ({ ...x })) }) };
}

/** What changed, for deciding whether to write it again: everything but when. */
export const summaryKey = (s: Summary): string => JSON.stringify(s);

// ---- Reading a friend's ----

const isDay = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const isInt = (x: unknown, lo: number, hi: number): x is number => Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi;
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const nameOk = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0 && Array.from(x).length <= NAME_MAX;
const WEEKS: Record<CompareRange, number> = { '4w': 4, '12w': 12, '1y': 52 };

function parseRange(x: unknown, weeks: number): RangeSummary | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.met !== 'string' || !new RegExp(`^[01]{${weeks}}$`).test(o.met)) return null;
  if (!Array.isArray(o.prs) || o.prs.length !== POINTS || !o.prs.every(isNum)) return null;
  const vol = Array.isArray(o.vol) && o.vol.length === POINTS && o.vol.every((v) => v === null || isNum(v)) ? (o.vol as (number | null)[]) : [];
  const lifts = (Array.isArray(o.lifts) ? o.lifts : []).slice(0, MAX_LIFTS).filter((l): l is LiftLine => {
    const q = l as Record<string, unknown> | null;
    return !!q && typeof q === 'object' && nameOk(q.n) && Array.isArray(q.s) && q.s.length === POINTS && q.s.every(isNum);
  }).map((l) => ({ n: l.n, s: [...l.s] }));
  return { met: o.met, vol, prs: o.prs as number[], lifts };
}

/**
 * A friend's summary as read, or null: not one this app can read (another version, a shape it doesn't know). Read as untrusted:
 * the rules check only the first lift and First of each list, so a bad entry further in is dropped here, not shown.
 */
export function parseSummary(x: unknown): ReadSummary | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (o.v !== 1 || !isDay(o.day) || !isInt(o.goal, 1, 7) || !isInt(o.streak, 0, 1000)) return null;
  const rr = o.r as Record<string, unknown> | null;
  if (!rr || typeof rr !== 'object') return null;
  const r = {} as Record<CompareRange, RangeSummary>;
  for (const k of COMPARE_RANGES) {
    const p = parseRange(rr[k], WEEKS[k]);
    if (!p) return null;
    r[k] = p;
  }
  const firsts = (Array.isArray(o.firsts) ? o.firsts : []).slice(0, MAX_FIRSTS).filter((f): f is First => {
    const q = f as Record<string, unknown> | null;
    return !!q && typeof q === 'object' && nameOk(q.n) && isNum(q.w) && q.w >= 0 && q.w <= 2000 && isDay(q.d);
  }).map((f) => ({ n: f.n, w: f.w, d: f.d }));
  const t = o.at as { toMillis?: () => number } | number | undefined;
  const at = typeof t === 'number' ? t : typeof t?.toMillis === 'function' ? t.toMillis() : 0;
  // Achievements: kept as sent, each entry's shape checked (achievements unlocksOf checks each against the families).
  const ach = Array.isArray(o.ach) ? o.ach.slice(0, MAX_SHARED).filter((a): a is SharedAch => {
    const q = a as Record<string, unknown> | null;
    return !!q && typeof q === 'object' && typeof q.i === 'string' && isInt(q.l, 0, 4) && isDay(q.d) && (q.n === undefined || nameOk(q.n));
  }).map((a) => ({ i: a.i, l: a.l, d: a.d, ...(a.n !== undefined && { n: a.n }) })) : undefined;
  return { v: 1, day: o.day, goal: o.goal, streak: o.streak, r, firsts, ...(ach && { ach }), at };
}

// ---- Setting people side by side ----

export type Metric = 'str' | 'goal' | 'vol' | 'pr' | 'streak';
export const METRICS: readonly Metric[] = ['str', 'goal', 'vol', 'pr', 'streak'];
/** The chart's: the metrics that are a line over the range. */
export const LINE_METRICS: readonly Metric[] = ['str', 'vol', 'pr'];
export const isMetric = (x: unknown): x is Metric => METRICS.includes(x as Metric);

/** One person on the page: you or a friend, with their summary (null: none yet). */
export interface Person { uid: string; me: boolean; s: Summary | null }
/** What one person shows for a metric: the number (null: nothing to say yet) and its line over the range (null: none). */
export interface Value { v: number | null; line: (number | null)[] | null }

/** What lifts are matched by between two people: the catalog lift a name counts as, else the name itself (as Friends does). */
export const matchKey = (name: string) => resolveLift(name).lift?.name ?? liftKey(name);

/**
 * Strength: the mean e1RM change, in %, over a person's lifts that someone else shown has a change on too (the crew's shared
 * lifts), so nobody's number rests on a lift only they do. Null: no lift shared yet. Its line is the same mean at each point.
 */
export function strength(people: readonly Person[], range: CompareRange): Map<string, Value> {
  const keys = new Map<string, Map<string, LiftLine>>();
  for (const p of people) {
    if (!p.s) continue;
    const m = new Map<string, LiftLine>();
    for (const l of p.s.r[range].lifts) { const k = matchKey(l.n); if (!m.has(k)) m.set(k, l); }
    keys.set(p.uid, m);
  }
  const holders = new Map<string, number>();
  for (const m of keys.values()) for (const k of m.keys()) holders.set(k, (holders.get(k) ?? 0) + 1);
  const out = new Map<string, Value>();
  for (const p of people) {
    const m = keys.get(p.uid);
    const shared = m ? [...m.entries()].filter(([k]) => (holders.get(k) ?? 0) >= 2).map(([, l]) => l) : [];
    if (!shared.length) { out.set(p.uid, { v: null, line: null }); continue; }
    const line = Array.from({ length: POINTS }, (_, i) => round1(shared.reduce((a, l) => a + l.s[i], 0) / shared.length));
    out.set(p.uid, { v: line[POINTS - 1], line });
  }
  return out;
}

/** Shared lifts behind each person's Strength (for the line under it): their names as they write them. */
export function sharedLifts(people: readonly Person[], range: CompareRange): Map<string, string[]> {
  const holders = new Map<string, number>();
  const each = people.map((p) => {
    const m = new Map<string, string>();
    for (const l of p.s?.r[range].lifts ?? []) { const k = matchKey(l.n); if (!m.has(k)) m.set(k, l.n); }
    for (const k of m.keys()) holders.set(k, (holders.get(k) ?? 0) + 1);
    return [p.uid, m] as const;
  });
  return new Map(each.map(([uid, m]) => [uid, [...m.entries()].filter(([k]) => (holders.get(k) ?? 0) >= 2).map(([, n]) => n)]));
}

export const metCount = (met: string) => [...met].filter((c) => c === '1').length;

/** Each person's value for a metric over a range. */
export function values(people: readonly Person[], metric: Metric, range: CompareRange): Map<string, Value> {
  if (metric === 'str') return strength(people, range);
  return new Map(people.map((p) => {
    const r = p.s?.r[range];
    if (!p.s || !r) return [p.uid, { v: null, line: null }];
    if (metric === 'goal') return [p.uid, { v: metCount(r.met), line: null }];
    if (metric === 'streak') return [p.uid, { v: p.s.streak, line: null }];
    if (metric === 'pr') return [p.uid, { v: r.prs[POINTS - 1], line: r.prs }];
    const v = r.vol.length ? r.vol[POINTS - 1] : null;
    return [p.uid, { v, line: r.vol.length ? r.vol : null }];
  }));
}

/** Ranks, highest first; equal values share one ("1, 2, 2, 4"); no value, no rank. */
export function ranks(vals: ReadonlyMap<string, Value>): Map<string, number | null> {
  const nums = [...vals.values()].map((x) => x.v).filter((v): v is number => v != null);
  return new Map([...vals.entries()].map(([uid, x]) => [uid, x.v == null ? null : 1 + nums.filter((v) => v > x.v!).length]));
}

/** People in rank order: highest first, no value last, then you first among equals, then by name. */
export function ranked<T extends { uid: string; me: boolean; name: string }>(people: readonly T[], vals: ReadonlyMap<string, Value>): T[] {
  const v = (p: T) => vals.get(p.uid)?.v ?? null;
  return [...people].sort((a, b) => {
    const x = v(a), y = v(b);
    if ((x == null) !== (y == null)) return x == null ? 1 : -1;
    return (x != null && y != null ? y - x : 0) || Number(b.me) - Number(a.me) || a.name.localeCompare(b.name);
  });
}

/**
 * A heat-table cell's shade, 1 to 4, by where the value sits among the others shown (equal values share one): never a warning,
 * only "others moved more this time". 0: no value, or nobody to set it against.
 */
export function heatStep(v: number | null, all: readonly (number | null)[]): number {
  const vs = all.filter((x): x is number => x != null);
  if (v == null || vs.length < 2) return 0;
  const below = vs.filter((x) => x < v).length;
  return 1 + Math.min(3, Math.floor((below / (vs.length - 1)) * 3.999));
}

// ---- Who's drawn in what ----

/** You: the app's accent. */
export const YOU_COLOUR = '#fbba4a';
/**
 * A friend's line, by the order you became friends (domain/compare personColours), so hiding someone never repaints anyone
 * else. Chosen for the dark surface (#18191c): each 4.0:1 or more against it, and every pair of the 13 with You at least 8.3
 * apart (OKLab ×100) in normal, protan and deutan vision (Machado 2009); tritan 3.9. Every line also carries its name.
 */
export const PERSON_COLOURS = ['#805bfe', '#b26f06', '#48d7fe', '#c547a3', '#4cae86', '#b79d2b', '#d790c5', '#08baf8', '#55f2ed', '#507fcd', '#308e63', '#4998fe'] as const;
/** Each friend's colour, by uid: the order you became friends (then uid), the 13th on again from the first. */
export function personColours(friends: readonly { uid: string; since?: number }[]): Map<string, string> {
  const order = [...friends].sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  return new Map(order.map((f, i) => [f.uid, PERSON_COLOURS[i % PERSON_COLOURS.length]]));
}

/**
 * Labels at the ends of lines, nudged apart: each `gap` from the next at least, inside [lo, hi], as near its line as that
 * allows. In and out in the order given.
 */
export function spread(ys: readonly number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => ({ y: Math.min(hi, Math.max(lo, y)), i })).sort((a, b) => a.y - b.y || a.i - b.i);
  // Down from the top, then back up from the bottom (only what runs past it moves), then down again: a set that can't fit at
  // all runs past `hi` rather than overlapping (the chart grows with its lines, so it fits).
  for (let k = 1; k < order.length; k++) order[k].y = Math.max(order[k].y, order[k - 1].y + gap);
  for (let k = order.length - 1; k >= 0; k--) order[k].y = Math.min(order[k].y, k === order.length - 1 ? hi : order[k + 1].y - gap);
  for (let k = 0; k < order.length; k++) order[k].y = Math.max(order[k].y, k ? order[k - 1].y + gap : lo);
  const out = new Array<number>(ys.length);
  for (const o of order) out[o.i] = o.y;
  return out;
}

/**
 * Round steps for a chart axis, about 4 of them, from at or below `lo` to at or above `hi` (and at least two): the first and last are the plot’s
 * edges, so every value drawn sits inside it.
 */
export function axisTicks(lo: number, hi: number, whole: boolean): number[] {
  const span = Math.max(hi - lo, whole ? 4 : 2);
  const raw = span / 4, p = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(whole ? 1 : 0, [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? 10 * p);
  const out: number[] = [];
  for (let t = Math.floor(lo / step) * step; ; t += step) {
    out.push(Math.round(t * 100) / 100);
    if (t >= hi - 1e-9 && out.length > 1) break;
  }
  return out;
}
