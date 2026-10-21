import { isCardio, isCardioEntry } from '../cardio';
import { isHold } from '../care';
import { liftKey } from '../ids';
import { liftFactsVersion, resolveLift } from '../lifts';
import { MUSCLES, type Muscle, type Vector } from '../muscles';
import { byOrderDone, doneAt } from '../stats';
import type { SetEntry } from '../types';
import { aheadVar, dayOf, KAPPA_PRIOR, READY, type Cell, type Core, type Est, type LiftCore } from './capacity';
import { coreBefore } from './index';
import { inOrder, normCdf } from './num';
import { wallClock } from './remind';

// Gym readiness S1: each muscle's recovery between sessions (20-readiness-plan §3.1, as amended by S0: 20-readiness §6). Domain
// only; the readiness number, the verdict and the planner are S2–S3.
//
// Evidence labels: (a) research, cited; (b) learned from his log, by the method named; (c) a neutral default that takes no action
// (or only shapes a prior). Numerics: a choice of arithmetic that changes no answer.
//
// The deficit (ln e1RM) muscle m carries at time t from the earlier sessions' hard sets j:
//   D_m(t) = Σ_j v_L(j),m · δ_j · exp(−(t − t_j) / (τ′_m · φ^s)),      δ_j = β · ρA_L / (κ_L + r_j)
// - ρA_L: reps per set that outlast a rest (the capacity equation's persistent share ρ times the lift's A_same: learn/capacity),
//   averaged over the core's grid from TIMED sets only (Core.rest, b), as item 17 reads recovery: the main fit spaces an untimed
//   day's sets at his typical gap, which says nothing true about time (on his log the main fit puts ρ at 0.01 against the edge
//   of its τ grid; the timed fit keeps it near Rahimi's prior). The lift's own deviation is added (learn/rest's rule). Divided by
//   κ_L + r_j it is a share of e1RM: reps lost ÷ reps per unit of ln e1RM (∂C/∂ln E = κ + C, learn/capacity).
// - v_L,m: the lift's muscle vector (lifts.ts). A later lift L′ reads Σ_m u_L′,m·D_m with u = v/Σv², so a set of the same lift
//   reads back its own δ, and another lift's at its muscle overlap (learn/tags.overlap): the same arithmetic as the core.
// - τ′_m (b, a prior): per muscle, on TAU_D_GRID, prior TAU_D_PRIOR, pooled person → region → muscle (below).
// - φ (a prior → b learned, owner 2026-10-21): failure lengthens recovery by φ^s, s the share of muscle m's working sets that
//   session (fractional, by v) taken to failure: a logged RIR of 0, or a target missed at its weight (learn/capacity's reading).
//   Unlogged sets are not failure (a: his habitual RIR, the core's prior 2: Robinson 2024), nor light-week sets (item 06: stopped
//   short on purpose). φ acts on τ, not on δ (a: S0 §3.3, Bayes factor 8.3 for τ). Prior PHI_PRIOR; learned on PHI_GRID by the
//   marginal likelihood of his readings at each value (b), averaged by posterior weight.
// - β (b): a person-level scale on the core's persistent loss read as the deficit straight after the session, prior BETA_PRIOR.
//
// What the model learns from (b): every lift's session reading of its level (Core.lifts.obs: its own sets, the session's fatigue
// put back) against its level predicted from its other sessions (a forward and a backward Kalman filter, the drift the core
// learned: capacity.aheadVar; both sides, so a trend doesn't read as fatigue). Its shortfall y = predicted − read is regressed on
//   x = Σ_m u_m·(X_m(t) − the same filters' prediction of X_m from those other sessions)
// X_m being D_m/β: the reference sessions carried deficits too, and the filters are linear, so running them over X removes
// exactly what the reference carried. Readings of one session share the day's readiness (a: READY, Grgic 2020), so each
// session's errors are a random intercept (Woodbury, as the core's fatigue grid), and the whole scale is Birge-corrected
// (a: Birge 1932, Phys Rev 40:207: the readings' own variances understate the scatter; the ratio χ²/(n − 1), never below 1).
// - β per τ cell: conjugate normal, exact.
// - τ′ per muscle: a lift reads several muscles, so the likelihood couples them; each muscle's cells are weighed with the others
//   at their current posterior mean (mean-field, ROUNDS rounds), then pooled.
// - Pooling (b): ln τ′_m = μ_person + η_region + ε_muscle, exact belief propagation on that tree with the person and region means
//   on a fine grid (MU). TAU_D_PRIOR's spread (0.8 in logs, S0's spread between study units) is split between the three levels:
//   each split on a grid in sixths, uniform prior over the simplex (c), weighed by marginal likelihood (b). A muscle he has never
//   trained gets its region's and person's value with their spread.
// - Recency (b): a power prior (a: Ibrahim & Chen 2000, Stat Sci 15:46): a session's readings count 2^(−age/h), so after a
//   layoff the posterior widens back toward the prior. h on HALF_LIVES (c), learned by prequential likelihood (b: each session
//   predicted from the ones before it), the fade then taken at the posterior-weighted average of 2^(−age/h).
// - How much is his (owner 2026-10-21: no switch-over point; every session moves it): the share of the posterior precision
//   that comes from his log, 1 − prior variance⁻¹ / posterior variance⁻¹ (= 1 − σ²_post/σ²_prior), for τ′, β and φ alike.
//   0 is research alone, 1 his log alone; the UI can show "research 80 % · you 20 %".
//
// Outputs are by day only (owner Q2, 2026-10-20): P(recovered) on a date is P(D_m < READY) at that date's reference time, his
// median logged session start on that weekday, else on any day, else REF_MINUTES (c). The reference time is internal: never shown.
// d* (freshBy) is the first date from today whose P > ½ (even odds, plan §3.1).

/** (a) τ′, the recovery time constant of a non-failure session (h): log-normal, S0's fit to Raastad & Hallén 2000 and Morán-Navarro 2017. */
export const TAU_D_PRIOR = { median: 4, logSd: 0.8 } as const;
/** (c) τ′ grid (h): spans the prior's 1–99 % for non-failure (0.6–26 h) and failure sessions (5–206 h, capped). */
export const TAU_D_GRID = [1, 2, 4, 8, 16, 32, 64, 128] as const;
/**
 * (a) φ prior, grade W: log-normal, median 8 (S0: failure sessions' τ_f median 31 h over τ′ 4 h; Morán-Navarro 2017's
 * volume-matched pair; Vieira 2022 for the direction), log-SD 0.62: S0's primary 5–95 % range 3.6–28, read in logs
 * (ln(28/3.6)/3.29). Learned from his failure sets (b).
 */
export const PHI_PRIOR = { median: 8, logSd: Math.log(28 / 3.6) / (2 * 1.6448536) } as const;
/** (c) φ grid: doubling, 1 (failure adds nothing) to 64; the prior's 99 % range sits inside it. */
export const PHI_GRID = [1, 2, 4, 8, 16, 32, 64] as const;
/**
 * (c) β prior: centred on the core's persistent loss taken as the deficit straight after a session (β = 1); at the core's priors
 * that gives Morán-Navarro's 3×5 squat about 4 % (inside S0's assumed 3.5–8 %). SD 0.5 lets his log halve or double it.
 */
export const BETA_PRIOR = { mean: 1, sd: 0.5 } as const;
/** (c) Half-lives of the power prior, days, doubling; uniform prior (the data weigh them). */
export const HALF_LIVES = [14, 28, 56, 112, 224, 448] as const;
/** (c) The reference time with no logged start: 18:00. A later time only makes more muscles fresh: it takes no action. */
export const REF_MINUTES = 18 * 60;
/** Even odds (plan §3.1): fresh once P(recovered) > ½. */
export const P_FRESH = 0.5;

/**
 * (c) Regions for pooling: a grouping. Upper and lower body kept apart because they recover differently (a: Chen 2011, elbow
 * flexors more damaged than knee extensors; Vieira 2022, upper limbs lost more velocity after failure); the trunk on its own.
 */
export type BodyRegion = 'upper' | 'lower' | 'trunk';
export const MUSCLE_REGION: Record<Muscle, BodyRegion> = {
  Chest: 'upper', Triceps: 'upper', Biceps: 'upper', 'Front Delts': 'upper', 'Side Delts': 'upper', 'Rear Delts': 'upper',
  Lats: 'upper', 'Mid-Back': 'upper', Traps: 'upper', Forearms: 'upper',
  Quads: 'lower', Hamstrings: 'lower', Glutes: 'lower', Calves: 'lower', Adductors: 'lower', Abductors: 'lower',
  Erectors: 'trunk', Abs: 'trunk',
};

/** Numerics: mean-field rounds (the third moves the cells by < 1e-3 on synthetic logs), the d* search's horizon in days. */
const ROUNDS = 3, HORIZON = 366;

const NC = TAU_D_GRID.length, NM = MUSCLES.length, NP = PHI_GRID.length, NH = HALF_LIVES.length;
const LN2 = Math.LN2;
const LAMBDA = TAU_D_GRID.map(Math.log);
/**
 * exp(−dt/(τ_c·mult)) for every cell, into `out`. Numerics: the grid doubles, so each cell's factor is the square of the next
 * one up's: one exp a call instead of eight.
 */
function decays(dt: number, mult: number, out: Float64Array): void {
  let f = Math.exp(-dt / (TAU_D_GRID[NC - 1] * mult));
  for (let c = NC - 1; c >= 0; c--) { out[c] = f; f *= f; }
}
const REGIONS: readonly BodyRegion[] = ['upper', 'lower', 'trunk'];
const REGION_OF = MUSCLES.map((m) => REGIONS.indexOf(MUSCLE_REGION[m]));
const IN_REGION = REGIONS.map((_, r) => MUSCLES.map((_, m) => m).filter((m) => REGION_OF[m] === r));
const MUSCLE_IX = new Map<Muscle, number>(MUSCLES.map((m, i) => [m, i]));
/** The grid's own resolution, uniform within one step, so a posterior on one cell is not read as exact (as the core's ρ). */
const RES_TAU = LN2 * LN2 / 12, RES_PHI = LN2 * LN2 / 12;
/** Numerics: the person and region means' grid (ln h): ¼ h to 512 h in half-doublings. */
const MU = Array.from({ length: 23 }, (_, i) => Math.log(0.25) + i * LN2 / 2);
const NMU = MU.length;
const RES_MU = (LN2 / 2) ** 2 / 12;

// ---- The pooling tree's priors, once ---------------------------------------------------------------------------------------

interface Split { pP: Float64Array; TR: Float64Array; TM: Float64Array }
const gauss = (x: number, m: number, v: number) => Math.exp(-0.5 * (x - m) * (x - m) / v);
/** Shares of TAU_D_PRIOR's variance at person, region and muscle level: sixths, each at least one (uniform over the simplex, c). */
const SPLITS: Split[] = [];
for (let a = 1; a <= 4; a++) for (let b = 1; a + b <= 5; b++) {
  const c = 6 - a - b, V = TAU_D_PRIOR.logSd ** 2;
  const vP = V * a / 6, vR = V * b / 6, vM = V * c / 6;
  const pP = new Float64Array(NMU);
  let z = 0;
  for (let i = 0; i < NMU; i++) z += pP[i] = gauss(MU[i], Math.log(TAU_D_PRIOR.median), vP);
  for (let i = 0; i < NMU; i++) pP[i] /= z;
  const TR = new Float64Array(NMU * NMU);
  for (let i = 0; i < NMU; i++) {
    let s = 0;
    for (let j = 0; j < NMU; j++) s += TR[i * NMU + j] = gauss(MU[j], MU[i], vR);
    for (let j = 0; j < NMU; j++) TR[i * NMU + j] /= s;
  }
  const TM = new Float64Array(NMU * NC);
  for (let j = 0; j < NMU; j++) {
    let s = 0;
    for (let c2 = 0; c2 < NC; c2++) s += TM[j * NC + c2] = gauss(LAMBDA[c2], MU[j], vM);
    for (let c2 = 0; c2 < NC; c2++) TM[j * NC + c2] /= s;
  }
  SPLITS.push({ pP, TR, TM });
}

/** φ's prior on its grid (a), normalised. */
const PHI_W0 = (() => {
  const w = PHI_GRID.map((p) => gauss(Math.log(p), Math.log(PHI_PRIOR.median), PHI_PRIOR.logSd ** 2));
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / s);
})();

const momentsOf = (xs: readonly number[], w: ArrayLike<number>, res: number) => {
  let m = 0, tot = 0;
  for (let i = 0; i < xs.length; i++) { m += w[i] * xs[i]; tot += w[i]; }
  m /= tot;
  let v = 0;
  for (let i = 0; i < xs.length; i++) v += w[i] * (xs[i] - m) ** 2;
  return { mean: m, sd: Math.sqrt(v / tot + res) };
};

// ---- Belief propagation on person → region → muscle ----------------------------------------------------------------------

interface Pooled { q: Float64Array; person: Float64Array; logZ: number }
/**
 * Each muscle's posterior over the τ′ grid from its own log likelihood per cell (ell, NM × NC), pooled through the tree: exact on
 * the discretised tree, averaged over the splits by marginal likelihood.
 */
function poolTree(ell: Float64Array): Pooled {
  const L = new Float64Array(NM * NC);
  let base = 0;
  for (let m = 0; m < NM; m++) {
    let mx = -Infinity;
    for (let c = 0; c < NC; c++) mx = Math.max(mx, ell[m * NC + c]);
    base += mx;
    for (let c = 0; c < NC; c++) L[m * NC + c] = Math.exp(ell[m * NC + c] - mx);
  }
  const NS = SPLITS.length;
  const qs = new Float64Array(NS * NM * NC), ps = new Float64Array(NS * NMU), lz = new Float64Array(NS);
  const up = new Float64Array(NM * NMU), U = new Float64Array(3 * NMU), upR = new Float64Array(3 * NMU);
  const msgP = new Float64Array(NMU), msg = new Float64Array(NMU), cav = new Float64Array(NMU), pre = new Float64Array(NM * NMU), suf = new Float64Array(NMU);
  for (let s = 0; s < NS; s++) {
    const { pP, TR, TM } = SPLITS[s];
    let logs = 0;
    for (let m = 0; m < NM; m++) {
      let mx = 0;
      for (let j = 0; j < NMU; j++) {
        let x = 0;
        for (let c = 0; c < NC; c++) x += TM[j * NC + c] * L[m * NC + c];
        up[m * NMU + j] = x; if (x > mx) mx = x;
      }
      for (let j = 0; j < NMU; j++) up[m * NMU + j] /= mx;
      logs += Math.log(mx);
    }
    for (let r = 0; r < 3; r++) {
      let mx = 0;
      for (let j = 0; j < NMU; j++) {
        let x = 1;
        for (const m of IN_REGION[r]) x *= up[m * NMU + j];
        U[r * NMU + j] = x; if (x > mx) mx = x;
      }
      for (let j = 0; j < NMU; j++) U[r * NMU + j] /= mx;
      logs += Math.log(mx);
      let my = 0;
      for (let i = 0; i < NMU; i++) {
        let x = 0;
        for (let j = 0; j < NMU; j++) x += TR[i * NMU + j] * U[r * NMU + j];
        upR[r * NMU + i] = x; if (x > my) my = x;
      }
      for (let i = 0; i < NMU; i++) upR[r * NMU + i] /= my;
      logs += Math.log(my);
    }
    let Z = 0;
    for (let i = 0; i < NMU; i++) { const x = pP[i] * upR[i] * upR[NMU + i] * upR[2 * NMU + i]; ps[s * NMU + i] = x; Z += x; }
    for (let i = 0; i < NMU; i++) ps[s * NMU + i] /= Z;
    lz[s] = Math.log(Z) + logs;
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < NMU; i++) {
        let x = pP[i];
        for (let r2 = 0; r2 < 3; r2++) if (r2 !== r) x *= upR[r2 * NMU + i];
        cav[i] = x;
      }
      for (let j = 0; j < NMU; j++) { let x = 0; for (let i = 0; i < NMU; i++) x += cav[i] * TR[i * NMU + j]; msgP[j] = x; }
      // The others' product for each muscle: running products from the left (pre) and the right (msg, as it goes).
      const ms = IN_REGION[r], nm = ms.length;
      for (let j = 0; j < NMU; j++) pre[j] = msgP[j];
      for (let k = 1; k < nm; k++) for (let j = 0; j < NMU; j++) pre[k * NMU + j] = pre[(k - 1) * NMU + j] * up[ms[k - 1] * NMU + j];
      suf.fill(1);
      for (let k = nm - 1; k >= 0; k--) {
        const m = ms[k];
        for (let j = 0; j < NMU; j++) msg[j] = pre[k * NMU + j] * suf[j];
        for (let j = 0; j < NMU; j++) suf[j] *= up[m * NMU + j];
        let t = 0;
        const o = (s * NM + m) * NC;
        for (let c = 0; c < NC; c++) {
          let x = 0;
          for (let j = 0; j < NMU; j++) x += msg[j] * TM[j * NC + c];
          qs[o + c] = x * L[m * NC + c]; t += qs[o + c];
        }
        for (let c = 0; c < NC; c++) qs[o + c] /= t;
      }
    }
  }
  let mx = -Infinity;
  for (let s = 0; s < NS; s++) mx = Math.max(mx, lz[s]);
  let tw = 0;
  const w = new Float64Array(NS);
  for (let s = 0; s < NS; s++) { w[s] = Math.exp(lz[s] - mx); tw += w[s]; }
  const q = new Float64Array(NM * NC), person = new Float64Array(NMU);
  for (let s = 0; s < NS; s++) {
    const ws = w[s] / tw;
    for (let k = 0; k < NM * NC; k++) q[k] += ws * qs[s * NM * NC + k];
    for (let i = 0; i < NMU; i++) person[i] += ws * ps[s * NMU + i];
  }
  return { q, person, logZ: mx + Math.log(tw / NS) + base };
}

/** With no data: every muscle's prior over the grid (all alike), and the person's. */
const PRIOR = poolTree(new Float64Array(NM * NC));
const PRIOR_TAU = momentsOf(LAMBDA, PRIOR.q.subarray(0, NC), RES_TAU);
const PRIOR_PERSON = momentsOf(MU, PRIOR.person, RES_MU);
const PRIOR_PHI = momentsOf(PHI_GRID.map(Math.log), PHI_W0, RES_PHI);
/** The share of the posterior precision from the data: 1 − σ²_post/σ²_prior, in [0, 1] (pooling can widen a little: 0). */
export const dataShare = (post: number, prior: number): number => Math.min(1, Math.max(0, 1 - (post * post) / (prior * prior)));

// ---- Sessions ---------------------------------------------------------------------------------------------------------------

/** One hard set as a deposit: its lift, reps, whether it went to failure, its muscles, and its local hour (NaN: no time). */
interface DSet { key: string; reps: number; fail: number; v: Vector; hour: number }
interface Sess { date: string; day: number; sets: DSet[]; startMin: number | null; first: Map<string, number> }

const CARDIO = new Map<string, boolean>();
// Per name, once (both normalise the name): not once per set per refit.
const notLift = (n: string) => { let c = CARDIO.get(n); if (c === undefined) { c = isCardio(n) || isHold(n); CARDIO.set(n, c); } return c; };
const isDeposit = (e: SetEntry) => e.reps != null && e.reps > 0 && !e.flags.includes('warmup') && !e.flags.includes('partial')
  && !e.flags.includes('hold') && !isCardioEntry(e) && !notLift(e.exercise);
/**
 * (a, S0 §0) A set to failure: a logged RIR of 0, or a target at its weight missed (learn/capacity reads that as near failure).
 * A light week's set is stopped short on purpose (item 06): never failure.
 */
export function isFailure(e: SetEntry): boolean {
  if (e.flags.includes('light')) return false;
  if (e.rir != null) return e.rir === 0;
  const t = e.target;
  return !!t && t.weight != null && t.weight === e.weight && e.reps != null && e.reps < t.reps;
}

// Cached by the day's sets themselves (the store never changes a set in place), the lift facts and the zone, as learn/capacity.
const SESSIONS = new WeakMap<SetEntry, { hard: readonly SetEntry[]; fv: number; tz: string; s: Sess }>();
const sameSets = (a: readonly SetEntry[], b: readonly SetEntry[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function sessOf(date: string, hard: SetEntry[], tz: string): Sess {
  const fv = liftFactsVersion();
  const hit = SESSIONS.get(hard[0]);
  if (hit && hit.fv === fv && hit.tz === tz && sameSets(hit.hard, hard)) return hit.s;
  const day = dayOf(date);
  const sets: DSet[] = [];
  let h0 = NaN, t0 = NaN, startMin: number | null = null;
  for (const e of hard) {
    const v = resolveLift(e.exercise).m;
    const t = doneAt(e);
    let hour = NaN;
    if (Number.isFinite(t)) {
      if (Number.isNaN(h0)) {
        const w = wallClock(e.loggedAt!, tz);
        if (w) { h0 = (dayOf(w.date) - day) * 24 + w.min / 60; t0 = t; if (w.date === date && !sets.length) startMin = w.min; }
      }
      if (!Number.isNaN(h0)) hour = h0 + (t - t0) / 36e5;
    }
    if (!v) continue;
    sets.push({ key: liftKey(e.exercise), reps: e.reps as number, fail: isFailure(e) ? 1 : 0, v, hour });
  }
  const first = new Map<string, number>();
  sets.forEach((x, i) => { if (!first.has(x.key)) first.set(x.key, i); });
  const s: Sess = { date, day, sets, startMin, first };
  SESSIONS.set(hard[0], { hard: [...hard], fv, tz, s });
  return s;
}

// ---- The fit ----------------------------------------------------------------------------------------------------------------

/** What the recovery fit reads from the capacity core (a Core has all of it). */
export interface RecoveryCore {
  drift: number; gap: number;
  fit: { theta: readonly number[] };
  rest: { cells: readonly Pick<Cell, 'w' | 'rho' | 'theta'>[] };
  lifts: ReadonlyMap<string, Pick<LiftCore, 'name' | 'kappa' | 'aSame' | 'obs'>>;
}

export interface MuscleRecovery {
  muscle: Muscle; region: BodyRegion;
  /** τ′ (h): posterior median and SD in logs; the prior's SD; posterior weight per TAU_D_GRID cell. */
  tau: { median: number; logSd: number; priorLogSd: number; w: number[] };
  /** β as this muscle's cells read it. */
  beta: Est;
  /** The share of the posterior precision from his log (0–1): τ′'s, β's, and the smaller of the two (what the deficit rests on). */
  fromData: { tau: number; beta: number; both: number };
  /** Readings (a lift's session) that inform it; the last date that left it a deficit. */
  readings: number; lastTrained: string | null;
}
/** One (φ, τ′) cell of a muscle at an hour: its weight, X = D/β there, and β's posterior in that cell. */
export interface RecoveryCell { w: number; phi: number; tau: number; x: number; beta: Est }
export interface RecoveryFit {
  today: string; tz: string;
  /** Sessions read for deposits; sessions and readings learned from. */
  sessions: number; learnedSessions: number; readings: number;
  /** β at the person level (every muscle at its posterior mean), with its prior. */
  beta: Est & { prior: Est };
  /** The person's ln τ′ mean (pooling's top level) as a median in hours, its SD in logs and the prior's. */
  person: { median: number; logSd: number; priorLogSd: number };
  /** φ: posterior weight per PHI_GRID value, median, SD in logs, the prior's, and whether it is still research. */
  phi: { median: number; logSd: number; priorLogSd: number; w: [number, number][]; fromData: number };
  /** Birge ratio s² (≥ 1) the readings' variances were scaled by. */
  birge: number;
  /** Posterior weight of each half-life (days). */
  halfLife: [number, number][];
  /** Prequential log score of the readings (nats) under the model, and under no recovery term (β = 0). */
  logScore: number; flatScore: number;
  /** The share of the posterior precision from his log at the person level: τ′ (pooling's top), β and φ. */
  fromData: { tau: number; beta: number; phi: number };
  muscles: ReadonlyMap<Muscle, MuscleRecovery>;
  /** The reference time on `date`, minutes after local midnight. Internal: never shown (owner Q2). */
  refMinutes(date: string): number;
  /** P(recovered) of a muscle at an hour on the day axis (dayOf(date)·24 + local hours): internal, for tests and S2. */
  pAtHour(muscle: Muscle, hour: number): number;
  /** P(recovered) of a muscle at `date`'s reference time. */
  pRecovered(muscle: Muscle, date: string): number;
  /** The deficit's mean and SD (ln e1RM) at `date`'s reference time. */
  deficit(muscle: Muscle, date: string): Est;
  /** d*: the first date from today whose reference time has P(recovered) > ½; null past a year. */
  freshBy(muscle: Muscle): string | null;
  /** The cells P(recovered) mixes at an hour (weights sum to 1): for S2's lift-level reading. */
  cells(muscle: Muscle, hour: number): RecoveryCell[];
}

/** A muscle's deposits, by session in date order: its day, end hour, failure share and sets (amount ÷ β, hours before the end). */
interface MDeps { day: number[]; date: string[]; tEnd: number[]; s: number[]; off: number[]; amt: number[]; lag: number[] }
/** A muscle's queries: the reading slots (day, absolute hour), in (day, hour) order. */
interface MQ { slot: number[]; day: number[]; T: number[] }

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const LN2PI = Math.log(2 * Math.PI);

/**
 * The fit (see the header), from the log up to and including `today` (later dates are ignored) and a capacity core, best the one
 * as of the days before today (index.coreBefore): its readings learn, every set deposits. Pure: the same inputs give the same fit.
 */
export function fitRecovery(entries: readonly SetEntry[], core: RecoveryCore, today: string, tz: string): RecoveryFit {
  const todayN = dayOf(today);
  // Sessions in date order, each in the order done.
  const byDate = new Map<string, SetEntry[]>();
  for (const e of entries) {
    if (e.date > today || !isDeposit(e)) continue;
    const d = byDate.get(e.date);
    if (d) d.push(e); else byDate.set(e.date, [e]);
  }
  const dates = [...byDate.keys()].sort();
  const sess = dates.map((d) => { const xs = byDate.get(d)!; return sessOf(d, inOrder(xs, byOrderDone) ? xs : xs.sort(byOrderDone), tz); }).filter((s) => s.sets.length);
  const sessAt = new Map(sess.map((s) => [s.date, s]));

  // The reference time: his median logged start on the weekday, else on any day, else REF_MINUTES (c).
  const starts: number[][] = Array.from({ length: 7 }, () => []);
  const all: number[] = [];
  for (const s of sess) if (s.date < today && s.startMin != null) { starts[weekday(s.date)].push(s.startMin); all.push(s.startMin); }
  const byWeekday = starts.map((xs) => (xs.length ? median(xs) : null));
  const anyDay = all.length ? median(all) : REF_MINUTES;
  const refMinutes = (date: string) => byWeekday[weekday(date)] ?? anyDay;

  // Set hours: a set without a time follows the one before it at his typical gap; a day without times starts at its reference.
  const hoursOf = (s: Sess): number[] => {
    const hs: number[] = [];
    for (let i = 0; i < s.sets.length; i++) {
      const h = s.sets[i].hour;
      hs.push(Number.isFinite(h) ? h : i ? hs[i - 1] + core.gap / 3600 : refMinutes(s.date) / 60);
    }
    return hs;
  };

  // Persistent loss per set of each lift (reps, b): Σ_cells w·ρ·(A_same + the lift's deviation), on the timed-sets grid.
  const persist = new Map<string, number>();
  const persistOf = (key: string): number => {
    let p = persist.get(key);
    if (p !== undefined) return p;
    const lift = core.lifts.get(key);
    const dev = lift ? lift.aSame.mean - core.fit.theta[0] : 0;
    p = 0;
    for (const c of core.rest.cells) p += c.w * c.rho * (c.theta[0] + dev);
    p = Math.max(0, p); // numerics: a loss can't be a gain
    persist.set(key, p);
    return p;
  };
  const kappaOf = (key: string) => core.lifts.get(key)?.kappa.mean ?? KAPPA_PRIOR.mean;

  // Deposits per muscle.
  const deps: MDeps[] = MUSCLES.map(() => ({ day: [], date: [], tEnd: [], s: [], off: [0], amt: [], lag: [] }));
  const lastTrained: (string | null)[] = MUSCLES.map(() => null);
  const sessHours = new Map<string, number[]>();
  const sv = new Float64Array(NM), sf = new Float64Array(NM);
  for (const s of sess) {
    const hs = hoursOf(s);
    sessHours.set(s.date, hs);
    let end = -Infinity;
    for (const h of hs) end = Math.max(end, h);
    sv.fill(0); sf.fill(0);
    for (const x of s.sets) for (const [m, w] of Object.entries(x.v) as [Muscle, number][]) {
      const i = MUSCLE_IX.get(m)!;
      sv[i] += w; sf[i] += w * x.fail;
    }
    for (let i = 0; i < NM; i++) {
      if (!(sv[i] > 0)) continue;
      const D = deps[i];
      D.day.push(s.day); D.date.push(s.date); D.tEnd.push(s.day * 24 + end); D.s.push(sf[i] / sv[i]);
      s.sets.forEach((x, j) => {
        const w = x.v[MUSCLES[i]] ?? 0;
        if (!(w > 0)) return;
        D.amt.push(w * persistOf(x.key) / (kappaOf(x.key) + x.reps)); D.lag.push(end - hs[j]);
      });
      D.off.push(D.amt.length);
      lastTrained[i] = s.date;
    }
  }

  // ---- Readings: each lift's sessions before today with a prediction from both sides ----
  const qs: MQ[] = MUSCLES.map(() => ({ slot: [], day: [], T: [] }));
  let nSlots = 0;
  interface LiftR { n: number; Kf: Float64Array; Kb: Float64Array; wf: Float64Array; wb: Float64Array; ms: number[]; us: number[]; slots: number[][]; rIx: number[]; rObs: number[] }
  const liftsR: LiftR[] = [];
  const rDate: string[] = [], rY: number[] = [], rD: number[] = [];
  for (const [key, lift] of core.lifts) {
    const o = lift.obs, n = o.length;
    if (n < 3) continue;
    const v = resolveLift(lift.name).m;
    if (!v) continue;
    const ms: number[] = [], us: number[] = [];
    let vv = 0;
    for (const w of Object.values(v)) vv += (w as number) ** 2;
    for (const [m, w] of Object.entries(v) as [Muscle, number][]) if (w > 0) { ms.push(MUSCLE_IX.get(m)!); us.push(w / vv); }
    if (!ms.length) continue;
    // Forward and backward filters (the core's drift), and each session's leave-one-out reference from both sides.
    const fP = new Float64Array(n).fill(Infinity), bP = new Float64Array(n).fill(Infinity), Kf = new Float64Array(n), Kb = new Float64Array(n);
    const fm = new Float64Array(n), bm = new Float64Array(n);
    let m0 = o[0].z, P = o[0].v;
    for (let k = 1; k < n; k++) {
      const Pp = P + aheadVar(core, o[k].day - o[k - 1].day);
      fP[k] = Pp; fm[k] = m0; Kf[k] = Pp / (Pp + o[k].v);
      m0 += Kf[k] * (o[k].z - m0); P = (1 - Kf[k]) * Pp;
    }
    m0 = o[n - 1].z; P = o[n - 1].v;
    for (let k = n - 2; k >= 0; k--) {
      const Pp = P + aheadVar(core, o[k + 1].day - o[k].day);
      bP[k] = Pp; bm[k] = m0; Kb[k] = Pp / (Pp + o[k].v);
      m0 += Kb[k] * (o[k].z - m0); P = (1 - Kb[k]) * Pp;
    }
    const wf = new Float64Array(n), wb = new Float64Array(n);
    const rIx: number[] = [], rObs: number[] = [];
    for (let k = 1; k < n - 1; k++) {
      const Pr = 1 / (1 / fP[k] + 1 / bP[k]);
      wf[k] = Pr / fP[k]; wb[k] = Pr / bP[k];
      if (o[k].date >= today || !sessAt.has(o[k].date)) continue;
      rIx.push(rY.length); rObs.push(k);
      rDate.push(o[k].date); rY.push(wf[k] * fm[k] + wb[k] * bm[k] - o[k].z);
      // Its own variance less the day's readiness, which the session's readings share (the random intercept below).
      rD.push(Math.max(1e-12, Pr + o[k].v - READY * READY));
    }
    if (!rIx.length) continue;
    // Each obs's hour: the lift's first set that day (the session's start, if it has none there).
    const T = o.map((x) => {
      const s = sessAt.get(x.date);
      const f = s?.first.get(key);
      return x.day * 24 + (s && f != null ? sessHours.get(x.date)![f] : refMinutes(x.date) / 60);
    });
    const slots = ms.map((m) => o.map((x, k) => { const q = qs[m]; q.slot.push(nSlots); q.day.push(x.day); q.T.push(T[k]); return nSlots++; }));
    liftsR.push({ n, Kf, Kb, wf, wb, ms, us, slots, rIx, rObs });
  }
  const nR = rY.length;
  // Sessions of readings, in date order, and each reading's.
  const rDates = [...new Set(rDate)].sort();
  const NSR = rDates.length;
  const sIx = new Map(rDates.map((d, i) => [d, i]));
  const rS = Int32Array.from(rDate, (d) => sIx.get(d)!);
  const sDay = rDates.map(dayOf);
  // Per session: Σ1/d, the Woodbury factor k = c/(1 + cΣ1/d) (c = READY²), Σy/d, Σy²/d, its size and ln det of its covariance.
  const C2 = READY * READY;
  const Sd1 = new Float64Array(NSR), Sy = new Float64Array(NSR), Syy = new Float64Array(NSR), nS = new Float64Array(NSR), ldS = new Float64Array(NSR);
  for (let i = 0; i < nR; i++) { const s = rS[i]; Sd1[s] += 1 / rD[i]; Sy[s] += rY[i] / rD[i]; Syy[s] += rY[i] * rY[i] / rD[i]; nS[s]++; ldS[s] += Math.log(rD[i]); }
  const kS = new Float64Array(NSR);
  for (let s = 0; s < NSR; s++) { kS[s] = C2 / (1 + C2 * Sd1[s]); ldS[s] += Math.log(1 + C2 * Sd1[s]); }
  // Entries: (reading, muscle, u), and per muscle its entries in session order.
  const eR: number[] = [], eM: number[] = [], eU: number[] = [];
  const eOf: { lift: number; mm: number; k: number }[] = [];
  liftsR.forEach((L, li) => L.rIx.forEach((r, j) => L.ms.forEach((m, mm) => { eR.push(r); eM.push(m); eU.push(L.us[mm]); eOf.push({ lift: li, mm, k: L.rObs[j] }); })));
  const nE = eR.length;
  const byM: number[][] = MUSCLES.map(() => []);
  for (let e = 0; e < nE; e++) byM[eM[e]].push(e);
  for (const xs of byM) xs.sort((a, b) => rS[eR[a]] - rS[eR[b]] || a - b);
  const readingsOf = byM.map((xs) => xs.length);
  // Per muscle, its queries in (day, hour) order.
  const qOrder = qs.map((q) => q.slot.map((_, i) => i).sort((a, b) => q.day[a] - q.day[b] || q.T[a] - q.T[b]));

  /**
   * X = D/β at every query slot, and each deposit anchored at its session's end, for one φ (per muscle, per cell); then g, X less
   * the lift's filters' leave-one-out prediction of X, per entry and cell. Only deposits with failure in them (`fail`) or only
   * those without: X and g are linear in the deposits, and those without don't depend on φ, so they are worked out once.
   */
  const xPass = (phi: number, fail: boolean) => {
    const X = new Float64Array(nSlots * NC);
    const dep: Float64Array[] = [], tauOf: Float64Array[] = [];
    const f = new Float64Array(NC);
    let any = false;
    const anyM = new Uint8Array(NM);
    for (let m = 0; m < NM; m++) {
      const D = deps[m], nd = D.day.length;
      const dc = new Float64Array(nd * NC), te = new Float64Array(nd * NC);
      for (let q = 0; q < nd; q++) {
        if ((D.s[q] > 0) !== fail) continue;
        any = true; anyM[m] = 1;
        const mult = phi ** D.s[q];
        for (let c = 0; c < NC; c++) te[q * NC + c] = TAU_D_GRID[c] * mult;
        for (let j = D.off[q]; j < D.off[q + 1]; j++) {
          decays(D.lag[j], mult, f);
          for (let c = 0; c < NC; c++) dc[q * NC + c] += D.amt[j] * f[c];
        }
      }
      dep.push(dc); tauOf.push(te);
      const Q = qs[m];
      if (!Q.slot.length || !anyM[m]) continue;
      // Deposits sharing a failure share decay alike: one running sum per share and cell, brought forward to each query.
      const gix = new Map<number, number>();
      const gS: Float64Array[] = [], gT: number[] = [], gM: number[] = [];
      let q = 0;
      for (const i of qOrder[m]) {
        const day = Q.day[i], T = Q.T[i];
        for (; q < nd && D.day[q] < day; q++) {
          if ((D.s[q] > 0) !== fail) continue;
          let g = gix.get(D.s[q]);
          if (g === undefined) { g = gS.length; gix.set(D.s[q], g); gS.push(new Float64Array(NC)); gT.push(D.tEnd[q]); gM.push(phi ** D.s[q]); }
          const S = gS[g];
          decays(Math.max(0, D.tEnd[q] - gT[g]), gM[g], f);
          for (let c = 0; c < NC; c++) S[c] = S[c] * f[c] + dc[q * NC + c];
          gT[g] = D.tEnd[q];
        }
        const o = Q.slot[i] * NC;
        for (let g = 0; g < gS.length; g++) {
          decays(Math.max(0, T - gT[g]), gM[g], f);
          for (let c = 0; c < NC; c++) X[o + c] += gS[g][c] * f[c];
        }
      }
    }
    const G = new Float64Array(nE * NC);
    if (!any) return { G, dep, tauOf, any };
    const series = liftsR.map((L) => L.ms.map(() => new Float64Array(0)));
    liftsR.forEach((L, li) => L.ms.forEach((m, mm) => {
      const n = L.n, out = new Float64Array(n * NC);
      series[li][mm] = out;
      if (!anyM[m]) return; // no deposits here: X and g are 0
      const a = new Float64Array(n), fw = new Float64Array(n), bw = new Float64Array(n);
      for (let c = 0; c < NC; c++) {
        for (let k = 0; k < n; k++) a[k] = X[L.slots[mm][k] * NC + c];
        let mm0 = a[0];
        for (let k = 1; k < n; k++) { fw[k] = mm0; mm0 += L.Kf[k] * (a[k] - mm0); }
        mm0 = a[n - 1];
        for (let k = n - 2; k >= 0; k--) { bw[k] = mm0; mm0 += L.Kb[k] * (a[k] - mm0); }
        for (let k = 1; k < n - 1; k++) out[k * NC + c] = a[k] - (L.wf[k] * fw[k] + L.wb[k] * bw[k]);
      }
    }));
    for (let e = 0; e < nE; e++) { const { lift, mm, k } = eOf[e]; G.set(series[lift][mm].subarray(k * NC, (k + 1) * NC), e * NC); }
    return { G, dep, tauOf, any };
  };

  const mu0 = BETA_PRIOR.mean, p0 = 1 / BETA_PRIOR.sd ** 2;
  /** Per session: Σx/d, Σx²/d, Σxy/d for the regressor x. */
  const sessSums = (x: Float64Array) => {
    const Sx = new Float64Array(NSR), Sxx = new Float64Array(NSR), Sxy = new Float64Array(NSR);
    for (let i = 0; i < nR; i++) { const s = rS[i], xd = x[i] / rD[i]; Sx[s] += xd; Sxx[s] += x[i] * xd; Sxy[s] += rY[i] * xd; }
    return { Sx, Sxx, Sxy };
  };
  const xbarOf = (G: Float64Array, q: Float64Array) => {
    const gb = new Float64Array(nE), x = new Float64Array(nR);
    for (let e = 0; e < nE; e++) {
      let g = 0;
      for (let c = 0; c < NC; c++) g += q[eM[e] * NC + c] * G[e * NC + c];
      gb[e] = g; x[eR[e]] += eU[e] * g;
    }
    return { gb, x };
  };
  /**
   * Each muscle's log marginal likelihood per cell (β integrated, conjugate), the other muscles at their mean; and β's posterior
   * per (muscle, cell). Session weights w (the power prior), scale s2.
   */
  const cellFit = (G: Float64Array, q: Float64Array, w: Float64Array, s2: number) => {
    const { gb, x } = xbarOf(G, q);
    const { Sx, Sxx, Sxy } = sessSums(x);
    let A0 = 0, B0 = 0;
    for (let s = 0; s < NSR; s++) { A0 += w[s] * (Sxx[s] - kS[s] * Sx[s] * Sx[s]); B0 += w[s] * (Sxy[s] - kS[s] * Sx[s] * Sy[s]); }
    const ell = new Float64Array(NM * NC), bm = new Float64Array(NM * NC), bs = new Float64Array(NM * NC);
    const dA = new Float64Array(NC), dB = new Float64Array(NC), dx = new Float64Array(NC), dxx = new Float64Array(NC), dxy = new Float64Array(NC);
    for (let m = 0; m < NM; m++) {
      dA.fill(0); dB.fill(0);
      const es = byM[m];
      for (let a = 0; a < es.length;) {
        const s = rS[eR[es[a]]];
        dx.fill(0); dxx.fill(0); dxy.fill(0);
        for (; a < es.length && rS[eR[es[a]]] === s; a++) {
          const e = es[a], i = eR[e], d = rD[i];
          for (let c = 0; c < NC; c++) {
            const del = eU[e] * (G[e * NC + c] - gb[e]);
            dx[c] += del / d; dxx[c] += (2 * x[i] * del + del * del) / d; dxy[c] += del * rY[i] / d;
          }
        }
        const k = kS[s], a0 = Sxx[s] - k * Sx[s] * Sx[s], b0 = Sxy[s] - k * Sx[s] * Sy[s];
        for (let c = 0; c < NC; c++) {
          const sx = Sx[s] + dx[c];
          dA[c] += w[s] * (Sxx[s] + dxx[c] - k * sx * sx - a0);
          dB[c] += w[s] * (Sxy[s] + dxy[c] - k * sx * Sy[s] - b0);
        }
      }
      for (let c = 0; c < NC; c++) {
        const A = (A0 + dA[c]) / s2, B = (B0 + dB[c]) / s2, P = p0 + A, h = mu0 * p0 + B;
        ell[m * NC + c] = -0.5 * Math.log(P / p0) + 0.5 * h * h / P;
        bm[m * NC + c] = h / P; bs[m * NC + c] = Math.sqrt(1 / P);
      }
    }
    return { ell, bm, bs, x };
  };
  /** β's posterior at the person level from x (session weights w, scale s2), and the a, b, c sums (already ÷ s2). */
  const betaAt = (x: Float64Array, w: Float64Array, s2: number) => {
    const { Sx, Sxx, Sxy } = sessSums(x);
    let a = 0, b = 0, cc = 0;
    for (let s = 0; s < NSR; s++) {
      a += w[s] * (Sxx[s] - kS[s] * Sx[s] * Sx[s]); b += w[s] * (Sxy[s] - kS[s] * Sx[s] * Sy[s]); cc += w[s] * (Syy[s] - kS[s] * Sy[s] * Sy[s]);
    }
    a /= s2; b /= s2; cc /= s2;
    const P = p0 + a;
    return { mean: (mu0 * p0 + b) / P, sd: Math.sqrt(1 / P), a, b, cc, Sx, Sxx, Sxy };
  };
  /** (a) Birge: χ² of the readings at β's mean over n − 1, never below 1. */
  const birgeOf = (mean: number, Sx: Float64Array, Sxx: Float64Array, Sxy: Float64Array) => {
    if (nR < 2) return 1;
    let chi = 0;
    for (let s = 0; s < NSR; s++) {
      const ry = Sy[s] - mean * Sx[s];
      chi += Syy[s] - 2 * mean * Sxy[s] + mean * mean * Sxx[s] - kS[s] * ry * ry;
    }
    return Math.max(1, chi / (nR - 1));
  };

  const ones = new Float64Array(NSR).fill(1);
  interface PhiFit {
    phi: number; evidence: number; s2: number; ll: Float64Array; q: Float64Array; bm: Float64Array; bs: Float64Array;
    person: Float64Array; beta: { mean: number; sd: number }; decay: () => { dep: Float64Array[]; tauOf: Float64Array[] }; hw: Float64Array; G: Float64Array;
  }
  const fits: PhiFit[] = [];
  let flatScore = 0;
  // The no-recovery baseline (β = 0): its own Birge ratio.
  {
    let chi = 0;
    for (let s = 0; s < NSR; s++) chi += Syy[s] - kS[s] * Sy[s] * Sy[s];
    const s2 = nR ? Math.max(1, chi / nR) : 1;
    for (let s = 0; s < NSR; s++) flatScore += -0.5 * (nS[s] * (Math.log(s2) + LN2PI) + ldS[s] + (Syy[s] - kS[s] * Sy[s] * Sy[s]) / s2);
  }
  const zero = xPass(1, false);
  let reuse: PhiFit | null = null;
  // The prior's median first, to convergence (ROUNDS); every other φ starts from its cells and scale and takes one round (numerics:
  // on synthetic logs a second or third round leaves φ's posterior where it was), and only the φ values with posterior weight get
  // their faded cells (below). Kept in PHI_GRID order.
  const order = PHI_GRID.map((_, k) => k).sort((a, b) => Math.abs(Math.log(PHI_GRID[a] / PHI_PRIOR.median)) - Math.abs(Math.log(PHI_GRID[b] / PHI_PRIOR.median)) || a - b);
  const byK: PhiFit[] = [];
  /** A φ that reuses another's fit (no failure in the log): the one it reuses. */
  const byPrev = new Map<PhiFit, PhiFit>();
  let start: { q: Float64Array; s2: number } | null = null;
  for (const k of order) {
    const phi = PHI_GRID[k];
    const fx = xPass(phi, true);
    // With no failure in the log, every φ reads the same: fit once.
    if (!fx.any && reuse) { byK[k] = { ...reuse, phi }; byPrev.set(byK[k], reuse); continue; }
    const add = (a: Float64Array, b: Float64Array) => { const o = new Float64Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] + b[i]; return o; };
    const G = fx.any ? add(zero.G, fx.G) : zero.G;
    // Each deposit and its τ per cell, for the answers (only φ with posterior weight need them).
    let dt: { dep: Float64Array[]; tauOf: Float64Array[] } | null = null;
    const decay = () => (dt ??= fx.any ? { dep: zero.dep.map((d, m) => add(d, fx.dep[m])), tauOf: zero.tauOf.map((d, m) => add(d, fx.tauOf[m])) } : zero);
    let q: Float64Array = start ? start.q : Float64Array.from({ length: NM * NC }, (_, i) => PRIOR.q[i % NC]);
    let s2: number = start ? start.s2 : 1;
    let x = new Float64Array(0);
    for (let r = 0; r < (start ? 1 : ROUNDS); r++) {
      const cf = cellFit(G, q, ones, s2);
      q = poolTree(cf.ell).q;
      x = xbarOf(G, q).x;
      const b = betaAt(x, ones, s2);
      s2 = birgeOf(b.mean, b.Sx, b.Sxx, b.Sxy);
    }
    const b = betaAt(x, ones, s2);
    // The evidence for this φ: the readings' β-integrated likelihood at this φ's regressor and scale (b, s² as plug-ins).
    const nTot = nR;
    const quad = b.cc - 2 * mu0 * b.b + mu0 * mu0 * b.a - (b.b - mu0 * b.a) ** 2 / (p0 + b.a);
    const evidence = -0.5 * nTot * Math.log(s2) - 0.5 * Math.log(1 + b.a / p0) - 0.5 * quad;
    // Prequential score per half-life: each session predicted from the ones before it, faded by 2^(−Δdays/h).
    const ll = new Float64Array(NH);
    for (let h = 0; h < NH; h++) {
      let A = 0, B = 0, last = sDay[0] ?? 0;
      for (let s = 0; s < NSR; s++) {
        const f = 2 ** (-(sDay[s] - last) / HALF_LIVES[h]);
        A *= f; B *= f; last = sDay[s];
        const P = p0 + A, m = (mu0 * p0 + B) / P, v = 1 / P;
        const as = (b.Sxx[s] - kS[s] * b.Sx[s] * b.Sx[s]) / s2, bs = (b.Sxy[s] - kS[s] * b.Sx[s] * Sy[s]) / s2, cs = (Syy[s] - kS[s] * Sy[s] * Sy[s]) / s2;
        const qd = cs - 2 * m * bs + m * m * as - v * (bs - m * as) ** 2 / (1 + v * as);
        ll[h] += -0.5 * (nS[s] * (Math.log(s2) + LN2PI) + ldS[s] + Math.log(1 + v * as) + qd);
        A += as; B += bs;
      }
    }
    // The fade at the posterior-weighted 2^(−age/h), then the cells once more with it.
    let mx = -Infinity;
    for (const x2 of ll) mx = Math.max(mx, x2);
    const hw = new Float64Array(NH);
    let ht = 0;
    for (let h = 0; h < NH; h++) { hw[h] = Math.exp(ll[h] - mx); ht += hw[h]; }
    for (let h = 0; h < NH; h++) hw[h] /= ht;
    const fit: PhiFit = { phi, evidence, s2, ll, q, bm: new Float64Array(0), bs: new Float64Array(0), person: new Float64Array(0), beta: { mean: NaN, sd: NaN }, decay, hw, G };
    byK[k] = fit;
    if (!fx.any) reuse = fit;
    if (!start) start = { q, s2 };
  }
  fits.push(...byK);

  // φ's posterior: its prior times each value's evidence.
  let emx = -Infinity;
  for (const f of fits) emx = Math.max(emx, f.evidence);
  const pw = fits.map((f, k) => PHI_W0[k] * Math.exp(f.evidence - emx));
  const pt = pw.reduce((a, b) => a + b, 0);
  for (let k = 0; k < NP; k++) pw[k] /= pt;
  const phiM = momentsOf(PHI_GRID.map(Math.log), pw, RES_PHI);
  const phiData = dataShare(phiM.sd, PRIOR_PHI.sd);
  // The prequential score over φ (its prior) and h (uniform).
  let lmx = -Infinity;
  const lsk = fits.map((f) => { let m = -Infinity; for (const x2 of f.ll) m = Math.max(m, x2); let s = 0; for (const x2 of f.ll) s += Math.exp(x2 - m); return m + Math.log(s / NH); });
  for (const x2 of lsk) lmx = Math.max(lmx, x2);
  const logScore = NSR ? lmx + Math.log(lsk.reduce((a, x2, k) => a + PHI_W0[k] * Math.exp(x2 - lmx), 0)) : 0;
  const halfLife = HALF_LIVES.map((h, i) => [h, fits.reduce((a, f, k) => a + pw[k] * f.hw[i], 0)] as [number, number]);

  // Each φ with any posterior weight (numerics: under 1e-9 changes no answer): its cells once more, with the fade at the
  // posterior-weighted 2^(−age/h).
  const live = fits.map((_, k) => k).filter((k) => pw[k] > 1e-9);
  const finals = new Map<PhiFit, PhiFit>();
  for (const k of live) {
    const f = fits[k];
    const hit = finals.get(byPrev.get(f) ?? f);
    if (hit) { fits[k] = { ...hit, phi: f.phi, evidence: f.evidence }; continue; }
    const w = new Float64Array(NSR);
    for (let s = 0; s < NSR; s++) for (let h = 0; h < NH; h++) w[s] += f.hw[h] * 2 ** (-(todayN - sDay[s]) / HALF_LIVES[h]);
    const cf = cellFit(f.G, f.q, w, f.s2);
    const pooled = poolTree(cf.ell);
    const bf = betaAt(xbarOf(f.G, pooled.q).x, w, f.s2);
    fits[k] = { ...f, q: pooled.q, bm: cf.bm, bs: cf.bs, person: pooled.person, beta: { mean: bf.mean, sd: bf.sd } };
    finals.set(byPrev.get(f) ?? f, fits[k]);
  }
  const muscles = new Map<Muscle, MuscleRecovery>();
  MUSCLES.forEach((muscle, m) => {
    const wq = new Float64Array(NC);
    let b1 = 0, b2 = 0;
    for (const k of live) for (let c = 0; c < NC; c++) {
      const w = pw[k] * fits[k].q[m * NC + c], mu = fits[k].bm[m * NC + c], sd = fits[k].bs[m * NC + c];
      wq[c] += w; b1 += w * mu; b2 += w * (mu * mu + sd * sd);
    }
    const tm = momentsOf(LAMBDA, wq, RES_TAU);
    const bsd = Math.sqrt(Math.max(0, b2 - b1 * b1));
    const ft = dataShare(tm.sd, PRIOR_TAU.sd), fb = dataShare(bsd, BETA_PRIOR.sd);
    muscles.set(muscle, {
      muscle, region: MUSCLE_REGION[muscle],
      tau: { median: Math.exp(tm.mean), logSd: tm.sd, priorLogSd: PRIOR_TAU.sd, w: [...wq] },
      beta: { mean: b1, sd: bsd }, fromData: { tau: ft, beta: fb, both: Math.min(ft, fb) }, readings: readingsOf[m], lastTrained: lastTrained[m],
    });
  });
  const personW = new Float64Array(NMU);
  let pb1 = 0, pb2 = 0;
  for (const k of live) {
    for (let i = 0; i < NMU; i++) personW[i] += pw[k] * fits[k].person[i];
    const { mean, sd } = fits[k].beta;
    pb1 += pw[k] * mean; pb2 += pw[k] * (mean * mean + sd * sd);
  }
  const pm = momentsOf(MU, personW, RES_MU);
  const birge = live.reduce((a, k) => a + pw[k] * fits[k].s2, 0);

  /** X per cell at an absolute hour, for φ fit k: every deposit that ended by then. */
  const xAt = (k: number, m: number, hour: number, out: Float64Array) => {
    out.fill(0);
    const D = deps[m], { dep, tauOf } = fits[k].decay();
    for (let q = 0; q < D.day.length && D.tEnd[q] <= hour; q++) {
      const dt = hour - D.tEnd[q];
      for (let c = 0; c < NC; c++) out[c] += dep[m][q * NC + c] * Math.exp(-dt / tauOf[m][q * NC + c]);
    }
  };
  const ixOf = (muscle: Muscle) => { const m = MUSCLE_IX.get(muscle); if (m === undefined) throw new Error(`not a muscle: ${muscle}`); return m; };
  const cells = (muscle: Muscle, hour: number): RecoveryCell[] => {
    const m = ixOf(muscle), out: RecoveryCell[] = [], x = new Float64Array(NC);
    for (const k of live) {
      xAt(k, m, hour, x);
      for (let c = 0; c < NC; c++) {
        const w = pw[k] * fits[k].q[m * NC + c];
        if (w > 0) out.push({ w, phi: PHI_GRID[k], tau: TAU_D_GRID[c], x: x[c], beta: { mean: fits[k].bm[m * NC + c], sd: fits[k].bs[m * NC + c] } });
      }
    }
    return out;
  };
  const pAtHour = (muscle: Muscle, hour: number): number => {
    let p = 0;
    for (const c of cells(muscle, hour)) p += c.w * (c.x > 0 ? normCdf((READY / c.x - c.beta.mean) / c.beta.sd) : 1);
    return p;
  };
  const hourOf = (date: string) => dayOf(date) * 24 + refMinutes(date) / 60;
  const memo = new Map<string, number>();
  const pRecovered = (muscle: Muscle, date: string) => {
    const key = `${muscle}|${date}`;
    let p = memo.get(key);
    if (p === undefined) { p = pAtHour(muscle, hourOf(date)); memo.set(key, p); }
    return p;
  };
  const fresh = new Map<Muscle, string | null>();

  return {
    today, tz, sessions: sess.length, learnedSessions: NSR, readings: nR,
    beta: { mean: pb1, sd: Math.sqrt(Math.max(0, pb2 - pb1 * pb1)), prior: { ...BETA_PRIOR } },
    person: { median: Math.exp(pm.mean), logSd: pm.sd, priorLogSd: PRIOR_PERSON.sd },
    phi: { median: Math.exp(phiM.mean), logSd: phiM.sd, priorLogSd: PRIOR_PHI.sd, w: PHI_GRID.map((p, k) => [p, pw[k]]), fromData: phiData },
    birge, halfLife, logScore, flatScore,
    fromData: { tau: dataShare(pm.sd, PRIOR_PERSON.sd), beta: dataShare(Math.sqrt(Math.max(0, pb2 - pb1 * pb1)), BETA_PRIOR.sd), phi: phiData },
    muscles, refMinutes, pAtHour, pRecovered, cells,
    deficit(muscle, date) {
      let m1 = 0, m2 = 0;
      for (const c of cells(muscle, hourOf(date))) { m1 += c.w * c.beta.mean * c.x; m2 += c.w * (c.beta.mean ** 2 + c.beta.sd ** 2) * c.x * c.x; }
      return { mean: m1, sd: Math.sqrt(Math.max(0, m2 - m1 * m1)) };
    },
    freshBy(muscle) {
      if (fresh.has(muscle)) return fresh.get(muscle)!;
      let out: string | null = null;
      for (let d = 0; d <= HORIZON; d++) { const date = addDays(today, d); if (pRecovered(muscle, date) > P_FRESH) { out = date; break; } }
      fresh.set(muscle, out);
      return out;
    },
  };
}

const FITS = new WeakMap<readonly SetEntry[], Map<string, RecoveryFit | null>>();
/**
 * The fit for `today` in zone `tz`, from the core as of the days before today (index.coreBefore): one per log array, day and
 * zone. Null when the core can't fit; never throws (a refinement, never a reason to fail a screen).
 */
export function recoveryOf(entries: readonly SetEntry[], today: string, tz: string): RecoveryFit | null {
  let by = FITS.get(entries);
  if (!by) FITS.set(entries, by = new Map());
  const key = `${today}|${tz}`;
  if (by.has(key)) return by.get(key)!;
  let fit: RecoveryFit | null = null;
  try {
    const core: Core | null = coreBefore(entries, today);
    if (core) fit = fitRecovery(entries, core, today, tz);
  } catch { fit = null; }
  if (by.size > 8) by.clear();
  by.set(key, fit);
  return fit;
}
