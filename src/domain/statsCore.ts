import { addDays, weekStart, weeklyMuscleSets } from './analytics';
import { trend as weightTrend, type BodyDay } from './body';
import { bodyShare } from './learn/bodyweight';
import { decay, type Core } from './learn/capacity';
import { kneeFrom, kneePlan } from './learn/rest';
import { sessionLengths, type Forecast } from './learn/session';
import { liftSimilarity } from './learn/tags';
import { MUSCLES, type Muscle } from './muscles';
import { nextDay, type DayPlan, type Program } from './program';
import { isWorking } from './progression';
import { liftKey } from './ids';
import { e1rm, liftSets, learnable } from './stats';
import { familyOf } from './statsTiles';
import { restSeconds, type RestFrom } from './timing';
import type { SetEntry } from './types';

// Stats v2's last tiles (plan .superpowers/redesign/stats-v2 §4 S4/S5): relative strength, each muscle's weeks against its band,
// the best-set reading beside the core's level, and the learning core's tiles: fatigue per set, the best rest, the next session's
// length, and the lifts that move together. Pure: no profile, no prefs, no clock but the dates passed in. A tile with nothing to
// say, or whose number hasn't passed its gate, gets an empty answer here, and the screen leaves it out.
//
// Evidence labels (00-core): (a) research, cited; (b) learned from his log, by the method named; (c) a neutral default, which
// only shapes a display.

const DAY = 864e5;
const dayNo = (d: string) => Math.round(Date.parse(`${d}T12:00:00Z`) / DAY);
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---- Relative strength (catalogue 43): e1RM ÷ trended body weight ----

/** (c) A weigh-in reads for a session up to this many days after it (never before): an older trend says little about that day. */
export const REL_STALE = 28;
export interface RelPoint { date: string; e1rm: number; bw: number; ratio: number }
export interface RelRow {
  name: string; points: RelPoint[]; now: RelPoint;
  /** The ratio's change over the range, last less first, once they're two weeks apart (null before). */ change: number | null;
}
/**
 * Each lift's e1RM per session (its strength as the tile reads it: the core's level, else the best set) over his body weight's
 * trend that day (body.trend, the smoothed weigh-ins up to it, within REL_STALE days). Lifts whose load is the body are left out:
 * their e1RM isn't in pounds. Empty without a weigh-in to divide by. Owner-only: a friend never sees a body weight.
 */
export function relativeStrength(lifts: readonly { name: string; points: readonly { date: string; v: number }[] }[], body: readonly BodyDay[], from: string, to: string): RelRow[] {
  const t = weightTrend(body.filter((d) => d.date <= to) as BodyDay[]);
  if (!t.length) return [];
  const bwOn = (date: string): number | null => {
    let at: (typeof t)[number] | null = null;
    for (const p of t) { if (p.date > date) break; at = p; }
    return at && dayNo(date) - dayNo(at.date) <= REL_STALE ? at.trend : null;
  };
  return lifts.flatMap((l) => {
    if (bodyShare(l.name) != null) return [];
    const points = l.points.filter((p) => p.date >= from && p.date <= to && p.v > 0).flatMap((p) => {
      const bw = bwOn(p.date);
      return bw ? [{ date: p.date, e1rm: p.v, bw, ratio: p.v / bw }] : [];
    });
    if (!points.length) return [];
    const a = points[0], b = points.at(-1)!;
    return [{ name: l.name, points, now: b, change: dayNo(b.date) - dayNo(a.date) >= 14 ? b.ratio - a.ratio : null }];
  });
}

// ---- Each muscle's weeks against its band (catalogue 13) ----

export interface MuscleWeeks { weeks: string[]; sets: Record<Muscle, number[]> }
/** Fractional sets per muscle each Monday-to-Sunday week from `from`'s week to `to`'s (the last the week under way), as the Muscles tile counts them. */
export function muscleWeeks(entries: readonly SetEntry[], from: string, to: string): MuscleWeeks {
  entries = learnable(entries); // the log without sets marked not used (stats.learnable)
  const weeks: string[] = [];
  for (let w = weekStart(from); w <= weekStart(to); w = addDays(w, 7)) weeks.push(w);
  const sets = Object.fromEntries(MUSCLES.map((m) => [m, [] as number[]])) as Record<Muscle, number[]>;
  for (const w of weeks) {
    const s = weeklyMuscleSets(entries as SetEntry[], w).sets;
    for (const m of MUSCLES) sets[m].push(s[m]);
  }
  return { weeks, sets };
}

export type BandStatus = 'under' | 'within' | 'over';
export const bandStatus = (v: number, [lo, hi]: readonly [number, number]): BandStatus => (v < lo ? 'under' : v > hi ? 'over' : 'within');
export interface MuscleSpan {
  /** The whole weeks read: from the week of the first logged set on, the week under way left out unless it's the only one. */ weeks: number;
  /** Their average a week (null with none), and how many were under, within and over the band. */ avg: number | null; under: number; within: number; over: number;
}
/** A muscle's weeks (MuscleWeeks, oldest first, the last under way) against its band. `first`: the first logged set (weeks before it aren't his). */
export function muscleSpan(weeks: readonly string[], values: readonly number[], band: readonly [number, number], first: string | null): MuscleSpan {
  const since = first == null ? null : weekStart(first);
  const live = values.flatMap((v, i) => (since != null && weeks[i] >= since ? [v] : []));
  const whole = live.length > 1 ? live.slice(0, -1) : live;
  const st = whole.map((v) => bandStatus(v, band));
  return { weeks: whole.length, avg: whole.length ? mean(whole) : null, under: st.filter((s) => s === 'under').length, within: st.filter((s) => s === 'within').length, over: st.filter((s) => s === 'over').length };
}

// ---- The best set beside the core's level (C2's toggle) ----

/** (a) A lift's best set each session over the range by Epley's formula (Epley 1985: stats.e1rm), oldest first: the plain reading. */
export function bestSetPoints(entries: readonly SetEntry[], name: string, from: string, to: string): { date: string; v: number }[] {
  entries = learnable(entries); // the log without sets marked not used (stats.learnable)
  const best = new Map<string, number>();
  for (const e of liftSets(entries, name)) {
    if (e.date < from || e.date > to) continue;
    const v = e1rm(e);
    if (v != null && v > (best.get(e.date) ?? 0)) best.set(e.date, v);
  }
  return [...best].map(([date, v]) => ({ date, v })).sort((a, b) => a.date.localeCompare(b.date));
}

// ---- Fatigue per set (catalogue 17): what the session's earlier sets cost the next one ----

/**
 * The gates a fatigue number passes before it's shown (00-core §9). (a/b) The core recovers A, τ and ρ within a posterior SD on
 * synthetic lifters at 50 sessions, and its pooled per-lift A beats no pooling (learn/capacity.test, the §9 gates): fewer
 * sessions than that, and nothing is shown. (b) A lift is shown once it has a within-session contrast of its own (A_same from its
 * own sets, not only its family's) and its loss at the 3rd set is clear of zero: the 90 % interval, mean − 1.645·SD, above 0.
 */
export const FATIGUE_GATE = { sessions: 50, z: 1.645 } as const;
export interface SetLoss {
  key: string; name: string; sets: number; sessions: number;
  /** Reps the 2nd, 3rd and 4th set lose to the lift's sets before them, at his usual pace; and each one's SD. */ loss: number[]; sd: number[];
}
export interface Fatigue {
  /** His usual time from one set to the next (s, done-time to done-time: Core.gap), the pace the losses are read at. */ gap: number;
  /** Lifts past the gate, the most sets first. */ lifts: SetLoss[];
  /** A set of another lift for the same muscles just before (overlap 1, at his usual gap): its cost in reps, when clear of zero. */ cross: { mean: number; sd: number } | null;
  sessions: number;
}
/**
 * From the capacity equation (learn/capacity, 00-core §1.2): set n of a lift done back to back at his usual gap g loses
 * A_L·Σ_{j<n} K(j·g), K the fitted recovery (ρ + (1 − ρ)·e^(−t/τ)), A_L the lift's pooled A_same at the core's (τ, ρ). The
 * product A·K at his gaps is what his sets identify (his rests sit where τ and ρ trade off), the quantity the §9 gate tests.
 * Null under the gate, or when no lift passes it.
 */
export function fatiguePerSet(core: Core | null): Fatigue | null {
  if (!core || core.sessions < FATIGUE_GATE.sessions) return null;
  const g = core.gap, K = [1, 2, 3].map((j) => decay(core, j * g));
  const sum = [K[0], K[0] + K[1], K[0] + K[1] + K[2]];
  const lifts = [...core.lifts.values()].flatMap((l): SetLoss[] => {
    if (!l.aSameOwn) return [];
    const loss = sum.map((k) => l.aSame.mean * k), sd = sum.map((k) => l.aSame.sd * k);
    return loss[1] - FATIGUE_GATE.z * sd[1] > 0 ? [{ key: l.key, name: l.name, sets: l.sets, sessions: l.sessions, loss, sd }] : [];
  }).sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name));
  if (!lifts.length) return null;
  const cm = core.fit.theta[1] * K[0], cs = core.aCross.sd * K[0];
  return { gap: g, lifts, cross: cm - FATIGUE_GATE.z * cs > 0 ? { mean: cm, sd: cs } : null, sessions: core.sessions };
}

// ---- The best rest (catalogue 34): the learned knee per lift ----

export interface BestRest {
  name: string; sets: number;
  /** The knee at his usual effort (s, as the timer would use it), and its 90 % band. */ seconds: number; lo: number; hi: number;
  /** (a) What the timer gives it without his knee: the research default (timing.restSeconds). */ research: number;
}
/**
 * Each lift's learned rest knee (learn/rest: the rest past which 30 s more buys under a rounding error of a rep), only where it's
 * in use: its 90 % band within ±45 s and its median inside the rests he has timed (KneeRest.use). `names`: the lifts asked about
 * (those done in the range). The most sets first. Empty when none is in use.
 */
export function bestRests(core: Core | null, names: readonly string[], date: string): BestRest[] {
  if (!core || !core.rest.sets || !core.rest.gaps) return [];
  const seen = new Set<string>();
  return names.flatMap((name): BestRest[] => {
    const l = core.lifts.get(liftKey(name));
    if (!l || seen.has(l.key)) return [];
    seen.add(l.key);
    const k = kneeFrom(core, l.name, [{ exercise: l.name, ago: 0 }], { date });
    return k?.use ? [{ name, sets: l.sets, seconds: k.usual, lo: k.lo, hi: k.hi, research: restSeconds(name) }] : [];
  }).sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name));
}

// ---- The next session: at his pace and at the timer's rests (catalogue 33) ----

export interface PlanRest { exercise: string; sets: number; seconds: number; from: RestFrom }
export interface NextSession {
  /** The program day next up and the date it's for (tomorrow once he has trained today). */ name: string; date: string;
  sets: number; lifts: number;
  /** (b) At his pace (learn/session's forecast); the plan's length at the timer's rests (timing.planSeconds), s. */ pace: Forecast; plan: number;
  /** Each lift's rest on the timer and where it comes from: his setting, his knee, or the research default. */ rests: PlanRest[];
}
/**
 * The program's next day (program.nextDay), as long as it takes him (his pace, b) and as long as it should at the timer's rests
 * (owner, 2026-10-20 01:16: predict vs prescribe). Null without a program, or before his pace is known (2 timed days).
 */
export function nextSession(entries: readonly SetEntry[], program: Program | null | undefined, plans: readonly DayPlan[], today: string,
  o: { warmups?: (ex: string) => number; kept?: (ex: string) => number | undefined } = {}): NextSession | null {
  if (!program?.days.length) return null;
  const log = entries as SetEntry[];
  const date = log.some((e) => e.date === today && isWorking(e)) ? addDays(today, 1) : today;
  const day = program.days[nextDay(program, plans, log, date)];
  if (!day?.slots.length) return null;
  const L = sessionLengths(log, date, day.slots, { warmups: o.warmups, kept: o.kept, fresh: true });
  if (!L.pace) return null;
  const knee = kneePlan(log, date);
  const lifted = day.slots.filter((s) => s.minutes == null);
  const rests = lifted.map((s): PlanRest => {
    const kept = o.kept?.(s.exercise), k = knee?.(s.exercise, [{ exercise: s.exercise, ago: 0 }]) ?? null;
    return { exercise: s.exercise, sets: s.sets, seconds: restSeconds(s.exercise, kept, k), from: kept != null && kept > 0 ? 'kept' : k != null ? 'knee' : 'default' };
  });
  return { name: day.name, date, sets: lifted.reduce((n, s) => n + s.sets, 0), lifts: lifted.length, pace: L.pace, plan: L.plan, rests };
}

// ---- Carry-over (catalogue 11): the family layer's ratio between lifts of one movement ----

/**
 * (b) Weeks both lifts of a pair were trained in, over the range, before the pair is shown; and how close its ratio is to the
 * truth: within ±10 % for 9 pairs in 10 or more on synthetic lifters (statsCore.test; RMS error about 4 %). Session-to-session
 * co-movement is not shown: two lifts trained the same day share the day's readiness, and a correlation of their changes read
 * "together" for independent synthetic lifts nearly half the time.
 */
export const CARRY = { min: 8, accuracy: 0.1, z: 1.645 } as const;
export interface CarryPair {
  /** The pair's lift with more sessions (what the other is read against), the other, and their movement. */ base: string; other: string; family: string;
  /** e1RM_other ÷ e1RM_base (the core's fatigue-adjusted levels) in the last week both were trained. */ ratio: number;
  /** How far the weekly ratio wandered over the range: 90 % of weeks within ±this of its mean (ln units, ≈ a share). */ spread: number;
  /** Weeks both were trained in. */ weeks: number;
}
/**
 * The carry-over ratio r_ij = e1RM_j ÷ e1RM_i (00-core §1.1, the family layer; read from his sets, b) for each pair of lifts of
 * one movement (learn/tags: same pattern, similarity above 0), both loaded in pounds, over the weeks in the range both were
 * trained in (each lift's level at its last session that week: readings days apart, inside the 6 weeks the layer allows). Shown
 * with CARRY.min such weeks or more; the steadiest first. A steady ratio is two lifts that climbed and fell as one.
 */
export function movesTogether(core: Core | null, from: string, to: string): CarryPair[] {
  if (!core) return [];
  const weekly = new Map<string, { name: string; sessions: number; at: Map<string, number> }>();
  for (const l of core.lifts.values()) {
    if (l.unit !== 'lb') continue;
    const at = new Map<string, number>();
    for (const p of l.level) if (p.date >= from && p.date <= to) at.set(weekStart(p.date), p.x); // oldest first: the week's last wins
    if (at.size >= CARRY.min) weekly.set(l.key, { name: l.name, sessions: l.sessions, at });
  }
  const ls = [...weekly.values()];
  const out: CarryPair[] = [];
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
    const [B, O] = ls[i].sessions > ls[j].sessions || (ls[i].sessions === ls[j].sessions && ls[i].name.localeCompare(ls[j].name) <= 0) ? [ls[i], ls[j]] : [ls[j], ls[i]];
    const fam = familyOf(B.name);
    if (!fam || fam !== familyOf(O.name) || !(liftSimilarity(B.name, O.name) > 0)) continue;
    const both = [...B.at.keys()].filter((w) => O.at.has(w)).sort();
    if (both.length < CARRY.min) continue;
    const r = both.map((w) => O.at.get(w)! - B.at.get(w)!);
    out.push({ base: B.name, other: O.name, family: fam, ratio: Math.exp(r.at(-1)!), spread: CARRY.z * sd(r), weeks: both.length });
  }
  return out.sort((x, y) => x.spread - y.spread || x.base.localeCompare(y.base) || x.other.localeCompare(y.other));
}

/** The sample SD (n − 1); 0 for fewer than two. */
const sd = (xs: readonly number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
