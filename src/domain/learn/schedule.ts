import { SESSION_CAP, weekStart, weeklyMuscleSets } from '../analytics';
import { isCardioEntry } from '../cardio';
import { MUSCLES, muscleVector, type Muscle } from '../muscles';
import { cycleDone, nextDay, type Program, type Slot } from '../program';
import { targetFor, type Profile, type Tier } from '../profile';
import type { SetEntry } from '../types';
import { BREAK_DAYS, LIGHT, LIGHT_DAYS, lightWeek, systemic } from './deload';
import { applyPlan, dayLabel, readiness, readinessModel, weekOf, type Evidence, type Readiness, type ReadinessInput, type ReadinessModel, type SessionReady, type Week } from './readiness';
import { P_FRESH } from './recovery';
import { fitReminder } from './remind';
import { planAims, volumeAdvice, type PlanAim } from './volume';

// Gym readiness S3: the week's plan (20-readiness-plan §3.3, with the owner's answers, §9: Q1 the weekly goal is the limit, never
// raised; Q2 by the DAY only, no clock time anywhere; Q3 program days may be reordered; Q4 usual days are a tie-break only).
// Domain only; the week strip is S4.
//
// Rolling: every call plans from today to the end of the week (Monday–Sunday, analytics.weekStart), so what he did, missed or
// moved is in the next plan. It searches every train/rest pattern of the days left (2^days ≤ 128) and ranks them, in order:
//   1. The weekly goal: the sessions still needed, never more (owner Q1), or every day left when the goal is out of reach.
//   2. Volume: Σ priority weight · √(each muscle's fractional sets this week), each session counted up to SESSION_CAP and the week
//      up to the muscle's +20 % aim (learn/volume.planAims). This picks WHICH sessions; recovery never trades volume away.
//   3. Σ Ready over the sessions (learn/readiness, S2), each on its whole-set grid: which days, and in which order (owner Q3).
//   4. Availability: Σ over the training days of P(he trains on that weekday) (learn/remind), a tie-break only (owner Q4).
//   Exact ties: the earlier day (c: the plans tied are equal on every count).
// Rest is never chosen at the goal's cost: tier 1 fixes how many days train before Ready is looked at, and readiness.verdictOf
// shows Rest only with a spare day.
// Today rests for recovery only when waiting gains at least REST_GAIN (one) set at full strength over the week, counted unrounded
// (owner, S4): the best plan that trains today is taken otherwise. The whole-set grid alone would rest today for 0.2 of a set
// that happens to round up.
//
// Evidence labels: (a) research, cited; (b) learned from his log, by the method named; (c) a neutral default that takes no action.
// - (a) The goal first, and no more than it: weekly volume drives growth and strength (Pelland 2026), and with volume equated more
//   or fewer sessions makes no detectable difference (Schoenfeld, Grgic & Krieger 2019; Boutagy & McKean 2026).
// - (a) √: Pelland 2026's best-fitting volume–hypertrophy curve is a square root of fractional sets (an indirect set ½).
//   SESSION_CAP 11 is a spreading rule (Remmert 2025 preprint, W; Boutagy & McKean 2026 find no per-session split effect): no
//   text here says sets past it are wasted. The +20 % aim (Scarpelli 2022; Barsuhn 2025: more added nothing), learn/volume's.
//   The weights are his priorities as the program builder weighs them (program.ts: P1 4, P2 3, P3 2), priority 4 none (plan:
//   P4 = 0, its range is 0).
// - (a) Ready (learn/readiness): recovery per muscle (Raastad & Hallén 2000; Morán-Navarro 2017; Vieira 2022), pain risk (b).
//   Each day's Ready reads the log before today: a session planned earlier in the week isn't counted against a later one. A
//   planned set isn't to failure (an unlogged set's rule in learn/recovery: his habit, RIR 2, Robinson 2024), and work short of
//   failure is back to baseline within 3–6 h (Raastad & Hallén 2000; Morán-Navarro 2017's 3×5 and 6×5), so by the next day.
// - (c) Ready is compared in whole sets: each session's Ready as round(Ready · its sets) of its sets (readyOnSetGrid), the "N of M
//   sets at full strength" its readout shows. A day that reads a fraction of a set fresher shows the same N of M and counts as
//   equal: no evidence for a day's wait or a reordered program, so the ties decide (today, then his usual days, then the earlier).
// - (c) Pain risk is read as of today on every day of the week: the week adds no pain evidence, and the risk's fade over a few days
//   is evidence ageing (learn/pain), not healing; read by date it would push every session to the week's end by a point or two.
// - (b) Availability: learn/remind's P(he trains on that weekday in a week he trains), the Beta-binomial per weekday weighed
//   against one rate for all days by Bayes factor. With no fit, every day ½ (c). Today counts as 1 (a): he is here, and a day he
//   can train isn't given up for his usual weekday: flexible timing beat a fixed schedule (Beshears 2021), and a missed usual
//   day did not set the habit back (Lally 2010). So a tie never rests today: by weekday rates alone, every week with a spare day
//   would say "Rest today" on all but his likeliest days. His usual days still order the days ahead.
// - (a) A layoff (deload.BREAK_DAYS or more since he trained, or never): today trains (Coleman 2024: a week off unloads).
// - (a) A deload suggested or a light week on (learn/deload): its days train light, half the sets (Bell 2025); the plan still
//   meets the goal (a deload cuts volume and load, not sessions), and the light week's cut is shown, not planned around.

/** (plan §3.3) The most train/rest patterns searched: every pattern of a whole week (2^7). */
export const MAX_PATTERNS = 128;
/** The volume score's weight per priority: the program builder's (program.ts), priority 4 none (plan §0: P4 = 0). */
export const PRIORITY_WEIGHT: Record<Tier, number> = { 1: 4, 2: 3, 3: 2, 4: 0 };
/**
 * (c) A session's Ready as the planner compares it: on its whole-set grid, round(Ready · sets / 100) of its sets as a percent,
 * an integer (see the header). Null as Ready is.
 */
export function readyOnSetGrid(r: Pick<SessionReady, 'ready' | 'total'>): number | null {
  if (r.ready == null || !(r.total > 0)) return r.ready;
  return Math.round((Math.round((r.ready * r.total) / 100) * 100) / r.total);
}
/**
 * (owner, S4) Today rests for recovery only if the week's plan gains at least this many sets at full strength by waiting (the
 * expected sets, Σ sets · P(full strength) · (1 − pain risk), unrounded); else the best plan that trains today stands.
 */
export const REST_GAIN = 1;
/**
 * Expected sets at full strength as Ready counts them (pain-weighted), unrounded: Ready · sets. (Ready is a whole percent, so this
 * is within half a hundredth of a set per set of Σ sets · P(full) · (1 − pain).)
 */
export const fullSets = (r: Pick<SessionReady, 'ready' | 'total'>): number => (r.ready == null ? 0 : (r.ready * r.total) / 100);
/** Numerics: equal volume or availability within this. */
const EPS = 1e-9;

// ---- The search (pure) ----------------------------------------------------------------------------------------------------

type Vol = Partial<Record<Muscle, number>>;

/** What the search reads: sessions are indices into `vol`; days are 0 (today) … days − 1. */
export interface PlanFacts {
  /** Days left in the week, today first (1–7). */
  days: number;
  /** Training days to plan: the goal's sessions still needed (never more), or every day left; at least 1 when he trained today. */
  sessions: number;
  /** Days that must train, a bit per day (bit 0 today): he trained today, or a layoff. */
  forced: number;
  /** Each session's fractional sets per muscle (each capped at SESSION_CAP). */
  vol: readonly Vol[];
  /** The days left in the current cycle and a whole cycle (session indices, program order); today's session when fixed (trained). */
  left: readonly number[]; all: readonly number[]; fixed: number | null;
  /** The week's volume so far (today's fixed session in it), each muscle's weight and cap (its aim). */
  base: Vol; weight: Vol; cap: Vol;
  /** Ready (0–100) of session s on day d; null counts 0. */
  ready(s: number, d: number): number | null;
  /** P(he trains on day d): the tie-break. */
  avail: readonly number[];
}
export interface PlanScore { sessions: number; volume: number; ready: number; availability: number }
export interface PlanPick {
  /** Training days, a bit per day. */
  mask: number;
  /** The session on each day (null: a rest day, or a training day with no session to put there). */
  order: (number | null)[];
  score: PlanScore;
}
export type Tier4 = 'sessions' | 'volume' | 'ready' | 'availability' | 'tie';
export interface PlanSearch {
  best: PlanPick;
  /** Per day, the best plan that trains on it, and the best that rests it (null: none can), for each day's reason. */
  bestWith: (PlanPick | null)[]; bestWithout: (PlanPick | null)[];
  /** Patterns enumerated (2^days ≤ MAX_PATTERNS) and scored (those with the goal's training days and every forced day). */
  patterns: number; scored: number;
  /** Session choices (which sessions this week) considered, and kept at the best volume. */
  options: number; kept: number;
}

const popcount = (x: number) => { let n = 0; for (; x; x &= x - 1) n++; return n; };
/** The plan whose first differing training day is earlier. */
const earlier = (a: number, b: number) => { const x = a ^ b; return x !== 0 && (a & (x & -x)) !== 0; };

/** The first count on which `a` and `b` differ, as the ranking reads them. */
export function decidedBy(a: PlanPick, b: PlanPick): Tier4 {
  if (a.score.sessions !== b.score.sessions) return 'sessions';
  if (Math.abs(a.score.volume - b.score.volume) > EPS) return 'volume';
  if (a.score.ready !== b.score.ready) return 'ready';
  if (Math.abs(a.score.availability - b.score.availability) > EPS) return 'availability';
  return 'tie';
}
/** Whether `a` ranks above `b` (lexicographic, then the earlier day). */
export function ranksAbove(a: PlanPick, b: PlanPick | null): boolean {
  if (!b) return true;
  switch (decidedBy(a, b)) {
    case 'sessions': return a.score.sessions > b.score.sessions;
    case 'volume': return a.score.volume > b.score.volume;
    case 'ready': return a.score.ready > b.score.ready;
    case 'availability': return a.score.availability > b.score.availability;
    default: return earlier(a.mask, b.mask);
  }
}

function subsets<T>(xs: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (i: number, cur: T[]) => {
    if (cur.length === k) { out.push([...cur]); return; }
    for (let j = i; j <= xs.length - (k - cur.length); j++) { cur.push(xs[j]); rec(j + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return out;
}

/**
 * The ways to fill `k` sessions in cycle order: blocks that must come in order (each day once a cycle; program.cycleDone closes a
 * cycle when a day repeats). Fewer than the cycle's days left: any `k` of them. More: all of them, whole cycles, then any of a
 * cycle for the rest.
 */
export function sessionOptions(left: readonly number[], all: readonly number[], k: number): number[][][] {
  if (k <= 0 || !all.length) return [[]];
  if (k <= left.length) return subsets(left, k).map((s) => [s]);
  const base: number[][] = left.length ? [[...left]] : [];
  let rest = k - left.length;
  while (rest >= all.length) { base.push([...all]); rest -= all.length; }
  return rest ? subsets(all, rest).map((s) => [...base, s]) : [base];
}

export function volumeScore(f: Pick<PlanFacts, 'vol' | 'base' | 'weight' | 'cap'>, sessions: readonly number[]): number {
  const v: Vol = { ...f.base };
  for (const s of sessions) for (const [m, x] of Object.entries(f.vol[s]) as [Muscle, number][]) v[m] = (v[m] ?? 0) + x;
  let score = 0;
  for (const m of MUSCLES) {
    const w = f.weight[m] ?? 0;
    if (w > 0) score += w * Math.sqrt(Math.min(v[m] ?? 0, f.cap[m] ?? 0));
  }
  return score;
}

/** Every pattern scored (see the header); the best, and the best that trains on each day. */
export function searchWeek(f: PlanFacts): PlanSearch {
  const D = f.days, T = Math.min(f.sessions, D);
  if (D < 1 || D > 7) throw new Error(`days left must be 1–7, not ${D}`);
  const k = T - (f.fixed != null ? 1 : 0);
  // Tier 2: which sessions, the same for every pattern (it reads no day).
  const opts = sessionOptions(f.left, f.all, k).map((blocks) => ({ blocks, volume: volumeScore(f, blocks.flat()) }));
  const top = opts.reduce((a, o) => Math.max(a, o.volume), -Infinity);
  const kept = opts.filter((o) => o.volume >= top - EPS);
  // Ready lookups, once each.
  const R = new Map<number, number>();
  const ready = (s: number, d: number) => { const key = s * 8 + d; let r = R.get(key); if (r === undefined) R.set(key, r = f.ready(s, d) ?? 0); return r; };

  const patterns = 1 << D;
  let best: PlanPick | null = null, scored = 0;
  const bestWith: (PlanPick | null)[] = Array(D).fill(null), bestWithout: (PlanPick | null)[] = Array(D).fill(null);
  for (let mask = 0; mask < patterns; mask++) {
    if (popcount(mask) !== T || (mask & f.forced) !== f.forced) continue;
    if (f.fixed != null && !(mask & 1)) continue;
    scored++;
    const free: number[] = [];
    for (let d = 0; d < D; d++) if (mask & (1 << d) && !(d === 0 && f.fixed != null)) free.push(d);
    let pick: PlanPick | null = null;
    for (const o of kept) {
      const order: (number | null)[] = Array(D).fill(null);
      if (f.fixed != null) order[0] = f.fixed;
      let sum = f.fixed != null ? ready(f.fixed, 0) : 0, at = 0;
      for (const block of o.blocks) {
        // The block's best assignment to its days (a DP over which of its sessions are placed; ties keep program order first).
        const n = block.length, pos = free.slice(at, at + n), N = 1 << n;
        const dp = new Float64Array(N).fill(-Infinity), from = new Int32Array(N).fill(-1);
        dp[0] = 0;
        for (let m = 0; m < N; m++) {
          if (dp[m] === -Infinity) continue;
          const p = pos[popcount(m)];
          for (let j = 0; j < n; j++) {
            if (m & (1 << j)) continue;
            const v = dp[m] + ready(block[j], p);
            if (v > dp[m | (1 << j)]) { dp[m | (1 << j)] = v; from[m | (1 << j)] = j; }
          }
        }
        sum += dp[N - 1];
        for (let m = N - 1; m; m &= ~(1 << from[m])) order[pos[popcount(m) - 1]] = block[from[m]];
        at += n;
      }
      const availability = [...Array(D).keys()].reduce((a, d) => a + (mask & (1 << d) ? f.avail[d] : 0), 0);
      const p: PlanPick = { mask, order, score: { sessions: T, volume: o.volume, ready: sum, availability } };
      if (!pick || p.score.ready > pick.score.ready) pick = p;
    }
    if (!pick) continue;
    if (ranksAbove(pick, best)) best = pick;
    for (let d = 0; d < D; d++) {
      const own = mask & (1 << d) ? bestWith : bestWithout;
      if (ranksAbove(pick, own[d])) own[d] = pick;
    }
  }
  if (!best) {
    // No pattern meets the forced days (none can, with T fixed by the goal): every forced day trains, nothing else.
    const order: (number | null)[] = Array(D).fill(null);
    if (f.fixed != null) order[0] = f.fixed;
    best = { mask: f.forced, order, score: { sessions: popcount(f.forced), volume: volumeScore(f, []), ready: 0, availability: 0 } };
  }
  return { best, bestWith, bestWithout, patterns, scored, options: opts.length, kept: kept.length };
}

// ---- The plan --------------------------------------------------------------------------------------------------------------

export interface PlanInput extends ReadinessInput {
  /** His priorities and ranges (as Stats shows them, fitted targets in): the volume tier and the gaps. */
  profile: Profile;
}
export interface PlanSession {
  /** A program day, or the quick day (only with no program). */
  kind: 'program' | 'quick';
  day: number | null; name: string; slots: Slot[];
}
export type RestKind = 'goal-met' | 'recovering' | 'usual' | 'spare';
export interface RestReason {
  /**
   * 'goal-met': no more sessions are needed by this day; 'recovering': training here instead would read less ready (its main
   * muscles named, with the day they are fresh by); 'usual': it is less likely one of his days than the days planned; 'spare': a
   * day the goal doesn't need, equal on every count.
   */
  kind: RestKind;
  label: string;
  muscles?: Muscle[]; freshBy?: string | null;
}
export interface PlanDay {
  date: string;
  /** "today", "tomorrow" or the weekday: never a clock time. */
  label: string;
  train: boolean;
  /** Why a training day is fixed: he trained today, or a layoff; null when the planner chose it. */
  fixed: 'trained' | 'layoff' | null;
  /** The session (training days; null with nothing to plan from: no program and no quick day). */
  session: PlanSession | null;
  /** Its Ready that day, and its sets at full strength (learn/readiness); null on a rest day or with no session. */
  ready: SessionReady | null;
  /** A deload or light week's day: train it light (half the sets). */
  light: boolean;
  rest: RestReason | null;
}
export interface PlanVolume {
  muscle: Muscle; tier: Tier;
  band: [number, number];
  /** What the plan aims at this week (learn/volume.planAims) and where it came from. */
  aim: [number, number]; from: PlanAim['from'];
  /** Fractional sets this week before today, and with the plan done (a light day's at half). */
  done: number; planned: number;
  /** Sets still under the band's low end with the plan done. */
  gap: number;
}
export interface WeekPlan {
  today: string;
  days: PlanDay[];
  /** Whether today trains in the best plan: readiness's `todayInPlan`. */
  todayInPlan: boolean;
  week: Week;
  /** The plan's counts, tier by tier (sessions, volume score, Σ Ready, Σ availability). */
  score: PlanScore;
  /**
   * When the best plan rested today for recovery: the sets at full strength (unrounded) waiting gains over the best plan that
   * trains today, and whether that was under REST_GAIN so today trains after all (`held`). Null when today wasn't rested so.
   */
  restGain: { sets: number; held: boolean } | null;
  patterns: number; scored: number;
  volume: PlanVolume[];
  evidence: Evidence[];
}

const DAY = 864e5;
const addD = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const isLiftSession = (e: SetEntry) => !e.flags.includes('warmup') && !isCardioEntry(e);

/** Fractional sets per muscle of a day's slots, each muscle capped at SESSION_CAP (a: Remmert, as Stats counts a session). */
export function slotVolume(slots: readonly Slot[]): Vol {
  const v: Vol = {};
  for (const s of slots) {
    if (s.minutes != null) continue;
    for (const [m, x] of Object.entries(muscleVector(s.exercise) ?? {}) as [Muscle, number][]) v[m] = (v[m] ?? 0) + x * s.sets;
  }
  for (const m of Object.keys(v) as Muscle[]) v[m] = Math.min(v[m]!, SESSION_CAP);
  return v;
}

/** `trained`: he has trained today (the goal is met today, not by today's session still to come). */
const restLabel = (r: Omit<RestReason, 'label'>, today: string, by?: string, trained = false): string => {
  switch (r.kind) {
    case 'goal-met': return !by ? 'Goal met' : by === today ? (trained ? 'Goal met today' : 'Goal met with today’s session') : `Goal met by ${dayLabel(by, today)}`;
    case 'recovering': {
      const ms = r.muscles ?? [];
      if (!ms.length || !r.freshBy) return 'Recovering: fresher later this week';
      const names = ms.length > 3 ? `${ms.slice(0, 3).join(', ')} …` : ms.join(', ');
      return `Recovering: ${names} fresh by ${dayLabel(r.freshBy, today)}`;
    }
    case 'usual': return 'Less usual for you than the days planned';
    default: return 'Spare day';
  }
};

/**
 * The week's plan from today (see the header). Throws only on a malformed input; readinessPlanned never does. `model`: the
 * readiness model to read Ready from (default learn/readiness's for today; a test can hold Ready flat to see what it moves).
 */
export function planWeek(input: PlanInput, model: Pick<ReadinessModel, 'sessionReady' | 'recovery'> = readinessModel(input.entries, input.body, input.today, input.tz)): WeekPlan {
  const { entries, body, today, tz, profile } = input;
  const week = weekOf(entries, input.weeklyGoal, today);
  const D = week.daysLeft;
  const dates = Array.from({ length: D }, (_, d) => addD(today, d));

  // Facts about today: trained (a lift set logged today, as weekOf counts a session), a layoff.
  const trained = entries.some((e) => e.date === today && isLiftSession(e));
  let last: string | null = null;
  for (const e of entries) if (e.date < today && isLiftSession(e) && e.reps != null && e.reps > 0 && (!last || e.date > last)) last = e.date;
  const sinceLast = last ? daysBetween(last, today) : null;
  const layoff = sinceLast == null || sinceLast >= BREAK_DAYS;
  const T = Math.max(Math.min(week.needed, D), trained ? 1 : 0);
  const forced = trained || (layoff && T > 0) ? 1 : 0;

  // Sessions: the program's days (cycle order), or the quick day with no program; today's when he has trained today.
  const p: Program | null = input.program?.days.length ? input.program : null;
  const stored = input.plans.find((x) => x.date === today);
  const sessions: PlanSession[] = p
    ? p.days.map((d, i) => ({ kind: 'program' as const, day: i, name: d.name, slots: d.slots }))
    : input.quick?.length ? [{ kind: 'quick', day: null, name: 'Quick', slots: input.quick }] : [];
  const all = sessions.map((_, i) => i);
  let left: number[] = [];
  let fixed: number | null = null;
  if (p) {
    const done = cycleDone(p, input.plans, entries, today);
    left = all.filter((i) => !done.has(i));
    if (trained) {
      if (stored?.quick != null) {
        sessions.push({ kind: 'quick', day: null, name: 'Quick', slots: stored.slots ?? [] });
        fixed = sessions.length - 1;
      } else {
        const day = stored && stored.day < p.days.length ? stored.day : nextDay(p, input.plans, entries, today);
        // Today's session as opened (its skips and swaps); its day leaves the cycle, and a day done already this cycle starts a
        // new one (program.cycleDone).
        sessions.push({ ...sessions[day], slots: stored && stored.day === day ? applyPlan(stored.slots ?? p.days[day].slots, stored) : p.days[day].slots });
        fixed = sessions.length - 1;
        left = left.includes(day) ? left.filter((i) => i !== day) : all.filter((i) => i !== day);
      }
    }
  } else if (trained && sessions.length) fixed = 0;
  const slotsOf = (s: number, d: number): Slot[] => {
    const x = sessions[s];
    // Today's opened plan (its skips and swaps) for today's session.
    if (d === 0 && s !== fixed && stored && stored.quick == null && x.kind === 'program' && stored.day === x.day) return applyPlan(stored.slots ?? x.slots, stored);
    return x.slots;
  };
  const vol = sessions.map((x) => slotVolume(x.slots));

  // Volume this week before today (each day capped, as Stats), today's fixed session at what's planned or logged, whichever is more.
  const before = weeklyMuscleSets(entries.filter((e) => e.date < today) as SetEntry[], weekStart(today)).sets;
  const loggedToday = trained ? weeklyMuscleSets(entries.filter((e) => e.date === today) as SetEntry[], weekStart(today)).sets : null;
  const base: Vol = {};
  for (const m of MUSCLES) {
    const t = fixed != null ? Math.max(vol[fixed][m] ?? 0, loggedToday?.[m] ?? 0) : loggedToday?.[m] ?? 0;
    base[m] = before[m] + t;
  }
  let aims: Record<Muscle, PlanAim>;
  try { aims = planAims(volumeAdvice(entries, body, profile, today, input.tapped), profile); } catch { aims = planAims(null, profile); }
  const weight: Vol = {}, cap: Vol = {};
  for (const m of MUSCLES) { weight[m] = PRIORITY_WEIGHT[profile.tiers[m]]; cap[m] = aims[m].plan[1]; }

  // Ready of each session on each day, pain as of today (see the header); availability by weekday.
  const SR = new Map<number, SessionReady>();
  const srOf = (s: number, d: number): SessionReady => {
    const key = s * 8 + d;
    let r = SR.get(key);
    if (!r) SR.set(key, r = model.sessionReady(slotsOf(s, d), dates[d], { painAt: today }));
    return r;
  };
  let avail: number[] = dates.map(() => 0.5);
  let availLearned = false;
  try {
    const fit = fitReminder(entries, today, tz);
    if (fit.dates > 0) { avail = dates.map((d) => fit.days[weekday(d)].p); availLearned = true; }
  } catch { /* (c) every day ½ */ }
  // Today he is here: a day he can train, whatever its weekday's rate (see the header).
  avail[0] = 1;

  const facts: PlanFacts = {
    days: D, sessions: T, forced, vol, left, all, fixed, base, weight, cap, avail,
    ready: (s, d) => readyOnSetGrid(srOf(s, d)),
  };
  const search = searchWeek(facts);
  // Owner (S4): rest today for recovery only for a whole set or more at full strength, unrounded.
  const pickSets = (x: PlanPick) => x.order.reduce<number>((a, s, d) => (s != null && x.mask & (1 << d) ? a + fullSets(srOf(s, d)) : a), 0);
  let best = search.best;
  let restGain: WeekPlan['restGain'] = null;
  const trainToday = search.bestWith[0];
  if (!(best.mask & 1) && trainToday && decidedBy(best, trainToday) === 'ready') {
    const sets = pickSets(best) - pickSets(trainToday);
    restGain = { sets, held: sets < REST_GAIN };
    if (restGain.held) best = trainToday;
  }

  // Light days: a light week on, or a deload suggested today (its week from today).
  let lw: { from: string; to: string } | null = null, deload = false;
  try { lw = lightWeek(entries, today, input.tapped); deload = systemic(entries, body, today, input.tapped)?.verdict === 'deload'; } catch { /* a refinement */ }
  const isLight = (d: number) => (lw != null && dates[d] >= lw.from && dates[d] <= lw.to) || (deload && d < LIGHT_DAYS);

  const lastTrain = dates.reduce<number>((a, _, d) => (best.mask & (1 << d) ? d : a), -1);
  const days: PlanDay[] = dates.map((date, d) => {
    const train = (best.mask & (1 << d)) !== 0;
    const s = best.order[d];
    const base = { date, label: dayLabel(date, today), train, light: train && isLight(d) };
    if (train) {
      return { ...base, fixed: d === 0 && trained ? 'trained' : d === 0 && forced ? 'layoff' : null, session: s == null ? null : sessions[s], ready: s == null ? null : srOf(s, d), rest: null };
    }
    let r: Omit<RestReason, 'label'>;
    let by: string | undefined;
    const alt = search.bestWith[d];
    if (T === 0 || d > lastTrain || !alt) { r = { kind: 'goal-met' }; by = lastTrain >= 0 && T > 0 ? dates[lastTrain] : undefined; }
    else {
      const t = decidedBy(best, alt);
      if (t === 'ready') {
        const s2 = alt.order[d];
        const sr = s2 == null ? null : srOf(s2, d);
        const muscles = sr && model.recovery ? sr.muscles.filter((m) => model.recovery!.pRecovered(m, date) <= P_FRESH) : [];
        r = { kind: 'recovering', muscles, freshBy: sr?.freshBy ?? null };
      } else r = { kind: t === 'availability' ? 'usual' : 'spare' };
    }
    return { ...base, fixed: null, session: null, ready: null, light: false, rest: { ...r, label: restLabel(r, today, by, trained) } };
  });

  // The volume table: done, planned (a light day's sets at LIGHT.volume) and the gap to each band.
  const volume: PlanVolume[] = MUSCLES.map((m) => {
    let planned = before[m];
    days.forEach((x, d) => {
      const s = best.order[d];
      if (!x.train) return;
      const v = s == null ? (d === 0 && loggedToday ? loggedToday[m] : 0) : d === 0 && s === fixed ? base[m]! - before[m] : vol[s][m] ?? 0;
      planned += v * (x.light ? LIGHT.volume : 1);
    });
    const band = targetFor(profile, m);
    return { muscle: m, tier: profile.tiers[m], band, aim: aims[m].plan, from: aims[m].from, done: before[m], planned, gap: Math.max(0, band[0] - planned) };
  });

  const restDays = days.filter((x) => !x.train);
  const evidence: Evidence[] = [
    { rule: 'Sessions: the weekly goal, never more', kind: 'research', cite: 'Pelland 2026 (weekly volume dose-response); Schoenfeld, Grgic & Krieger 2019 and Boutagy & McKean 2026 (frequency adds nothing detectable at equal volume); owner Q1', acts: true },
    {
      rule: 'Which sessions: the most volume by priority, each session up to 11 sets a muscle, the week up to its +20% aim', kind: 'research',
      cite: 'Pelland 2026 (√ of fractional sets); Remmert 2025 (11 a session, a spreading rule, W; Boutagy & McKean 2026: no split effect); Scarpelli 2022, Barsuhn 2025 (the +20% aim); weights: your priorities (P4 none)',
      acts: search.kept < search.options,
    },
    {
      rule: 'Rest today for recovery only for a whole set or more', kind: 'research',
      cite: `owner (S4): waiting must gain ${REST_GAIN} set at full strength, unrounded; Pelland 2026 (a session missed is weekly volume lost)`,
      acts: restGain != null && restGain.held,
    },
    {
      rule: 'Which days: the most sets at full strength', kind: 'research', cite: 'learn/readiness: Raastad & Hallén 2000; Morán-Navarro 2017; Vieira 2022 (recovery per muscle)',
      acts: restDays.some((x) => x.rest?.kind === 'recovering'),
    },
    availLearned
      ? { rule: 'Ties: your usual days', kind: 'learned', method: 'learn/remind: P(you train on that weekday in a week you train), per weekday, faded, weighed against one rate for all days', acts: restDays.some((x) => x.rest?.kind === 'usual') }
      : { rule: 'Ties: your usual days', kind: 'default', method: 'nothing logged to learn your days from: every day alike', acts: false },
    {
      rule: 'Today counts as a day you can train', kind: 'research', cite: 'Beshears 2021 (flexible timing beat a fixed schedule); Lally 2010 (a missed usual day did not set the habit back)',
      acts: (best.mask & 1) !== 0 && !forced && search.bestWithout[0] != null && decidedBy(best, search.bestWithout[0]) === 'availability',
    },
    { rule: 'Days differ by whole sets', kind: 'default', method: 'Ready compared on each session’s set grid: a day a fraction of a set fresher shows the same “N of M sets at full strength”, and counts as equal', acts: false },
    { rule: 'Exact ties: the earlier day', kind: 'default', method: 'the plans it picks between are equal on every count', acts: false },
    { rule: 'Pain risk as of today on every day', kind: 'default', method: 'the week adds no pain evidence; its fade is evidence ageing, not healing', acts: false },
    { rule: 'A planned session leaves no deficit by the next day', kind: 'research', cite: 'Raastad & Hallén 2000; Morán-Navarro 2017 (short of failure: back within 3–6 h); Robinson 2024 (your habit, 2 in reserve)', acts: false },
    { rule: `A layoff of ${BREAK_DAYS}+ days: today trains`, kind: 'research', cite: 'Coleman 2024 (a week off cost no muscle); Rogerson 2024; Bell 2025', acts: layoff && T > 0 && !trained },
    { rule: 'A deload or light week: its sessions light, the goal kept', kind: 'research', cite: 'Bell 2025 (deloads cut volume and load, about half the sets, for 5–7 days); learn/deload', acts: days.some((x) => x.light) },
  ];

  return {
    today, days, todayInPlan: (best.mask & 1) !== 0, week, score: best.score, restGain, patterns: search.patterns, scored: search.scored, volume, evidence,
  };
}

/**
 * The day's readiness with the planner's answer fed in (readiness `todayInPlan`), and the plan. The planner is a refinement: if it
 * fails, the readiness is S2's with no planner (never Rest) and the plan is null.
 */
export function readinessPlanned(input: PlanInput): Readiness & { plan: WeekPlan | null } {
  let plan: WeekPlan | null = null;
  try { plan = planWeek(input); } catch { plan = null; }
  return { ...readiness({ ...input, todayInPlan: plan ? plan.todayInPlan : undefined }), plan };
}

