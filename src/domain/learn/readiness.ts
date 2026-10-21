import { weekStart } from '../analytics';
import type { BodyDay } from '../body';
import { isCardio, isCardioEntry } from '../cardio';
import { resolveLift } from '../lifts';
import type { Muscle } from '../muscles';
import { cycleDone, nextDay, type DayPlan, type Program, type Slot } from '../program';
import { perLog } from '../stats';
import type { SetEntry } from '../types';
import { aheadVar, READY, type Core, type Est } from './capacity';
import { BREAK_DAYS, lightWeek, systemic, type Systemic } from './deload';
import { coreBefore, logBefore } from './index';
import { betaCdf, normCdf } from './num';
import { painRisk } from './pain';
import { recoveryOf, type RecoveryFit } from './recovery';

// Gym readiness S2: the day's number and verdict (20-readiness-plan §3.2, as amended by S0, 20-readiness §6, and the owner's
// answers, plan §9: by the DAY only; no clock time is ever shown). Domain only; the planner is S3, the tile S4.
//
// Evidence labels: (a) research, cited; (b) learned from his log, by the method named; (c) a neutral default that takes no action.
// Every rule below carries one, and `evidence` lists them for the Why sheet.
//
// Ready(S), 0–100, for a candidate session S on a date: the mean over its working sets of P(full strength) × (1 − pain risk).
// - Full strength (a: READY, 3 %, a day's readiness: Grgic 2020's 1RM test–retest CV, learn/capacity): the set's lift carries a
//   deficit from earlier sessions below 3 % of e1RM at the date's reference time (learn/recovery, internal, never shown).
// - The lift's deficit reads its muscles' (learn/recovery): D_L = Σ_m u_m·D_m, u = v/Σv² (a set of the same lift reads back its
//   own deposit; another lift's at the muscle overlap). Each D_m is learn/recovery's mixture over (φ, τ′) cells, φ shared by the
//   muscles (one fit per φ), τ′ independent between muscles given φ (S1's pooled posterior is mean-field), β one scale (its cell
//   posteriors combined by each muscle's share of the deficit). With one muscle it is exactly learn/recovery's P(recovered).
// - Pain risk (b): learn/pain's P(the lift hurts at its session that day): a hierarchical rate per lift, family and region,
//   faded by a learned half-life. A set that may hurt is not a set at full strength. Until he has flagged pain at least once the
//   risk is learn/pain's uniform prior alone ((A + 1)/(N + 2): ½ on day one), not evidence, so it takes no action (c).
// - Energy (b, display-only until it is proven): the slope of his session residual (each lift's reading of its level against its
//   prediction from its other sessions, learn/capacity's level filters, both sides) on energy − his usual, by weighted least
//   squares, Birge-scaled (a: Birge 1932). It acts only once its 90 % interval excludes 0 (a Student t interval, n − 2 df): then
//   the day's predicted shift, b·(energy − usual) with its SD, moves the full-strength line. Before that, single-item wellness
//   has no validation for resistance training (a: Saw 2016; Laurent 2011), so it moves nothing.
// Ready is the best candidate's: the program's next day and any program day not yet done this cycle; the quick day only with no
// program (S3: else the small quick day, aimed at fresh muscles, is nearly always "best" and the program never is).
//
// Verdicts, by day (owner Q2): checked in this order.
// - After a layoff of BREAK_DAYS or more (or no training yet): Go today, always (a: deload.BREAK_DAYS: a week off unloads).
// - The weekly goal met already: "Goal met · extra session optional", a Go, never Rest (owner, S4: his goal is size, and extra
//   weekly volume only helps it: a: Pelland 2026's weekly volume dose-response). The planner's rest reasons stay on the days ahead.
// - Rest today: only when the planner (S3, learn/schedule) says today isn't in the best plan AND resting keeps the weekly goal
//   reachable (at least one spare day). Without a planner (`todayInPlan` not given) there is never a Rest: (c), no action.
//   learn/schedule.readinessPlanned runs the planner and passes its answer here.
// - Go light: learn/deload suggests a deload, or a light week is on (a: Grandou 2020; Saw 2016; Bell 2025).
// - Go today · tight week: the weekly goal has no spare day left; never Rest (a: weekly volume drives growth and strength, Pelland
//   2026; with volume equated, more or fewer sessions makes no detectable difference, Schoenfeld, Grgic & Krieger 2019, Boutagy &
//   McKean 2026: so a missed session costs volume and a rest day buys nothing proven).
// - Else Go today.
// "Best next": the first day the best candidate's main muscles (v ≥ ½) are all fresh, learn/recovery's d* (even odds, plan §3.1).

/** (a) Full strength: a deficit under a day's readiness (learn/capacity READY, Grgic 2020). */
export const FULL = READY;
/** (a) A 90 % interval for the energy slope (plan §3.2: it acts once that excludes 0). */
export const ENERGY_CI = 0.9;
/** (c) The fewest sessions with energy logged before a slope is fitted at all (n − 2 ≥ 1 degrees of freedom). */
export const ENERGY_MIN = 3;
/** (c) A muscle counts toward "Best next" when a lift in the session works it at least this much (lifts.ts: ½ is a secondary). */
export const MAIN_SHARE = 0.5;
/** Numerics: the most cell combinations a lift's mixture keeps before it merges neighbours in ln X (16 bins per doubling). */
const CAP = 256, BINS_PER_LN2 = 16;

const DAY = 864e5;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A date as the tile says it: today, tomorrow, a weekday within the week ahead, else "Mon 3 Nov". Never a clock time. */
export function dayLabel(date: string, today: string): string {
  const n = days(today, date);
  const d = new Date(`${date}T00:00:00Z`), wd = WEEKDAY[d.getUTCDay()];
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n > 1 && n < 7) return wd;
  return `${wd} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}

// ---- A lift's P(full strength) ----------------------------------------------------------------------------------------------

/** An energy shift of the day's level (ln e1RM; negative = weaker), with its SD: 0 when energy doesn't act. */
export interface EnergyShift { mean: number; sd: number }
const NO_SHIFT: EnergyShift = { mean: 0, sd: 0 };

/** One combination of the lift's muscles' cells: its weight, X = Σ u·x, and Σ u·x·β̄, Σ u·x·β_sd. */
interface Combo { p: number; X: number; B: number; S: number }

function merge(cs: Combo[]): Combo[] {
  const bins = new Map<number, Combo>();
  for (const c of cs) {
    const k = c.X > 0 ? Math.floor(Math.log(c.X) / Math.LN2 * BINS_PER_LN2) : -Infinity;
    const b = bins.get(k);
    if (!b) { bins.set(k, { p: c.p, X: c.p * c.X, B: c.p * c.B, S: c.p * c.S }); continue; }
    b.p += c.p; b.X += c.p * c.X; b.B += c.p * c.B; b.S += c.p * c.S;
  }
  return [...bins.values()].map((b) => ({ p: b.p, X: b.X / b.p, B: b.B / b.p, S: b.S / b.p }));
}

/** P(deficit − shift < FULL) for one combination: β ~ N(B/X, (S/X)²) on X, the shift N(mean, sd²). */
function pFullOf(c: Combo, e: EnergyShift): number {
  const mu = c.B, sd = Math.sqrt(c.S * c.S + e.sd * e.sd), line = FULL + e.mean;
  if (sd > 0) return normCdf((line - mu) / sd);
  return mu < line ? 1 : 0;
}

/**
 * P(full strength) for a set of `exercise` at an hour on the day axis (learn/recovery's), under an energy shift. A lift the app
 * can't place, or no recovery fit, carries no known deficit (c): only the shift moves it.
 */
export function liftFull(fit: RecoveryFit | null, exercise: string, hour: number, e: EnergyShift = NO_SHIFT, cache?: Map<string, ReturnType<RecoveryFit['cells']>>): number {
  const v = resolveLift(exercise).m;
  const ms = v ? (Object.entries(v) as [Muscle, number][]).filter(([, w]) => w > 0) : [];
  const zero: Combo = { p: 1, X: 0, B: 0, S: 0 };
  if (!fit || !ms.length) return pFullOf(zero, e);
  const vv = ms.reduce((a, [, w]) => a + w * w, 0);
  // Per φ (shared by the muscles), each muscle's cells normalised within it.
  let byPhi: Map<number, Combo[]> | null = null;
  for (const [m, w] of ms) {
    const u = w / vv, key = `${m}|${hour}`;
    let cells = cache?.get(key);
    if (!cells) { cells = fit.cells(m, hour); cache?.set(key, cells); }
    const tot = new Map<number, number>();
    for (const c of cells) tot.set(c.phi, (tot.get(c.phi) ?? 0) + c.w);
    if ([...tot.values()].every((t) => !(t > 0))) continue;
    const next = new Map<number, Combo[]>();
    for (const [phi, t] of tot) {
      if (!(t > 0)) continue;
      const prev = byPhi ? byPhi.get(phi) : [{ ...zero, p: t }];
      if (!prev) continue;
      const own = cells.filter((c) => c.phi === phi && c.w > 0);
      let out: Combo[] = [];
      for (const a of prev) for (const c of own) {
        const ux = u * c.x;
        out.push({ p: a.p * c.w / t, X: a.X + ux, B: a.B + ux * c.beta.mean, S: a.S + ux * c.beta.sd });
      }
      if (out.length > CAP) out = merge(out);
      next.set(phi, out);
    }
    byPhi = next;
  }
  if (!byPhi) return pFullOf(zero, e);
  let p = 0, tw = 0;
  for (const cs of byPhi.values()) for (const c of cs) { p += c.p * pFullOf(c, e); tw += c.p; }
  return tw > 0 ? p / tw : pFullOf(zero, e);
}

// ---- Energy -----------------------------------------------------------------------------------------------------------------

/** One session's residual (ln e1RM: read − predicted, positive = stronger than expected) and its variance. */
export interface Residual { date: string; r: number; v: number }

/**
 * Each session's residual before `before`: every lift's reading (Core.lifts.obs) against its level predicted from its other
 * sessions by forward and backward filters (the core's drift: capacity.aheadVar), as learn/recovery reads a session. A session's
 * readings share the day's readiness (READY²), so they are pooled with that taken out, then it is put back once (b).
 */
export function sessionResiduals(core: Pick<Core, 'drift' | 'lifts'>, before: string): Residual[] {
  const at = new Map<string, { sw: number; swr: number }>();
  const C2 = READY * READY;
  for (const lift of core.lifts.values()) {
    const o = lift.obs, n = o.length;
    if (n < 3) continue;
    const fP = new Float64Array(n), bP = new Float64Array(n), fm = new Float64Array(n), bm = new Float64Array(n);
    let m0 = o[0].z, P = o[0].v;
    for (let k = 1; k < n; k++) {
      const Pp = P + aheadVar(core, o[k].day - o[k - 1].day), K = Pp / (Pp + o[k].v);
      fP[k] = Pp; fm[k] = m0; m0 += K * (o[k].z - m0); P = (1 - K) * Pp;
    }
    m0 = o[n - 1].z; P = o[n - 1].v;
    for (let k = n - 2; k >= 0; k--) {
      const Pp = P + aheadVar(core, o[k + 1].day - o[k].day), K = Pp / (Pp + o[k].v);
      bP[k] = Pp; bm[k] = m0; m0 += K * (o[k].z - m0); P = (1 - K) * Pp;
    }
    for (let k = 1; k < n - 1; k++) {
      if (o[k].date >= before) continue;
      const Pr = 1 / (1 / fP[k] + 1 / bP[k]);
      const pred = Pr / fP[k] * fm[k] + Pr / bP[k] * bm[k];
      const d = Math.max(1e-12, Pr + o[k].v - C2);
      const s = at.get(o[k].date) ?? { sw: 0, swr: 0 };
      s.sw += 1 / d; s.swr += (o[k].z - pred) / d;
      at.set(o[k].date, s);
    }
  }
  return [...at].map(([date, s]) => ({ date, r: s.swr / s.sw, v: 1 / s.sw + C2 })).sort((a, b) => a.date.localeCompare(b.date));
}

/** P(T ≤ t) for Student's t with ν degrees of freedom. */
function tCdf(t: number, nu: number): number {
  const tail = 0.5 * betaCdf(nu / (nu + t * t), nu / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}
/** The t quantile at q (q > ½), by bisection. */
export function tQuantile(q: number, nu: number): number {
  let lo = 0, hi = 1;
  while (tCdf(hi, nu) < q) hi *= 2;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (tCdf(mid, nu) < q) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

export interface EnergyFit {
  /** 'none': fewer than ENERGY_MIN sessions with energy; 'learning': fitted, its 90 % interval holds 0 (display-only); 'active'. */
  status: 'none' | 'learning' | 'active';
  /** Sessions with energy logged that the slope was fitted to. */
  n: number;
  /** His usual energy (the median logged before today); null with none. */
  usual: number | null;
  /** The slope (ln e1RM per energy point), its 90 % interval, and the Birge ratio its SE was scaled by; null until fitted. */
  slope: Est | null; ci: [number, number] | null; birge: number;
  /** Today's energy and the shift it predicts (0 unless active). */
  today: number | null; shift: EnergyShift;
}

/**
 * The energy slope (b) from session residuals and energy days: weighted least squares of r on (energy − usual) with an
 * intercept, weights 1/v, the SE scaled by Birge's ratio χ²/(n − 2) (never below 1). Acts once the 90 % t interval excludes 0.
 */
export function energyFit(res: readonly Residual[], body: readonly BodyDay[], today: string): EnergyFit {
  const eOf = new Map<string, number>();
  for (const d of body) if (d.energy != null) eOf.set(d.date, d.energy);
  const before = [...eOf].filter(([d]) => d < today).map(([, e]) => e).sort((a, b) => a - b);
  const usual = before.length ? (before.length % 2 ? before[(before.length - 1) >> 1] : (before[before.length / 2 - 1] + before[before.length / 2]) / 2) : null;
  const todayE = eOf.get(today) ?? null;
  const rows = usual == null ? [] : res.filter((x) => x.date < today && eOf.has(x.date)).map((x) => ({ x: eOf.get(x.date)! - usual, y: x.r, w: 1 / x.v }));
  const base: EnergyFit = { status: 'none', n: rows.length, usual, slope: null, ci: null, birge: 1, today: todayE, shift: NO_SHIFT };
  if (rows.length < ENERGY_MIN) return base;
  let Sw = 0, Sx = 0, Sxx = 0, Sy = 0, Sxy = 0;
  for (const { x, y, w } of rows) { Sw += w; Sx += w * x; Sxx += w * x * x; Sy += w * y; Sxy += w * x * y; }
  const det = Sw * Sxx - Sx * Sx;
  if (!(det > 1e-12 * Sw * Sw)) return { ...base, status: 'learning' }; // every day at one energy: no slope to read
  const b = (Sw * Sxy - Sx * Sy) / det, a = (Sy - b * Sx) / Sw;
  let chi = 0;
  for (const { x, y, w } of rows) chi += w * (y - a - b * x) ** 2;
  const nu = rows.length - 2;
  const birge = Math.max(1, chi / nu);
  const se = Math.sqrt(birge * Sw / det), t = tQuantile((1 + ENERGY_CI) / 2, nu);
  const ci: [number, number] = [b - t * se, b + t * se];
  const active = ci[0] > 0 || ci[1] < 0;
  const dE = todayE != null && usual != null ? todayE - usual : 0;
  return { ...base, status: active ? 'active' : 'learning', slope: { mean: b, sd: se }, ci, birge, shift: active && dE ? { mean: b * dE, sd: se * Math.abs(dE) } : NO_SHIFT };
}

// ---- Candidates ------------------------------------------------------------------------------------------------------------

export interface Candidate {
  /** 'next': the program's next day; 'cycle': a program day not yet done this cycle; 'quick': the quick day. */
  kind: 'next' | 'cycle' | 'quick';
  /** Its program day index (null for quick), its name and its slots (skips and swaps applied). */
  day: number | null; name: string; slots: Slot[];
}

/** Dates before `before` with a working set (`cardio`: or a cardio bout, as program.ts moves the rotation). */
const workingDates = (entries: readonly SetEntry[], before: string, cardio: boolean) => {
  const s = new Set<string>();
  for (const e of entries) {
    if (e.date >= before || e.flags.includes('warmup')) continue;
    if (isCardioEntry(e) ? cardio : e.reps != null && e.reps > 0) s.add(e.date);
  }
  return s;
};

/** The program days done in the current cycle (program.cycleDone, which program.nextDay reads too). */
export const doneThisCycle = cycleDone;

/** A day's slots with its plan's skips and swaps applied. */
export const applyPlan = (slots: Slot[], plan?: DayPlan) => (plan
  ? slots.filter((s) => !plan.skips.includes(s.exercise)).map((s) => (plan.swaps[s.exercise] ? { ...s, exercise: plan.swaps[s.exercise] } : s))
  : slots);

/**
 * The candidates for `today`: the program's next day (today's stored plan, if he has opened one) and every day not yet done this
 * cycle; the quick day (built by the caller, who knows the time he has: program.quickDay) only with no program (S3: small and
 * aimed at the muscles least trained this week, it reads freshest by construction and would nearly always be "best").
 * Distinct by program day.
 */
export function candidatesOf(p: Program | null, plans: readonly DayPlan[], entries: readonly SetEntry[], today: string, quick: Slot[] | null): Candidate[] {
  const out: Candidate[] = [];
  if (p?.days.length) {
    const stored = plans.find((x) => x.date === today && x.quick == null && x.day < p.days.length);
    const next = stored ? stored.day : nextDay(p, plans as DayPlan[], entries as SetEntry[], today);
    const dayOf = (d: number, plan?: DayPlan) => applyPlan(plan?.slots ?? p.days[d].slots, plan);
    out.push({ kind: 'next', day: next, name: p.days[next].name, slots: dayOf(next, stored) });
    const done = doneThisCycle(p, plans, entries, today);
    p.days.forEach((d, i) => { if (i !== next && !done.has(i)) out.push({ kind: 'cycle', day: i, name: d.name, slots: dayOf(i) }); });
  } else if (quick?.length) out.push({ kind: 'quick', day: null, name: 'Quick', slots: quick });
  return out;
}

// ---- The week -------------------------------------------------------------------------------------------------------------

export interface Week {
  goal: number;
  /** Sessions (days with a working lift set, as analytics.weeklySummary counts) this week before today, and still needed. */
  done: number; needed: number;
  /** Days left in the week, today included, and how many of them can be rest days with the goal still met. */
  daysLeft: number; slack: number;
  /** No spare day: the goal needs every day left (or is already out of reach). */
  tight: boolean;
  /** The goal met before today: no session needed this week. */
  met: boolean;
}

export function weekOf(entries: readonly SetEntry[], goal: number, today: string): Week {
  const start = weekStart(today);
  const ds = new Set<string>();
  for (const e of entries) if (e.date >= start && e.date < today && !e.flags.includes('warmup') && !isCardioEntry(e)) ds.add(e.date);
  const done = ds.size, needed = Math.max(0, goal - done), daysLeft = 7 - days(start, today);
  const slack = daysLeft - needed;
  return { goal, done, needed, daysLeft, slack, tight: needed > 0 && slack <= 0, met: goal > 0 && needed === 0 };
}

// ---- Verdict --------------------------------------------------------------------------------------------------------------

export type VerdictKind = 'go' | 'tight' | 'light' | 'rest';
export interface Verdict {
  kind: VerdictKind;
  /**
   * Why: a layoff, the goal met (an extra session, optional), the planner's rest day, a deload, a light week, a tight week, the
   * planner's training day, or no planner.
   */
  why: 'layoff' | 'goal-met' | 'plan-rest' | 'deload' | 'light' | 'tight' | 'plan' | 'default';
  label: string;
}
export interface VerdictFacts {
  /** Days since the last training day (null: never trained). */
  sinceLast: number | null;
  /** learn/deload's verdict, and whether a light week is on. */
  systemic: Systemic['verdict'] | null; lightOn: boolean;
  /** `met`: the goal met before today (left out: not met). */
  week: Pick<Week, 'slack' | 'tight'> & { met?: boolean };
  /** S3's planner: is today in the best plan? Undefined/null without one: never Rest. */
  todayInPlan?: boolean | null;
}

/** The day's verdict from its facts (see the header for the order and the evidence). */
export function verdictOf(f: VerdictFacts): Verdict {
  if (f.sinceLast == null || f.sinceLast >= BREAK_DAYS) return { kind: 'go', why: 'layoff', label: 'Go today' };
  if (f.week.met) {
    // A light week or a deload suggested: an extra session, if any, is a light one.
    const light = f.systemic === 'deload' || f.lightOn;
    return light ? { kind: 'light', why: 'goal-met', label: 'Goal met · go light if you train' } : { kind: 'go', why: 'goal-met', label: 'Goal met · extra session optional' };
  }
  if (f.todayInPlan === false && !f.week.tight && f.week.slack >= 1) return { kind: 'rest', why: 'plan-rest', label: 'Rest today' };
  if (f.systemic === 'deload' || f.lightOn) return { kind: 'light', why: f.systemic === 'deload' ? 'deload' : 'light', label: f.week.tight ? 'Go light · tight week' : 'Go light' };
  if (f.week.tight) return { kind: 'tight', why: 'tight', label: 'Go today · tight week' };
  return { kind: 'go', why: f.todayInPlan === true ? 'plan' : 'default', label: 'Go today' };
}

// ---- Evidence -------------------------------------------------------------------------------------------------------------

export interface Evidence {
  rule: string;
  /** (a) research with its citation, (b) learned with its method, (c) a neutral default that takes no action. */
  kind: 'research' | 'learned' | 'default';
  cite?: string; method?: string;
  /** Whether it moved the number or the verdict today. A (c) never does. */
  acts: boolean;
  /** The recovery model only: how much is research and how much his log ("research 80% · you 20%"). */
  share?: { research: number; you: number; label: string };
}

const shareLabel = (you: number) => { const y = Math.round(100 * you); return { research: 100 - y, you: y, label: `research ${100 - y}% · you ${y}%` }; };

// ---- The model ------------------------------------------------------------------------------------------------------------

export interface LiftReady {
  exercise: string; sets: number;
  /** P(full strength) of each of its sets, and P(it hurts) (learn/pain). */
  pFull: number; pain: number;
}
export interface SessionReady {
  /** 0–100: the mean over its working sets of P(full strength) × (1 − pain risk); null with no working lift sets. */
  ready: number | null;
  /** Expected sets at full strength (rounded) of all its working lift sets: "N of M sets at full strength". */
  full: number; total: number;
  lifts: LiftReady[];
  /** Its main muscles (v ≥ MAIN_SHARE in some lift) and the first day all are fresh (learn/recovery d*); null past a year. */
  muscles: Muscle[]; freshBy: string | null;
}

export interface ReadinessInput {
  entries: readonly SetEntry[];
  body: readonly BodyDay[];
  /** The weekly sessions goal (profile.weeklyGoal). */
  weeklyGoal: number;
  program: Program | null;
  plans: readonly DayPlan[];
  /** The quick day's slots (program.quickDay, built by the caller for the time he has); null for none. */
  quick: Slot[] | null;
  today: string; tz: string;
  /** A light week he started on this phone (state/lightWeek). */
  tapped?: { from: string; end?: string } | null;
  /** S3's planner: whether today is in the best plan. Leave it out (no planner) and the verdict is never Rest. */
  todayInPlan?: boolean | null;
}

/**
 * What S3's planner reads: Ready of any session on any date from today on, with today's energy only on today. `painAt`: the date
 * whose pain risk each lift reads (default the date itself; the planner reads today's on every day of the week).
 */
export interface ReadinessModel {
  today: string;
  recovery: RecoveryFit | null;
  energy: EnergyFit;
  sessionReady(slots: readonly Slot[], date: string, opts?: { painAt?: string }): SessionReady;
}

const isLiftSlot = (s: Slot) => s.minutes == null && s.sets > 0 && !isCardio(s.exercise);
/** The first date he flagged pain (null: never): before it, learn/pain's risk is its prior alone (see the header). */
const firstPain = perLog((entries) => { let d: string | null = null; for (const e of entries) if (e.flags.includes('pain') && (!d || e.date < d)) d = e.date; return d; });

/**
 * The model behind the number, for `today` (the log before today: what is logged today is the session being judged, not a
 * reason against it). Cached fits only (learn/recovery, learn/pain, the core): cheap to call per render.
 */
let LAST_FITS: { log: readonly SetEntry[]; body: readonly BodyDay[]; today: string; tz: string; recovery: RecoveryFit | null; energy: EnergyFit } | null = null;
const sameRefs = (a: readonly SetEntry[], b: readonly SetEntry[]) => a === b || (a.length === b.length && a.every((x, i) => x === b[i]));

export function readinessModel(entries: readonly SetEntry[], body: readonly BodyDay[], today: string, tz: string): ReadinessModel {
  const log = logBefore(entries, today);
  // A set logged today makes a new log array with the same days before it: the fits are those of the last call (the store never
  // changes a set in place, so the same objects are the same sets).
  let fits = LAST_FITS;
  if (!fits || fits.today !== today || fits.tz !== tz || fits.body !== body || !sameRefs(fits.log, log)) {
    const core = coreBefore(entries, today);
    fits = LAST_FITS = { log, body, today, tz, recovery: recoveryOf(log, today, tz), energy: energyFit(core ? sessionResiduals(core, today) : [], body, today) };
  }
  const { recovery, energy } = fits;
  const cache = new Map<string, ReturnType<RecoveryFit['cells']>>();
  const dayHour = (date: string) => (Date.parse(`${date}T00:00:00Z`) / DAY) * 24 + (recovery ? recovery.refMinutes(date) : 0) / 60;
  const sessionReady = (slots: readonly Slot[], date: string, opts?: { painAt?: string }): SessionReady => {
    const hour = dayHour(date), shift = date === today ? energy.shift : NO_SHIFT, painAt = opts?.painAt ?? date;
    const lifts: LiftReady[] = [];
    const main = new Set<Muscle>();
    for (const s of slots) {
      if (!isLiftSlot(s)) continue;
      const pFull = liftFull(recovery, s.exercise, hour, shift, cache);
      const fp = firstPain(entries);
      const pain = fp != null && fp <= painAt ? painRisk(entries, s.exercise, painAt).p : 0;
      lifts.push({ exercise: s.exercise, sets: s.sets, pFull, pain });
      const v = resolveLift(s.exercise).m;
      if (v) for (const [m, w] of Object.entries(v) as [Muscle, number][]) if (w >= MAIN_SHARE) main.add(m);
    }
    const total = lifts.reduce((a, l) => a + l.sets, 0);
    const score = lifts.reduce((a, l) => a + l.sets * l.pFull * (1 - l.pain), 0);
    const fullSets = lifts.reduce((a, l) => a + l.sets * l.pFull, 0);
    let freshBy: string | null = date;
    if (recovery) for (const m of main) {
      const f = recovery.freshBy(m);
      if (f == null) { freshBy = null; break; }
      if (f > freshBy) freshBy = f;
    }
    return { ready: total ? Math.round(100 * score / total) : null, full: Math.round(fullSets), total, lifts, muscles: [...main], freshBy };
  };
  return { today, recovery, energy, sessionReady };
}

export interface Readiness {
  today: string;
  /** 0–100, the best candidate's Ready; null with no candidate that has working lift sets. */
  ready: number | null;
  /** Every candidate with its Ready (best first), and the best (null as `ready`). */
  candidates: (Candidate & SessionReady)[];
  best: (Candidate & SessionReady) | null;
  verdict: Verdict;
  /** The first day the best candidate is fresh, when that's after today ("Best next: Thu"); null today or with none. */
  bestNext: { date: string; label: string } | null;
  week: Week;
  /** Days since he last trained (null: never), and whether that is a layoff. */
  layoff: { sinceLast: number | null; on: boolean };
  energy: EnergyFit;
  /** How much of the recovery model is research and how much his log, over the best candidate's muscles. */
  source: { research: number; you: number; label: string };
  evidence: Evidence[];
}

/** The day's readiness (see the header). Never throws for a bad fit: a refinement, never a reason to fail a screen. */
export function readiness(input: ReadinessInput): Readiness {
  const { entries, body, today } = input;
  const model = readinessModel(entries, body, today, input.tz);
  const cands = candidatesOf(input.program, input.plans, entries, today, input.quick)
    .map((c) => ({ ...c, ...model.sessionReady(c.slots, today) }));
  const ranked = [...cands].sort((a, b) => (b.ready ?? -1) - (a.ready ?? -1));
  const best = ranked.find((c) => c.ready != null) ?? null;

  let last: string | null = null;
  for (const d of workingDates(entries, today, false)) if (!last || d > last) last = d;
  const sinceLast = last ? days(last, today) : null;
  const sys = systemic(entries, body, today, input.tapped);
  const lightOn = !!lightWeek(entries, today, input.tapped);
  const week = weekOf(entries, input.weeklyGoal, today);
  const verdict = verdictOf({ sinceLast, systemic: sys?.verdict ?? null, lightOn, week, todayInPlan: input.todayInPlan });
  const bestNext = best?.freshBy && best.freshBy > today ? { date: best.freshBy, label: `Best next: ${dayLabel(best.freshBy, today)}` } : null;

  // The share from his log, over the best candidate's main muscles (each muscle's τ′ and β, the smaller: learn/recovery).
  const rec = model.recovery;
  const ms = best?.muscles ?? [];
  const you = rec ? (ms.length ? ms.reduce((a, m) => a + rec.muscles.get(m)!.fromData.both, 0) / ms.length : Math.min(rec.fromData.tau, rec.fromData.beta)) : 0;
  const source = shareLabel(you);

  const e = model.energy;
  const layoff = verdict.why === 'layoff';
  const evidence: Evidence[] = [
    { rule: 'Full strength: a deficit under 3% of e1RM', kind: 'research', cite: 'Grgic 2020, 1RM test–retest CV 4.2% (learn/capacity READY)', acts: true },
    {
      rule: 'Recovery between sessions, per muscle', kind: 'research',
      cite: 'Raastad & Hallén 2000; Morán-Navarro 2017; Vieira 2022 (τ′ and failure priors, S0)',
      method: 'learned per muscle: conjugate β per τ′ cell, pooled person → region → muscle, power-prior fade (learn/recovery)',
      acts: !!rec, share: source,
    },
    cands.some((c) => c.lifts.some((l) => l.pain > 0))
      ? { rule: 'Pain risk lowers a set', kind: 'learned', method: 'learn/pain: hierarchical pain rate per lift, family and region, faded by a learned half-life', acts: true }
      : { rule: 'Pain risk lowers a set', kind: 'default', method: 'no pain flagged yet: the pain model prior alone is not evidence', acts: false },
    { rule: `A layoff of ${BREAK_DAYS}+ days: always Go`, kind: 'research', cite: 'Coleman 2024 (a week off cost no muscle); Rogerson 2024; Bell 2025 (deloads last 5–7 days)', acts: layoff },
    { rule: 'Go light in a deload or light week', kind: 'research', cite: 'Grandou 2020 (a sustained drop is the overreaching marker); Saw 2016; Bell 2025 (light week)', acts: verdict.kind === 'light' },
    { rule: 'The goal met: an extra session is optional, never Rest', kind: 'research', cite: 'Pelland 2026 (weekly volume dose-response: more weekly sets, more growth); owner (S4: the goal is size)', acts: verdict.why === 'goal-met' },
    { rule: 'No Rest when the weekly goal has no spare day', kind: 'research', cite: 'Pelland 2026 (weekly volume dose-response); Schoenfeld, Grgic & Krieger 2019 and Boutagy & McKean 2026 (frequency adds nothing detectable at equal volume)', acts: week.tight && !layoff },
    input.todayInPlan == null
      ? { rule: 'Rest today only off the best plan', kind: 'default', method: 'no planner yet (S3): today counts as planned, so never Rest', acts: false }
      : { rule: 'Rest today only off the best plan', kind: 'research', cite: 'Pelland 2026 (weekly volume first); plan §3.3 planner', acts: verdict.kind === 'rest' },
    e.status === 'active'
      ? { rule: 'Energy moves the number', kind: 'learned', method: `weighted least squares of session residual on energy − usual, n ${e.n}, Birge-scaled; its 90% interval excludes 0`, acts: e.shift.mean !== 0 }
      : { rule: 'Energy moves the number', kind: 'default', method: `display-only until its learned slope's 90% interval excludes 0 (n ${e.n}); single-item wellness is unvalidated for lifting (Saw 2016; Laurent 2011)`, acts: false },
    { rule: 'Best next: the day its main muscles are fresh', kind: 'default', method: 'even odds, P(recovered) > ½ on the day (plan §3.1): shown, never acted on', acts: false },
  ];

  return {
    today, ready: best?.ready ?? null, candidates: ranked, best, verdict, bestNext, week,
    layoff: { sinceLast, on: layoff }, energy: e, source, evidence,
  };
}
