import { isCardio, isCardioEntry } from '../cardio';
import { liftKey } from '../ids';
import { liftFactsVersion, resolveLift } from '../lifts';
import { byOrderDone, doneAt } from '../stats';
import { planSeconds, REST_MAX_S, REST_MIN_S, REST_STEP, SET_WORK, stepsOf, type KneeAt, type KneeRest, type PlanSlot, type Prior } from '../timing';
import type { SetEntry } from '../types';
import { aheadVar, dayOf, RHOS, TAUS, type Core } from './capacity';
import { learn, logBefore } from './index';
import { normCdf } from './num';
import { overlap } from './tags';

// Item 17: the rest "knee" — the rest past which more rest buys almost nothing (owner: "beyond some number of minutes the
// differences are minuscule"; prove it from his data if the learning allows). It prescribes (timing.restFor, planSeconds); his own
// gaps never feed it (they describe him: learn/session).
//
// Evidence labels: (a) research, cited; (b) learned from his log, by the method named; (c) a neutral default, which takes no action.
//
// From the capacity equation (learn/capacity, 00-core §1.2), the reps the next set of lift L loses to too little rest t are
//   E(t) = (1 − ρ)·M·e^(−(t + w)/τ),   M = Σ_j a_j·o_j·f_j·e^(−ago_j/τ)
// over the session's earlier hard sets j (the one just done has ago 0): a_j = A_L for the lift's own sets, A_cross for another
// lift's, o_j its muscle overlap onto L (1 for L's own), f_j its effort (below), w the next set's own time (timing.SET_WORK: the
// fit's Δt runs done-time to done-time). ρ's share never recovers within a session: that's the normal drop from set to set (owner:
// "losing reps" means the excess loss from short rest, not the normal drop-off), so it's left out. γ (any prior set) doesn't
// depend on rest either. So 30 s more rest buys G(t) = E(t) − E(t + 30) = (1 − ρ)(1 − e^(−30/τ))·M·e^(−(t + w)/τ), and
//   the knee t* = the shortest rest with G(t*) < δ:   t* = max(0, τ·ln((1 − ρ)(1 − e^(−30/τ))·M/δ) − w).
// - 30 s: the timer's own step (REST_STEP, the ±30 s he taps): the smallest change of rest he makes.
// - δ = 1/√12 rep (a): the rounding error of a whole-number count (Sheppard 1898: a uniform error over one unit has SD 1/√12).
//   Reps are logged as whole numbers, so a gain under it can't show in his log: "minuscule" made exact.
// - The posterior over (τ, ρ, A_same, A_cross) is the core's grid from TIMED sets only (Core.rest, b): untimed days are spaced at
//   his typical gap in the main fit, which says nothing true about recovery. Each cell gives M a normal (A from the cell's
//   posterior), so t*'s distribution is a mixture, read by its CDF: P(t* ≤ x) = Σ_c w_c·Φ((m_c(x) − E[M_c]) / SD[M_c]).
//   The grid can't tell τ or ρ apart inside a cell, so each cell's (τ, ρ) is spread over its span (τ log-uniform between the
//   geometric midpoints to its neighbours, ρ uniform over ±half a step), read at three points each, its A held: as the core's ρ
//   SD adds the grid's own resolution. Moving τ without A's trade-off overstates the spread: the band errs wide.
// - The lift (partial pooling, b): A_L = the cell's A_same + the lift's pooled deviation (core: person → family → lift, at the
//   main fit's cell; learn/pool's model is additive, so the deviation carries across cells). Its SD is added whole: it holds the
//   person's uncertainty too, already in each cell, so the band errs wide again. A lift never done has no knee (null).
// - Effort (a): a set nearer failure leaves more to recover. Refalo 2023 (rep loss over six sets at fixed rest: 7.6 / 5.1 / 2.8
//   reps at 0 / 1 / 3 RIR) scales a set's a_j by L(its RIR) / L(his usual RIR), L linear between those points and flat past 3
//   (no evidence beyond). His usual RIR (b) is the core's habit less his bias: like with like, as logged.
// - A layoff (owner: layoffs widen uncertainty): the losses are a share of what he can do (Rahimi 2005 reports them as % of set
//   1), so a level known less well makes them known less well: M's variance grows by its square times the level's own growth
//   over the days since his last session (capacity.aheadVar: b drift, a Bosquet 2013 past two weeks).
// - Used (b) only when (1) its 90 % band (5–95 %) is within ±45 s (TIGHT, c: 00-core §4.2's gate) and (2) its median lies inside
//   the middle 90 % of the rests he has timed (Core.rest.gaps): a fit says nothing about rests he never takes, and a knee
//   below all of them is an extrapolation, not a finding (on synthetic logs with 6–7 min rests the fit can put a tight band near
//   0:00 against a true 1:15). Until both, the research default (timing.restFor), with what his sets show so he can see why.

/** (a) δ: the gain in reps 30 s more rest must buy to be worth it, a whole-number count's rounding error (Sheppard 1898). */
export const DELTA = 1 / Math.sqrt(12);
/** (c) His knee is used once its 90 % band is within ±TIGHT s (00-core §4.2); a gate on when (b) is known enough, never a rest. */
export const TIGHT = 45;
/** The band shown and gated on, and the share of his rests a knee must sit inside: the middle 90 %. */
const LO = 0.05, HI = 0.95;
/** (a) Refalo 2023: reps lost over six sets at 0 / 1 / 3 RIR. */
const REFALO: readonly (readonly [number, number])[] = [[0, 7.6], [1, 5.1], [3, 2.8]];
/** Numerics: the longest knee searched (an hour; anything past 5:00 is used as 5:00), bisection steps, cells too light to matter. */
const SEARCH = 3600, STEPS = 32, MIN_W = 1e-6;
/** Numerics: where inside its span a cell is read (the midpoint rule's thirds). */
const SUB = [1 / 6, 1 / 2, 5 / 6] as const;

/** Refalo's loss at a logged RIR, linear between his points, flat outside them. */
export function effortLoss(rir: number): number {
  if (rir <= REFALO[0][0]) return REFALO[0][1];
  for (let i = 1; i < REFALO.length; i++) {
    const [x0, y0] = REFALO[i - 1], [x1, y1] = REFALO[i];
    if (rir <= x1) return y0 + (y1 - y0) * (rir - x0) / (x1 - x0);
  }
  return REFALO[REFALO.length - 1][1];
}

/** One point read inside a grid cell: its weight, τ, g = (1 − ρ)(1 − e^(−30/τ)), and the cell's A posterior. */
interface K { w: number; tau: number; g: number; a: number; x: number; v00: number; v11: number; v01: number }

/** What the knee needs from one core, once per core. */
interface Model {
  points: K[];
  /** His usual logged RIR's loss (Refalo), the reference for a set's effort. */
  usual: number;
  /** The person's A_same at the main fit, for each lift's deviation. */
  theta0: number;
  core: Core;
  /** Per day planned for, whether each lift's knee is in use (kneePlan: judged once, not once per plan or per δ). */
  use: Map<string, Map<string, boolean>>;
}
const MODELS = new WeakMap<Core, Model>();

/** A grid value's span: from the midpoint to the one below to the midpoint to the one above (the ends mirror their neighbour). */
function span(xs: readonly number[], i: number, log: boolean): [number, number] {
  const f = log ? Math.log : (x: number) => x;
  const lo = i > 0 ? (f(xs[i - 1]) + f(xs[i])) / 2 : f(xs[i]) - (f(xs[i + 1]) - f(xs[i])) / 2;
  const hi = i < xs.length - 1 ? (f(xs[i]) + f(xs[i + 1])) / 2 : f(xs[i]) + (f(xs[i]) - f(xs[i - 1])) / 2;
  return [lo, hi];
}

function modelOf(core: Core): Model {
  let m = MODELS.get(core);
  if (m) return m;
  const points: K[] = [];
  let tot = 0;
  for (const c of core.rest.cells) {
    if (c.w < MIN_W) continue;
    const [t0, t1] = span(TAUS, TAUS.indexOf(c.tau as (typeof TAUS)[number]), true);
    const [r0, r1] = span(RHOS, RHOS.indexOf(c.rho as (typeof RHOS)[number]), false);
    for (const a of SUB) for (const b of SUB) {
      const tau = Math.exp(t0 + a * (t1 - t0)), rho = Math.min(RHOS[RHOS.length - 1], Math.max(0, r0 + b * (r1 - r0)));
      const w = c.w / (SUB.length * SUB.length);
      points.push({ w, tau, g: (1 - rho) * (1 - Math.exp(-REST_STEP / tau)), a: c.theta[0], x: c.theta[1], v00: c.cov[0], v11: c.cov[4], v01: c.cov[1] });
      tot += w;
    }
  }
  for (const p of points) p.w /= tot;
  m = { points, usual: effortLoss(Math.max(0, core.habit.mean - core.bias.mean)), theta0: core.fit.theta[0], core, use: new Map() };
  MODELS.set(core, m);
  return m;
}

/** One earlier set, as the knee reads it: whose (L's own or not), its overlap onto L, its effort and how long ago. */
interface Term { own: boolean; o: number; f: number; ago: number }

const vecOf = (exercise: string) => resolveLift(exercise).m;
/** The terms for lift `exercise`'s next set after `prior` (each with its RIR's effort when logged). */
function termsOf(m: Model, exercise: string, prior: readonly Prior[]): Term[] {
  const key = liftKey(exercise), v = vecOf(exercise);
  return prior.map((p) => {
    const own = liftKey(p.exercise) === key;
    return { own, o: own ? 1 : overlap(vecOf(p.exercise), v), f: p.rir != null ? effortLoss(p.rir) / m.usual : 1, ago: Math.max(0, p.ago) };
  }).filter((t) => t.own || t.o > 0);
}

/** A knee's distribution: its CDF, and its q-quantile in seconds (0 if F(0) ≥ q; an hour if never reached). */
export interface KneeDist { cdf(x: number): number; q(p: number): number }

/**
 * The knee's distribution for lift `exercise`'s next set after `prior` (the session's hard sets so far, the one just done last
 * at ago 0), from `core`. `days`: since his last session (a layoff widens it); `delta`: δ. Null if the lift has no core values.
 */
export function kneeDist(core: Core, exercise: string, prior: readonly Prior[], o: { days?: number; delta?: number } = {}): KneeDist | null {
  const lift = core.lifts.get(liftKey(exercise));
  if (!lift) return null;
  const m = modelOf(core), delta = o.delta ?? DELTA;
  const terms = termsOf(m, exercise, prior);
  const d = lift.aSame.mean - m.theta0, dv = lift.aSame.sd ** 2;
  const lay = aheadVar(core, o.days ?? 0);
  const per = m.points.map((c) => {
    let S = 0, X = 0;
    for (const t of terms) { const e = t.f * Math.exp(-t.ago / c.tau); if (t.own) S += e; else X += t.o * e; }
    const mean = (c.a + d) * S + c.x * X;
    let v = S * S * (c.v00 + dv) + X * X * c.v11 + 2 * S * X * c.v01;
    v += (mean * mean + v) * lay;
    return { w: c.w, tau: c.tau, k: delta / c.g, mean, sd: Math.sqrt(Math.max(v, 1e-12)) };
  });
  // P(t* ≤ x) = P(M ≤ δ·e^((x + w)/τ) / g), point by point.
  const cdf = (x: number) => {
    let F = 0;
    for (const p of per) F += p.w * normCdf((p.k * Math.exp((x + SET_WORK) / p.tau) - p.mean) / p.sd);
    return F;
  };
  const q = (pr: number) => {
    if (cdf(0) >= pr) return 0;
    if (cdf(SEARCH) < pr) return SEARCH;
    let lo = 0, hi = SEARCH;
    for (let i = 0; i < STEPS; i++) { const mid = (lo + hi) / 2; if (cdf(mid) >= pr) hi = mid; else lo = mid; }
    return (lo + hi) / 2;
  };
  return { cdf, q };
}

/** Rounded to 5 s (display resolution; at most 2.5 s off) and kept within the timer's bounds (timing.restFor's). */
const clampRest = (s: number) => Math.min(REST_MAX_S, Math.max(REST_MIN_S, Math.round(s / 5) * 5));

/**
 * The knee after lift `exercise`'s set, from `core` (see kneeDist for `prior`); `date` the day it's for (a layoff). Null when the
 * lift has no core values or no timed set taught the rest fit anything. KneeRest: `usual` at his usual effort (the set's RIR not
 * read), `seconds` with it; the 90 % band and median at his usual effort; `use` once tight and inside the rests he's timed.
 */
export function kneeFrom(core: Core, exercise: string, prior: readonly Prior[], o: { date?: string; delta?: number } = {}): KneeRest | null {
  const g = core.rest.gaps;
  if (!core.rest.sets || !g) return null;
  const days = o.date ? Math.max(0, dayOf(o.date) - core.rest.lastDay) : 0, delta = o.delta ?? DELTA;
  const last = prior.length - 1;
  const D0 = kneeDist(core, exercise, prior.map((p, i) => (i === last ? { ...p, rir: null } : p)), { days, delta });
  if (!D0) return null;
  const D1 = prior[last]?.rir != null ? kneeDist(core, exercise, prior, { days, delta })! : D0;
  const lo = D0.q(LO), hi = D0.q(HI), mid = D0.q(0.5);
  // The rests he has timed: the gaps less the set itself.
  const rests = { lo: Math.max(0, Math.round(g.lo - SET_WORK)), hi: Math.max(0, Math.round(g.hi - SET_WORK)) };
  const tight = (hi - lo) / 2 <= TIGHT, tried = mid >= rests.lo && mid <= rests.hi;
  return {
    usual: clampRest(mid), seconds: clampRest(D1.q(0.5)), mid: Math.round(mid), lo: Math.round(lo), hi: Math.round(hi),
    tight, tried, use: tight && tried, rests, delta,
  };
}

/**
 * The core as of the days before `date` (index.coreBefore), kept while those days are the same sets: a set logged today makes a
 * new log, and the timer and the plan's length then read only today (as learn/session's paceBefore).
 */
let LAST: { date: string; log: readonly SetEntry[]; facts: number; core: Core | null } | null = null;
function coreFor(entries: readonly SetEntry[], date: string): Core | null {
  const log = logBefore(entries, date), facts = liftFactsVersion();
  if (LAST && LAST.date === date && LAST.facts === facts && LAST.log.length === log.length) {
    let same = true;
    for (let i = 0; same && i < log.length; i++) same = LAST.log[i] === log[i];
    if (same) return LAST.core;
  }
  let core: Core | null = null;
  try { core = learn(log).core; } catch { /* a refinement: never a reason to fail */ }
  LAST = { date, log, facts, core };
  return core;
}

const hard = (e: SetEntry) => !e.flags.includes('warmup') && !e.flags.includes('partial') && e.reps != null && e.reps > 0 && !isCardioEntry(e) && !isCardio(e.exercise);

/**
 * The knee after `set` (the timer's): the core as of the days before its date (a target or a rest doesn't move under him while
 * he trains), and the day's timed hard sets up to it as the session so far. `delta`: the day's (restDelta). Null as kneeFrom.
 */
export function kneeAfter(entries: readonly SetEntry[], set: SetEntry, delta = DELTA): KneeRest | null {
  if (!hard(set)) return null;
  const core = coreFor(entries, set.date);
  if (!core) return null;
  const at = doneAt(set);
  const day = entries.filter((e) => e.date === set.date && e.id !== set.id && hard(e) && e.loggedAt && doneAt(e) <= at).sort(byOrderDone);
  const prior: Prior[] = [...day, set].map((e) => ({ exercise: e.exercise, ago: Number.isFinite(at) ? (at - doneAt(e)) / 1000 : 0, rir: e.rir ?? null }));
  return kneeFrom(core, set.exercise, prior, { date: set.date, delta });
}

/**
 * For timing.planSeconds: the knee (at his usual effort: effort isn't known before a set, and a plan's sets aim at his usual) for a
 * lift whose knee is in use, else null (the research default). Whether a lift's is in use is judged once, on its first set's rest.
 */
export function kneePlan(entries: readonly SetEntry[], date: string, delta = DELTA): KneeAt | null {
  const core = coreFor(entries, date);
  if (!core || !core.rest.sets || !core.rest.gaps) return null;
  const m = modelOf(core);
  const use = m.use.get(date) ?? new Map<string, boolean>();
  m.use.set(date, use);
  const days = Math.max(0, dayOf(date) - core.rest.lastDay);
  return (exercise, prior) => {
    const key = liftKey(exercise);
    let ok = use.get(key);
    if (ok === undefined) { ok = kneeFrom(core, exercise, [{ exercise, ago: 0 }], { date })?.use ?? false; use.set(key, ok); }
    if (!ok) return null;
    const D = kneeDist(core, exercise, prior, { days, delta });
    return D ? clampRest(D.q(0.5)) : null;
  };
}

/**
 * The day's δ (00-core §4.2, session budget): DELTA, unless the plan at its knees runs past `minutes`; then δ is raised, the same
 * for every set (equal marginal value: each rest is cut where 30 s more buys the same), until it fits or every knee is at the
 * timer's floor. Only learned knees move; his settings and the research defaults don't.
 */
export function restDelta(entries: readonly SetEntry[], date: string, slots: readonly PlanSlot[], minutes: number,
  o: { warmups?: (ex: string) => number; kept?: (ex: string) => number | undefined; overhead?: number } = {}): number {
  if (!kneePlan(entries, date)) return DELTA;
  const steps = stepsOf(slots, o.warmups);
  const len = (delta: number) => planSeconds(steps, { kept: o.kept, overhead: o.overhead, knee: kneePlan(entries, date, delta) ?? undefined });
  const budget = minutes * 60;
  if (!(budget > 0) || len(DELTA) <= budget) return DELTA;
  // ln δ from DELTA up to e^12 ≈ 160 000 × DELTA (numerics: past any fatigue the grid allows, so every knee is 0); bisected.
  // If even there it doesn't fit, δ can't help (no knee in use, or every one already at the floor): left as is.
  let lo = 0, hi = 12;
  if (len(DELTA * Math.exp(hi)) > budget) return DELTA;
  for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (len(DELTA * Math.exp(mid)) <= budget) hi = mid; else lo = mid; }
  return DELTA * Math.exp(hi);
}
