import { liftKey } from '../ids';
import { dayOf, type Core, type Est, type LiftCore } from './capacity';
import { pool } from './pool';
import { liftSimilarity } from './tags';

// Item 12: is a lift on a plateau, or still progressing too slowly to show a new best? Asked of the learning core's per-session
// readings of the fatigue-adjusted level (LiftCore.obs: a late or pre-fatigued set isn't read as lost strength; a set stopped
// at its target is a lower bound), never of raw bests.
//
// A lift's recent slope (ln e1RM per week, weighted least squares over the window) is compared under two hypotheses:
//   plateau   m ~ N(0, se²)                       (the true slope is 0; what's seen is noise)
//   progress  m ~ N(μ_L, τ² + sd(μ_L)² + se²)      (the lift's own rate of progress, pooled person → family → lift)
// The person's share of plateau blocks π, progress rate μ and spread τ are learned (b) by EM over every lift's 8-week blocks; μ_L
// is pooled with learn/pool. P(plateau | m) = odds/(1 + odds), odds = min(1, π/(1 − π))·N(m; 0, se²)/N(m; μ_L, …); a stall needs
// P > ½. Evidence: P* = ½ is the cost ratio with both errors about as cheap (a: 12 §2.1, Kassiano 2022 — excessive variation may
// cost gains; a missed plateau still trains the muscle); the prior odds are capped at 1, so a history full of plateaus can't call
// one by itself: the window's data must favour flat (a: Kassiano 2022 and Baz-Valle 2019 — no study triggers rotation by a
// stall, and too much variation can hurt, so a suggestion needs evidence).

/** (a) A layoff: strength holds for about 3–4 weeks off and falls after (Bosquet 2013, detraining meta-analysis); 6 weeks. */
export const LAYOFF_DAYS = 42;
/** Owner rule (12 §4.1): a lift's first 2 sessions, and the first 2 after a layoff, re-adapt: no stall counts them, no test is set. */
export const REACCLIMATION = 2;
/**
 * (a) The window and block length, 8 weeks: at the 4.2 % session CV of a 1RM (Grgic 2020), telling flat from +1 %/week at about
 * 85 % takes ~8 weeks of twice-weekly sessions (12 §2.2: the slope's SE is ≈ 0.46 %/week over 8 weeks, 0.68 over 6).
 */
export const WINDOW_DAYS = 56;
/** (c) The least a slope is fitted from: 3 readings (one left over for its scatter) spanning 2 weeks (the stall rule's span). */
const MIN_POINTS = 3, MIN_SPAN = 14;
/** (a) Prior on the progress rate, ln e1RM per week: trained lifters gain 0.1–0.3 %/week (Latella 2020); SD 0.5 %/week spans novices. */
const MU_PRIOR = { mean: 0.002, sd: 0.005 } as const;
/** (c) Prior scale of the progress rate's block-to-block spread, worth two blocks: a prior only, the blocks re-estimate it. */
const TAU_PRIOR = { sd: 0.003, k: 2 } as const;

/** Each session's 0-based place in its run (a new run after a gap of LAYOFF_DAYS or more); `days` ascending. */
export function runIndex(days: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < days.length; i++) out.push(i && days[i] - days[i - 1] < LAYOFF_DAYS ? out[i - 1] + 1 : 0);
  return out;
}

export interface Slope { m: number; se: number; n: number; days: number }
/**
 * Weighted least squares slope of ln e1RM per week through readings (day, z, v). The SE from the readings' variances, scaled up by
 * the Birge ratio (χ²/dof) when they scatter more than their variances say (b). Null below MIN_POINTS or MIN_SPAN.
 */
export function slopeOf(pts: readonly { day: number; z: number; v: number }[]): Slope | null {
  const n = pts.length;
  if (n < MIN_POINTS || pts[n - 1].day - pts[0].day < MIN_SPAN) return null;
  let sw = 0, sx = 0, sz = 0;
  for (const p of pts) { const w = 1 / p.v; sw += w; sx += w * p.day / 7; sz += w * p.z; }
  const mx = sx / sw, mz = sz / sw;
  let sxx = 0, sxz = 0;
  for (const p of pts) { const w = 1 / p.v, dx = p.day / 7 - mx; sxx += w * dx * dx; sxz += w * dx * (p.z - mz); }
  if (!(sxx > 0)) return null;
  const m = sxz / sxx;
  let chi = 0;
  for (const p of pts) { const r = p.z - mz - m * (p.day / 7 - mx); chi += r * r / p.v; }
  const birge = Math.max(1, chi / (n - 2));
  return { m, se: Math.sqrt(birge / sxx), n, days: pts[n - 1].day - pts[0].day };
}

/** A lift's readings that count toward a trend: none from a run's first REACCLIMATION sessions. */
const counted = (obs: LiftCore['obs']): LiftCore['obs'] => {
  const idx = runIndex(obs.map((o) => o.day));
  return obs.filter((_, i) => idx[i] >= REACCLIMATION);
};

export interface TrendPrior {
  /** The share of 8-week blocks on a plateau, the progress rate (ln/week, with its SD) and its block-to-block spread. */
  pi: number; mu: Est; tau: number;
  /** How many blocks taught them. */
  blocks: number;
  /** A lift's own progress rate, pooled person → family → lift (any lift, with blocks or not). */
  lift(key: string): Est;
}
const npdf = (x: number, v: number) => Math.exp(-0.5 * x * x / v) / Math.sqrt(2 * Math.PI * v);

const PRIORS = new WeakMap<Core, TrendPrior>();
/**
 * The plateau/progress mixture (b), by EM over every lift's 8-week blocks (each run cut into consecutive windows from its first
 * counted session): responsibilities r_i = P(plateau | m_i); π their mean (with a uniform prior: +1 and +2); μ conjugate to its
 * prior (a: Latella) with weights (1 − r_i)/(τ² + se_i²); τ² by moments, shrunk to its prior (c). Then each lift's μ_L pooled.
 */
export function trendPrior(core: Core): TrendPrior {
  const hit = PRIORS.get(core);
  if (hit) return hit;
  const rows: { key: string; m: number; v: number }[] = [];
  for (const l of core.lifts.values()) {
    const obs = counted(l.obs);
    let i = 0;
    while (i < obs.length) {
      const d0 = obs[i].day;
      let j = i;
      // A block: from a counted session, the next 8 weeks, never across a layoff (its runs restart the count).
      while (j < obs.length && obs[j].day - d0 < WINDOW_DAYS && (j === i || obs[j].day - obs[j - 1].day < LAYOFF_DAYS)) j++;
      const s = slopeOf(obs.slice(i, j));
      if (s) rows.push({ key: l.key, m: s.m, v: s.se * s.se });
      i = j;
    }
  }
  let pi = 0.5, mu: number = MU_PRIOR.mean, muV: number = MU_PRIOR.sd ** 2, tau2 = TAU_PRIOR.sd ** 2;
  const r = new Float64Array(rows.length);
  for (let it = 0; it < 100; it++) {
    for (let i = 0; i < rows.length; i++) {
      const a = pi * npdf(rows[i].m, rows[i].v), b = (1 - pi) * npdf(rows[i].m - mu, tau2 + rows[i].v);
      r[i] = a + b > 0 ? a / (a + b) : 0.5;
    }
    let sr = 0, sw = MU_PRIOR.sd ** -2, swm = MU_PRIOR.mean * MU_PRIOR.sd ** -2, sq = 0, sp = 0;
    for (let i = 0; i < rows.length; i++) { sr += r[i]; const w = (1 - r[i]) / (tau2 + rows[i].v); sw += w; swm += w * rows[i].m; }
    const was = [pi, mu, tau2];
    pi = (sr + 1) / (rows.length + 2);
    mu = swm / sw; muV = 1 / sw;
    for (let i = 0; i < rows.length; i++) { sp += 1 - r[i]; sq += (1 - r[i]) * Math.max(0, (rows[i].m - mu) ** 2 - rows[i].v); }
    tau2 = (TAU_PRIOR.k * TAU_PRIOR.sd ** 2 + sq) / (TAU_PRIOR.k + sp);
    if (Math.abs(pi - was[0]) < 1e-7 && Math.abs(mu - was[1]) < 1e-9 && Math.abs(tau2 - was[2]) < 1e-12) break;
  }
  // Each lift's progress rate from its own blocks, weighted by how likely each is progress; pooled around the person's.
  const acc = new Map<string, { w: number; wm: number }>();
  rows.forEach((x, i) => {
    const w = (1 - r[i]) / (tau2 + x.v);
    if (!(w > 0)) return;
    const t = acc.get(x.key) ?? { w: 0, wm: 0 };
    t.w += w; t.wm += w * x.m; acc.set(x.key, t);
  });
  const items = [...acc].filter(([, t]) => t.w > 1e-9).map(([key, t]) => ({ key, est: t.wm / t.w, v: 1 / t.w }));
  const tau = Math.sqrt(tau2);
  const p = pool(items, liftSimilarity, { mean: mu, personSd: Math.sqrt(muV), liftSd: tau });
  const out: TrendPrior = { pi, mu: { mean: mu, sd: Math.sqrt(muV) }, tau, blocks: rows.length, lift: (k) => p.lift(k) };
  PRIORS.set(core, out);
  return out;
}

export interface Flatness {
  /** P(plateau) for the window, and the odds behind it. */
  p: number;
  /** The window's slope, ln e1RM per week, its SE, its readings and span (days). */
  slope: Slope;
  /** The lift's pooled progress rate it was weighed against. */
  mu: Est;
}

/**
 * How likely a lift is on a plateau on `today`: its counted readings over the last WINDOW_DAYS weighed as plateau against its
 * own progress (see the header). Null when the window holds too little to fit a slope: no evidence, no stall.
 */
export function flatness(core: Core, exercise: string, today: string): Flatness | null {
  const l = core.lifts.get(liftKey(exercise));
  if (!l) return null;
  const end = dayOf(today);
  const s = slopeOf(counted(l.obs).filter((o) => o.day <= end && end - o.day < WINDOW_DAYS));
  if (!s) return null;
  const prior = trendPrior(core);
  const mu = prior.lift(l.key);
  const v = s.se * s.se;
  const odds = Math.min(1, prior.pi / (1 - prior.pi)) * npdf(s.m, v) / npdf(s.m - mu.mean, prior.tau ** 2 + mu.sd ** 2 + v);
  return { p: Number.isFinite(odds) ? odds / (1 + odds) : 1, slope: s, mu };
}
