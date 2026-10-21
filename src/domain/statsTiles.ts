import { addDays, weekStart } from './analytics';
import { isCardio, isCardioEntry } from './cardio';
import { liftKind } from './feed';
import { liftKey, normalizeName } from './ids';
import { tagsOf } from './learn/tags';
import { isWorking } from './progression';
import type { RecordKind } from './records';
import { doneAt, e1rm, liftIndex } from './stats';
import { SET_WORK } from './timing';
import type { BodyDay } from './body';
import type { SetEntry } from './types';

// Stats v2 S2 (plan .superpowers/redesign/stats-v2 §2, the R+ rows): what the new tiles read, each worked out from the log alone
// over the one range (`from` to `to`, both included). Pure: no profile, no prefs, no clock but the dates passed in. A tile with
// nothing to say gets an empty answer here (no sets, null), and the screen leaves it out.

const DAY = 864e5;
const dayNo = (d: string) => Math.round(Date.parse(`${d}T12:00:00Z`) / DAY);
/** Monday 0 … Sunday 6, from the date alone (no time zone). */
export const weekdayOf = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** The p-th quantile, linear between order statistics. */
const quantile = (xs: readonly number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * p, lo = Math.floor(i);
  return lo + 1 < s.length ? s[lo] + (i - lo) * (s[lo + 1] - s[lo]) : s[lo];
};
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const inRange = (d: string, from: string, to: string) => d >= from && d <= to;
/** A lifted working set: not a warm-up, a partial, a cardio bout or a set of no reps. */
const lifted = (e: SetEntry) => isWorking(e) && !isCardioEntry(e) && !isCardio(e.exercise);

// ---- Rate of gain (catalogue 2, 3) ----

/** A lift's trend over the range: a least-squares line through its sessions' strength (a level or a best e1RM). */
export interface Fit {
  /** Sessions in the fit, and the days from the first to the last. */ n: number; span: number;
  /** Pounds a day, and that slope's standard error. */ slope: number; se: number;
  /** The fit's centre: the mean day (day number) and the mean level there. */ x0: number; y0: number;
  /** Per week, as a share of the mean level (%). */ pct: number;
}
/** Sessions a rate needs, and days from the first to the last: fewer is noise. */
export const RATE_MIN = { sessions: 4, days: 14 } as const;

/** The line through a lift's points (oldest first), or null under RATE_MIN. */
export function fitTrend(points: readonly { date: string; v: number }[]): Fit | null {
  const n = points.length;
  if (n < RATE_MIN.sessions) return null;
  const xs = points.map((p) => dayNo(p.date)), ys = points.map((p) => p.v);
  const span = xs[n - 1] - xs[0];
  if (span < RATE_MIN.days) return null;
  const x0 = mean(xs), y0 = mean(ys);
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - x0) ** 2; sxy += (xs[i] - x0) * (ys[i] - y0); }
  if (sxx <= 0 || y0 <= 0) return null;
  const slope = sxy / sxx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (y0 + slope * (xs[i] - x0))) ** 2;
  const se = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : Infinity;
  return { n, span, slope, se, x0, y0, pct: (100 * 7 * slope) / y0 };
}

/** Each lift's rate (%/wk), fastest first, and the median of them: the tile reads the lifts followed, the sheet every lift. */
export function rateOfGain(lifts: readonly { name: string; points: readonly { date: string; v: number }[] }[]): { rows: { name: string; pct: number; n: number }[]; median: number | null } {
  const rows = lifts.flatMap((l) => { const f = fitTrend(l.points); return f ? [{ name: l.name, pct: f.pct, n: f.n }] : []; })
    .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
  return { rows, median: rows.length ? median(rows.map((r) => r.pct)) : null };
}

/** The family a lift belongs to (learn/tags: its movement), as a label: "Horizontal press", "Curl". */
export const familyOf = (name: string): string | null => { const m = tagsOf(name).move; return m && m !== 'other' ? m[0].toUpperCase() + m.slice(1) : null; };
/** Lifts' rates by family: each family's median and its lifts, fastest first. Lifts with no family are left out. */
export function familyRates(rows: readonly { name: string; pct: number }[]): { family: string; pct: number; lifts: string[] }[] {
  const by = new Map<string, { name: string; pct: number }[]>();
  for (const r of rows) { const f = familyOf(r.name); if (f) by.set(f, [...(by.get(f) ?? []), r]); }
  return [...by].map(([family, xs]) => ({ family, pct: median(xs.map((x) => x.pct)), lifts: xs.map((x) => x.name) }))
    .sort((a, b) => b.pct - a.pct || a.family.localeCompare(b.family));
}

/**
 * The lifts followed as one line, week by week over the range: each lift's level as a share of its first in the range (100 = where
 * it started), averaged over the lifts with a reading by then (a lift keeps its last reading through weeks without one). Null
 * for a week before any lift had one. The rate tile's sparkline.
 */
export function strengthIndex(lifts: readonly { points: readonly { date: string; v: number }[] }[], from: string, weeks: number): (number | null)[] {
  const start = weekStart(from);
  const out: (number | null)[] = [];
  for (let w = 0; w < weeks; w++) {
    const end = addDays(start, 7 * w + 6);
    const vals = lifts.flatMap((l) => {
      const ps = l.points.filter((p) => p.date >= from);
      const last = ps.filter((p) => p.date <= end).at(-1);
      return last && ps[0].v > 0 ? [(100 * last.v) / ps[0].v] : [];
    });
    out.push(vals.length ? mean(vals) : null);
  }
  return out;
}

// ---- PRs by kind (catalogue 5) ----

/** What kind of record a PR set broke, in four: strength (e1RM, heaviest, rep maxes), reps (and holds), volume, cardio. */
export type PrGroup = 'strength' | 'reps' | 'volume' | 'cardio';
export const PR_GROUPS: readonly { id: PrGroup; label: string }[] = [
  { id: 'strength', label: 'Strength' }, { id: 'reps', label: 'Reps' }, { id: 'volume', label: 'Volume' }, { id: 'cardio', label: 'Cardio' },
];
const GROUP_OF = (k: RecordKind): PrGroup => (k === 'e1rm' || k === 'heaviest' || k.startsWith('rm') ? 'strength'
  : k === 'reps' || k === 'mostReps' || k === 'sessionReps' || k === 'hold' ? 'reps'
  : k === 'setVolume' || k === 'sessionVolume' ? 'volume' : 'cardio');
/** A PR set's group: the first of strength, reps, volume, cardio among the records it broke (a set counts once). */
export function prGroup(kinds: readonly RecordKind[]): PrGroup {
  const gs = new Set(kinds.map(GROUP_OF));
  return PR_GROUPS.find((g) => gs.has(g.id))?.id ?? 'strength';
}

export interface PrDot { date: string; group: PrGroup; /** Where in the range, 0 (its first day) to 1 (`to`). */ at: number }
/**
 * PRs over the range as a timeline: each PR set a dot by its date and group, oldest first; the count per group; how many in the
 * range and in `to`'s calendar month.
 */
export function prTimeline(prs: readonly { date: string; kinds: readonly RecordKind[] }[], from: string, to: string): { total: number; thisMonth: number; groups: Record<PrGroup, number>; dots: PrDot[] } {
  const span = Math.max(1, dayNo(to) - dayNo(from)), month = to.slice(0, 7);
  const groups: Record<PrGroup, number> = { strength: 0, reps: 0, volume: 0, cardio: 0 };
  const dots = prs.filter((p) => inRange(p.date, from, to)).map((p) => ({ date: p.date, group: prGroup(p.kinds), at: (dayNo(p.date) - dayNo(from)) / span }))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const d of dots) groups[d.group]++;
  return { total: dots.length, thisMonth: dots.filter((d) => d.date.startsWith(month)).length, groups, dots };
}

// ---- Plateaus (catalogue 4) ----

export interface LiftState { name: string; stall: { weeks: number; since: string } | null; /** The change over the range, % (null: too new). */ pct: number | null }
export type Pip = 'flat' | 'up' | 'down' | 'level';
/** A lift's state in one word: flat (on a plateau), up, down, or level (no change worth a word, or too new to say). */
export const pipOf = (l: LiftState): Pip => (l.stall ? 'flat' : l.pct == null || Math.abs(l.pct) < 0.05 ? 'level' : l.pct > 0 ? 'up' : 'down');
/** The lifts followed: which are flat (longest first), and every lift's pip in the order given. */
export function plateaus(lifts: readonly LiftState[]): { flat: LiftState[]; of: number; pips: { name: string; pip: Pip }[] } {
  const flat = lifts.filter((l) => l.stall).sort((a, b) => b.stall!.weeks - a.stall!.weeks || a.name.localeCompare(b.name));
  return { flat, of: lifts.length, pips: lifts.map((l) => ({ name: l.name, pip: pipOf(l) })) };
}

// ---- Target hit rate (catalogue 10) ----

export interface HitRate {
  /** Sets done at the weight the app suggested, and how many made the reps it suggested. */ sets: number; hit: number;
  /** Per lift, the most aimed sets first. */ lifts: { name: string; sets: number; hit: number }[];
  /** The aimed sets whose weight was a step up on the lift's last session (a load jump), and how many made their reps. */ jumps: { sets: number; hit: number };
  /** Each week's rate (null: no aimed sets that week), the range's weeks oldest first. */ weekly: (number | null)[];
}
/**
 * How often a suggested set made its reps (SetEntry.target, kept when the set was logged): working sets at the suggested weight,
 * tests left out (as progression.targetsHit reads them). A set at another weight wasn't aimed at that target, so it says nothing.
 */
export function hitRate(entries: readonly SetEntry[], from: string, to: string): HitRate {
  const start = weekStart(from), weeks = Math.floor((dayNo(weekStart(to)) - dayNo(start)) / 7) + 1;
  const wk = Array.from({ length: weeks }, () => ({ sets: 0, hit: 0 }));
  const lifts: HitRate['lifts'] = [];
  const jumps = { sets: 0, hit: 0 };
  let sets = 0, hit = 0;
  for (const all of liftIndex(entries).values()) {
    const work = all.filter((e) => lifted(e) && !e.flags.includes('test'));
    const dates = [...new Set(work.map((e) => e.date))].sort();
    const top = new Map(dates.map((d) => [d, Math.max(...work.filter((e) => e.date === d).map((e) => e.weight))]));
    let n = 0, h = 0, name = '';
    for (const e of work) {
      if (!inRange(e.date, from, to) || e.target?.weight == null || e.target.weight !== e.weight) continue;
      const ok = (e.reps as number) >= e.target.reps;
      n++; if (ok) h++;
      name = normalizeName(e.exercise);
      const w = wk[Math.floor((dayNo(weekStart(e.date)) - dayNo(start)) / 7)];
      w.sets++; if (ok) w.hit++;
      const prev = dates.filter((d) => d < e.date).at(-1);
      if (prev != null && e.target.weight > top.get(prev)!) { jumps.sets++; if (ok) jumps.hit++; }
    }
    if (n) { lifts.push({ name, sets: n, hit: h }); sets += n; hit += h; }
  }
  lifts.sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name));
  return { sets, hit, lifts, jumps, weekly: wk.map((w) => (w.sets ? w.hit / w.sets : null)) };
}

// ---- How hard: logged RIR (catalogue 15) ----

/** RIR 0, 1, 2, 3, 4 and 5 or more. */
export const RIR_BINS = ['0', '1', '2', '3', '4', '5+'] as const;
export interface Effort {
  /** Working lift sets in the range, and those with an RIR logged. */ sets: number; logged: number;
  /** The mean logged RIR, and the share of logged sets at RIR 0–2. */ avg: number; hard: number;
  /** Logged sets by RIR_BINS. */ bins: number[];
  /** Per lift: logged sets, mean RIR, share at 0–2; the most logged first. */ lifts: { name: string; n: number; avg: number; hard: number }[];
}
/** How hard he trains, by the RIR he logged; null with none logged in the range. */
export function effort(entries: readonly SetEntry[], from: string, to: string): Effort | null {
  const work = entries.filter((e) => inRange(e.date, from, to) && lifted(e));
  const logged = work.filter((e) => e.rir != null);
  if (!logged.length) return null;
  const bins = RIR_BINS.map(() => 0);
  for (const e of logged) bins[Math.min(5, Math.max(0, Math.round(e.rir!)))]++;
  const by = new Map<string, { name: string; rirs: number[] }>();
  for (const e of logged) { const k = liftKey(e.exercise), b = by.get(k) ?? { name: normalizeName(e.exercise), rirs: [] }; b.rirs.push(e.rir!); by.set(k, b); }
  const hardOf = (rs: number[]) => rs.filter((r) => r <= 2).length / rs.length;
  const rirs = logged.map((e) => e.rir!);
  return {
    sets: work.length, logged: logged.length, avg: mean(rirs), hard: hardOf(rirs), bins,
    lifts: [...by.values()].map((b) => ({ name: b.name, n: b.rirs.length, avg: mean(b.rirs), hard: hardOf(b.rirs) })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
  };
}

// ---- Rest between sets, against the timer; density (catalogue 31, 32) ----

/** A gap from one set to the next of the same lift past this is a break, not a rest (as timing.paces reads it). */
const MAX_GAP = 10 * 60;
export interface RestRow { name: string; /** Median rest, s. */ rest: number; /** What the timer gives it, s. */ timer: number; n: number }
export interface SessionPace { date: string; minutes: number; sets: number; /** Working sets an hour. */ perHour: number; /** Median rest that day, s (null: no rests). */ rest: number | null; /** Minutes the day's rests ran over the timer (under: negative). */ over: number }
export interface Rests {
  /** Rests timed, their median, and the timer's median over the same rests. */ n: number; rest: number; timer: number;
  /** Per lift, the most rests first. */ lifts: RestRow[];
  /** Each timed session, oldest first. */ sessions: SessionPace[];
  /** Median working sets an hour over the sessions, and the median minutes a session's rests ran over the timer. */ perHour: number | null; over: number | null;
}
/**
 * Rest as he takes it against what the timer gives (`timer`: a lift's rest, s): from one working set to the next of the same lift,
 * timed as done (a time entered late is a guess, so it says nothing), less the set itself (timing.SET_WORK), gaps over 10 min left
 * out as breaks. Each session's length runs from its first timed set's start to its last; density is its working sets an hour.
 * Null with no rest timed in the range.
 */
export function rests(entries: readonly SetEntry[], from: string, to: string, timer: (exercise: string) => number): Rests | null {
  const days = new Map<string, SetEntry[]>();
  for (const e of entries) {
    if (!inRange(e.date, from, to) || !lifted(e) || !e.loggedAt || e.enteredAt || Number.isNaN(doneAt(e))) continue;
    const d = days.get(e.date);
    if (d) d.push(e); else days.set(e.date, [e]);
  }
  const by = new Map<string, { name: string; rests: number[]; timer: number }>();
  const all: { rest: number; timer: number }[] = [];
  const sessions: SessionPace[] = [];
  for (const [date, day] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    day.sort((a, b) => doneAt(a) - doneAt(b));
    const own: number[] = [];
    let over = 0;
    for (let i = 1; i < day.length; i++) {
      const a = day[i - 1], b = day[i];
      if (liftKey(a.exercise) !== liftKey(b.exercise)) continue;
      const gap = (doneAt(b) - doneAt(a)) / 1000;
      if (gap <= 0 || gap > MAX_GAP) continue;
      const rest = Math.max(0, gap - SET_WORK), k = liftKey(b.exercise);
      const row = by.get(k) ?? { name: normalizeName(b.exercise), rests: [], timer: timer(b.exercise) };
      row.rests.push(rest); by.set(k, row);
      all.push({ rest, timer: row.timer }); own.push(rest); over += rest - row.timer;
    }
    if (day.length < 2) continue;
    const minutes = (doneAt(day.at(-1)!) - doneAt(day[0])) / 60_000 + SET_WORK / 60;
    sessions.push({ date, minutes, sets: day.length, perHour: (60 * day.length) / minutes, rest: own.length ? median(own) : null, over: over / 60 });
  }
  if (!all.length) return null;
  const lifts = [...by.values()].map((r) => ({ name: r.name, rest: median(r.rests), timer: r.timer, n: r.rests.length }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const rested = sessions.filter((s) => s.rest != null);
  return {
    n: all.length, rest: median(all.map((x) => x.rest)), timer: median(all.map((x) => x.timer)), lifts, sessions,
    perHour: sessions.length ? median(sessions.map((s) => s.perHour)) : null, over: rested.length ? median(rested.map((s) => s.over)) : null,
  };
}

// ---- When he trains: best days, usual start (catalogue 25, 26) ----

export interface When {
  /** Days trained in the range, and the weeks it spans. */ days: number; weeks: number;
  /** Days trained on each weekday, Monday first. */ byDay: number[];
  /**
   * The weekdays trained most (0 = Monday), most first, then Monday first: the top two and any tied with the second, three at
   * most; past that only the clear leaders, and none when four or more share the most.
   */ top: number[];
  /** Days with a time to start from, the usual start (hour of the day, fractional: the median) and its middle half. */
  timed: number; start: number | null; early: number | null; late: number | null;
  /** Timed days' starts by hour (0–23). */ hours: number[];
  /** Each weekday's usual start (null: none timed that day). */ startByDay: (number | null)[];
}
/**
 * Which weekdays he trains, and when he starts: a day counts with any set but a warm-up; its start is its first timed set's done
 * time less the set itself, as an hour of the local day (`hourOf`: ms → hours, the phone's own clock by default). Times are only
 * ever said as an hour.
 */
export function whenTrained(entries: readonly SetEntry[], from: string, to: string, hourOf = (ms: number) => { const d = new Date(ms); return d.getHours() + d.getMinutes() / 60; }): When {
  const first = new Map<string, number>(), dates = new Set<string>();
  for (const e of entries) {
    if (!inRange(e.date, from, to) || e.flags.includes('warmup')) continue;
    dates.add(e.date);
    if (!e.loggedAt || e.enteredAt) continue;
    const t = doneAt(e);
    if (!Number.isNaN(t) && t < (first.get(e.date) ?? Infinity)) first.set(e.date, t);
  }
  const byDay = Array(7).fill(0) as number[];
  for (const d of dates) byDay[weekdayOf(d)]++;
  const ranked = byDay.map((n, i) => [n, i]).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const second = ranked[1]?.[0] ?? 0;
  let top = ranked.filter(([n]) => n >= second).map(([, i]) => i);
  if (top.length > 3) top = ranked.filter(([n]) => n > second).map(([, i]) => i);
  const starts = [...first].map(([date, t]) => ({ date, h: hourOf(t - SET_WORK * 1000) }));
  const hours = Array(24).fill(0) as number[];
  for (const s of starts) hours[Math.min(23, Math.max(0, Math.floor(s.h)))]++;
  const hs = starts.map((s) => s.h);
  const startByDay = Array.from({ length: 7 }, (_, i) => { const xs = starts.filter((s) => weekdayOf(s.date) === i).map((s) => s.h); return xs.length ? median(xs) : null; });
  return {
    days: dates.size, weeks: Math.floor((dayNo(to) - dayNo(from)) / 7) + 1, byDay, top,
    timed: starts.length, start: hs.length ? median(hs) : null, early: hs.length ? quantile(hs, 0.25) : null, late: hs.length ? quantile(hs, 0.75) : null,
    hours, startByDay,
  };
}

// ---- Pull vs push (catalogue 19) ----

export interface Balance {
  /** Working lift sets by kind over the range. */ legs: number; push: number; pull: number; core: number;
  /** Pull sets per push set (null: no push). */ ratio: number | null;
  /** Each week's pull and push sets, oldest first. */ weekly: { pull: number; push: number }[];
}
/** Working lift sets by what each lift trains most (feed.liftKind, as the calendar's kinds): the pull and push balance. */
export function balance(entries: readonly SetEntry[], from: string, to: string): Balance {
  const start = weekStart(from), weeks = Math.floor((dayNo(weekStart(to)) - dayNo(start)) / 7) + 1;
  const weekly = Array.from({ length: weeks }, () => ({ pull: 0, push: 0 }));
  const n = { legs: 0, push: 0, pull: 0, core: 0 };
  for (const e of entries) {
    if (!inRange(e.date, from, to) || !lifted(e)) continue;
    const k = liftKind(e.exercise);
    if (k == null || k === 'cardio') continue;
    n[k]++;
    if (k === 'pull' || k === 'push') weekly[Math.floor((dayNo(weekStart(e.date)) - dayNo(start)) / 7)][k]++;
  }
  return { ...n, ratio: n.push ? n.pull / n.push : null, weekly };
}

// ---- Lifts in rotation (catalogue 21) ----

export interface LiftSpan { name: string; sessions: number; first: string; last: string }
export interface LiftRotation {
  /** Lifts done in the range, the most sessions first. */ lifts: LiftSpan[];
  /** Done for the first time in the range (their first-ever day), newest first. */ fresh: LiftSpan[];
  /** Done in the span of the same length before the range, not in it (their last day before), most recent first. */ dropped: LiftSpan[];
  /** Different lifts done each week, oldest first. */ weekly: number[];
}
/** The lifts he does: how many in the range, which are new to him, which he stopped; cardio machines aren't lifts here. */
export function liftsInRotation(entries: readonly SetEntry[], from: string, to: string): LiftRotation {
  const span = dayNo(to) - dayNo(from) + 1, before = addDays(from, -span);
  const start = weekStart(from), weeks = Math.floor((dayNo(weekStart(to)) - dayNo(start)) / 7) + 1;
  const weekly = Array.from({ length: weeks }, () => new Set<string>());
  const lifts: LiftSpan[] = [], fresh: LiftSpan[] = [], dropped: LiftSpan[] = [];
  for (const [k, all] of liftIndex(entries)) {
    const work = all.filter((e) => lifted(e) && e.date <= to);
    if (!work.length) continue;
    const name = normalizeName(work.at(-1)!.exercise);
    const dates = [...new Set(work.map((e) => e.date))].sort();
    const inside = dates.filter((d) => d >= from);
    if (inside.length) {
      const row = { name, sessions: inside.length, first: dates[0], last: inside.at(-1)! };
      lifts.push(row);
      if (dates[0] >= from) fresh.push(row);
      for (const d of inside) weekly[Math.floor((dayNo(weekStart(d)) - dayNo(start)) / 7)].add(k);
    } else {
      const prior = dates.filter((d) => d >= before && d < from);
      if (prior.length) dropped.push({ name, sessions: prior.length, first: dates[0], last: prior.at(-1)! });
    }
  }
  lifts.sort((a, b) => b.sessions - a.sessions || b.last.localeCompare(a.last) || a.name.localeCompare(b.name));
  fresh.sort((a, b) => b.first.localeCompare(a.first) || a.name.localeCompare(b.name));
  dropped.sort((a, b) => b.last.localeCompare(a.last) || a.name.localeCompare(b.name));
  return { lifts, fresh, dropped, weekly: weekly.map((s) => s.size) };
}

// ---- Energy and performance (catalogue 37) ----

/** Sessions of a lift a day is read against: its median best e1RM over the last this many before the day, those within ENERGY_WINDOW. */
const ENERGY_REF = 3;
/** Days back a reference session may be: older, the lift was another lift then (a layoff, a new machine). */
const ENERGY_WINDOW = 56;
/** Reference sessions a lift needs to say anything: one session alone is noise. */
const ENERGY_MIN_REFS = 2;
export interface EnergyDay { date: string; energy: number; /** That day's lifts against their last sessions, % (null: no lift to compare). */ vs: number | null }
export interface Energy {
  /** Days with energy logged in the range, oldest first. */ days: EnergyDay[];
  avg: number;
  /** Per energy level 1–5: days, and the mean of their `vs` (null: none to compare). */ levels: { level: number; days: number; vs: number | null }[];
  /** The mean `vs` of low (1–2) and high (4–5) days: null with none. */ low: number | null; high: number | null;
}
/**
 * His energy (1–5, BodyDay.energy) over the range, and how each day's lifting went against itself: each lift's best e1RM that day
 * against the median of its last 3 sessions before, those in the 8 weeks before and at least 2 of them (unadjusted for fatigue:
 * the core's adjusted reading is later), the day the mean over its lifts. Null with no energy logged in the range.
 */
export function energyVsLifts(entries: readonly SetEntry[], body: readonly BodyDay[], from: string, to: string): Energy | null {
  const days = body.filter((d) => d.energy != null && inRange(d.date, from, to)).sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length) return null;
  // Each lift's best e1RM per session day, oldest first.
  const best = new Map<string, { date: string; v: number }[]>();
  for (const [k, all] of liftIndex(entries)) {
    const per = new Map<string, number>();
    for (const e of all) { if (!lifted(e)) continue; const v = e1rm(e); if (v != null && v > (per.get(e.date) ?? 0)) per.set(e.date, v); }
    if (per.size) best.set(k, [...per].map(([date, v]) => ({ date, v })).sort((a, b) => a.date.localeCompare(b.date)));
  }
  const vsOf = (date: string): number | null => {
    const xs: number[] = [];
    for (const ss of best.values()) {
      const i = ss.findIndex((s) => s.date === date);
      if (i < 1) continue;
      const refs = ss.slice(Math.max(0, i - ENERGY_REF), i).filter((s) => dayNo(date) - dayNo(s.date) <= ENERGY_WINDOW);
      if (refs.length < ENERGY_MIN_REFS) continue;
      xs.push(100 * (ss[i].v / median(refs.map((s) => s.v)) - 1));
    }
    return xs.length ? mean(xs) : null;
  };
  const out: EnergyDay[] = days.map((d) => ({ date: d.date, energy: d.energy!, vs: vsOf(d.date) }));
  const vsMean = (ds: EnergyDay[]) => { const xs = ds.flatMap((d) => (d.vs == null ? [] : [d.vs])); return xs.length ? mean(xs) : null; };
  return {
    days: out, avg: mean(out.map((d) => d.energy)),
    levels: [1, 2, 3, 4, 5].map((level) => { const ds = out.filter((d) => d.energy === level); return { level, days: ds.length, vs: vsMean(ds) }; }),
    low: vsMean(out.filter((d) => d.energy <= 2)), high: vsMean(out.filter((d) => d.energy >= 4)),
  };
}

// ---- The next milestone's date (catalogue 7) ----

/** Sessions a date needs (owner, 2026-10-20: only with 6+ sessions and a rising trend). */
export const MILESTONE_MIN_SESSIONS = 6;
/** The likely band: the slope ± this many standard errors (about 80 %). */
const Z80 = 1.2816;
/** Further out than this, a date says nothing. */
const MAX_DAYS = 365;
/**
 * When the trend reaches `next`: the line through the sessions (fitTrend) carried on from today, and the likely range from its
 * slope ± 1.28 standard errors. Null under 6 sessions, or unless the trend is rising at both ends of that band, or past a year.
 */
export function milestoneDate(points: readonly { date: string; v: number }[], next: number, today: string): { date: string; early: string; late: string } | null {
  if (points.length < MILESTONE_MIN_SESSIONS) return null;
  const f = fitTrend(points);
  if (!f || !(f.slope > 0) || !(f.slope - Z80 * f.se > 0)) return null;
  const gap = next - (f.y0 + f.slope * (dayNo(today) - f.x0));
  const at = (slope: number) => Math.max(1, Math.ceil(gap / slope));
  const d = at(f.slope), early = at(f.slope + Z80 * f.se), late = at(f.slope - Z80 * f.se);
  if (late > MAX_DAYS) return null;
  return { date: addDays(today, d), early: addDays(today, early), late: addDays(today, late) };
}

// ---- Sessions a week (owner bug, 2026-10-21) ----

/**
 * Sessions a week over the range's weeks (oldest first, the last the week under way): averaged over the whole weeks from the week
 * of the first logged set on, not the weeks of the range before he logged anything (6 weeks of a log in a 12-week range is 6
 * weeks, not 12). The week under way counts only when it's the only one; `met` counts the same weeks against the goal.
 */
export function sessionsAWeek(weeks: readonly { week: string; sessions: number }[], first: string | null, goal: number): { avg: number; met: number; of: number; weeks: { week: string; sessions: number }[] } {
  const since = first == null ? null : weekStart(first);
  const live = since == null ? weeks.slice(-1) : weeks.filter((w) => w.week >= since);
  const shown = live.length ? live : weeks.slice(-1);
  const whole = shown.slice(0, -1), used = whole.length ? whole : shown;
  return { avg: used.reduce((a, w) => a + w.sessions, 0) / Math.max(1, used.length), met: used.filter((w) => w.sessions >= goal).length, of: used.length, weeks: shown };
}
