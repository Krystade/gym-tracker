import { isCardio, isCardioEntry } from '../cardio';
import { isHold } from '../care';
import { liftKey } from '../ids';
import { liftFactsVersion, resolveLift } from '../lifts';
import type { Vector } from '../muscles';
import { byOrderDone, doneAt } from '../stats';
import type { SetEntry } from '../types';
import { inOrder, inv3, truncBelow } from './num';
import { pool, type Posterior } from './pool';
import { liftSimilarity, overlap } from './tags';

// The learning core's capacity equation (00-core §1.2). For working set s of lift L:
//
//   reps to failure  F_s = C_L(w_s) − Δ_s + ε_s,        C_L(w) = κ_L·(E_L,t / w − 1)      (fresh capacity, Epley-shaped)
//   Δ_s = A_same·Σ_{prior sets of L} K(Δt) + A_cross·Σ_{prior sets of other lifts} o·K(Δt) + γ·(prior sets of other lifts)
//   K(Δt) = ρ + (1 − ρ)·exp(−Δt/τ)
//
// E_L,t (the level, an e1RM) is a random walk per lift; o is muscle overlap (learn/tags). Rest enters only through K. Reps to
// failure are read from logged RIR, from a missed target (near failure), as a lower bound when a set stopped at its target or
// hurt, or from the person's habitual RIR. Every rule's evidence is labelled: (a) research, (b) learned from his data,
// (c) a neutral default that only shapes a prior or a display.
//
// Fit (00-core §1.3), for one profile's log: alternate (1) a leave-one-session-out level per lift (Kalman, two filters), which
// gives each set's predicted fresh capacity without having seen its own session, and (2) a Bayesian linear regression of the
// shortfall (predicted − observed) on the fatigue features, for every (τ, ρ) on a grid, weighted by marginal likelihood.
// Two fixes over the prototype (owner, 2026-10-20): each lift gets its own intercept in (2), so a level that lags the truth
// can't be read as fatigue (the prototype recovered γ about 40 % low); and per-lift values are pooled with learn/pool, whose
// spread is estimated rather than floored (the prototype's per-lift shrinkage was far too weak for thin lifts).

/** τ grid, seconds (00-core §1.3). */
export const TAUS = [30, 45, 60, 90, 120, 180, 300, 600] as const;
/** ρ grid (00-core §1.3). */
export const RHOS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] as const;
const NT = TAUS.length;

/**
 * (a) Priors on reps lost per prior hard set at K = 1 (00-core table 1.4): A_same 1.0 ± 1.0 (Rahimi 2005, JSCR 19(4): set 2 is
 * 62/73/91 % of set 1 after 1/2/5 min; Ratamess 2007; Refalo 2023: −2.8 to −7.6 reps over 6 sets), A_cross 0.5 ± 0.6 (Soares 2016:
 * ~2 reps after one 10RM synergist set; Augustsson 2003), γ 0.05 ± 0.15 (Behm 2021 meta-analysis: non-local fatigue small and
 * imprecise for reps to failure).
 */
export const THETA_PRIOR = { mean: [1.0, 0.5, 0.05], sd: [1.0, 0.6, 0.15] } as const;
/** (a) τ: log-normal, median 75 s, SD 0.7 in logs (Harris 1976 phosphocreatine half-times; fitted to Rahimi 2005 and Senna 2016). ρ: uniform 0–0.8 (Rahimi: losses persist at 5 min). */
export const TAU_PRIOR = { median: 75, logSd: 0.7 } as const;
/** (a) RIR bias b: lifters under-predict reps to failure by 0.95 (Halperin 2022, Sports Med 52:377), between-person SD 1.45. Identified only by test sets. */
export const B_PRIOR = { mean: 0.95, sd: 1.45 } as const;
/**
 * (a) Habitual RIR on sets without one logged, as a prior worth two sets: 2 (hypertrophy sets are typically stopped 0–3 RIR;
 * Robinson 2024, Sports Med 54:2209; the app's DEFAULT_RIR_OFFSET); its spread 1.5 reps worth three sets (Refalo 2024: trained
 * lifters' RIR error ±1.0; Steele 2017 SEM 2.6–3.4 before a set). (b) Both learned from his logged RIR.
 */
const HABIT = { mean: 2, k: 2, sd: 1.5, kSd: 3 } as const;
/** (a) Day-to-day readiness, 3 % of e1RM: most of the 4.2 % test–retest CV of a 1RM (Grgic 2020, Sports Med Open 6:31). */
const READY = 0.03;
/**
 * (a) Level drift per √week, a grid learned by marginal likelihood (b); prior weight on 1 %/√week (Latella 2020/2022: trained
 * lifters gain 0.1–0.3 %/week; 04 §2). Layoffs widen it by 3 % per week past two (Bosquet 2013 detraining meta-analysis).
 */
const DRIFT = [0.005, 0.01, 0.02, 0.04] as const;
const DRIFT_PRIOR = [0.2, 0.4, 0.3, 0.1] as const;
const LAYOFF = 0.03;
/**
 * (a) Reps–load slope κ: Epley's 30 (Epley 1985), between-person SD 0.28 in logs (Nuzzo 2024, Sports Med 54:303: SD 2.5 reps
 * at 80 % on ~8.8); between-exercise spread ~0.3 in logs (bench ≈ 35, leg press ≈ 50, Nuzzo 2024), a prior only.
 */
export const KAPPA_PRIOR = { mean: 30, personSd: 0.28, liftSd: 0.3 } as const;
/** (c) Prior scale for how far one lift's A_same may sit from the person's: shapes the pooling prior only (the pool learns the spread). */
const A_LIFT_SD = 0.5;
/** (c) Residual set-to-set noise prior, 0.7 reps worth 10 sets; (b) learned from within-session residuals. */
const NOISE = { sd: 0.7, k: 10 } as const;
/** Outer iterations of level ↔ fatigue (00-core §1.3: 2–3; one more for the reps–load slope). */
const ITERATIONS = 4;

const DAY = 864e5;
const dayNo = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY);

/** How a set's reps to failure are read. */
type Kind = 'rir' | 'test' | 'missed' | 'habit' | 'bound';

/** A working set that measures capacity, with its fatigue features. */
interface Flat { nS: Float64Array; nC: Float64Array; nY: Float64Array; w: Float64Array; eS: Float64Array; eC: Float64Array }
interface Obs {
  e: SetEntry; lift: number; group: number; w: number; r: number;
  kind: Kind; k: number; // logged RIR (rir/test), or the bound's offset above reps (bound)
  nS: number; nC: number; nY: number; eS: Float64Array; eC: Float64Array;
}

// ---- Sessions and fatigue features -------------------------------------------------------------------------------------

// isCardio normalises the name: once per name, not once per set per refit.
const CARDIO = new Map<string, boolean>();
const cardioName = (name: string) => { let c = CARDIO.get(name); if (c === undefined) { c = isCardio(name); CARDIO.set(name, c); } return c; };
const isHard = (e: SetEntry) => !e.flags.includes('warmup') && !e.flags.includes('partial') && e.reps != null && e.reps > 0 && !isCardioEntry(e) && !cardioName(e.exercise);
const isHoldSet = (e: SetEntry) => e.flags.includes('hold') || isHold(e.exercise);
/** A set whose reps measure capacity at a load: hard, loaded, not a hold, not past 30 reps. */
const measures = (e: SetEntry) => isHard(e) && e.weight > 0 && !e.flags.includes('bodyweight') && !isHoldSet(e) && (e.reps as number) <= 30;

interface Session { date: string; day: number; timed: boolean; hard: SetEntry[]; obs: { e: SetEntry; nS: number; nC: number; nY: number; eS: Float64Array; eC: Float64Array }[] }

// Features of one day's sets, cached by the sets themselves: the store never changes a set in place (state/useSets), so the same
// objects in the same order are the same session. A changed set, a new set, new lift facts or a new typical gap rebuild it.
interface Cached { hard: readonly SetEntry[]; fv: number; gap: number; s: Session }
const SESSIONS = new WeakMap<SetEntry, Cached>();

/** The same set objects in the same order as a cached session's (so already in the order done). */
function sameDay(xs: readonly SetEntry[]): boolean {
  const hit = SESSIONS.get(xs[0]);
  return !!hit && hit.hard.length === xs.length && hit.hard.every((e, i) => e === xs[i]);
}
function sessionOf(date: string, hard: SetEntry[], gap: number): Session {
  const first = hard[0];
  const hit = SESSIONS.get(first);
  const fv = liftFactsVersion();
  if (hit && hit.fv === fv && hit.hard.length === hard.length && hit.hard.every((e, i) => e === hard[i])) {
    if (hit.s.timed || hit.gap === gap) return hit.s;
  }
  const times = hard.map(doneAt);
  const timed = times.every((t) => Number.isFinite(t));
  const t = timed ? times.map((x) => (x - times[0]) / 1000) : hard.map((_, i) => i * gap);
  const keys = hard.map((e) => liftKey(e.exercise));
  const vecs: (Vector | null)[] = hard.map((e) => resolveLift(e.exercise).m);
  const obs: Session['obs'] = [];
  for (let a = 0; a < hard.length; a++) {
    if (!measures(hard[a])) continue;
    let nS = 0, nC = 0, nY = 0;
    const eS = new Float64Array(NT), eC = new Float64Array(NT);
    for (let b = 0; b < a; b++) {
      const dt = Math.max(1, t[a] - t[b]);
      if (keys[b] === keys[a]) {
        nS += 1;
        for (let k = 0; k < NT; k++) eS[k] += Math.exp(-dt / TAUS[k]);
      } else {
        nY += 1;
        const o = overlap(vecs[b], vecs[a]);
        if (o > 0) { nC += o; for (let k = 0; k < NT; k++) eC[k] += o * Math.exp(-dt / TAUS[k]); }
      }
    }
    obs.push({ e: hard[a], nS, nC, nY, eS, eC });
  }
  const s: Session = { date, day: dayNo(date), timed, hard, obs };
  SESSIONS.set(first, { hard: [...hard], fv, gap, s });
  return s;
}

/** The person's typical time from one set to the next (s), for days logged without times: the median timed gap ≤ 10 min, else 180 s (c, the app's default pace). */
const GAPS = new WeakMap<SetEntry, { hard: readonly SetEntry[]; gaps: number[] }>();
function dayGaps(d: SetEntry[]): number[] {
  const hit = GAPS.get(d[0]);
  if (hit && hit.hard.length === d.length && hit.hard.every((e, i) => e === d[i])) return hit.gaps;
  const gaps: number[] = [];
  const ts = d.map(doneAt);
  if (ts.every(Number.isFinite)) for (let i = 1; i < ts.length; i++) { const g = (ts[i] - ts[i - 1]) / 1000; if (g > 0 && g <= 600) gaps.push(g); }
  GAPS.set(d[0], { hard: [...d], gaps });
  return gaps;
}
function typicalGap(days: SetEntry[][]): number {
  // The median by counting whole seconds (gaps are ≤ 600 s): no sort of every gap on every refit.
  const counts = new Int32Array(601);
  let n = 0;
  for (const d of days) for (const g of dayGaps(d)) { counts[Math.round(g)]++; n++; }
  if (n < 3) return 180;
  let c = 0, med = 0;
  for (let s = 0; s <= 600; s++) { c += counts[s]; if (2 * c > n) { med = s; break; } }
  // Rounded to 15 s so a new timed gap rarely changes the spacing of untimed days (and their cached features).
  return Math.round(med / 15) * 15;
}

// ---- Results -----------------------------------------------------------------------------------------------------------

export interface Est { mean: number; sd: number }
export interface Cell { tau: number; rho: number; w: number; theta: [number, number, number]; cov: number[] }
export interface LiftCore {
  key: string; name: string;
  /** Reps–load slope κ (C = κ·(E/w − 1)). */
  kappa: Est;
  /** Reps lost per prior same-lift set at K = 1, this lift's (pooled), at the person's (τ, ρ). */
  aSame: Est;
  /** Fatigue-adjusted level per session, ln e1RM (smoothed: every session's data), oldest first. */
  level: { date: string; day: number; x: number; sd: number }[];
  sessions: number; sets: number;
}
export interface Core {
  sets: number; obs: number; sessions: number; timed: number;
  /** Person-level fatigue: reps per prior set at K = 1; τ in s (posterior median and 5–95 %), ρ. */
  aSame: Est; aCross: Est; gamma: Est;
  tau: Est & { lo: number; hi: number }; rho: Est;
  cells: Cell[];
  /** Habitual RIR on unlogged sets (b), the RIR bias b (a, until tests), and the residual noise (reps). */
  habit: Est; bias: Est; noise: number;
  /** The person's typical time from one set to the next (s), for untimed days. */
  gap: number;
  /** Level drift per √week, as learned. */
  drift: number;
  lifts: Map<string, LiftCore>;
  /** Fatigue features (00-core §1.2) of every set that measures capacity, by set id: for consumers that score sets. */
  features: Map<string, Features>;
  /** The grid cell the per-lift values were fitted at (A, τ, ρ trade off: use them together, through decay/fatigueOf). */
  fit: { tau: number; kTau: number; rho: number; theta: [number, number, number] };
}
export interface Features { nS: number; nC: number; nY: number; eS: Float64Array; eC: Float64Array }

/**
 * e1RM from one set with its reps in reserve and its session fatigue put back: w·(1 + (reps + RIR + Δ)/κ). The plain Epley
 * reading (stats.e1rm) takes a tired back-off set at face value; this one reads it as the fresh strength it implies.
 * Null for a set the core does not score (warm-up, bodyweight, hold, over 30 reps).
 */
export function e1rmAdjusted(core: Core, e: SetEntry): number | null {
  const f = core.features.get(e.id);
  if (!f || e.reps == null) return null;
  const key = liftKey(e.exercise);
  const kappa = core.lifts.get(key)?.kappa.mean ?? KAPPA_PRIOR.mean;
  const rir = e.rir != null && e.rir < 4 ? e.rir + core.bias.mean : core.habit.mean;
  return e.weight * (1 + (e.reps + rir + fatigueOf(core, key, f)) / kappa);
}

/** K(Δt): how much of a prior set's fatigue is left Δt seconds later, at the fitted (τ, ρ). */
export const decay = (core: Core, dt: number): number => core.fit.rho + (1 - core.fit.rho) * Math.exp(-Math.max(0, dt) / core.fit.tau);

/** Δ: reps a set loses to the session so far (same lift, overlapping lifts, other hard sets), from its features. */
export function fatigueOf(core: Core, liftKey: string, f: Features): number {
  const { kTau: k, rho, theta } = core.fit;
  const a = core.lifts.get(liftKey)?.aSame.mean ?? theta[0];
  return a * (rho * f.nS + (1 - rho) * f.eS[k]) + theta[1] * (rho * f.nC + (1 - rho) * f.eC[k]) + theta[2] * f.nY;
}


// ---- The fit -----------------------------------------------------------------------------------------------------------

interface Group { lift: number; day: number; date: string; o0: number; o1: number }

/**
 * Fits the capacity equation to one profile's log. Pure: the same log gives the same result.
 * `censor: false` (tests only: the negative control) reads target-stopped sets as if they had gone to the usual RIR.
 */
export function fitCore(entries: readonly SetEntry[], opts: { censor?: boolean } = {}): Core {
  const censor = opts.censor ?? true;
  // Days, in date order, each in the order done.
  const byDate = new Map<string, SetEntry[]>();
  for (const e of entries) { if (!isHard(e)) continue; const d = byDate.get(e.date); if (d) d.push(e); else byDate.set(e.date, [e]); }
  const dates = [...byDate.keys()].sort();
  // Logs arrive mostly in the order done: a linear check skips the sort (and its time parsing) for those days.
  const days = dates.map((d) => { const xs = byDate.get(d)!; return sameDay(xs) || inOrder(xs, byOrderDone) ? xs : xs.sort(byOrderDone); });
  const gap = typicalGap(days);
  const sessions = days.map((d, i) => sessionOf(dates[i], d, gap));

  // Lifts and groups (lift × day). Observations sorted by group.
  const liftIx = new Map<string, number>();
  const liftNames: string[] = [];
  const raw: { s: Session; o: Session['obs'][number]; lift: number }[] = [];
  const keyOf = new Map<string, string>();
  for (const s of sessions) for (const o of s.obs) {
    let k = keyOf.get(o.e.exercise);
    if (k == null) { k = liftKey(o.e.exercise); keyOf.set(o.e.exercise, k); }
    let li = liftIx.get(k);
    if (li == null) { li = liftNames.length; liftIx.set(k, li); liftNames.push(o.e.exercise); }
    raw.push({ s, o, lift: li });
  }
  raw.sort((a, b) => a.lift - b.lift || a.s.day - b.s.day);
  const groups: Group[] = [];
  const obs: Obs[] = [];
  for (const { s, o, lift } of raw) {
    let g = groups.at(-1);
    if (!g || g.lift !== lift || g.day !== s.day) { g = { lift, day: s.day, date: s.date, o0: obs.length, o1: obs.length }; groups.push(g); }
    const e = o.e, r = e.reps as number;
    const target = e.target && e.target.weight != null && e.target.weight === e.weight ? e.target.reps : null;
    let kind: Kind = 'habit', k = 0;
    if (e.flags.includes('pain')) { kind = 'bound'; k = 0; } // pain limited the set, not strength (04 §7)
    else if (e.rir != null && e.rir >= 4) { kind = 'bound'; k = 3; } // "4+": at least 4, with a rep of slack (04 §3)
    else if (e.rir != null) { kind = e.flags.includes('test') ? 'test' : 'rir'; k = e.rir; }
    else if (censor && target != null && r === target) { kind = 'bound'; k = 0; } // stopped at the target: could have done more (00-core §1.2)
    else if (target != null && r < target) kind = 'missed'; // short of the target: near failure (00-core §1.2)
    obs.push({ e, lift, group: groups.length - 1, w: e.weight, r, kind, k, nS: o.nS, nC: o.nC, nY: o.nY, eS: o.eS, eC: o.eC });
    g.o1 = obs.length;
  }
  const N = obs.length, G = groups.length, L = liftNames.length;
  const liftGroups: number[][] = Array.from({ length: L }, () => []);
  groups.forEach((g, i) => liftGroups[g.lift].push(i));

  // Habitual RIR (b): mean and SD of logged training RIR plus the bias, shrunk to the prior (HABIT).
  const b = B_PRIOR.mean;
  let hs = 0, hss = 0, hn = 0;
  for (const o of obs) if (o.kind === 'rir') { const v = o.k + b; hs += v; hss += v * v; hn++; }
  const habit = (HABIT.k * HABIT.mean + hs) / (HABIT.k + hn);
  const habitVar = (HABIT.kSd * HABIT.sd ** 2 + Math.max(0, hss - hn * (hn ? (hs / hn) ** 2 : 0))) / (HABIT.kSd + Math.max(0, hn - 1));

  // Per observation: the reading of reps to failure (y), its variance (v), and for bounds the floor.
  const y = new Float64Array(N), v = new Float64Array(N), lo = new Float64Array(N);
  const isBound = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const o = obs[i];
    switch (o.kind) {
      case 'rir': case 'test': {
        // (a) RIR error grows with distance from failure and with reps past ~10 (Refalo 2024; Zourdos 2021; Halperin 2022): 04 §3.
        const R = o.r + o.k;
        const sd = 0.5 + 0.3 * o.k + 0.3 * Math.max(0, R - 10);
        y[i] = R + (o.kind === 'rir' ? b : 0); v[i] = sd * sd * (o.e.flags.includes('unsure') ? 1.5 : 1);
        break;
      }
      case 'missed': y[i] = o.r + 0.5; v[i] = 0.6 ** 2; break; // (a/c) at or near failure: RIR 0–1
      case 'habit': y[i] = o.r + habit; v[i] = habitVar; break;
      case 'bound': isBound[i] = 1; lo[i] = o.r + o.k; y[i] = o.r + o.k + habit; v[i] = habitVar; break;
    }
  }

  // Flat copies of the fatigue features for the hot loops (typed arrays, no object hops).
  const fx: Flat = { nS: new Float64Array(N), nC: new Float64Array(N), nY: new Float64Array(N), w: new Float64Array(N), eS: new Float64Array(N * NT), eC: new Float64Array(N * NT) };
  for (let i = 0; i < N; i++) {
    const o = obs[i];
    fx.nS[i] = o.nS; fx.nC[i] = o.nC; fx.nY[i] = o.nY; fx.w[i] = o.w;
    fx.eS.set(o.eS, i * NT); fx.eC.set(o.eC, i * NT);
  }
  // Residual noise σ_e² (b): starts at the prior; re-estimated each round from within-session residuals.
  let noise2 = NOISE.sd ** 2;
  const kappa = new Float64Array(L).fill(KAPPA_PRIOR.mean);
  let theta = [...THETA_PRIOR.mean] as [number, number, number];
  let mapT = TAUS.indexOf(90), mapR = 2; // start at the prior's neighbourhood: τ 90 s, ρ 0.2
  const aLift = new Float64Array(L).fill(theta[0]);
  let cells: Cell[] = [];
  let drift: number = DRIFT[1];
  // Per group after each level pass: LOO predicted ln E and its variance, the smoothed level, and the reps scale.
  const predX = new Float64Array(G), predV = new Float64Array(G), smX = new Float64Array(G), smV = new Float64Array(G), predU = new Float64Array(G);
  const hasPred = new Uint8Array(G);
  const delta = new Float64Array(N), pred = new Float64Array(N), W = new Float64Array(N), yy = new Float64Array(N);
  const siteV = new Float64Array(N).fill(Infinity);

  const logW = new Float64Array(N), liftOf = new Int32Array(N);
  for (let i = 0; i < N; i++) { logW[i] = Math.log(obs[i].w); liftOf[i] = obs[i].lift; }
  const fatigueAt = (i: number, kT: number, rho: number, th: readonly number[], aSame: number) =>
    aSame * (rho * fx.nS[i] + (1 - rho) * fx.eS[i * NT + kT]) + th[1] * (rho * fx.nC[i] + (1 - rho) * fx.eC[i * NT + kT]) + th[2] * fx.nY[i];

  for (let it = 0; it < ITERATIONS; it++) {
    const rho = RHOS[mapR];
    for (let i = 0; i < N; i++) delta[i] = fatigueAt(i, mapT, rho, theta, aLift[liftOf[i]]);

    // (1) Levels. Each set's fatigue-adjusted capacity → an implied ln E; a session's are averaged by precision.
    const zG = new Float64Array(G), vG = new Float64Array(G), uG = new Float64Array(G), okG = new Uint8Array(G);
    for (let g = 0; g < G; g++) {
      const { o0, o1, lift } = groups[g];
      let sw = 0, sz = 0, su = 0;
      for (let i = o0; i < o1; i++) {
        // A bound reads as its site from the last round (none in the first: it says nothing until there's a prediction).
        if (isBound[i] && !(siteV[i] < 1e6)) continue;
        const c = Math.max(0.5, (isBound[i] ? yy[i] : y[i]) + delta[i]);
        const ve = (isBound[i] ? siteV[i] : v[i]) + noise2;
        const lv = ve / (kappa[lift] + c) ** 2;
        const z = logW[i] + Math.log1p(c / kappa[lift]);
        sw += 1 / lv; sz += z / lv; su += (c / (kappa[lift] + c)) / lv;
      }
      if (sw > 0) { okG[g] = 1; zG[g] = sz / sw; uG[g] = su / sw; vG[g] = 1 / sw + READY * READY; }
    }
    drift = levels(liftGroups, groups, zG, vG, uG, okG, predX, predV, predU, hasPred, smX, smV);

    // Predicted fresh capacity per set (never having seen its own session), and the shortfall z = predicted − observed.
    // Bounds: an expectation-propagation site from the truncated predictive (Tobit): uninformative when the prediction sits
    // well above the floor, a firm reading when it doesn't.
    for (let i = 0; i < N; i++) {
      const o = obs[i], g = o.group;
      if (!hasPred[g]) { pred[i] = NaN; W[i] = 0; yy[i] = y[i]; siteV[i] = Infinity; continue; }
      const E = Math.exp(predX[g]);
      pred[i] = kappa[o.lift] * (E / o.w - 1);
      if (!isBound[i]) { yy[i] = y[i]; W[i] = 1 / (v[i] + noise2); continue; }
      const scale = kappa[o.lift] * E / o.w;
      const cavV = scale * scale * (predV[g] + READY * READY) + noise2;
      const mu = pred[i] - delta[i];
      const t = truncBelow(mu, Math.sqrt(cavV), lo[i]);
      const prec = 1 / t.v - 1 / cavV;
      if (!(prec > 1e-4 / cavV)) { yy[i] = mu; W[i] = 0; siteV[i] = Infinity; continue; }
      siteV[i] = 1 / prec;
      yy[i] = siteV[i] * (t.mean / t.v - mu / cavV);
      W[i] = 1 / (siteV[i] + noise2);
    }

    // (2) Fatigue: GLS over the (τ, ρ) grid, a random intercept per session (its level error) and an intercept per lift.
    // Rounds before the last search only τ next to the current best (the fit moves little between rounds; 2–4 rounds agree
    // to the third decimal on synthetic data); the last round searches the whole grid.
    const last = it === ITERATIONS - 1;
    cells = fatigueGrid(fx, groups, liftGroups, kappa, predX, predV, hasPred, pred, yy, W, L, last ? 0 : Math.max(0, mapT - 1), last ? NT - 1 : Math.min(NT - 1, mapT + 1));
    let best = 0;
    for (let c = 1; c < cells.length; c++) if (cells[c].w > cells[best].w) best = c;
    mapT = TAUS.indexOf(cells[best].tau as (typeof TAUS)[number]); mapR = RHOS.indexOf(cells[best].rho as (typeof RHOS)[number]);
    theta = [0, 1, 2].map((j) => cells.reduce((a, c) => a + c.w * c.theta[j], 0)) as [number, number, number];

    // Residual noise (b): within-session spread of fatigue-adjusted readings beyond the readings' own variance, shrunk to the prior.
    let rss = 0, dof = 0, ownV = 0;
    for (const g of groups) {
      let n = 0, m = 0, mm = 0, vv = 0;
      for (let i = g.o0; i < g.o1; i++) {
        if (isBound[i] || !Number.isFinite(pred[i])) continue;
        const r = y[i] + delta[i] - pred[i]; // the session's shared level error drops out of the within-session spread
        m += r; mm += r * r; n++; vv += v[i];
      }
      if (n < 2) continue;
      rss += mm - m * m / n;
      dof += n - 1; ownV += vv * (n - 1) / n;
    }
    const excess = dof > 0 ? Math.max(0, (rss - ownV) / dof) : 0;
    noise2 = (NOISE.k * NOISE.sd ** 2 + dof * excess) / (NOISE.k + dof);

    // Reps–load slope κ per lift (b), pooled toward the person and similar lifts.
    const kappaSd = updateKappa(fx, mapT, RHOS[mapR], groups, liftGroups, liftNames, kappa, fx.w, predX, predU, hasPred, pred, yy, W, delta, L);
    // Per-lift A_same (b), pooled; used for the next round's fatigue.
    const a = liftASame(fx, groups, liftGroups, liftNames, cells, mapT, mapR, theta, pred, yy, W, L, kappa, predX, hasPred);
    for (let l = 0; l < L; l++) aLift[l] = a.post[l].mean;
    if (it === ITERATIONS - 1) {
      const lifts = new Map<string, LiftCore>();
      for (let l = 0; l < L; l++) {
        const gs = liftGroups[l];
        lifts.set(liftKey(liftNames[l]), {
          key: liftKey(liftNames[l]), name: liftNames[l],
          kappa: { mean: kappa[l], sd: kappaSd[l] },
          aSame: { mean: a.post[l].mean, sd: a.post[l].sd },
          level: gs.filter((g) => smV[g] < 1).map((g) => ({ date: groups[g].date, day: groups[g].day, x: smX[g], sd: Math.sqrt(smV[g]) })),
          sessions: gs.length, sets: gs.reduce((n, g) => n + groups[g].o1 - groups[g].o0, 0),
        });
      }
      return summarize(cells, theta, lifts, { kT: mapT, rho: RHOS[mapR], N, sets: entries.length, sessions: sessions.length, timed: sessions.filter((s) => s.timed).length, habit, habitVar, hn, noise2, gap, drift, obs });
    }
  }
  throw new Error('unreachable');
}


function summarize(cells: Cell[], theta: [number, number, number], lifts: Map<string, LiftCore>,
  m: { kT: number; rho: number; N: number; sets: number; sessions: number; timed: number; habit: number; habitVar: number; hn: number; noise2: number; gap: number; drift: number; obs: Obs[] }): Core {
  const sd = [0, 1, 2].map((j) => Math.sqrt(cells.reduce((a, c) => a + c.w * (c.cov[j * 4] + (c.theta[j] - theta[j]) ** 2), 0)));
  // τ: posterior over the grid, summarised in logs; its 5–95 % from the cumulative weights.
  const wT = TAUS.map((t) => cells.filter((c) => c.tau === t).reduce((a, c) => a + c.w, 0));
  const lt = wT.reduce((a, w, i) => a + w * Math.log(TAUS[i]), 0);
  const ltSd = Math.sqrt(wT.reduce((a, w, i) => a + w * (Math.log(TAUS[i]) - lt) ** 2, 0));
  const q = (p: number) => { let c = 0; for (let i = 0; i < NT; i++) { c += wT[i]; if (c >= p) return TAUS[i]; } return TAUS[NT - 1]; };
  const rm = cells.reduce((a, c) => a + c.w * c.rho, 0);
  // Plus the grid's own resolution (a uniform within one 0.1 step: 0.1²/12), so a posterior on one cell is not read as exact.
  const rsd = Math.sqrt(cells.reduce((a, c) => a + c.w * (c.rho - rm) ** 2, 0) + (RHOS[1] - RHOS[0]) ** 2 / 12);
  // Built on first read: most refits are read for their parameters only.
  let features: Map<string, Features> | null = null;
  const obs = m.obs;
  return {
    sets: m.sets, obs: m.N, sessions: m.sessions, timed: m.timed,
    aSame: { mean: theta[0], sd: sd[0] }, aCross: { mean: theta[1], sd: sd[1] }, gamma: { mean: theta[2], sd: sd[2] },
    tau: { mean: Math.exp(lt), sd: ltSd, lo: q(0.05), hi: q(0.95) }, rho: { mean: rm, sd: rsd },
    cells,
    habit: { mean: m.habit, sd: Math.sqrt(m.habitVar / (HABIT.k + m.hn)) }, bias: { mean: B_PRIOR.mean, sd: B_PRIOR.sd }, noise: Math.sqrt(m.noise2),
    gap: m.gap, drift: m.drift, lifts,
    get features() {
      if (!features) { features = new Map(); for (const o of obs) features.set(o.e.id, { nS: o.nS, nC: o.nC, nY: o.nY, eS: o.eS, eC: o.eC }); }
      return features;
    },
    fit: { tau: TAUS[m.kT], kTau: m.kT, rho: m.rho, theta: [...theta] as [number, number, number] },
  };
}

/**
 * Leave-one-session-out level per lift: a forward and a backward Kalman filter over its sessions (random walk in ln E), each
 * session predicted from both sides without itself. Also runs the same gains on an auxiliary series (u = C/(κ + C), for the
 * reps–load slope) and the smoothed level with the session's own data. Picks the drift (DRIFT grid) by one-step predictive
 * likelihood with its prior (b); returns it.
 */
function levels(liftGroups: number[][], groups: Group[], z: Float64Array, vz: Float64Array, u: Float64Array, ok: Uint8Array,
  predX: Float64Array, predV: Float64Array, predU: Float64Array, hasPred: Uint8Array, smX: Float64Array, smV: Float64Array): number {
  const G = groups.length;
  const fm = new Float64Array(G), fP = new Float64Array(G), fu = new Float64Array(G), fok = new Uint8Array(G);
  const bm = new Float64Array(G), bP = new Float64Array(G), bu = new Float64Array(G), bok = new Uint8Array(G);
  const q = (d: number, perDay: number) => perDay * Math.abs(d) + LAYOFF * LAYOFF * Math.max(0, Math.abs(d) / 7 - 2);
  const run = (gs: number[], perDay: number, m_: Float64Array, P_: Float64Array, u_: Float64Array, ok_: Uint8Array): number => {
    let m = 0, P = Infinity, uu = 0, prev = 0, ll = 0;
    for (const g of gs) {
      if (Number.isFinite(P)) {
        const Pp = P + q(groups[g].day - prev, perDay);
        m_[g] = m; P_[g] = Pp; u_[g] = uu; ok_[g] = 1;
        if (ok[g]) {
          const S = Pp + vz[g], K = Pp / S, nu = z[g] - m;
          ll += -0.5 * (Math.log(S) + nu * nu / S);
          m += K * nu; uu += K * (u[g] - uu); P = (1 - K) * Pp;
        } else P = Pp;
      } else {
        ok_[g] = 0;
        if (ok[g]) { m = z[g]; uu = u[g]; P = vz[g]; }
      }
      prev = groups[g].day;
    }
    return ll;
  };
  // Drift: one-step predictive likelihood of every lift's forward filter, plus the prior.
  let bestD = 1, bestLL = -Infinity;
  for (let d = 0; d < DRIFT.length; d++) {
    const perDay = DRIFT[d] * DRIFT[d] / 7;
    let ll = Math.log(DRIFT_PRIOR[d]);
    for (const gs of liftGroups) ll += run(gs, perDay, fm, fP, fu, fok);
    if (ll > bestLL) { bestLL = ll; bestD = d; }
  }
  const perDay = DRIFT[bestD] * DRIFT[bestD] / 7;
  for (const gs of liftGroups) { run(gs, perDay, fm, fP, fu, fok); run([...gs].reverse(), perDay, bm, bP, bu, bok); }
  for (let g = 0; g < G; g++) {
    let pm = 0, pv = Infinity, pu = 0;
    if (fok[g] && bok[g]) { pv = 1 / (1 / fP[g] + 1 / bP[g]); pm = pv * (fm[g] / fP[g] + bm[g] / bP[g]); pu = pv * (fu[g] / fP[g] + bu[g] / bP[g]); }
    else if (fok[g]) { pv = fP[g]; pm = fm[g]; pu = fu[g]; }
    else if (bok[g]) { pv = bP[g]; pm = bm[g]; pu = bu[g]; }
    hasPred[g] = Number.isFinite(pv) && pv < 1 ? 1 : 0;
    predX[g] = pm; predV[g] = pv; predU[g] = pu;
    if (ok[g]) {
      const sv = Number.isFinite(pv) ? 1 / (1 / pv + 1 / vz[g]) : vz[g];
      smX[g] = Number.isFinite(pv) ? sv * (pm / pv + z[g] / vz[g]) : z[g]; smV[g] = sv;
    } else { smX[g] = pm; smV[g] = pv; }
  }
  return DRIFT[bestD];
}

/**
 * The fatigue regression for every (τ, ρ) cell. Shortfall z = predicted fresh − observed = Δ + lift intercept + session error +
 * set noise. Per session the covariance is diag(1/W) + s²·11ᵀ (s²: the level prediction's variance in reps); Woodbury keeps it
 * cheap. The lift intercepts are profiled out. Features are linear in ρ given τ (x = q + ρ·h), so every sum is a polynomial in
 * ρ of degree ≤ 2 and each τ is accumulated once.
 */
function fatigueGrid(fx: Flat, groups: Group[], liftGroups: number[][], kappa: Float64Array, predX: Float64Array, predV: Float64Array,
  hasPred: Uint8Array, pred: Float64Array, yy: Float64Array, W: Float64Array, L: number, kLo = 0, kHi = NT - 1): Cell[] {
  const L0 = THETA_PRIOR.sd.map((s) => 1 / (s * s));
  // Per τ: coefficients of ρ⁰, ρ¹, ρ² for A (3×3) and of ρ⁰, ρ¹ for b (3).
  const A0 = new Float64Array(NT * 9), A1 = new Float64Array(NT * 9), A2 = new Float64Array(NT * 9);
  const b0 = new Float64Array(NT * 3), b1 = new Float64Array(NT * 3);
  const sq = new Float64Array(3), sh = new Float64Array(3);
  // Per lift scratch, per τ.
  const lA = new Float64Array(NT * 3), lB = new Float64Array(NT * 3);
  const fS = fx.eS, fC = fx.eC, fY = fx.nY, nSa = fx.nS, nCa = fx.nC, fw = fx.w;
  for (let l = 0; l < L; l++) {
    let S11 = 0, S1z = 0;
    lA.fill(0); lB.fill(0);
    for (const g of liftGroups[l]) {
      if (!hasPred[g]) continue;
      const { o0, o1 } = groups[g];
      let sW = 0, sWz = 0;
      for (let i = o0; i < o1; i++) { if (!W[i]) continue; const z = pred[i] - yy[i]; sW += W[i]; sWz += W[i] * z; }
      if (!sW) continue;
      // The session's shared error in reps: level prediction and readiness, at the session's mean scale κE/w.
      let sc = 0;
      for (let i = o0; i < o1; i++) if (W[i]) sc += W[i] / fw[i];
      sc *= kappa[l] * Math.exp(predX[g]);
      sc /= sW;
      const s2 = sc * sc * (predV[g] + READY * READY);
      const c = s2 / (1 + s2 * sW), f = 1 - c * sW;
      S11 += sW * f; S1z += f * sWz;
      for (let k = kLo; k <= kHi; k++) {
        const k9 = k * 9, k3 = k * 3;
        let sq0 = 0, sq1 = 0, sq2 = 0, sh0 = 0, sh1 = 0, bq0 = 0, bq1 = 0, bq2 = 0, bh0 = 0, bh1 = 0;
        let a00 = 0, a01 = 0, a02 = 0, a11 = 0, a12 = 0, a22 = 0;
        let c00 = 0, c01 = 0, c10 = 0, c02 = 0, c11 = 0, c12 = 0, c20 = 0, c21 = 0;
        let d00 = 0, d01 = 0, d11 = 0;
        for (let i = o0; i < o1; i++) {
          const w = W[i];
          if (!w) continue;
          const z = pred[i] - yy[i];
          const ik = i * NT + k, q0 = fS[ik], q1 = fC[ik], q2 = fY[i], h0 = nSa[i] - q0, h1 = nCa[i] - q1;
          const wq0 = w * q0, wq1 = w * q1, wq2 = w * q2, wh0 = w * h0, wh1 = w * h1;
          sq0 += wq0; sq1 += wq1; sq2 += wq2; sh0 += wh0; sh1 += wh1;
          bq0 += wq0 * z; bq1 += wq1 * z; bq2 += wq2 * z; bh0 += wh0 * z; bh1 += wh1 * z;
          a00 += wq0 * q0; a01 += wq0 * q1; a02 += wq0 * q2; a11 += wq1 * q1; a12 += wq1 * q2; a22 += wq2 * q2;
          c00 += wq0 * h0; c01 += wq0 * h1; c10 += wq1 * h0; c11 += wq1 * h1; c02 += wh0 * q2; c12 += wh1 * q2; c20 += wq2 * h0; c21 += wq2 * h1;
          d00 += wh0 * h0; d01 += wh0 * h1; d11 += wh1 * h1;
        }
        b0[k3] += bq0; b0[k3 + 1] += bq1; b0[k3 + 2] += bq2; b1[k3] += bh0; b1[k3 + 1] += bh1;
        A0[k9] += a00; A0[k9 + 1] += a01; A0[k9 + 2] += a02; A0[k9 + 3] += a01; A0[k9 + 4] += a11; A0[k9 + 5] += a12;
        A0[k9 + 6] += a02; A0[k9 + 7] += a12; A0[k9 + 8] += a22;
        // A1[a][b] = Σ w(q_a h_b + h_a q_b); h2 = 0.
        A1[k9] += 2 * c00; A1[k9 + 1] += c01 + c10; A1[k9 + 2] += c02;
        A1[k9 + 3] += c10 + c01; A1[k9 + 4] += 2 * c11; A1[k9 + 5] += c12;
        A1[k9 + 6] += c20; A1[k9 + 7] += c21;
        A2[k9] += d00; A2[k9 + 1] += d01; A2[k9 + 3] += d01; A2[k9 + 4] += d11;
        sq[0] = sq0; sq[1] = sq1; sq[2] = sq2; sh[0] = sh0; sh[1] = sh1; sh[2] = 0;
        // Woodbury: subtract c·(ΣWx)(ΣWx)ᵀ and c·(ΣWx)(ΣWz).
        for (let a = 0; a < 3; a++) {
          b0[k3 + a] -= c * sq[a] * sWz; b1[k3 + a] -= c * sh[a] * sWz;
          for (let bb = 0; bb < 3; bb++) {
            A0[k9 + a * 3 + bb] -= c * sq[a] * sq[bb];
            A1[k9 + a * 3 + bb] -= c * (sq[a] * sh[bb] + sh[a] * sq[bb]);
            A2[k9 + a * 3 + bb] -= c * sh[a] * sh[bb];
          }
          lA[k3 + a] += f * sq[a]; lB[k3 + a] += f * sh[a];
        }
      }
    }
    // Profile out the lift's intercept: subtract (S1x)(S1x)ᵀ/S11 and (S1x)·S1z/S11, S1x = lA + ρ·lB.
    if (S11 > 1e-12) {
      for (let k = kLo; k <= kHi; k++) {
        for (let a = 0; a < 3; a++) {
          const la = lA[k * 3 + a], lb = lB[k * 3 + a];
          b0[k * 3 + a] -= la * S1z / S11; b1[k * 3 + a] -= lb * S1z / S11;
          for (let bb = 0; bb < 3; bb++) {
            const ma = lA[k * 3 + bb], mb = lB[k * 3 + bb];
            A0[k * 9 + a * 3 + bb] -= la * ma / S11;
            A1[k * 9 + a * 3 + bb] -= (la * mb + lb * ma) / S11;
            A2[k * 9 + a * 3 + bb] -= lb * mb / S11;
          }
        }
      }
    }
  }
  // Every cell: posterior N(μ, P⁻¹) with P = L0 + A, μ = P⁻¹(L0·μ0 + b); log evidence up to a constant shared by all cells.
  const out: Cell[] = [];
  let maxLe = -Infinity;
  const les: number[] = [];
  for (let k = kLo; k <= kHi; k++) {
    const logTau = Math.log(TAUS[k]);
    const lp = -0.5 * ((logTau - Math.log(TAU_PRIOR.median)) / TAU_PRIOR.logSd) ** 2;
    for (const rho of RHOS) {
      const P = new Array<number>(9), hh = new Array<number>(3);
      for (let a = 0; a < 3; a++) {
        hh[a] = L0[a] * THETA_PRIOR.mean[a] + b0[k * 3 + a] + rho * b1[k * 3 + a];
        for (let bb = 0; bb < 3; bb++) P[a * 3 + bb] = (a === bb ? L0[a] : 0) + A0[k * 9 + a * 3 + bb] + rho * A1[k * 9 + a * 3 + bb] + rho * rho * A2[k * 9 + a * 3 + bb];
      }
      // Symmetrise against rounding.
      for (let a = 0; a < 3; a++) for (let bb = a + 1; bb < 3; bb++) { const m = (P[a * 3 + bb] + P[bb * 3 + a]) / 2; P[a * 3 + bb] = m; P[bb * 3 + a] = m; }
      const iv = inv3(P);
      if (!iv) continue;
      const mu = [0, 1, 2].map((a) => iv.inv[a * 3] * hh[0] + iv.inv[a * 3 + 1] * hh[1] + iv.inv[a * 3 + 2] * hh[2]) as [number, number, number];
      const quad = mu[0] * hh[0] + mu[1] * hh[1] + mu[2] * hh[2]; // μᵀPμ = μᵀh
      const le = 0.5 * quad - 0.5 * iv.logDet + lp;
      les.push(le); if (le > maxLe) maxLe = le;
      out.push({ tau: TAUS[k], rho, w: 0, theta: mu, cov: iv.inv });
    }
  }
  let tot = 0;
  out.forEach((c, i) => { c.w = Math.exp(les[i] - maxLe); tot += c.w; });
  for (const c of out) c.w /= tot;
  return out;
}

/**
 * κ per lift (b): how the shortfall moves with ∂pred/∂ln κ, the change in predicted reps if the curve were steeper. Only weight
 * changes WITHIN a session inform it (a back-off or a ramp: the same day's strength at two loads), so each session is centred and
 * the level's own errors drop out; across sessions κ and the level trade off (a misjudged level reads as a misjudged curve,
 * biasing κ by 15–30 % on synthetic data). Then pooled toward the person and similar lifts (learn/pool) around Epley's 30 (a).
 * A lifter who never changes weight inside a session keeps the population curve, with its full prior SD.
 */
function updateKappa(fx: Flat, kT: number, rho: number, groups: Group[], liftGroups: number[][], names: string[], kappa: Float64Array, ws: Float64Array,
  predX: Float64Array, predU: Float64Array, hasPred: Uint8Array, pred: Float64Array, yy: Float64Array, W: Float64Array, delta: Float64Array, L: number): Float64Array {
  const items: { key: string; est: number; v: number }[] = [];
  const cur = Array.from(kappa, (k) => Math.log(k / KAPPA_PRIOR.mean));
  let rss = 0, dof = 0;
  const per: { l: number; Sdd: number; Sdr: number; vd: number }[] = [];
  for (let l = 0; l < L; l++) {
    // Within-session weighted regression of the residual on d = −∂pred/∂ln κ ∝ −κE(1 − u)/w, jointly
    // with the lift's same-lift fatigue x: a back-off is usually the last set, so a lighter load and a more tired lifter arrive
    // together, and κ alone would take the blame for a misjudged fatigue (its SD comes from the joint fit, so it says so).
    let Sdd = 0, Sdr = 0, Srr = 0, Sdx = 0, Sxx = 0, Sxr = 0, cnt = 0;
    for (const g of liftGroups[l]) {
      if (!hasPred[g]) continue;
      const { o0, o1 } = groups[g];
      // The level itself is read through κ (ln E = ln w + ln(1 + C/κ)), so a steeper curve also lowers E: the total derivative
      // carries (1 − u), u = C/(κ + C) from the level pass. Without it the step and its SD come out ~1.4× too small.
      const E = Math.exp(predX[g]) * (1 - predU[g]);
      let sW = 0, sWd = 0, sWr = 0, sWx = 0, sWdd = 0, sWdr = 0, sWrr = 0, sWdx = 0, sWxx = 0, sWxr = 0, m = 0;
      for (let i = o0; i < o1; i++) {
        const w = W[i];
        if (!w) continue;
        const d = -kappa[l] * E / ws[i];
        const x = rho * fx.nS[i] + (1 - rho) * fx.eS[i * NT + kT];
        const r = pred[i] - yy[i] - delta[i];
        sW += w; sWd += w * d; sWr += w * r; sWx += w * x;
        sWdd += w * d * d; sWdr += w * d * r; sWrr += w * r * r; sWdx += w * d * x; sWxx += w * x * x; sWxr += w * x * r; m++;
      }
      if (m < 2) continue;
      Sdd += sWdd - sWd * sWd / sW; Sdr += sWdr - sWd * sWr / sW; Srr += sWrr - sWr * sWr / sW;
      Sdx += sWdx - sWd * sWx / sW; Sxx += sWxx - sWx * sWx / sW; Sxr += sWxr - sWx * sWr / sW; cnt += m - 1;
    }
    if (!(Sdd > 1e-6)) continue;
    // 2×2 solve; with no fatigue contrast (Sxx ≈ 0) it is the one-regressor fit.
    const det = Sdd * Sxx - Sdx * Sdx;
    const joint = Sxx > 1e-9 && det > 1e-9 * Sdd * Sxx;
    const bd = joint ? (Sxx * Sdr - Sdx * Sxr) / det : Sdr / Sdd;
    const bx = joint ? (Sdd * Sxr - Sdx * Sdr) / det : 0;
    rss += Srr - bd * Sdr - bx * Sxr; dof += cnt - (joint ? 2 : 1);
    per.push({ l, Sdd, Sdr: bd, vd: joint ? Sxx / det : 1 / Sdd });
  }
  // The weights are 1/variance already; the residuals' own scale corrects a misjudged noise (never below the stated one).
  const phi = dof > 5 ? Math.max(1, rss / dof) : 1;
  // The step from the current κ, linearised; the estimate of ln(κ/30) is the current value plus it.
  for (const { l, Sdr, vd } of per) items.push({ key: liftKey(names[l]), est: cur[l] + Sdr, v: phi * vd });
  const p = pool(items, (a, b) => liftSimilarity(a, b), { mean: 0, personSd: KAPPA_PRIOR.personSd, liftSd: KAPPA_PRIOR.liftSd });
  const kappaSd = new Float64Array(L);
  for (let l = 0; l < L; l++) {
    const post = p.lift(liftKey(names[l]));
    // Bounded to ±0.7 in logs (κ 15–60): Nuzzo's range across exercises and people.
    const x = Math.max(-0.7, Math.min(0.7, post.mean));
    kappa[l] = KAPPA_PRIOR.mean * Math.exp(x);
    kappaSd[l] = kappa[l] * post.sd;
  }
  return kappaSd;
}

/** Per-lift A_same (b): within-session contrasts at the person's (τ, ρ), then pooled (learn/pool) around the person's value. */
function liftASame(fx: Flat, groups: Group[], liftGroups: number[][], names: string[], cells: Cell[], kT: number, kR: number,
  theta: [number, number, number], pred: Float64Array, yy: Float64Array, W: Float64Array, L: number,
  kappa: Float64Array, predX: Float64Array, hasPred: Uint8Array): { post: Posterior[] } {
  const rho = RHOS[kR];
  const items: { key: string; est: number; v: number }[] = [];
  let rss = 0, dof = 0;
  const per: { est: number; v: number; l: number }[] = [];
  const rs = (i: number) => pred[i] - yy[i] - theta[1] * (rho * fx.nC[i] + (1 - rho) * fx.eC[i * NT + kT]) - theta[2] * fx.nY[i];
  for (let l = 0; l < L; l++) {
    // Weighted within-session regression of the residual on the same-lift fatigue x, jointly with the load term d = −κE/w (see
    // updateKappa: a back-off is usually the last set, so fatigue and load move together). Centred per session.
    let Sxx = 0, Sxr = 0, Sdd = 0, Sdr = 0, Sdx = 0, Srr = 0, cnt = 0;
    for (const g of liftGroups[l]) {
      const { o0, o1 } = groups[g];
      if (o1 - o0 < 2 || !hasPred[g]) continue;
      const E = Math.exp(predX[g]);
      let sw = 0, sx = 0, sr = 0, sd = 0, sxx = 0, sxr = 0, srr = 0, sdd = 0, sdr = 0, sdx = 0, m = 0;
      for (let i = o0; i < o1; i++) {
        const w = W[i];
        if (!(w > 0) || !Number.isFinite(pred[i])) continue;
        const x = rho * fx.nS[i] + (1 - rho) * fx.eS[i * NT + kT], r = rs(i), d = -kappa[l] * E / fx.w[i];
        sw += w; sx += w * x; sr += w * r; sd += w * d;
        sxx += w * x * x; sxr += w * x * r; srr += w * r * r; sdd += w * d * d; sdr += w * d * r; sdx += w * d * x; m++;
      }
      if (m < 2) continue;
      Sxx += sxx - sx * sx / sw; Sxr += sxr - sx * sr / sw; Srr += srr - sr * sr / sw;
      Sdd += sdd - sd * sd / sw; Sdr += sdr - sd * sr / sw; Sdx += sdx - sd * sx / sw; cnt += m - 1;
    }
    if (!(Sxx > 1e-9)) continue;
    const det = Sdd * Sxx - Sdx * Sdx;
    const joint = Sdd > 1e-9 && det > 1e-9 * Sdd * Sxx;
    const bx = joint ? (Sdd * Sxr - Sdx * Sdr) / det : Sxr / Sxx;
    const bd = joint ? (Sxx * Sdr - Sdx * Sxr) / det : 0;
    rss += Srr - bx * Sxr - bd * Sdr; dof += cnt - (joint ? 2 : 1);
    per.push({ est: bx, v: joint ? Sdd / det : 1 / Sxx, l });
  }
  // The weights are 1/variance already; a scale estimated from the residuals corrects for a misjudged noise.
  const phi = dof > 5 ? Math.max(1, rss / dof) : 1;
  // Absolute per-lift A at the person's (τ, ρ). A, τ and ρ trade off (at usual rests e^(−Δt/τ) is near 0, so the data see
  // A·ρ): a lift's A is only meaningful with the (τ, ρ) it was fitted at, which is how every consumer uses it (lossAt).
  for (const { est, v, l } of per) items.push({ key: liftKey(names[l]), est, v: phi * v });
  const sd0 = Math.sqrt(cells.reduce((a, c) => a + c.w * (c.cov[0] + (c.theta[0] - theta[0]) ** 2), 0));
  const p = pool(items, (a, b) => liftSimilarity(a, b), { mean: theta[0], personSd: sd0, liftSd: A_LIFT_SD });
  return { post: names.map((n) => p.lift(liftKey(n))) };
}
