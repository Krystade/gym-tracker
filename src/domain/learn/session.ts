import { isCardio, isCardioEntry } from '../cardio';
import { liftKey } from '../ids';
import { liftFactsVersion } from '../lifts';
import { isWorking, settingsKey } from '../progression';
import { byOrderDone, doneAt, perLog, sameExercise } from '../stats';
import { supersets, type Superset } from '../superset';
import { isIsolation, paces, planSeconds, SET_WORK, stepsLeft, stepsOf, usualGap, type PlanSlot, type Step } from '../timing';
import type { SetEntry } from '../types';
import { dayOf } from './capacity';
import { logBefore } from './index';
import { backward, cholesky, forward } from './num';
import { LIFT_LOG_SD, PERSON_MIN } from './pace';
import { pool, type Pooled } from './pool';
import { liftSimilarity } from './tags';

// Item 11: how long a session takes HIM — the forecast (owner, 2026-10-20: "exactly accurate to what I do"). It describes; it
// prescribes nothing. How long a plan SHOULD take is timing.planSeconds (the timer's rests), which takes one number from here:
// what a switch to another lift costs him beyond a set-to-set gap.
//
// Evidence labels: (a) research, cited; (b) learned from his log, by the method named; (c) a neutral default that only shapes a
// display or a prior. Every number here only shapes a display, except `overhead`, which sizes plans (b).
//
// The unit is a gap: the seconds from one timed set's done-time to the next set's, the same day. A session is its first set
// (SET_WORK) and its gaps, so the forecast and the measured length (timing.sessionMinutes) span the same thing. The model (b):
//   ln g = β0 + β_c·compound + β_s·switch + β_w·after-warm-up + β_p·position + l_L + u_d + ε
// - compound: the set before the gap is of a compound lift (timing.isIsolation, the rest timer's two classes): "by lift kind".
// - switch: the next set is another lift: the walk and set-up. after-warm-up: the set before was a warm-up.
// - position: the gap's place in the session (0 for the gap after the first set), clamped to the places seen (no trend run on
//   past his longest session).
// - l_L: the lift's own deviation (the lift before the gap: its rest), partially pooled person → family → lift (learn/pool,
//   learn/tags similarity; a lift with one gap sits near its family, one with many on its own).
// - u_d: the day's own pace (busy gym, short of time), a random effect with its spread τ² learned (b: one-way ANOVA moments).
// - β: Zellner's g-prior at g = n, the unit-information prior (a: Kass & Wasserman 1995, JASA 90:928): centred on no effect and
//   worth one gap, so his data rules from the start; an effect never seen (no compound lift timed yet) is 0 (c).
// Fitted in logs (gaps are skewed; "twice as long" and "half as long" are alike), then put back in seconds by Duan's smearing
// (a: Duan 1983, JASA 78:605): the mean of exp(residual), so a sum of gaps is predicted by its mean, not its median.
//
// Recency (b): every gap is weighted 2^(−age/h), a power prior on old sessions (a: Ibrahim & Chen 2000, Stat Sci 15:46). h is
// averaged over HALF_LIVES by how well each predicted every next timed day from the days before it (prequential likelihood,
// Bayesian model averaging, as learn/pain). A layoff leaves every gap older: their weight, so what the model knows, falls by
// 2^(−days/h), and the band widens (owner: layoffs widen uncertainty) while the point stays.
//
// Left out (owner: exclude breaks and app-closed outliers): a gap above Tukey's upper fence, Q3 + 1.5·IQR of the residuals of a
// first fit (a: Tukey 1977, Exploratory Data Analysis — the boxplot's outlier rule): a break, or a set logged when the app came
// back, not a rest. (c) Also out: gaps touching a set entered late (its time is a guess), a cardio bout (its own minutes are
// its time), a superset's switches and round rests (timing.paces: not priced in a plan), and days with an untimed set among
// timed ones (the spacing is unknown). Short gaps stay: back-to-back entries are time he spent, and the sum keeps them.

/** Columns: intercept, compound, switch, after a warm-up, position. */
const P = 5;
/** (c) Half-lives on the recency grid, days: doubling, from two weeks to over a year; uniform prior (the data weighs them). */
export const HALF_LIVES = [14, 28, 56, 112, 224, 448] as const;
/** (c) Timed days before a forecast: one day can't tell its own pace from his (the day effect needs a second). */
export const MIN_DAYS = 2;
/** (a) Tukey's outlier fence, in IQRs above the third quartile. */
const FENCE = 1.5;
/** (c) The band shown: the middle 80 % of where a session lands (display only). z of the 90th percentile. */
const Z80 = 1.2815515655446004;
/** Backfitting rounds (fixed effects, then lifts, then days): numerics, not a model parameter. */
const ROUNDS = 4;
/** A half-life whose posterior weight is under this is left out of the average (numerics). */
const MIN_WEIGHT = 1e-4;

const secs = (e: SetEntry) => doneAt(e) / 1000;
const cardio = (e: SetEntry) => isCardioEntry(e) || isCardio(e.exercise);

/** One gap's columns. */
function cols(a: { exercise: string; warmup: boolean; cardio: boolean }, bExercise: string, pos: number, out: Float64Array, o: number): void {
  out[o] = 1;
  out[o + 1] = a.cardio || isIsolation(a.exercise) ? 0 : 1;
  out[o + 2] = liftKey(a.exercise) !== liftKey(bExercise) ? 1 : 0;
  out[o + 3] = a.warmup ? 1 : 0;
  out[o + 4] = pos;
}

// ---- A day's gaps -----------------------------------------------------------------------------------------------------

/** One day's gaps: ln seconds, columns (P each), and the lift before each gap; their moments, once asked. */
interface DayGaps { n: number; y: Float64Array; x: Float64Array; key: string[]; m?: Moments }
const NONE: DayGaps = { n: 0, y: new Float64Array(0), x: new Float64Array(0), key: [] };

/**
 * A day's gaps (see the header for what's left out). `usual(ex)`: the lift's usual set-to-set time, which tells a superset's
 * switch from a rest (timing.supersets); asked only of a day whose lifts weren't each done in one run (else no superset).
 */
function readDay(sets: readonly SetEntry[], usual: () => (ex: string) => number): DayGaps {
  const lifts = sets.filter((e) => !cardio(e));
  if (!lifts.length || lifts.some((e) => !e.loggedAt)) return NONE;
  const day = sets.filter((e) => e.loggedAt).sort(byOrderDone);
  // A superset needs a lift to come back after another: each lift in one run has none.
  const seen = new Set<string>();
  let back = false;
  for (let i = 0; i < day.length && !back; i++) {
    const k = liftKey(day[i].exercise);
    if (i && k !== liftKey(day[i - 1].exercise) && seen.has(k)) back = true;
    seen.add(k);
  }
  const of = new Map<string, Superset>();
  if (back) for (const g of supersets(day, day[0].date, usual())) for (const id of g.after.keys()) of.set(id, g);
  const y: number[] = [], x: number[] = [], key: string[] = [];
  const row = new Float64Array(P);
  for (let i = 1; i < day.length; i++) {
    const a = day[i - 1], b = day[i];
    if (a.enteredAt || b.enteredAt || cardio(a) || cardio(b)) continue;
    if (of.get(a.id)?.keys.includes(settingsKey(b.exercise))) continue;
    const g = secs(b) - secs(a);
    if (!(g > 0)) continue;
    cols({ exercise: a.exercise, warmup: a.flags.includes('warmup'), cardio: false }, b.exercise, i - 1, row, 0);
    y.push(Math.log(g)); x.push(...row); key.push(liftKey(a.exercise));
  }
  return y.length ? { n: y.length, y: Float64Array.from(y), x: Float64Array.from(x), key } : NONE;
}

// A day's gaps, cached by its sets: the store never changes a set in place, so the same objects are the same day (as
// learn/pace). A day that could hold a superset is read again when its lifts' usual times move.
const DAYS = new WeakMap<SetEntry, { sets: readonly SetEntry[]; gaps: DayGaps; usual: string | null }>();
function dayGaps(sets: readonly SetEntry[], usualOf: () => (ex: string) => number): DayGaps {
  const hit = DAYS.get(sets[0]);
  let same = !!hit && hit.sets.length === sets.length;
  for (let i = 0; same && i < sets.length; i++) same = hit!.sets[i] === sets[i];
  let sig: string | null = null;
  const usual = () => { const u = usualOf(); sig = [...new Set(sets.map((e) => settingsKey(e.exercise)))].map((k) => u(k)).join(); return u; };
  if (same && (hit!.usual == null || (usual(), sig === hit!.usual))) return hit!.gaps;
  const gaps = readDay(sets, usual);
  DAYS.set(sets[0], { sets: [...sets], gaps, usual: sig });
  return gaps;
}

// ---- Least squares ----------------------------------------------------------------------------------------------------

/** Weighted moments: Σw, Σw·x, Σw·y, Σw·x·xᵀ, Σw·x·y (raw; x includes the intercept's 1). */
class Moments {
  sw = 0; sy = 0; syy = 0; sx = new Float64Array(P); sxx = new Float64Array(P * P); sxy = new Float64Array(P);
  add(x: ArrayLike<number>, o: number, y: number, w: number): void {
    this.sw += w; this.sy += w * y; this.syy += w * y * y;
    for (let j = 0; j < P; j++) {
      const xj = x[o + j];
      this.sx[j] += w * xj; this.sxy[j] += w * xj * y;
      for (let k = 0; k < P; k++) this.sxx[j * P + k] += w * xj * x[o + k];
    }
  }
  scale(f: number): void {
    this.sw *= f; this.sy *= f; this.syy *= f;
    for (let j = 0; j < P; j++) { this.sx[j] *= f; this.sxy[j] *= f; }
    for (let j = 0; j < P * P; j++) this.sxx[j] *= f;
  }
  plus(m: Moments, f = 1): void {
    this.sw += f * m.sw; this.sy += f * m.sy; this.syy += f * m.syy;
    for (let j = 0; j < P; j++) { this.sx[j] += f * m.sx[j]; this.sxy[j] += f * m.sxy[j]; }
    for (let j = 0; j < P * P; j++) this.sxx[j] += f * m.sxx[j];
  }
}

/**
 * A fit of the fixed effects: β (β0 at the weighted mean), the means, and the Cholesky factor of the centred Sxx on the
 * columns that vary (`active`), for (x − x̄)ᵀ·Sxx⁻¹·(x − x̄).
 */
interface Ls { beta: Float64Array; xbar: Float64Array; sw: number; shrink: number; active: number[]; chol: Float64Array | null }

function solve(m: Moments): Ls {
  const sw = m.sw, xbar = new Float64Array(P), beta = new Float64Array(P);
  if (!(sw > 0)) return { beta, xbar, sw: 0, shrink: 0, active: [], chol: null };
  for (let j = 0; j < P; j++) xbar[j] = m.sx[j] / sw;
  const ybar = m.sy / sw;
  // Centred cross-products; a column that doesn't vary (never seen, or always the same) has no effect (c).
  const active: number[] = [];
  for (let j = 1; j < P; j++) if (m.sxx[j * P + j] - sw * xbar[j] * xbar[j] > 1e-9 * sw * Math.max(1, xbar[j] * xbar[j])) active.push(j);
  const k = active.length;
  const shrink = sw / (sw + 1); // the g-prior at g = Σw
  let chol: Float64Array | null = null;
  if (k) {
    const A = new Float64Array(k * k), b = new Float64Array(k);
    const fill = (jit: number) => {
      for (let r = 0; r < k; r++) {
        const j = active[r];
        b[r] = m.sxy[j] - sw * xbar[j] * ybar;
        for (let c = 0; c < k; c++) { const l = active[c]; A[r * k + c] = m.sxx[j * P + l] - sw * xbar[j] * xbar[l] + (r === c ? jit * sw : 0); }
      }
    };
    fill(0);
    let ok = cholesky(A, k);
    for (let jit = 1e-10; !ok && jit < 1; jit *= 100) { fill(jit); ok = cholesky(A, k); }
    if (ok) {
      chol = A;
      const sol = backward(A, k, forward(A, k, b));
      for (let r = 0; r < k; r++) beta[active[r]] = shrink * sol[r];
    }
  }
  beta[0] = ybar;
  for (let j = 1; j < P; j++) beta[0] -= beta[j] * xbar[j];
  return { beta, xbar, sw, shrink, active, chol };
}

/** (x − x̄)ᵀ·Sxx⁻¹·(x − x̄) over the columns that vary: the squared length of L⁻¹(x − x̄). */
function quad(ls: Ls, x: ArrayLike<number>): number {
  if (!ls.chol) return 0;
  const k = ls.active.length, d = new Float64Array(k);
  for (let r = 0; r < k; r++) d[r] = x[ls.active[r]] - ls.xbar[ls.active[r]];
  const z = forward(ls.chol, k, d);
  let q = 0;
  for (let r = 0; r < k; r++) q += z[r] * z[r];
  return q;
}
const dot = (b: ArrayLike<number>, x: ArrayLike<number>, o = 0) => { let s = 0; for (let j = 0; j < P; j++) s += b[j] * x[o + j]; return s; };
/** βᵀ·M·β for a P×P M. */
const quadB = (b: ArrayLike<number>, M: ArrayLike<number>) => { let s = 0; for (let j = 0; j < P; j++) for (let k = 0; k < P; k++) s += b[j] * M[j * P + k] * b[k]; return s; };

// ---- The fit ----------------------------------------------------------------------------------------------------------

/** A timed day's gaps kept (after the fence): its moments, and per lift (cell) the count, Σx and Σy. */
interface Day { no: number; gaps: DayGaps; keep: Uint8Array | null; m: Moments; cells: { lift: number; n: number; sx: Float64Array; sy: number }[] }

/** One recency weighting's fit (half-life h). */
interface Member {
  h: number; ls: Ls; lifts: Pooled; liftMean: Float64Array; sigW2: number; tau2: number;
  /** Smearing: exp(residual) averaged over the gaps (S, marginal over the day); the within-day CV² (phiW). */
  S: number; phiW: number;
  /** Information the fit holds: Σw over gaps and over days. */
  sw: number; swDays: number;
  /** What a switch adds to a gap, s, on his switches (b), ≥ 0. */
  overhead: number;
}

/**
 * Σ r² and Σ r per day for r = y − xβ − l (the lifts' deviations by cell), from the day's moments: the residuals without a
 * pass over its gaps.
 */
function dayResid(d: Day, beta: Float64Array, liftMean: ArrayLike<number>): { s: number; ss: number } {
  const m = d.m;
  let s = m.sy - dot(beta, m.sx), ss = m.syy - 2 * dot(beta, m.sxy) + quadB(beta, m.sxx);
  for (const c of d.cells) {
    const l = liftMean[c.lift];
    s -= l * c.n;
    ss += -2 * l * (c.sy - dot(beta, c.sx)) + l * l * c.n;
  }
  return { s, ss };
}

/** Within-day and between-day variance (one-way ANOVA moments, unbalanced: Searle 1971's n0), from each day's Σr and Σr². */
function anova(days: readonly Day[], sums: { s: number; ss: number }[], dof: number): { sigW2: number; tau2: number } {
  let N = 0, ssw = 0, tot = 0, sm2 = 0;
  days.forEach((d, i) => { const m = d.m.sw; N += m; ssw += sums[i].ss - (sums[i].s * sums[i].s) / m; tot += sums[i].s; sm2 += m * m; });
  const D = days.length, grand = tot / N;
  let ssb = 0;
  days.forEach((d, i) => { ssb += d.m.sw * (sums[i].s / d.m.sw - grand) ** 2; });
  const sigW2 = Math.max(1e-6, ssw / Math.max(1, N - D - dof));
  if (D < 2) return { sigW2, tau2: 0 };
  const n0 = (N - sm2 / N) / (D - 1);
  return { sigW2, tau2: Math.max(0, (ssb / (D - 1) - sigW2) / n0) };
}

function fitMember(days: readonly Day[], keys: readonly string[], wd: Float64Array, h: number, sigW2_0: number): Member {
  const L = keys.length, D = days.length;
  const liftMean = new Float64Array(L), u = new Float64Array(D);
  const fixed = new Moments(); // Σ w·x·xᵀ etc.: the same every round
  for (let i = 0; i < D; i++) fixed.plus(days[i].m, wd[i]);
  let ls = solve(fixed), lifts: Pooled | null = null;
  let sigW2 = sigW2_0, tau2 = 0;
  for (let round = 0; round < ROUNDS; round++) {
    // Fixed effects on y less the lifts' and days' own.
    const m = new Moments();
    m.sw = fixed.sw; m.sx.set(fixed.sx); m.sxx.set(fixed.sxx);
    m.sy = fixed.sy; m.sxy.set(fixed.sxy);
    for (let i = 0; i < D; i++) {
      const d = days[i], w = wd[i];
      m.sy -= w * u[i] * d.m.sw;
      for (let j = 0; j < P; j++) m.sxy[j] -= w * u[i] * d.m.sx[j];
      for (const c of d.cells) {
        const l = liftMean[c.lift];
        m.sy -= w * l * c.n;
        for (let j = 0; j < P; j++) m.sxy[j] -= w * l * c.sx[j];
      }
    }
    ls = solve(m);
    // The lifts' own deviations, pooled person → family → lift.
    const s = new Float64Array(L), sw = new Float64Array(L);
    for (let i = 0; i < D; i++) {
      const w = wd[i];
      for (const c of days[i].cells) { s[c.lift] += w * (c.sy - dot(ls.beta, c.sx) - u[i] * c.n); sw[c.lift] += w * c.n; }
    }
    const items = [];
    for (let k = 0; k < L; k++) if (sw[k] > 0) items.push({ key: keys[k], est: s[k] / sw[k], v: sigW2 / sw[k] });
    lifts = pool(items, liftSimilarity, { mean: 0, personSd: Math.sqrt(sigW2 / Math.max(ls.sw, 1e-9)), liftSd: LIFT_LOG_SD });
    for (let k = 0; k < L; k++) liftMean[k] = sw[k] > 0 ? lifts.lift(keys[k]).mean : 0;
    // The days' own pace, shrunk by how much days differ (τ²) against the noise within one (σ²_w).
    const sums = days.map((d) => dayResid(d, ls.beta, liftMean));
    ({ sigW2, tau2 } = anova(days, sums, P));
    for (let i = 0; i < D; i++) u[i] = tau2 > 0 ? sums[i].s / (days[i].m.sw + sigW2 / tau2) : 0;
  }
  // Back to seconds (Duan's smearing), what a switch costs, and what the fit knows: one pass over the gaps.
  let sw = 0, sS = 0, sW = 0, sW2 = 0, swDays = 0, os = 0, ow = 0;
  const ix = new Map(keys.map((k, i) => [k, i]));
  const eb = 1 - Math.exp(-ls.beta[2]);
  for (let i = 0; i < D; i++) {
    const d = days[i], w = wd[i], g = d.gaps;
    swDays += w;
    for (let j = 0; j < g.n; j++) {
      if (d.keep && !d.keep[j]) continue;
      const r = g.y[j] - dot(ls.beta, g.x, j * P) - liftMean[ix.get(g.key[j])!];
      const er = Math.exp(r), ew = Math.exp(r - u[i]);
      sw += w; sS += w * er; sW += w * ew; sW2 += w * ew * ew;
      if (g.x[j * P + 2] === 1) { os += w * Math.exp(g.y[j] - r) * eb; ow += w; }
    }
  }
  const S = sS / sw, Sw = sW / sw, phiW = Math.max(0, sW2 / sw / (Sw * Sw) - 1);
  // A switch's extra seconds on the switches he made: the gap's mean less the same gap's without the switch (b).
  return { h, ls, lifts: lifts!, liftMean, sigW2, tau2, S, phiW, sw, swDays, overhead: ow > 0 ? Math.max(0, (os / ow) * S) : 0 };
}

/**
 * The prequential log likelihood of each half-life: every timed day after the first, its mean ln gap predicted from the days
 * before it (fixed effects, weights 2^(−age/h)) against N(0, τ² + σ²_w/m + the estimate's own variance). σ²_w and τ² are a
 * whole-log fit's (nuisance, shared by every h).
 */
function prequential(days: readonly Day[], sigW2: number, tau2: number): number[] {
  return HALF_LIVES.map((h) => {
    const acc = new Moments();
    let swDays = 0, ll = 0, count = 0;
    const xm = new Float64Array(P);
    for (let k = 0; k < days.length; k++) {
      if (k) { const f = 2 ** (-(days[k].no - days[k - 1].no) / h); acc.scale(f); swDays *= f; }
      const d = days[k].m;
      if (k && count >= PERSON_MIN) {
        const ls = solve(acc);
        for (let j = 0; j < P; j++) xm[j] = d.sx[j] / d.sw;
        const r = d.sy / d.sw - dot(ls.beta, xm);
        const s2 = tau2 + sigW2 / d.sw + sigW2 / acc.sw + tau2 / swDays + (sigW2 + tau2) * ls.shrink * quad(ls, xm);
        ll += -0.5 * Math.log(2 * Math.PI * s2) - (r * r) / (2 * s2);
      }
      acc.plus(d); swDays += 1; count += d.sw;
    }
    return ll;
  });
}

export interface Forecast {
  /** Seconds from the first set's start to the last planned set's done-time, at his pace: the mean, and the middle 80 %. */
  seconds: number; lo: number; hi: number;
  /** Seconds still to go after the last set logged today (all of it before the first). */
  remaining: number;
  /** When the last planned set should be done (epoch ms), once the session has a timed set; else null. */
  endsAt: number | null;
}

export interface PaceFit {
  days: number; gaps: number;
  /** Gaps left out as breaks (Tukey's fence). */
  breaks: number;
  /** The last timed day it learned from (day number). */
  lastDay: number;
  /** Each half-life's posterior weight (HALF_LIVES order). */
  weights: number[];
  /** The fixed effects, averaged over the half-lives (ln s): intercept, compound, switch, after a warm-up, per position. */
  beta: number[];
  /** The day effect's and the within-day noise's variance (ln s). */
  tau2: number; sigW2: number;
  /** A lift's own pooled deviation (ln s), averaged over the half-lives; its family's for a lift never timed. */
  lift(name: string): { mean: number; sd: number };
  /** What a switch to another lift adds over a set-to-set gap, s (b, ≥ 0): the plan's overhead (timing.planSeconds). */
  overhead: number;
  /**
   * The session at his pace: `steps` still to do, after `today` (the day's sets so far, any order) on `date`. Today's own gaps
   * move it by how today is going, shrunk by τ² against σ²_w (b: the empirical-Bayes day effect).
   */
  forecast(steps: readonly Step[], o: { date: string; today?: readonly SetEntry[] }): Forecast;
}

function fit(entries: readonly SetEntry[]): PaceFit | null {
  const byDate = new Map<string, SetEntry[]>();
  for (const e of entries) { const d = byDate.get(e.date); if (d) d.push(e); else byDate.set(e.date, [e]); }
  let usual: ((ex: string) => number) | null = null;
  const usualOf = () => { if (!usual) { const pc = paces(entries as SetEntry[]); usual = (ex) => usualGap(pc, ex); } return usual; };
  const read: { no: number; gaps: DayGaps }[] = [];
  let n = 0;
  for (const date of [...byDate.keys()].sort()) {
    const gaps = dayGaps(byDate.get(date)!, usualOf);
    if (gaps.n) { read.push({ no: dayOf(date), gaps }); n += gaps.n; }
  }
  if (n < PERSON_MIN || read.length < MIN_DAYS) return null;

  // Tukey's fence on the residuals of a first fit (fixed effects, every gap alike).
  const all = new Moments();
  const dayM = read.map(({ gaps: g }) => { if (!g.m) { g.m = new Moments(); for (let j = 0; j < g.n; j++) g.m.add(g.x, j * P, g.y[j], 1); } return g.m; });
  for (const m of dayM) all.plus(m);
  const ls0 = solve(all);
  const res = new Float64Array(n);
  let at = 0;
  for (const { gaps: g } of read) for (let j = 0; j < g.n; j++) res[at++] = g.y[j] - dot(ls0.beta, g.x, j * P);
  const sorted = res.slice().sort();
  const q = (p: number) => { const i = (n - 1) * p, lo = Math.floor(i); return sorted[lo] + (sorted[Math.min(lo + 1, n - 1)] - sorted[lo]) * (i - lo); };
  const fence = q(0.75) + FENCE * (q(0.75) - q(0.25));
  const isBreak = (y: number, x: ArrayLike<number>, o: number) => y - dot(ls0.beta, x, o) > fence;

  // The days as kept, with their moments and their lifts' cells.
  const keys: string[] = [], kix = new Map<string, number>();
  const days: Day[] = [];
  let breaks = 0, kept = 0;
  read.forEach(({ no, gaps: g }, i) => {
    let keep: Uint8Array | null = null, m = dayM[i];
    for (let j = 0; j < g.n; j++) if (isBreak(g.y[j], g.x, j * P)) { keep ??= new Uint8Array(g.n).fill(1); keep[j] = 0; breaks++; }
    if (keep) { m = new Moments(); for (let j = 0; j < g.n; j++) if (keep[j]) m.add(g.x, j * P, g.y[j], 1); }
    if (!m.sw) return;
    const cells = new Map<number, { lift: number; n: number; sx: Float64Array; sy: number }>();
    for (let j = 0; j < g.n; j++) {
      if (keep && !keep[j]) continue;
      let k = kix.get(g.key[j]);
      if (k === undefined) { k = keys.length; kix.set(g.key[j], k); keys.push(g.key[j]); }
      let c = cells.get(k);
      if (!c) cells.set(k, c = { lift: k, n: 0, sx: new Float64Array(P), sy: 0 });
      c.n++; c.sy += g.y[j];
      for (let p = 0; p < P; p++) c.sx[p] += g.x[j * P + p];
    }
    days.push({ no, gaps: g, keep, m, cells: [...cells.values()] });
    kept += m.sw;
  });
  if (kept < PERSON_MIN || days.length < MIN_DAYS) return null;
  const lastDay = days.at(-1)!.no;

  // The noise's scale from the fixed effects alone (shared by every half-life), then each half-life's weight by how well it
  // predicted each next day, and each one's full fit.
  const k0 = new Moments();
  for (const d of days) k0.plus(d.m);
  const lsK = solve(k0);
  const comp = anova(days, days.map((d) => dayResid(d, lsK.beta, new Float64Array(keys.length))), P);
  const ll = prequential(days, comp.sigW2, comp.tau2);
  const top = Math.max(...ll);
  const raw = ll.map((x) => Math.exp(x - top));
  const tot = raw.reduce((a, b) => a + b, 0);
  const weights = raw.map((x) => x / tot);
  const live: { m: Member; w: number }[] = [];
  HALF_LIVES.forEach((h, j) => {
    if (weights[j] < MIN_WEIGHT) return;
    const wd = Float64Array.from(days, (d) => 2 ** (-(lastDay - d.no) / h));
    live.push({ m: fitMember(days, keys, wd, h, comp.sigW2), w: weights[j] });
  });
  const wsum = live.reduce((a, x) => a + x.w, 0);
  for (const x of live) x.w /= wsum;
  const avg = (f: (m: Member) => number) => live.reduce((a, x) => a + x.w * f(x.m), 0);
  let posMax = 0;
  for (const d of days) posMax = Math.max(posMax, d.m.sxx[4 * P + 4] > 0 ? maxPos(d) : 0);

  return {
    days: days.length, gaps: kept, breaks, lastDay, weights,
    beta: Array.from({ length: P }, (_, j) => avg((m) => m.ls.beta[j])),
    tau2: avg((m) => m.tau2), sigW2: avg((m) => m.sigW2),
    lift: (name) => {
      const k = liftKey(name);
      const mean = avg((m) => m.lifts.lift(k).mean);
      return { mean, sd: Math.sqrt(avg((m) => m.lifts.lift(k).sd ** 2 + (m.lifts.lift(k).mean - mean) ** 2)) };
    },
    overhead: avg((m) => m.overhead),
    forecast: (steps, o) => forecast(live, steps, o, { lastDay, posMax, isBreak, usualOf }),
  };
}

/** The last place (position) a kept gap of the day has. */
function maxPos(d: Day): number {
  let p = 0;
  for (let j = 0; j < d.gaps.n; j++) if (!d.keep || d.keep[j]) p = Math.max(p, d.gaps.x[j * P + 4]);
  return p;
}

function forecast(live: readonly { m: Member; w: number }[], steps: readonly Step[], o: { date: string; today?: readonly SetEntry[] },
  c: { lastDay: number; posMax: number; isBreak: (y: number, x: ArrayLike<number>, o: number) => boolean; usualOf: () => (ex: string) => number }): Forecast {
  const today = (o.today ?? []).filter((e) => e.loggedAt).sort(byOrderDone);
  const last = today.at(-1);
  const elapsed = last ? secs(last) - secs(today[0]) + SET_WORK : 0;
  // The gaps to come: from the last set logged (or the first step) on, each with its place in the session.
  const planned: { x: Float64Array; key: string | null; plus: number }[] = [];
  let prev: { exercise: string; warmup: boolean; cardio: boolean } | null = last ? { exercise: last.exercise, warmup: last.flags.includes('warmup'), cardio: cardio(last) } : null;
  let pos = Math.max(0, today.length - 1), lead = 0;
  for (const s of steps) {
    const bout = s.seconds != null;
    if (!prev) lead = s.seconds ?? SET_WORK; // the first set's own time
    else {
      const x = new Float64Array(P);
      cols(prev, s.exercise, Math.min(pos, c.posMax), x, 0);
      if (prev.cardio) x[2] = 1; // out of a cardio bout: a switch, at the person's level
      // Into a cardio bout: the gap's set is the bout itself.
      planned.push({ x, key: prev.cardio ? null : liftKey(prev.exercise), plus: bout ? s.seconds! - SET_WORK : 0 });
      pos++;
    }
    prev = { exercise: s.exercise, warmup: !!s.warmup, cardio: bout };
  }
  // How today is going: its own gaps (a break today is in the time so far, and says nothing of the pace).
  const tg = today.length > 1 ? readDay(o.today!, c.usualOf) : NONE;
  const todays: number[] = [];
  for (let j = 0; j < tg.n; j++) if (!c.isBreak(tg.y[j], tg.x, j * P)) todays.push(j);
  const layoff = Math.max(0, dayOf(o.date) - c.lastDay);
  const per = live.map(({ m, w }) => {
    let rs = 0;
    for (const j of todays) rs += tg.y[j] - dot(m.ls.beta, tg.x, j * P) - m.lifts.lift(tg.key[j]).mean;
    const mt = todays.length;
    const uT = mt && m.tau2 > 0 ? rs / (mt + m.sigW2 / m.tau2) : 0;
    const vT = m.tau2 > 0 ? 1 / (1 / m.tau2 + mt / m.sigW2) : 0;
    const factor = Math.exp(uT + (vT - m.tau2) / 2);
    let R = 0, within = 0, plus = 0;
    const share = new Map<string, number>();
    const cbar = new Float64Array(P);
    for (const q of planned) {
      const mu = Math.exp(dot(m.ls.beta, q.x) + (q.key == null ? 0 : m.lifts.lift(q.key).mean)) * m.S * factor;
      R += mu; within += mu * mu * m.phiW; plus += q.plus;
      for (let j = 0; j < P; j++) cbar[j] += mu * q.x[j];
      if (q.key) share.set(q.key, (share.get(q.key) ?? 0) + mu);
    }
    let vP = 0;
    if (R > 0) {
      for (let j = 0; j < P; j++) cbar[j] /= R;
      // What the fit doesn't know: β0 (gaps and days, each at its weight), the effects at this plan's mix, the lifts' own.
      vP = m.sigW2 / m.sw + m.tau2 / m.swDays + (m.sigW2 + m.tau2) * m.ls.shrink * quad(m.ls, cbar);
      for (const [k, s] of share) vP += (s / R) ** 2 * m.lifts.lift(k).sd ** 2;
      // A layoff: every gap that much older, worth 2^(−days/h) of what it was, down to one gap's worth at the least (the
      // unit-information floor, as for β): past that, his level is known no better than one gap tells it.
      vP = Math.max(vP, Math.min(vP * 2 ** (layoff / m.h), m.sigW2 + m.tau2));
    }
    return { w, mean: R + plus, v: within + R * R * (Math.exp(vT) - 1) + R * R * (Math.exp(vP) - 1) };
  });
  const mean = per.reduce((a, x) => a + x.w * x.mean, 0);
  const v = Math.max(0, per.reduce((a, x) => a + x.w * (x.v + x.mean * x.mean), 0) - mean * mean);
  const s2 = mean > 0 ? Math.log(1 + v / (mean * mean)) : 0, s = Math.sqrt(s2);
  const base = elapsed + lead;
  return {
    seconds: base + mean, remaining: lead + mean,
    lo: base + mean * Math.exp(-s2 / 2 - Z80 * s), hi: base + mean * Math.exp(-s2 / 2 + Z80 * s),
    endsAt: last ? doneAt(last) + mean * 1000 : null,
  };
}

/** His pace as learned from a log (once per log array): null under MIN_DAYS timed days or PERSON_MIN gaps. */
export const paceFit: (entries: readonly SetEntry[]) => PaceFit | null = perLog(fit);
/**
 * His pace as of the days before `date`: a forecast doesn't learn from the session it forecasts (today moves it as a day
 * effect). A set logged today makes a new log, but the days before are the same sets: the last fit is kept for them.
 */
let LAST: { date: string; log: readonly SetEntry[]; facts: number; fit: PaceFit | null } | null = null;
export function paceBefore(entries: readonly SetEntry[], date: string): PaceFit | null {
  const log = logBefore(entries, date), facts = liftFactsVersion();
  if (LAST && LAST.date === date && LAST.facts === facts && LAST.log.length === log.length) {
    let same = true;
    for (let i = 0; same && i < log.length; i++) same = LAST.log[i] === log[i];
    if (same) return LAST.fit;
  }
  const fit = paceFit(log);
  LAST = { date, log, facts, fit };
  return fit;
}

/** Owner, 2026-10-20: when the plan's length and his pace differ by more than this (s), both are shown. */
export const SHOW_BOTH = 600;

export interface Lengths {
  /** How long the plan should take (timing.planSeconds: the timer's rests, and his switch overhead once learned). */
  plan: number;
  /** At his pace: the day's sets so far and the plan's sets still to do. Null until MIN_DAYS days are timed. */
  pace: Forecast | null;
  /** Show the pace beside the plan (owner): it's more than SHOW_BOTH away. */
  both: boolean;
  /** The day's first timed set's done-time (epoch ms), and when the plan should end: at his pace, else at the plan's. */
  started: number | null; endsAt: number | null;
}

/**
 * A planned day's length and his pace for it, on `date`. `slots` are the sets to do (swaps applied, skips left out);
 * `warmups(ex)`: the warm-ups the day's first lift gets (timing.stepsOf); `kept(ex)`: his rest setting. `fresh`: a day not
 * started (a program's), so the date's own sets are not read.
 */
export function sessionLengths(entries: readonly SetEntry[], date: string, slots: readonly PlanSlot[],
  o: { warmups?: (ex: string) => number; kept?: (ex: string) => number | undefined; fresh?: boolean } = {}): Lengths {
  const fit = paceBefore(entries, date);
  const warmups = o.warmups ?? (() => 0);
  const all = stepsOf(slots, warmups);
  const plan = planSeconds(all, { kept: o.kept, overhead: fit?.overhead ?? 0 });
  const day = o.fresh ? [] : entries.filter((e) => e.date === date);
  const timed = day.filter((e) => e.loggedAt).sort(byOrderDone);
  const first = timed[0] ?? null;
  const count = (ex: string, f: (e: SetEntry) => boolean) => day.reduce((n, e) => n + (sameExercise(e.exercise, ex) && f(e) ? 1 : 0), 0);
  const steps = first ? stepsLeft(slots, (ex) => count(ex, (e) => isWorking(e) || !!e.cardio), timed.at(-1)!.exercise,
    (ex) => Math.max(0, warmups(ex) - count(ex, (e) => e.flags.includes('warmup')))) : all;
  const pace = fit ? fit.forecast(steps, { date, today: day }) : null;
  const started = first ? doneAt(first) : null;
  return {
    plan, pace, both: !!pace && Math.abs(pace.seconds - plan) > SHOW_BOTH, started,
    endsAt: pace?.endsAt ?? (started == null ? null : started + (plan - SET_WORK) * 1000),
  };
}
