import { isCardio, isCardioEntry } from '../cardio';
import { isHold } from '../care';
import { liftKey } from '../ids';
import { liftFactsVersion, resolveLift } from '../lifts';
import type { Vector } from '../muscles';
import { byOrderDone, doneAt } from '../stats';
import type { SetEntry } from '../types';
import { addedLoad, bodyShare } from './bodyweight';
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
 * (c) Prior scale of how far one lift's b may sit from the person's: shapes the pooling prior only (learn/pool estimates the
 * spread from tests). Halperin 2022 found no clear effect of body region or training status; reps and distance from failure,
 * which do matter, are already in each reading's variance.
 */
const B_LIFT_SD = 0.5;
/**
 * (a) Habitual RIR on sets without one logged, as a prior worth two sets: 2 (hypertrophy sets are typically stopped 0–3 RIR;
 * Robinson 2024, Sports Med 54:2209; the app's DEFAULT_RIR_OFFSET); its spread 1.5 reps worth three sets (Refalo 2024: trained
 * lifters' RIR error ±1.0; Steele 2017 SEM 2.6–3.4 before a set). (b) Both learned from his logged RIR.
 */
const HABIT = { mean: 2, k: 2, sd: 1.5, kSd: 3 } as const;
/** (a) Day-to-day readiness, 3 % of e1RM: most of the 4.2 % test–retest CV of a 1RM (Grgic 2020, Sports Med Open 6:31). */
export const READY = 0.03;
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
const K_RIR = 0, K_TEST = 1, K_MISSED = 2, K_HABIT = 3, K_BOUND = 4;

/** The fatigue features of every working set that measures capacity, one row per set (eS, eC: NT per set). */
interface Flat { nS: Float64Array; nC: Float64Array; nY: Float64Array; w: Float64Array; eS: Float64Array; eC: Float64Array }

// ---- Sessions and fatigue features -------------------------------------------------------------------------------------

// isCardio normalises the name: once per name, not once per set per refit.
const CARDIO = new Map<string, boolean>();
const cardioName = (name: string) => { let c = CARDIO.get(name); if (c === undefined) { c = isCardio(name); CARDIO.set(name, c); } return c; };
const isHard = (e: SetEntry) => !e.flags.includes('warmup') && !e.flags.includes('partial') && e.reps != null && e.reps > 0 && !isCardioEntry(e) && !cardioName(e.exercise);
const isHoldSet = (e: SetEntry) => e.flags.includes('hold') || isHold(e.exercise);
/** (a) Reps past this aren't read: rep–load equations lose accuracy as reps rise (Reynolds, Gordon & Robergs 2006; 04 §3). */
export const MAX_REPS = 30;
/**
 * The load a set's reps measure capacity at; null for a set that measures none (not hard, a hold, past MAX_REPS, or a load that
 * isn't known). A lift whose load is the body (item 14: learn/bodyweight) is read in units of the person's body mass: a set with
 * nothing added or taken off is at the lift's share of it (a); one with weight added or help taken needs his body weight to
 * place, which he doesn't log, so it measures nothing (c: it only holds back), though it still tires the sets after it. Any
 * other lift: its weight, when positive.
 */
function loadOf(e: SetEntry): number | null {
  if (!isHard(e) || isHoldSet(e) || (e.reps as number) > MAX_REPS) return null;
  const f = bodyShare(e.exercise);
  if (f != null) return addedLoad(e) === 0 ? f : null;
  return e.weight > 0 && !e.flags.includes('bodyweight') ? e.weight : null;
}

/**
 * One session's working sets that measure capacity, as a block of typed arrays ready to copy into the fit's: ordered by lift
 * (first done first), then by the order done, so each lift's sets that day are one contiguous group. Everything here depends
 * only on the day's sets, the lift facts and (untimed days) the typical gap; what depends on the whole log is worked out per fit.
 */
interface Block {
  date: string; day: number; timed: boolean;
  /** Sets (rows). */
  m: number;
  e: SetEntry[];
  /** Per lift that day: its key, the first set's name, and its rows [at[j], at[j + 1]). */
  keys: string[]; names: string[]; at: Int32Array;
  nS: Float64Array; nC: Float64Array; nY: Float64Array; w: Float64Array; logW: Float64Array; eS: Float64Array; eC: Float64Array;
  /** Reps; logged RIR (K_RIR/K_TEST) or the bound's offset above reps (K_BOUND); how the reps to failure are read. */
  r: Float64Array; k: Float64Array; kind: Uint8Array;
  /** 1 where the set is a bound only because it stopped at its target (read as K_HABIT with `censor: false`); 1 for "unsure" RIR. */
  atTarget: Uint8Array; unsure: Uint8Array;
  /** 1 for a set read by the habit that is lighter than the lift's top weight that day and done before it: a ramp set (a bound). */
  light: Uint8Array;
  /**
   * For the rest fit (item 17: learn/rest): 1 where the day is timed; 1 where the set or the lift's set before it was entered
   * late (its time is a guess); the seconds since the lift's set before it that day (NaN: none, or untimed).
   */
  clock: Uint8Array; late: Uint8Array; gapPrev: Float64Array;
}

// Blocks are cached by the day's sets themselves: the store never changes a set in place (state/useSets), so the same objects
// in the same order are the same session. A changed set, a new set, new lift facts or a new typical gap rebuild it.
interface Cached { hard: readonly SetEntry[]; fv: number; gap: number; s: Block }
const SESSIONS = new WeakMap<SetEntry, Cached>();

/** The same set objects in the same order. */
function sameSets(a: readonly SetEntry[], b: readonly SetEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
/** The same set objects in the same order as a cached session's (so already in the order done). */
function sameDay(xs: readonly SetEntry[]): boolean {
  const hit = SESSIONS.get(xs[0]);
  return !!hit && sameSets(hit.hard, xs);
}
function blockOf(date: string, hard: SetEntry[], gap: number): Block {
  const first = hard[0];
  const hit = SESSIONS.get(first);
  const fv = liftFactsVersion();
  if (hit && hit.fv === fv && sameSets(hit.hard, hard)) {
    if (hit.s.timed || hit.gap === gap) return hit.s;
  }
  const n = hard.length;
  const times = hard.map(doneAt);
  const timed = times.every((t) => Number.isFinite(t));
  const t = timed ? times.map((x) => (x - times[0]) / 1000) : hard.map((_, i) => i * gap);
  // Each distinct lift that day once (by key), each distinct muscle vector once, and (lazily) each pair's overlap.
  const lix = new Map<string, number>(), vix = new Map<Vector | null, number>();
  const vecs: (Vector | null)[] = [];
  const lid = new Int32Array(n), vid = new Int32Array(n);
  for (let a = 0; a < n; a++) {
    const key = liftKey(hard[a].exercise);
    let j = lix.get(key);
    if (j === undefined) { j = lix.size; lix.set(key, j); }
    lid[a] = j;
    const v = resolveLift(hard[a].exercise).m;
    let q = vix.get(v);
    if (q === undefined) { q = vecs.length; vix.set(v, q); vecs.push(v); }
    vid[a] = q;
  }
  const nl = lix.size, nv = vecs.length;
  // The lift's hard set before each one that day (−1: none), for the rest fit's gaps.
  const prevSame = new Int32Array(n).fill(-1), lastOf = new Int32Array(nl).fill(-1);
  for (let a = 0; a < n; a++) { prevSame[a] = lastOf[lid[a]]; lastOf[lid[a]] = a; }
  const ov = new Float64Array(nv * nv).fill(NaN);
  // Rows: the measuring sets, grouped by lift in order of first appearance, each group in the order done. A bodyweight lift's
  // heaviest added load that day, over all its hard sets (those that measure nothing too): a set at bodyweight below it is a ramp.
  const keys: string[] = [], names: string[] = [], rows: number[][] = [];
  const slot = new Int32Array(nl).fill(-1);
  const load = new Float64Array(n), topAdded = new Float64Array(nl).fill(-Infinity);
  for (let a = 0; a < n; a++) if (bodyShare(hard[a].exercise) != null) topAdded[lid[a]] = Math.max(topAdded[lid[a]], addedLoad(hard[a]));
  for (let a = 0; a < n; a++) {
    const L = loadOf(hard[a]);
    if (L == null) continue;
    load[a] = L;
    let j = slot[lid[a]];
    if (j < 0) { j = slot[lid[a]] = keys.length; keys.push(liftKey(hard[a].exercise)); names.push(hard[a].exercise); rows.push([]); }
    rows[j].push(a);
  }
  let m = 0;
  for (const xs of rows) m += xs.length;
  const s: Block = {
    date, day: dayNo(date), timed, m, e: new Array<SetEntry>(m), keys, names, at: new Int32Array(keys.length + 1),
    nS: new Float64Array(m), nC: new Float64Array(m), nY: new Float64Array(m), w: new Float64Array(m), logW: new Float64Array(m),
    eS: new Float64Array(m * NT), eC: new Float64Array(m * NT),
    r: new Float64Array(m), k: new Float64Array(m), kind: new Uint8Array(m), atTarget: new Uint8Array(m), unsure: new Uint8Array(m),
    light: new Uint8Array(m), clock: new Uint8Array(m).fill(timed ? 1 : 0), late: new Uint8Array(m), gapPrev: new Float64Array(m).fill(NaN),
  };
  let i = 0;
  for (let j = 0; j < rows.length; j++) {
    s.at[j] = i;
    let top = 0;
    for (const a of rows[j]) top = Math.max(top, load[a]);
    for (const a of rows[j]) {
      let nS = 0, nC = 0, nY = 0;
      const i0 = i * NT;
      for (let b = 0; b < a; b++) {
        const dt = Math.max(1, t[a] - t[b]);
        if (lid[b] === lid[a]) {
          nS += 1;
          for (let k = 0; k < NT; k++) s.eS[i0 + k] += Math.exp(-dt / TAUS[k]);
        } else {
          nY += 1;
          const x = vid[b] * nv + vid[a];
          let o = ov[x];
          if (o !== o) o = ov[x] = overlap(vecs[vid[b]], vecs[vid[a]]);
          if (o > 0) { nC += o; for (let k = 0; k < NT; k++) s.eC[i0 + k] += o * Math.exp(-dt / TAUS[k]); }
        }
      }
      const e = hard[a], r = e.reps as number;
      s.e[i] = e; s.nS[i] = nS; s.nC[i] = nC; s.nY[i] = nY; s.w[i] = load[a]; s.logW[i] = Math.log(load[a]); s.r[i] = r;
      // How its reps to failure are read.
      const target = e.target && e.target.weight != null && e.target.weight === e.weight ? e.target.reps : null;
      let kind = K_HABIT, k = 0;
      if (e.flags.includes('pain')) { kind = K_BOUND; k = 0; } // pain limited the set, not strength (04 §7)
      else if (e.flags.includes('light') && e.rir == null) { kind = K_BOUND; k = 0; } // a light week's set, stopped short on purpose (item 06)
      else if (e.rir != null && e.rir >= 4) { kind = K_BOUND; k = 3; } // "4+": at least 4, with a rep of slack (04 §3)
      else if (e.rir != null) { kind = e.flags.includes('test') ? K_TEST : K_RIR; k = e.rir; }
      else if (target != null && r === target) { kind = K_BOUND; k = 0; s.atTarget[i] = 1; } // stopped at the target: could have done more (00-core §1.2)
      else if (target != null && r < target) kind = K_MISSED; // short of the target: near failure (00-core §1.2)
      s.kind[i] = kind; s.k[i] = k;
      // A ramp or back-off set: lighter than the day's top weight (a bodyweight set: less added than the day's most).
      if (kind === K_HABIT && (topAdded[lid[a]] > -Infinity ? addedLoad(e) < topAdded[lid[a]] : load[a] < top)) s.light[i] = 1;
      s.unsure[i] = e.flags.includes('unsure') ? 1 : 0;
      const pv = prevSame[a];
      if (e.enteredAt || (pv >= 0 && hard[pv].enteredAt)) s.late[i] = 1;
      if (timed && pv >= 0) s.gapPrev[i] = t[a] - t[pv];
      i++;
    }
  }
  s.at[rows.length] = m;
  SESSIONS.set(first, { hard: [...hard], fv, gap, s });
  return s;
}

/**
 * The fit's rows: every session's block, in date order, copied into one set of arrays (so rows run by session, then lift). The
 * arrays are kept and reused: a refit copies only the blocks after the first one that changed, so a new set today copies today's
 * block and nothing else. Lifts are numbered in order of first appearance; a group is one lift's rows in one session.
 */
interface Rows {
  N: number; G: number;
  groups: Group[];
  /** Lifts in order of first appearance: key and name (the first set's), and each one's groups in date order. */
  keys: string[]; names: string[]; liftGroups: number[][];
  fx: Flat; logW: Float64Array; r: Float64Array; k: Float64Array; kind: Uint8Array; atTarget: Uint8Array; unsure: Uint8Array; light: Uint8Array; liftOf: Int32Array;
  clock: Uint8Array; late: Uint8Array; gapPrev: Float64Array;
}
interface Joined {
  blocks: Block[];
  /** Per block joined: its first row and first group, and how many lifts had appeared before it. */
  rowAt: number[]; groupAt: number[]; liftsAt: number[];
  keys: string[]; names: string[]; groups: Group[];
  cap: number;
  nS: Float64Array; nC: Float64Array; nY: Float64Array; w: Float64Array; logW: Float64Array; eS: Float64Array; eC: Float64Array;
  r: Float64Array; k: Float64Array; kind: Uint8Array; atTarget: Uint8Array; unsure: Uint8Array; light: Uint8Array; liftOf: Int32Array;
  clock: Uint8Array; late: Uint8Array; gapPrev: Float64Array;
}
// One log at a time (the profile on screen); another log's fit replaces it.
let JOINED: Joined | null = null;
const ROW_F64 = ['nS', 'nC', 'nY', 'w', 'logW', 'r', 'k', 'gapPrev'] as const;
const ROW_U8 = ['kind', 'atTarget', 'unsure', 'light', 'clock', 'late'] as const;

function emptyJoined(cap: number): Joined {
  return {
    blocks: [], rowAt: [0], groupAt: [0], liftsAt: [0], keys: [], names: [], groups: [], cap,
    nS: new Float64Array(cap), nC: new Float64Array(cap), nY: new Float64Array(cap), w: new Float64Array(cap), logW: new Float64Array(cap),
    eS: new Float64Array(cap * NT), eC: new Float64Array(cap * NT), r: new Float64Array(cap), k: new Float64Array(cap),
    kind: new Uint8Array(cap), atTarget: new Uint8Array(cap), unsure: new Uint8Array(cap), light: new Uint8Array(cap), liftOf: new Int32Array(cap),
    clock: new Uint8Array(cap), late: new Uint8Array(cap), gapPrev: new Float64Array(cap),
  };
}

function rowsOf(blocks: readonly Block[]): Rows {
  let J = JOINED ?? emptyJoined(0);
  // The blocks already joined, in place: the longest run of the same block objects from the start.
  let p = 0;
  while (p < blocks.length && p < J.blocks.length && blocks[p] === J.blocks[p]) p++;
  const N0 = J.rowAt[p], G0 = J.groupAt[p], L0 = J.liftsAt[p];
  let N = N0;
  for (let b = p; b < blocks.length; b++) N += blocks[b].m;
  if (N > J.cap) {
    // Grow by half again, keeping the rows that stay.
    const K = emptyJoined(Math.max(N, Math.ceil(J.cap * 1.5), 64));
    for (const f of ROW_F64) K[f].set(J[f].subarray(0, N0));
    for (const f of ROW_U8) K[f].set(J[f].subarray(0, N0));
    K.liftOf.set(J.liftOf.subarray(0, N0));
    K.eS.set(J.eS.subarray(0, N0 * NT)); K.eC.set(J.eC.subarray(0, N0 * NT));
    J = { ...K, blocks: J.blocks, rowAt: J.rowAt, groupAt: J.groupAt, liftsAt: J.liftsAt, keys: J.keys, names: J.names, groups: J.groups };
  }
  J.blocks.length = p; J.rowAt.length = p + 1; J.groupAt.length = p + 1; J.liftsAt.length = p + 1;
  J.keys.length = L0; J.names.length = L0; J.groups.length = G0;
  const liftIx = new Map<string, number>();
  for (let l = 0; l < L0; l++) liftIx.set(J.keys[l], l);
  let off = N0;
  for (let b = p; b < blocks.length; b++) {
    const s = blocks[b];
    for (let j = 0; j < s.keys.length; j++) {
      let li = liftIx.get(s.keys[j]);
      if (li === undefined) { li = J.keys.length; liftIx.set(s.keys[j], li); J.keys.push(s.keys[j]); J.names.push(s.names[j]); }
      const o0 = off + s.at[j], o1 = off + s.at[j + 1];
      J.groups.push({ lift: li, day: s.day, date: s.date, o0, o1 });
      J.liftOf.fill(li, o0, o1);
    }
    for (const f of ROW_F64) J[f].set(s[f], off);
    for (const f of ROW_U8) J[f].set(s[f], off);
    J.eS.set(s.eS, off * NT); J.eC.set(s.eC, off * NT);
    off += s.m;
    J.blocks.push(s); J.rowAt.push(off); J.groupAt.push(J.groups.length); J.liftsAt.push(J.keys.length);
  }
  JOINED = J;
  const L = J.keys.length, G = J.groups.length;
  const liftGroups: number[][] = Array.from({ length: L }, () => []);
  for (let g = 0; g < G; g++) liftGroups[J.groups[g].lift].push(g);
  const view = <A extends Float64Array | Uint8Array | Int32Array>(a: A, n = N) => a.subarray(0, n) as A;
  return {
    N, G, groups: J.groups, keys: J.keys, names: J.names, liftGroups,
    fx: { nS: view(J.nS), nC: view(J.nC), nY: view(J.nY), w: view(J.w), eS: view(J.eS, N * NT), eC: view(J.eC, N * NT) },
    logW: view(J.logW), r: view(J.r), k: view(J.k), kind: view(J.kind), atTarget: view(J.atTarget), unsure: view(J.unsure), light: view(J.light), liftOf: view(J.liftOf),
    clock: view(J.clock), late: view(J.late), gapPrev: view(J.gapPrev),
  };
}

/** The person's typical time from one set to the next (s), for days logged without times: the median timed gap ≤ 10 min, else 180 s (c, the app's default pace). */
const GAPS = new WeakMap<SetEntry, { hard: readonly SetEntry[]; gaps: number[] }>();
function dayGaps(d: SetEntry[]): number[] {
  const hit = GAPS.get(d[0]);
  if (hit && sameSets(hit.hard, d)) return hit.gaps;
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
  /**
   * What its levels are in: lb, or (a lift whose load is the body, item 14) the person's body mass, from its sets at bodyweight
   * alone. A level in body mass compares with other bodyweight lifts' but not with a loaded lift's, and it isn't a weight to load.
   */
  unit: 'lb' | 'body';
  /** Reps–load slope κ (C = κ·(E/w − 1)). */
  kappa: Est;
  /** Reps lost per prior same-lift set at K = 1, this lift's (pooled), at the person's (τ, ρ). */
  aSame: Est;
  /** The same from this lift's own sets alone, before pooling (no pooling): null without a within-session contrast. */
  aSameOwn: Est | null;
  /** Fatigue-adjusted level per session, ln e1RM (smoothed: every session's data), oldest first. */
  level: { date: string; day: number; x: number; sd: number }[];
  /** Each session's own reading of the level (its sets alone, fatigue put back; readiness in v), oldest first: for trends. */
  obs: { date: string; day: number; z: number; v: number }[];
  /** This lift's RIR bias b (reps): the person's, pooled with its family and its own test sets. */
  bias: Est;
  /**
   * The SD (ln e1RM) the latest level carries from what only test sets fix: b and the habit, through the share of its reading
   * that leans on each (first-order error propagation). Not in `level[].sd`, which assumes both known.
   */
  sys: number;
  sessions: number; sets: number;
}
export interface Core {
  sets: number; obs: number; sessions: number; timed: number;
  /** Person-level fatigue: reps per prior set at K = 1; τ in s (posterior median and 5–95 %), ρ. */
  aSame: Est; aCross: Est; gamma: Est;
  tau: Est & { lo: number; hi: number }; rho: Est;
  cells: Cell[];
  /**
   * Habitual RIR on unlogged sets (b: logged RIR, then test sets), the person's RIR bias b (a: Halperin 2022, until test sets),
   * how many test sessions taught them, and the residual noise (reps).
   */
  habit: Est; bias: Est; tests: number; noise: number;
  /** The same residual noise from sets read without the habit only (logged RIR, tests, missed targets): a test's own (reps). */
  measure: number;
  /** The person's typical time from one set to the next (s), for untimed days. */
  gap: number;
  /** Level drift per √week, as learned. */
  drift: number;
  lifts: Map<string, LiftCore>;
  /** Fatigue features (00-core §1.2) of every set that measures capacity, by set id: for consumers that score sets. */
  features: Map<string, Features>;
  /** The grid cell the per-lift values were fitted at (A, τ, ρ trade off: use them together, through decay/fatigueOf). */
  fit: { tau: number; kTau: number; rho: number; theta: [number, number, number] };
  /**
   * Item 17 (learn/rest): the same fatigue posterior from sets whose times are real. The fit above spaces an untimed day's sets
   * at his typical gap, which is right for fatigue but says nothing true about how fast he recovers; here only real times speak.
   * Left out besides: a set entered late, or whose lift's set before it was (its time is a guess), and a gap from the lift's set
   * before past Tukey's fence on ln seconds (a: Tukey 1977; a break, or the app closed). `sets`: the rows it learned from, over
   * `sessions` days; `breaks`: rows the fence left out; `gaps`: the 5th and 95th percentiles of the kept rows' times since the
   * lift's set before (s, done-time to done-time; null with none), the rests it has seen; `lastDay`: the log's last session (day
   * number), for a layoff.
   */
  rest: { cells: Cell[]; sets: number; sessions: number; breaks: number; gaps: { lo: number; hi: number } | null; lastDay: number };
}
export interface Features { nS: number; nC: number; nY: number; eS: Float64Array; eC: Float64Array }

/**
 * e1RM from one set with its reps in reserve and its session fatigue put back: w·(1 + (reps + RIR + Δ)/κ). The plain Epley
 * reading (stats.e1rm) takes a tired back-off set at face value; this one reads it as the fresh strength it implies.
 * Null for a set the core does not score (warm-up, bodyweight, hold, over 30 reps), or of a lift read in body mass (no lb).
 */
export function e1rmAdjusted(core: Core, e: SetEntry): number | null {
  const f = core.features.get(e.id);
  if (!f || e.reps == null) return null;
  const key = liftKey(e.exercise);
  if (core.lifts.get(key)?.unit === 'body') return null;
  const kappa = core.lifts.get(key)?.kappa.mean ?? KAPPA_PRIOR.mean;
  // A test's RIR is taken as true (it is what calibrates b); other logged RIR carries the lift's bias; none, the habit.
  const b = e.flags.includes('test') ? 0 : core.lifts.get(key)?.bias.mean ?? core.bias.mean;
  const rir = e.rir != null && e.rir < 4 ? e.rir + b : core.habit.mean;
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

/** The day number of a date (whole days since 1970), as the level's `day`. */
export const dayOf = dayNo;

/**
 * How much the level's variance (ln e1RM) grows over `days` with no session: the learned drift per √week (b), plus the layoff
 * term past two weeks (a: Bosquet 2013). The same step the level filter takes between sessions.
 */
export function aheadVar(core: Pick<Core, 'drift'>, days: number): number {
  const d = Math.max(0, days);
  return core.drift * core.drift * d / 7 + LAYOFF * LAYOFF * Math.max(0, d / 7 - 2);
}

/**
 * The SD (ln e1RM) of one test set's own reading of the level: a set of `reps` to failure (RIR 0), read with RIR error (a: as the
 * fit reads a test), the residual noise of sets read without the habit (b: Core.measure) and the day's readiness (a: READY).
 * What one test can pin the level to.
 */
export function testSd(core: Core, liftKey: string, reps: number): number {
  const kappa = core.lifts.get(liftKey)?.kappa.mean ?? KAPPA_PRIOR.mean;
  const sd = 0.5 + 0.3 * Math.max(0, reps - 10);
  return Math.sqrt(READY * READY + (sd * sd + core.measure * core.measure) / (kappa + reps) ** 2);
}


// ---- The fit -----------------------------------------------------------------------------------------------------------

interface Group { lift: number; day: number; date: string; o0: number; o1: number }
/** Per group: days since the lift's previous session (|Δ|), and the level's extra variance for a layoff that long. */
interface Steps { dd: Float64Array; lay: Float64Array }

/**
 * Fits the capacity equation to one profile's log. Pure: the same log gives the same result.
 * `censor: false` (tests only: the negative control) reads target-stopped sets as if they had gone to the usual RIR.
 * `learnBias: false` (tests only) keeps the RIR bias and the habit at what logged RIR says, whatever test sets show (stage 1's fit).
 * `light: false` (tests only) reads ramp and back-off sets by the habit, as stage 1 did.
 */
export function fitCore(entries: readonly SetEntry[], opts: { censor?: boolean; learnBias?: boolean; light?: boolean } = {}): Core {
  const censor = opts.censor ?? true, learnBias = opts.learnBias ?? true, lightBound = opts.light ?? true;
  // Days, in date order, each in the order done.
  const byDate = new Map<string, SetEntry[]>();
  for (const e of entries) { if (!isHard(e)) continue; const d = byDate.get(e.date); if (d) d.push(e); else byDate.set(e.date, [e]); }
  const dates = [...byDate.keys()].sort();
  // Logs arrive mostly in the order done: a linear check skips the sort (and its time parsing) for those days.
  const days = dates.map((d) => { const xs = byDate.get(d)!; return sameDay(xs) || inOrder(xs, byOrderDone) ? xs : xs.sort(byOrderDone); });
  const gap = typicalGap(days);
  const sessions = days.map((d, i) => blockOf(dates[i], d, gap));

  // Lifts and groups (lift × session), rows by session then lift (rowsOf: only blocks after a change are copied).
  const { N, G, groups, names: liftNames, liftGroups, fx, logW, r: rr, k: kk, kind, atTarget, unsure, light, liftOf, clock, late, gapPrev } = rowsOf(sessions);
  const L = liftNames.length;
  // Without censoring (the negative control), a set stopped at its target reads as if it went to the usual RIR.
  // A set lighter than the lift's top that day (a ramp or back-off set) without RIR or a target was stopped by choice: its
  // distance from failure is unknown, so it is a lower bound (a: censoring, 00-core §1.2), not a habit reading. The habit
  // (Robinson 2024: working sets stopped 0–3 RIR) describes the top sets. Read as habit, his ramps and back-offs of 12s at
  // other loads said reps don't depend on load and later sets are stronger (on his log: κ at its floor on every lift, A_same
  // −2.6, residual noise 4.5 reps; as bounds: κ 18–37, A_same 1.5, noise 0.1). Logged RIR on a back-off still reads it.
  const kindOf = (i: number) => (!censor && atTarget[i] ? K_HABIT : lightBound && light[i] ? K_BOUND : kind[i]);

  // The RIR bias b per lift (a: Halperin's prior until test sets say otherwise) and the habit offset e_h (0 until tests).
  const bL = new Float64Array(L).fill(B_PRIOR.mean);
  let eh = 0;
  // Per observation: the reading of reps to failure (y), its variance (v), and for bounds the floor; and how the reading moves
  // with b (sB) and with the habit (sH), for what tests can teach.
  const y = new Float64Array(N), v = new Float64Array(N), lo = new Float64Array(N);
  const isBound = new Uint8Array(N), sB = new Float64Array(N), sH = new Float64Array(N);
  let habit = 0, habitVar = 0, hn = 0;
  const read = () => {
    // Habitual RIR (b): mean and SD of logged training RIR plus the bias, shrunk to the prior (HABIT).
    let hs = 0, hss = 0;
    hn = 0;
    for (let i = 0; i < N; i++) if (kindOf(i) === K_RIR) { const x = kk[i] + bL[liftOf[i]]; hs += x; hss += x * x; hn++; }
    habit = (HABIT.k * HABIT.mean + hs) / (HABIT.k + hn);
    habitVar = (HABIT.kSd * HABIT.sd ** 2 + Math.max(0, hss - hn * (hn ? (hs / hn) ** 2 : 0))) / (HABIT.kSd + Math.max(0, hn - 1));
    const h = habit + eh, hb = hn / (HABIT.k + hn);
    for (let i = 0; i < N; i++) {
      const r = rr[i], k = kk[i], kd = kindOf(i);
      switch (kd) {
        case K_RIR: case K_TEST: {
          // (a) RIR error grows with distance from failure and with reps past ~10 (Refalo 2024; Zourdos 2021; Halperin 2022): 04 §3.
          const R = r + k;
          const sd = 0.5 + 0.3 * k + 0.3 * Math.max(0, R - 10);
          y[i] = R + (kd === K_RIR ? bL[liftOf[i]] : 0); v[i] = sd * sd * (unsure[i] ? 1.5 : 1);
          sB[i] = kd === K_RIR ? 1 : 0;
          break;
        }
        case K_MISSED: y[i] = r + 0.5; v[i] = 0.6 ** 2; break; // (a/c) at or near failure: RIR 0–1
        case K_HABIT: y[i] = r + h; v[i] = habitVar; sB[i] = hb; sH[i] = 1; break;
        case K_BOUND: isBound[i] = 1; lo[i] = r + k; y[i] = r + k + h; v[i] = habitVar; break;
      }
    }
  };
  read();
  // Test sets that can teach b and the habit (only they read reps to failure without either). While b is being learned they stay
  // out of the fatigue and noise fits: their readings sit b apart from the sets around them, and a test is usually a session's
  // first set, so a wrong b would be read as fatigue (and a test row has nothing to say about fatigue that b doesn't confound).
  let tests = 0;
  const isTestRow = new Uint8Array(N);
  if (learnBias) for (let i = 0; i < N; i++) if (kindOf(i) === K_TEST) { tests++; isTestRow[i] = 1; }
  let cal: Calib = noCalib(L, habitVar, hn);
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
  const wk: Work = { y, v, lo, isBound, delta, pred, W, yy, siteV };
  // Per group, each level pass: the session's implied ln E, its variance and reps scale, and whether it has any; and how its
  // ln E moves with b and with the habit (sens: in, per session; LOO prediction's; smoothed).
  const zG = new Float64Array(G), vG = new Float64Array(G), uG = new Float64Array(G), okG = new Uint8Array(G);
  const sens: Sens = { b: new Float64Array(G), h: new Float64Array(G), pb: new Float64Array(G), ph: new Float64Array(G), sb: new Float64Array(G), sh: new Float64Array(G) };

  // The Kalman steps between a lift's sessions (levels), once per fit.
  const steps: Steps = { dd: new Float64Array(G), lay: new Float64Array(G) };
  for (const gs of liftGroups) {
    for (let x = 0; x < gs.length; x++) {
      const d = Math.abs(groups[gs[x]].day - (x ? groups[gs[x - 1]].day : 0));
      steps.dd[gs[x]] = d; steps.lay[gs[x]] = LAYOFF * LAYOFF * Math.max(0, d / 7 - 2);
    }
  }

  for (let it = 0; it < ITERATIONS; it++) {
    const rho = RHOS[mapR];
    deltaPass(fx, liftOf, aLift, mapT, rho, theta, delta);
    // (1) Levels. Each set's fatigue-adjusted capacity → an implied ln E; a session's are averaged by precision.
    levelPass(groups, wk, kappa, logW, noise2, zG, vG, uG, okG, sB, sH, sens);
    drift = levels(liftGroups, steps, zG, vG, uG, okG, predX, predV, predU, hasPred, smX, smV, sens);
    predictPass(groups, fx.w, wk, kappa, predX, predV, hasPred, noise2);
    if (tests) for (let i = 0; i < N; i++) if (isTestRow[i]) W[i] = 0;
    // A ramp or back-off set read as a bound informs its session's level only: not the fatigue fit, κ or A_same, whose contrasts
    // it would enter one-sided (its site is built at the current values), while it was lighter by choice and its reps say little.
    if (lightBound) for (let i = 0; i < N; i++) if (light[i]) W[i] = 0;
    // (1b) What test sets say about b and the habit (only when there are any): read again with them next round.
    if (tests) cal = biasPass(groups, liftNames, wk, kind, fx.w, kappa, predX, predV, hasPred, noise2, sens, bL, eh, habitVar, hn);

    // (2) Fatigue: GLS over the (τ, ρ) grid, a random intercept per session (its level error) and an intercept per lift.
    // Rounds before the last search only τ next to the current best (the fit moves little between rounds; 2–4 rounds agree
    // to the third decimal on synthetic data); the last round searches the whole grid.
    const last = it === ITERATIONS - 1;
    cells = fatigueGrid(fx, groups, kappa, predX, predV, hasPred, pred, yy, W, L, last ? 0 : Math.max(0, mapT - 1), last ? NT - 1 : Math.min(NT - 1, mapT + 1));
    let best = 0;
    for (let c = 1; c < cells.length; c++) if (cells[c].w > cells[best].w) best = c;
    mapT = TAUS.indexOf(cells[best].tau as (typeof TAUS)[number]); mapR = RHOS.indexOf(cells[best].rho as (typeof RHOS)[number]);
    theta = [0, 1, 2].map((j) => cells.reduce((a, c) => a + c.w * c.theta[j], 0)) as [number, number, number];

    noise2 = noisePass(groups, wk, tests ? isTestRow : null);

    // Reps–load slope κ per lift (b), pooled toward the person and similar lifts.
    const kappaSd = updateKappa(fx, mapT, RHOS[mapR], groups, liftNames, kappa, fx.w, predX, predU, hasPred, pred, yy, W, delta, L);
    // Per-lift A_same (b), pooled; used for the next round's fatigue.
    const a = liftASame(fx, groups, liftNames, cells, mapT, mapR, theta, pred, yy, W, L, kappa, predX, hasPred);
    for (let l = 0; l < L; l++) aLift[l] = a.post[l].mean;
    if (tests && it < ITERATIONS - 1) { bL.set(cal.bL); eh = cal.eh.mean; read(); }
    if (it === ITERATIONS - 1) {
      // The set-to-set noise of sets whose reps to failure are read without the habit (RIR, tests, missed targets): what a test
      // set carries. The habit-read sets' spread also holds how far from failure each was stopped, which a test doesn't have.
      const habitRow = new Uint8Array(N);
      for (let i = 0; i < N; i++) if (kindOf(i) === K_HABIT) habitRow[i] = 1;
      const measure2 = noisePass(groups, wk, habitRow);
      const rest = restGrid(fx, groups, kappa, predX, predV, hasPred, pred, yy, W, L, clock, late, gapPrev);
      const lifts = new Map<string, LiftCore>();
      for (let l = 0; l < L; l++) {
        const gs = liftGroups[l];
        lifts.set(liftKey(liftNames[l]), {
          key: liftKey(liftNames[l]), name: liftNames[l], unit: bodyShare(liftNames[l]) != null ? 'body' : 'lb',
          kappa: { mean: kappa[l], sd: kappaSd[l] },
          aSame: { mean: a.post[l].mean, sd: a.post[l].sd }, aSameOwn: a.own[l],
          level: gs.filter((g) => smV[g] < 1).map((g) => ({ date: groups[g].date, day: groups[g].day, x: smX[g], sd: Math.sqrt(smV[g]) })),
          obs: gs.filter((g) => okG[g]).map((g) => ({ date: groups[g].date, day: groups[g].day, z: zG[g], v: vG[g] })),
          bias: { mean: cal.bL[l], sd: cal.bLsd[l] },
          sys: systematic(liftGroups[l], smV, sens, cal, l),
          sessions: gs.length, sets: gs.reduce((n, g) => n + groups[g].o1 - groups[g].o0, 0),
        });
      }
      return summarize(cells, theta, lifts, { kT: mapT, rho: RHOS[mapR], N, sets: entries.length, sessions: sessions.length, timed: sessions.filter((s) => s.timed).length, habit, cal, noise2, measure2, gap, drift, blocks: sessions, rest: { ...rest, lastDay: sessions.at(-1)?.day ?? 0 } });
    }
  }
  throw new Error('unreachable');
}


/** The fit's per-set working arrays: the reading of reps to failure (y, v; a bound's floor), and each round's fatigue, prediction,
 * weight and reading (a bound's from its expectation-propagation site). */
interface Work {
  y: Float64Array; v: Float64Array; lo: Float64Array; isBound: Uint8Array;
  delta: Float64Array; pred: Float64Array; W: Float64Array; yy: Float64Array; siteV: Float64Array;
}

/** Each set's fatigue Δ at the current (τ, ρ, θ) and per-lift A_same (fatigueOf, on the rows). */
function deltaPass(fx: Flat, liftOf: Int32Array, aLift: Float64Array, kT: number, rho: number, theta: readonly number[], delta: Float64Array): void {
  const r1 = 1 - rho, t1 = theta[1], t2 = theta[2], { nS, nC, nY, eS, eC } = fx;
  for (let i = 0, ik = kT; i < delta.length; i++, ik += NT) {
    delta[i] = aLift[liftOf[i]] * (rho * nS[i] + r1 * eS[ik]) + t1 * (rho * nC[i] + r1 * eC[ik]) + t2 * nY[i];
  }
}

/** Per group: the precision-weighted mean of its sets' implied ln E (fatigue put back), with its variance and reps scale; and its
 * sensitivity to b and to the habit (sB, sH per set: how its reading moves with each), for test sets to learn them by. */
function levelPass(groups: Group[], wk: Work, kappa: Float64Array, logW: Float64Array, noise2: number,
  zG: Float64Array, vG: Float64Array, uG: Float64Array, okG: Uint8Array, sB: Float64Array, sH: Float64Array, sens: Sens): void {
  const { y, v, isBound, delta, yy, siteV } = wk;
  okG.fill(0);
  for (let g = 0; g < groups.length; g++) {
    const { o0, o1, lift } = groups[g];
    let sw = 0, sz = 0, su = 0, sb = 0, sh = 0;
    for (let i = o0; i < o1; i++) {
      // A bound reads as its site from the last round (none in the first: it says nothing until there's a prediction).
      if (isBound[i] && !(siteV[i] < 1e6)) continue;
      const c = Math.max(0.5, (isBound[i] ? yy[i] : y[i]) + delta[i]);
      const ve = (isBound[i] ? siteV[i] : v[i]) + noise2;
      const lv = ve / (kappa[lift] + c) ** 2;
      const z = logW[i] + Math.log1p(c / kappa[lift]);
      sw += 1 / lv; sz += z / lv; su += (c / (kappa[lift] + c)) / lv;
      if (!isBound[i]) { const d = 1 / ((kappa[lift] + c) * lv); sb += sB[i] * d; sh += sH[i] * d; }
    }
    if (sw > 0) { okG[g] = 1; zG[g] = sz / sw; uG[g] = su / sw; vG[g] = 1 / sw + READY * READY; sens.b[g] = sb / sw; sens.h[g] = sh / sw; }
  }
}

/**
 * Predicted fresh capacity per set (never having seen its own session), and the shortfall z = predicted − observed, with its
 * weight. Bounds: an expectation-propagation site from the truncated predictive (Tobit): uninformative when the prediction
 * sits well above the floor, a firm reading when it doesn't.
 */
function predictPass(groups: Group[], ws: Float64Array, wk: Work, kappa: Float64Array, predX: Float64Array, predV: Float64Array,
  hasPred: Uint8Array, noise2: number): void {
  const { y, v, lo, isBound, delta, pred, W, yy, siteV } = wk;
  for (let g = 0; g < groups.length; g++) {
    const { o0, o1, lift } = groups[g];
    if (!hasPred[g]) {
      for (let i = o0; i < o1; i++) { pred[i] = NaN; W[i] = 0; yy[i] = y[i]; siteV[i] = Infinity; }
      continue;
    }
    const E = Math.exp(predX[g]), kl = kappa[lift], pv = predV[g] + READY * READY;
    for (let i = o0; i < o1; i++) {
      const w = ws[i];
      pred[i] = kl * (E / w - 1);
      if (!isBound[i]) { yy[i] = y[i]; W[i] = 1 / (v[i] + noise2); continue; }
      const scale = kl * E / w;
      const cavV = scale * scale * pv + noise2;
      const mu = pred[i] - delta[i];
      const t = truncBelow(mu, Math.sqrt(cavV), lo[i]);
      const prec = 1 / t.v - 1 / cavV;
      if (!(prec > 1e-4 / cavV)) { yy[i] = mu; W[i] = 0; siteV[i] = Infinity; continue; }
      siteV[i] = 1 / prec;
      yy[i] = siteV[i] * (t.mean / t.v - mu / cavV);
      W[i] = 1 / (siteV[i] + noise2);
    }
  }
}

/** Per group: how its ln E moves per rep of b and of the habit offset: the session's own (b, h), its leave-one-session-out
 * prediction's (pb, ph) and the smoothed level's (sb, sh). */
interface Sens { b: Float64Array; h: Float64Array; pb: Float64Array; ph: Float64Array; sb: Float64Array; sh: Float64Array }
/** What test sets taught: the person's b, the habit offset e_h, their covariance; each lift's b; how many test sessions. */
interface Calib { b: Est; eh: Est; cov: number; bL: Float64Array; bLsd: Float64Array; n: number }

/** Before any test: the priors (b: Halperin's; e_h: 0 with the habit mean's own sampling SD), every lift's b its pooled prior. */
function noCalib(L: number, habitVar: number, hn: number): Calib {
  const sdL = Math.sqrt(B_PRIOR.sd ** 2 + B_LIFT_SD ** 2); // learn/pool with no data: person + family + lift prior
  return { b: { mean: B_PRIOR.mean, sd: B_PRIOR.sd }, eh: { mean: 0, sd: Math.sqrt(habitVar / (HABIT.k + hn)) }, cov: 0,
    bL: new Float64Array(L).fill(B_PRIOR.mean), bLsd: new Float64Array(L).fill(sdL), n: 0 };
}

/**
 * The RIR bias b and the habit offset e_h from test sets (00-core §1.2: nothing else identifies them). A test reads reps to failure
 * directly; its session's level is predicted from the other sessions (leave one out), which were read through b (sets with RIR)
 * and the habit (sets without), so the test's residual r = (reps + RIR + Δ) − predicted ≈ S_b·(b − b̂) + S_h·(e_h − ê_h) + noise,
 * S being the prediction's sensitivity to each (carried through the level filter: `levels`). Tests in one session share its level
 * error, so they are averaged first. A Gaussian linear update on the priors (b: Halperin 2022; e_h: the habit mean's sampling SD)
 * gives the person's (b, e_h); then each lift's b is pooled person → family → lift (learn/pool) from its own tests' residuals.
 */
function biasPass(groups: Group[], names: string[], wk: Work, kind: Uint8Array, ws: Float64Array, kappa: Float64Array, predX: Float64Array,
  predV: Float64Array, hasPred: Uint8Array, noise2: number, sens: Sens, bL: Float64Array, eh: number, habitVar: number, hn: number): Calib {
  const { y, v, delta, pred } = wk;
  const L = names.length;
  // Per test session: its lift, mean residual (made absolute: + S·θ now), sensitivities and variance.
  const rows: { l: number; r: number; Sb: number; Sh: number; V: number }[] = [];
  for (let g = 0; g < groups.length; g++) {
    if (!hasPred[g]) continue;
    const { o0, o1, lift: l } = groups[g];
    let sw = 0, sr = 0, ss = 0;
    for (let i = o0; i < o1; i++) {
      if (kind[i] !== K_TEST || !Number.isFinite(pred[i])) continue;
      const scale = kappa[l] * Math.exp(predX[g]) / ws[i]; // reps per unit of ln E at this load
      const w = 1 / (v[i] + noise2);
      sw += w; sr += w * (y[i] + delta[i] - pred[i]); ss += w * scale;
    }
    if (!sw) continue;
    const sc = ss / sw, Sb = sc * sens.pb[g], Sh = sc * sens.ph[g];
    rows.push({ l, r: sr / sw + Sb * bL[l] + Sh * eh, Sb, Sh, V: 1 / sw + sc * sc * (predV[g] + READY * READY) });
  }
  const sh0 = Math.sqrt(habitVar / (HABIT.k + hn));
  // Person level: P = prior precision + Σ S Sᵀ/V; mean = P⁻¹(prior precision · prior mean + Σ S r/V).
  let p00 = 1 / B_PRIOR.sd ** 2, p01 = 0, p11 = 1 / (sh0 * sh0), h0 = B_PRIOR.mean / B_PRIOR.sd ** 2, h1 = 0;
  for (const x of rows) { p00 += x.Sb * x.Sb / x.V; p01 += x.Sb * x.Sh / x.V; p11 += x.Sh * x.Sh / x.V; h0 += x.Sb * x.r / x.V; h1 += x.Sh * x.r / x.V; }
  const det = p00 * p11 - p01 * p01;
  const c00 = p11 / det, c01 = -p01 / det, c11 = p00 / det;
  const bP = c00 * h0 + c01 * h1, eP = c01 * h0 + c11 * h1;
  // Lift level: each lift's tests, after the person's fit, as an estimate of its own b; pooled around the person's.
  const acc = new Map<number, { a: number; b: number }>();
  for (const x of rows) {
    if (!(Math.abs(x.Sb) > 1e-9)) continue;
    const e = x.r - x.Sh * eP; // ≈ S_b·b_lift
    const t = acc.get(x.l) ?? { a: 0, b: 0 };
    t.a += x.Sb * x.Sb / x.V; t.b += x.Sb * e / x.V;
    acc.set(x.l, t);
  }
  const items = [...acc].map(([l, t]) => ({ key: liftKey(names[l]), est: t.b / t.a, v: 1 / t.a }));
  const p = pool(items, (a, b) => liftSimilarity(a, b), { mean: bP, personSd: Math.sqrt(c00), liftSd: B_LIFT_SD });
  const bl = new Float64Array(L), bs = new Float64Array(L);
  for (let l = 0; l < L; l++) { const q = p.lift(liftKey(names[l])); bl[l] = q.mean; bs[l] = q.sd; }
  return { b: { mean: bP, sd: Math.sqrt(c00) }, eh: { mean: eP, sd: Math.sqrt(c11) }, cov: c01, bL: bl, bLsd: bs, n: rows.length };
}

/**
 * The SD (ln e1RM) a lift's latest level carries from b and the habit: s_bᵀ Σ s_b by first-order error propagation, with s its
 * smoothed level's sensitivity to each (per rep) and Σ their posterior covariance (the lift's b, the person's e_h).
 */
function systematic(gs: number[], smV: Float64Array, sens: Sens, cal: Calib, l: number): number {
  let g = -1;
  for (let x = gs.length - 1; x >= 0; x--) if (smV[gs[x]] < 1) { g = gs[x]; break; }
  if (g < 0) return 0;
  const a = sens.sb[g], c = sens.sh[g];
  return Math.sqrt(Math.max(0, a * a * cal.bLsd[l] ** 2 + c * c * cal.eh.sd ** 2 + 2 * a * c * cal.cov));
}

/** Residual noise σ_e² (b): within-session spread of fatigue-adjusted readings beyond the readings' own variance, shrunk to the prior. */
function noisePass(groups: Group[], wk: Work, skip: Uint8Array | null): number {
  const { y, v, isBound, delta, pred } = wk;
  let rss = 0, dof = 0, ownV = 0;
  for (const g of groups) {
    let n = 0, m = 0, mm = 0, vv = 0;
    for (let i = g.o0; i < g.o1; i++) {
      if (isBound[i] || !Number.isFinite(pred[i]) || (skip && skip[i])) continue;
      const r = y[i] + delta[i] - pred[i]; // the session's shared level error drops out of the within-session spread
      m += r; mm += r * r; n++; vv += v[i];
    }
    if (n < 2) continue;
    rss += mm - m * m / n;
    dof += n - 1; ownV += vv * (n - 1) / n;
  }
  const excess = dof > 0 ? Math.max(0, (rss - ownV) / dof) : 0;
  return (NOISE.k * NOISE.sd ** 2 + dof * excess) / (NOISE.k + dof);
}

function summarize(cells: Cell[], theta: [number, number, number], lifts: Map<string, LiftCore>,
  m: { kT: number; rho: number; N: number; sets: number; sessions: number; timed: number; habit: number; cal: Calib; noise2: number; measure2: number; gap: number; drift: number; blocks: Block[]; rest: Core['rest'] }): Core {
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
  const blocks = m.blocks;
  return {
    sets: m.sets, obs: m.N, sessions: m.sessions, timed: m.timed,
    aSame: { mean: theta[0], sd: sd[0] }, aCross: { mean: theta[1], sd: sd[1] }, gamma: { mean: theta[2], sd: sd[2] },
    tau: { mean: Math.exp(lt), sd: ltSd, lo: q(0.05), hi: q(0.95) }, rho: { mean: rm, sd: rsd },
    cells,
    habit: { mean: m.habit + m.cal.eh.mean, sd: m.cal.eh.sd }, bias: m.cal.b, tests: m.cal.n, noise: Math.sqrt(m.noise2), measure: Math.sqrt(m.measure2),
    gap: m.gap, drift: m.drift, lifts,
    get features() {
      if (!features) {
        features = new Map();
        for (const s of blocks) for (let i = 0; i < s.m; i++) {
          features.set(s.e[i].id, { nS: s.nS[i], nC: s.nC[i], nY: s.nY[i], eS: s.eS.slice(i * NT, (i + 1) * NT), eC: s.eC.slice(i * NT, (i + 1) * NT) });
        }
      }
      return features;
    },
    fit: { tau: TAUS[m.kT], kTau: m.kT, rho: m.rho, theta: [...theta] as [number, number, number] },
    rest: m.rest,
  };
}

/**
 * Core.rest: the fatigue grid (fatigueGrid) on the rows whose times are real (see Core.rest for what's left out), from the
 * population prior (THETA_PRIOR, TAU_PRIOR). With none it is the prior itself.
 */
function restGrid(fx: Flat, groups: Group[], kappa: Float64Array, predX: Float64Array, predV: Float64Array, hasPred: Uint8Array,
  pred: Float64Array, yy: Float64Array, W: Float64Array, L: number, clock: Uint8Array, late: Uint8Array, gapPrev: Float64Array): Omit<Core['rest'], 'lastDay'> {
  const N = W.length, lg: number[] = [];
  for (let i = 0; i < N; i++) if (W[i] && clock[i] && !late[i] && gapPrev[i] > 0) lg.push(Math.log(gapPrev[i]));
  lg.sort((a, b) => a - b);
  const q = (p: number) => { const x = (lg.length - 1) * p, lo = Math.floor(x); return lg[lo] + (lg[Math.min(lo + 1, lg.length - 1)] - lg[lo]) * (x - lo); };
  // (a) Tukey's fence, Q3 + 1.5·IQR, in logs (gaps are skewed), as learn/session's.
  const fence = lg.length ? q(0.75) + 1.5 * (q(0.75) - q(0.25)) : Infinity;
  const Wt = new Float64Array(N);
  let sets = 0, breaks = 0;
  for (let i = 0; i < N; i++) {
    if (!W[i] || !clock[i] || late[i]) continue;
    if (gapPrev[i] > 0 && Math.log(gapPrev[i]) > fence) { breaks++; continue; }
    Wt[i] = W[i]; sets++;
  }
  const days = new Set<number>();
  for (const g of groups) for (let i = g.o0; i < g.o1; i++) if (Wt[i]) { days.add(g.day); break; }
  const kept = lg.filter((x) => x <= fence);
  const at = (p: number) => { const x = (kept.length - 1) * p, lo = Math.floor(x); return Math.exp(kept[lo] + (kept[Math.min(lo + 1, kept.length - 1)] - kept[lo]) * (x - lo)); };
  const gaps = kept.length ? { lo: at(0.05), hi: at(0.95) } : null;
  return { cells: fatigueGrid(fx, groups, kappa, predX, predV, hasPred, pred, yy, Wt, L), sets, sessions: days.size, breaks, gaps };
}

/**
 * Leave-one-session-out level per lift: a forward and a backward Kalman filter over its sessions (random walk in ln E), each
 * session predicted from both sides without itself. Also runs the same gains on auxiliary series (u = C/(κ + C), for the
 * reps–load slope; and each session's sensitivity to b and to the habit, so a prediction knows how it would move with them) and
 * the smoothed level with the session's own data. Picks the drift (DRIFT grid) by one-step predictive likelihood with its prior
 * (b); returns it.
 */
function levels(liftGroups: number[][], steps: Steps, z: Float64Array, vz: Float64Array, u: Float64Array, ok: Uint8Array,
  predX: Float64Array, predV: Float64Array, predU: Float64Array, hasPred: Uint8Array, smX: Float64Array, smV: Float64Array, sens: Sens): number {
  const G = z.length;
  const { dd, lay } = steps;
  const sb = sens.b, sh = sens.h;
  let fm = new Float64Array(G), fP = new Float64Array(G), fu = new Float64Array(G), fok = new Uint8Array(G);
  let tm = new Float64Array(G), tP = new Float64Array(G), tu = new Float64Array(G), tok = new Uint8Array(G);
  const bm = new Float64Array(G), bP = new Float64Array(G), bu = new Float64Array(G), bok = new Uint8Array(G);
  // The sensitivities' forward and backward predictions (only for the kept passes: the drift search doesn't need them).
  const fb = new Float64Array(G), fh = new Float64Array(G), kb = new Float64Array(G), kh = new Float64Array(G);
  // One filter over a lift's sessions, forward (dir 1) or backward (dir −1); the step into a session is the process noise over
  // the days from the session before it in that direction (perDay per day, plus the layoff term). Returns the one-step
  // predictive log likelihood when asked (the drift search), else 0. `ob`, `oh`: where to put the sensitivities' predictions.
  const run = (gs: number[], dir: 1 | -1, perDay: number, m_: Float64Array, P_: Float64Array, u_: Float64Array, ok_: Uint8Array, withLL: boolean,
    ob: Float64Array | null, oh: Float64Array | null): number => {
    let m = 0, P = Infinity, uu = 0, ub = 0, uh = 0, ll = 0;
    const n = gs.length;
    for (let x = dir === 1 ? 0 : n - 1; x >= 0 && x < n; x += dir) {
      const g = gs[x];
      if (Number.isFinite(P)) {
        const h = dir === 1 ? g : gs[x + 1]; // the step's gap: from the session before g in this direction
        const Pp = P + (perDay * dd[h] + lay[h]);
        m_[g] = m; P_[g] = Pp; u_[g] = uu; ok_[g] = 1;
        if (ob) { ob[g] = ub; oh![g] = uh; }
        if (ok[g]) {
          const S = Pp + vz[g], K = Pp / S, nu = z[g] - m;
          if (withLL) ll += -0.5 * (Math.log(S) + nu * nu / S);
          m += K * nu; uu += K * (u[g] - uu); P = (1 - K) * Pp;
          if (ob) { ub += K * (sb[g] - ub); uh += K * (sh[g] - uh); }
        } else P = Pp;
      } else {
        ok_[g] = 0;
        if (ok[g]) { m = z[g]; uu = u[g]; P = vz[g]; ub = sb[g]; uh = sh[g]; }
      }
    }
    return ll;
  };
  // Drift: one-step predictive likelihood of every lift's forward filter, plus the prior. The best drift's forward pass is kept.
  let bestD = 1, bestLL = -Infinity;
  for (let d = 0; d < DRIFT.length; d++) {
    const perDay = DRIFT[d] * DRIFT[d] / 7;
    let ll = Math.log(DRIFT_PRIOR[d]);
    for (const gs of liftGroups) ll += run(gs, 1, perDay, tm, tP, tu, tok, true, null, null);
    if (ll > bestLL) {
      bestLL = ll; bestD = d;
      [fm, tm] = [tm, fm]; [fP, tP] = [tP, fP]; [fu, tu] = [tu, fu]; [fok, tok] = [tok, fok];
    }
  }
  const perDay = DRIFT[bestD] * DRIFT[bestD] / 7;
  // The kept drift's forward pass once more, with the sensitivities (the same gains, so the same level; with no finite
  // likelihood above, this is the default drift's).
  for (const gs of liftGroups) run(gs, 1, perDay, fm, fP, fu, fok, false, fb, fh);
  for (const gs of liftGroups) run(gs, -1, perDay, bm, bP, bu, bok, false, kb, kh);
  for (let g = 0; g < G; g++) {
    let pm = 0, pv = Infinity, pu = 0, pb = 0, ph = 0;
    if (fok[g] && bok[g]) {
      pv = 1 / (1 / fP[g] + 1 / bP[g]);
      const wf = pv / fP[g], wb = pv / bP[g];
      pm = wf * fm[g] + wb * bm[g]; pu = wf * fu[g] + wb * bu[g]; pb = wf * fb[g] + wb * kb[g]; ph = wf * fh[g] + wb * kh[g];
    } else if (fok[g]) { pv = fP[g]; pm = fm[g]; pu = fu[g]; pb = fb[g]; ph = fh[g]; }
    else if (bok[g]) { pv = bP[g]; pm = bm[g]; pu = bu[g]; pb = kb[g]; ph = kh[g]; }
    hasPred[g] = Number.isFinite(pv) && pv < 1 ? 1 : 0;
    predX[g] = pm; predV[g] = pv; predU[g] = pu; sens.pb[g] = pb; sens.ph[g] = ph;
    if (ok[g]) {
      const sv = Number.isFinite(pv) ? 1 / (1 / pv + 1 / vz[g]) : vz[g];
      if (Number.isFinite(pv)) {
        const a = sv / pv, c = sv / vz[g];
        smX[g] = a * pm + c * z[g]; sens.sb[g] = a * pb + c * sb[g]; sens.sh[g] = a * ph + c * sh[g];
      } else { smX[g] = z[g]; sens.sb[g] = sb[g]; sens.sh[g] = sh[g]; }
      smV[g] = sv;
    } else { smX[g] = pm; smV[g] = pv; sens.sb[g] = pb; sens.sh[g] = ph; }
  }
  return DRIFT[bestD];
}

/**
 * The fatigue regression for every (τ, ρ) cell. Shortfall z = predicted fresh − observed = Δ + lift intercept + session error +
 * set noise. Per session the covariance is diag(1/W) + s²·11ᵀ (s²: the level prediction's variance in reps); Woodbury keeps it
 * cheap. The lift intercepts are profiled out. Features are linear in ρ given τ (x = q + ρ·h), so every sum is a polynomial in
 * ρ of degree ≤ 2 and each τ is accumulated once.
 */
function fatigueGrid(fx: Flat, groups: Group[], kappa: Float64Array, predX: Float64Array, predV: Float64Array,
  hasPred: Uint8Array, pred: Float64Array, yy: Float64Array, W: Float64Array, L: number, kLo = 0, kHi = NT - 1): Cell[] {
  const L0 = THETA_PRIOR.sd.map((s) => 1 / (s * s));
  // Per τ: coefficients of ρ⁰, ρ¹, ρ² for A (3×3) and of ρ⁰, ρ¹ for b (3).
  const A0 = new Float64Array(NT * 9), A1 = new Float64Array(NT * 9), A2 = new Float64Array(NT * 9);
  const b0 = new Float64Array(NT * 3), b1 = new Float64Array(NT * 3);
  // Per lift, per τ: the sums the lift's intercept is profiled out with (rows are by session, so every lift's are kept at once).
  const T3 = NT * 3;
  const lA = new Float64Array(L * T3), lB = new Float64Array(L * T3), S11 = new Float64Array(L), S1z = new Float64Array(L);
  const fS = fx.eS, fC = fx.eC, fY = fx.nY, nSa = fx.nS, nCa = fx.nC, fw = fx.w;
  // The shortfall per set, once (not once per τ).
  const zs = new Float64Array(W.length);
  for (let i = 0; i < W.length; i++) if (W[i]) zs[i] = pred[i] - yy[i];
  for (let g = 0; g < groups.length; g++) {
    if (!hasPred[g]) continue;
    const { o0, o1, lift: l } = groups[g];
    const lT = l * T3;
    let sW = 0, sWz = 0;
    for (let i = o0; i < o1; i++) { if (!W[i]) continue; sW += W[i]; sWz += W[i] * zs[i]; }
    if (!sW) continue;
    // The session's shared error in reps: level prediction and readiness, at the session's mean scale κE/w.
    let sc = 0;
    for (let i = o0; i < o1; i++) if (W[i]) sc += W[i] / fw[i];
    sc *= kappa[l] * Math.exp(predX[g]);
    sc /= sW;
    const s2 = sc * sc * (predV[g] + READY * READY);
    const c = s2 / (1 + s2 * sW), f = 1 - c * sW;
    S11[l] += sW * f; S1z[l] += f * sWz;
    for (let k = kLo; k <= kHi; k++) {
      const k9 = k * 9, k3 = k * 3, lk = lT + k3;
      let sq0 = 0, sq1 = 0, sq2 = 0, sh0 = 0, sh1 = 0, bq0 = 0, bq1 = 0, bq2 = 0, bh0 = 0, bh1 = 0;
      let a00 = 0, a01 = 0, a02 = 0, a11 = 0, a12 = 0, a22 = 0;
      let c00 = 0, c01 = 0, c10 = 0, c02 = 0, c11 = 0, c12 = 0, c20 = 0, c21 = 0;
      let d00 = 0, d01 = 0, d11 = 0;
      for (let i = o0; i < o1; i++) {
        const w = W[i];
        if (!w) continue;
        const z = zs[i];
        const ik = i * NT + k, q0 = fS[ik], q1 = fC[ik], q2 = fY[i], h0 = nSa[i] - q0, h1 = nCa[i] - q1;
        const wq0 = w * q0, wq1 = w * q1, wq2 = w * q2, wh0 = w * h0, wh1 = w * h1;
        sq0 += wq0; sq1 += wq1; sq2 += wq2; sh0 += wh0; sh1 += wh1;
        bq0 += wq0 * z; bq1 += wq1 * z; bq2 += wq2 * z; bh0 += wh0 * z; bh1 += wh1 * z;
        a00 += wq0 * q0; a01 += wq0 * q1; a02 += wq0 * q2; a11 += wq1 * q1; a12 += wq1 * q2; a22 += wq2 * q2;
        c00 += wq0 * h0; c01 += wq0 * h1; c10 += wq1 * h0; c11 += wq1 * h1; c02 += wh0 * q2; c12 += wh1 * q2; c20 += wq2 * h0; c21 += wq2 * h1;
        d00 += wh0 * h0; d01 += wh0 * h1; d11 += wh1 * h1;
      }
      // Add the session's sums, then (Woodbury) subtract c·(ΣWx)(ΣWx)ᵀ and c·(ΣWx)(ΣWz). Written out: x = (q, h), h2 = 0,
      // so the terms with h2 vanish; A1[a][b] = Σ w(q_a h_b + h_a q_b).
      const cq0 = c * sq0, cq1 = c * sq1, cq2 = c * sq2, ch0 = c * sh0, ch1 = c * sh1;
      b0[k3] = b0[k3] + bq0 - cq0 * sWz; b0[k3 + 1] = b0[k3 + 1] + bq1 - cq1 * sWz; b0[k3 + 2] = b0[k3 + 2] + bq2 - cq2 * sWz;
      b1[k3] = b1[k3] + bh0 - ch0 * sWz; b1[k3 + 1] = b1[k3 + 1] + bh1 - ch1 * sWz;
      A0[k9] = A0[k9] + a00 - cq0 * sq0; A0[k9 + 1] = A0[k9 + 1] + a01 - cq0 * sq1; A0[k9 + 2] = A0[k9 + 2] + a02 - cq0 * sq2;
      A0[k9 + 3] = A0[k9 + 3] + a01 - cq1 * sq0; A0[k9 + 4] = A0[k9 + 4] + a11 - cq1 * sq1; A0[k9 + 5] = A0[k9 + 5] + a12 - cq1 * sq2;
      A0[k9 + 6] = A0[k9 + 6] + a02 - cq2 * sq0; A0[k9 + 7] = A0[k9 + 7] + a12 - cq2 * sq1; A0[k9 + 8] = A0[k9 + 8] + a22 - cq2 * sq2;
      A1[k9] = A1[k9] + 2 * c00 - c * (sq0 * sh0 + sh0 * sq0); A1[k9 + 1] = A1[k9 + 1] + (c01 + c10) - c * (sq0 * sh1 + sh0 * sq1);
      A1[k9 + 2] = A1[k9 + 2] + c02 - c * (sh0 * sq2);
      A1[k9 + 3] = A1[k9 + 3] + (c10 + c01) - c * (sq1 * sh0 + sh1 * sq0); A1[k9 + 4] = A1[k9 + 4] + 2 * c11 - c * (sq1 * sh1 + sh1 * sq1);
      A1[k9 + 5] = A1[k9 + 5] + c12 - c * (sh1 * sq2);
      A1[k9 + 6] = A1[k9 + 6] + c20 - c * (sq2 * sh0); A1[k9 + 7] = A1[k9 + 7] + c21 - c * (sq2 * sh1);
      A2[k9] = A2[k9] + d00 - ch0 * sh0; A2[k9 + 1] = A2[k9 + 1] + d01 - ch0 * sh1;
      A2[k9 + 3] = A2[k9 + 3] + d01 - ch1 * sh0; A2[k9 + 4] = A2[k9 + 4] + d11 - ch1 * sh1;
      lA[lk] += f * sq0; lA[lk + 1] += f * sq1; lA[lk + 2] += f * sq2; lB[lk] += f * sh0; lB[lk + 1] += f * sh1;
    }
  }
  // Profile out each lift's intercept: subtract (S1x)(S1x)ᵀ/S11 and (S1x)·S1z/S11, S1x = lA + ρ·lB.
  for (let l = 0; l < L; l++) {
    const s11 = S11[l], s1z = S1z[l], lT = l * T3;
    if (s11 > 1e-12) {
      for (let k = kLo; k <= kHi; k++) {
        for (let a = 0; a < 3; a++) {
          const la = lA[lT + k * 3 + a], lb = lB[lT + k * 3 + a];
          b0[k * 3 + a] -= la * s1z / s11; b1[k * 3 + a] -= lb * s1z / s11;
          for (let bb = 0; bb < 3; bb++) {
            const ma = lA[lT + k * 3 + bb], mb = lB[lT + k * 3 + bb];
            A0[k * 9 + a * 3 + bb] -= la * ma / s11;
            A1[k * 9 + a * 3 + bb] -= (la * mb + lb * ma) / s11;
            A2[k * 9 + a * 3 + bb] -= lb * mb / s11;
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
function updateKappa(fx: Flat, kT: number, rho: number, groups: Group[], names: string[], kappa: Float64Array, ws: Float64Array,
  predX: Float64Array, predU: Float64Array, hasPred: Uint8Array, pred: Float64Array, yy: Float64Array, W: Float64Array, delta: Float64Array, L: number): Float64Array {
  const items: { key: string; est: number; v: number }[] = [];
  const cur = Array.from(kappa, (k) => Math.log(k / KAPPA_PRIOR.mean));
  let rss = 0, dof = 0;
  const per: { l: number; Sdd: number; Sdr: number; vd: number }[] = [];
  // Within-session weighted regression of the residual on d = −∂pred/∂ln κ ∝ −κE(1 − u)/w, jointly with the lift's same-lift
  // fatigue x: a back-off is usually the last set, so a lighter load and a more tired lifter arrive together, and κ alone would
  // take the blame for a misjudged fatigue (its SD comes from the joint fit, so it says so). Summed per lift, in row order.
  const S = new Float64Array(L * 7); // per lift: Sdd, Sdr, Srr, Sdx, Sxx, Sxr, cnt
  for (let g = 0; g < groups.length; g++) {
    if (!hasPred[g]) continue;
    const { o0, o1, lift: l } = groups[g];
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
    const l7 = l * 7;
    S[l7] += sWdd - sWd * sWd / sW; S[l7 + 1] += sWdr - sWd * sWr / sW; S[l7 + 2] += sWrr - sWr * sWr / sW;
    S[l7 + 3] += sWdx - sWd * sWx / sW; S[l7 + 4] += sWxx - sWx * sWx / sW; S[l7 + 5] += sWxr - sWx * sWr / sW; S[l7 + 6] += m - 1;
  }
  for (let l = 0; l < L; l++) {
    const l7 = l * 7, Sdd = S[l7], Sdr = S[l7 + 1], Srr = S[l7 + 2], Sdx = S[l7 + 3], Sxx = S[l7 + 4], Sxr = S[l7 + 5], cnt = S[l7 + 6];
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
function liftASame(fx: Flat, groups: Group[], names: string[], cells: Cell[], kT: number, kR: number,
  theta: [number, number, number], pred: Float64Array, yy: Float64Array, W: Float64Array, L: number,
  kappa: Float64Array, predX: Float64Array, hasPred: Uint8Array): { post: Posterior[]; own: (Est | null)[] } {
  const rho = RHOS[kR];
  const items: { key: string; est: number; v: number }[] = [];
  let rss = 0, dof = 0;
  const per: { est: number; v: number; l: number }[] = [];
  const rs = (i: number) => pred[i] - yy[i] - theta[1] * (rho * fx.nC[i] + (1 - rho) * fx.eC[i * NT + kT]) - theta[2] * fx.nY[i];
  // Weighted within-session regression of the residual on the same-lift fatigue x, jointly with the load term d = −κE/w (see
  // updateKappa: a back-off is usually the last set, so fatigue and load move together). Centred per session; summed per lift.
  const S = new Float64Array(L * 7); // per lift: Sxx, Sxr, Sdd, Sdr, Sdx, Srr, cnt
  for (let g = 0; g < groups.length; g++) {
    const { o0, o1, lift: l } = groups[g];
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
    const l7 = l * 7;
    S[l7] += sxx - sx * sx / sw; S[l7 + 1] += sxr - sx * sr / sw; S[l7 + 5] += srr - sr * sr / sw;
    S[l7 + 2] += sdd - sd * sd / sw; S[l7 + 3] += sdr - sd * sr / sw; S[l7 + 4] += sdx - sd * sx / sw; S[l7 + 6] += m - 1;
  }
  for (let l = 0; l < L; l++) {
    const l7 = l * 7, Sxx = S[l7], Sxr = S[l7 + 1], Sdd = S[l7 + 2], Sdr = S[l7 + 3], Sdx = S[l7 + 4], Srr = S[l7 + 5], cnt = S[l7 + 6];
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
  const own: (Est | null)[] = names.map(() => null);
  for (const { est, v, l } of per) { items.push({ key: liftKey(names[l]), est, v: phi * v }); own[l] = { mean: est, sd: Math.sqrt(phi * v) }; }
  const sd0 = Math.sqrt(cells.reduce((a, c) => a + c.w * (c.cov[0] + (c.theta[0] - theta[0]) ** 2), 0));
  const p = pool(items, (a, b) => liftSimilarity(a, b), { mean: theta[0], personSd: sd0, liftSd: A_LIFT_SD });
  return { post: names.map((n) => p.lift(liftKey(n))), own };
}
