import { liftKey } from '../ids';
import { liftSets, perLog } from '../stats';
import type { SetEntry } from '../types';
import { tagsOf, type Implement } from './tags';

// Item 01: the weights each lift can actually be loaded with, learned from the weights logged (01-weight-jumps §4.1).
//
// Evidence labels: (b) the step and its offset are learned from his logged weights, by the method below; (a) which gear
// shares one set of weights (a dumbbell rack, a cable stack, plates on a bar) is hardware fact, while a selectorized machine
// has its own stack (01 §3.4, vendor sources); (c) the neutral priors are a uniform prior over the candidate grids and an
// add-one prior on the typo rate: they shape the choice only through the data.
//
// Method (b), partial pooling person → gym → lift: every logged weight, warm-ups included (real loadings), once per session.
// A grid (step s, offset o) explains a weight with probability (1 − ε)/k for each of its k rungs in a 20 lb cycle, else ε spread
// over the other residues (a typo or a kg conversion; ε by add-one on the weights off the grid). The broadest level picks its
// grid by maximum likelihood (a finer grid pays for its extra rungs, so the coarsest grid that explains the weights wins). Each
// narrower level keeps its own grid only when its weights are better explained by it, after paying for having picked one of
// the candidates, than by the level above's own residue frequencies (which carry his preference for round numbers on a fine
// grid). Thin lifts sit on their pool; a dedicated stack with enough sessions (a seated row, a pulldown) gets its own.

/** Candidate steps, lb, coarsest first (01 §4.1). */
export const STEPS = [20, 10, 5, 2.5, 1.25] as const;
const CYCLE = 20, RES = 1.25, NR = CYCLE / RES; // residues of a weight mod 20 lb, at 1.25 lb
/** (a) Gear whose weights every lift using it shares (01 §4.1); anything else (machines) has a stack per lift. */
const SHARED: Partial<Record<Implement, string>> = { dumbbell: 'dumbbell', kettlebell: 'kettlebell', cable: 'cable', barbell: 'plates', smith: 'plates', plate: 'plates', bodyweight: 'plates' };

export interface Ladder {
  step: number; offset: number;
  /** Whose weights set the grid: this lift's own, or its pool's (the gear at the gym, or every gym). */
  source: 'lift' | 'pool';
  /** Weights (once per session) behind the grid. */
  n: number;
  /** Weights this lift has logged at the gym: known to load. */
  known: number[];
  /** The shared gear ("cable", "dumbbell", "plates"), or null for a machine's own stack. */
  pool: string | null;
}

const residue = (w: number): number | null => {
  const x = ((w % CYCLE) + CYCLE) % CYCLE / RES, r = Math.round(x);
  return Math.abs(x - r) < 0.1 ? r % NR : null; // off the 1.25 lb resolution: a typo under every grid alike
};
interface Grid { s: number; o: number; ll: number }
/** The grid's log likelihood for residue counts (length NR), with ε by add-one. */
function gridLL(counts: ArrayLike<number>, s: number, o: number): number {
  const k = CYCLE / s, every = s / RES;
  let on = 0, n = 0;
  for (let r = 0; r < NR; r++) { n += counts[r]; if ((r - o + NR) % every === 0) on += counts[r]; }
  const off = n - on, eps = (off + 1) / (n + 2);
  return on * Math.log((1 - eps) / k) + (k < NR ? off * Math.log(eps / (NR - k)) : 0);
}
/** (c) The uniform prior over (step, offset) candidates: its count is what choosing a grid of one's own costs. */
const CANDIDATES = STEPS.reduce((a, s) => a + s / RES, 0);
/** The maximum-likelihood grid (ties to the coarser, which comes first). */
function bestGrid(counts: ArrayLike<number>): Grid {
  let best: Grid = { s: STEPS[STEPS.length - 1], o: 0, ll: -Infinity };
  for (const s of STEPS) for (let o = 0; o < s / RES; o++) {
    const ll = gridLL(counts, s, o);
    if (ll > best.ll + 1e-9) best = { s, o, ll };
  }
  return best;
}

/**
 * The levels a lift's grid is pooled through, broadest first: shared gear, the person's (every gym) → that gym's → the lift
 * at that gym; a machine, all the person's machines → this lift (every gym) → this lift at that gym.
 */
function chain(exercise: string, gym: string): string[] {
  const key = liftKey(exercise), imp = tagsOf(exercise).imp, name = (imp && SHARED[imp]) ?? null;
  return name ? [`*|${name}`, `${gym}|${name}`, `${gym}|lift:${key}`] : ['*|machine', `*|lift:${key}`, `${gym}|lift:${key}`];
}

/** Session-distinct weights' residue counts, once per log, under every level of every lift's chain. */
const pools = perLog((entries) => {
  const out = new Map<string, Float64Array>();
  const distinct = new Map<string, Set<number>>();
  const seen = new Set<string>();
  for (const e of entries) {
    if (!(e.weight > 0) || e.flags.includes('cardio') || e.flags.includes('double_pulley')) continue;
    const gym = e.gym ?? '';
    const id = `${gym}|${liftKey(e.exercise)}|${e.date}|${e.weight}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const r = residue(e.weight);
    if (r == null) continue;
    for (const k of chain(e.exercise, gym)) {
      let c = out.get(k); if (!c) out.set(k, c = new Float64Array(NR)); c[r]++;
      let d = distinct.get(k); if (!d) distinct.set(k, d = new Set()); d.add(e.weight);
    }
  }
  return { out, distinct };
});

/** The gym a lift is next done at: the gym of its newest set (none logged: the unnamed gym). */
const gymOf = (entries: readonly SetEntry[], exercise: string): string => {
  const xs = liftSets(entries, exercise);
  return xs.length ? xs.reduce((a, e) => (e.date >= a.date ? e : a)).gym ?? '' : '';
};
const total = (c: ArrayLike<number>) => { let n = 0; for (let r = 0; r < NR; r++) n += c[r]; return n; };

/** This lift's ladder at `gym` (default: where it was last done); null when nothing in its chain has a logged weight. */
export function ladderOf(entries: readonly SetEntry[], exercise: string, gym = gymOf(entries, exercise)): Ladder | null {
  const imp = tagsOf(exercise).imp;
  const name = (imp && SHARED[imp]) ?? null;
  const known = [...new Set(liftSets(entries, exercise)
    .filter((e) => e.weight > 0 && (e.gym ?? '') === gym && !e.flags.includes('double_pulley') && residue(e.weight) != null).map((e) => e.weight))].sort((a, b) => a - b);
  // A level with one distinct weight says nothing about the step (any grid through it fits): it has no voice.
  const { out, distinct } = pools(entries);
  const counts = chain(exercise, gym).map((k) => ((distinct.get(k)?.size ?? 0) >= 2 ? out.get(k) : undefined));
  let g: Grid | null = null, at = -1, up: Float64Array | null = null;
  for (let i = 0; i < counts.length; i++) {
    const own = counts[i];
    if (!own || !total(own)) continue;
    const mine = bestGrid(own);
    if (!g || !up) { g = mine; at = i; up = own; continue; }
    // The nearest level above with a voice, without this level's own weights: its residue frequencies, add-half each.
    const rest = up.map((c, r) => c - own[r]), nRest = total(rest);
    let llUp = 0;
    for (let r = 0; r < NR; r++) if (own[r]) llUp += own[r] * Math.log((rest[r] + 0.5) / (nRest + NR / 2));
    // Nothing above but these same weights: nothing to tell them apart by, so the level above stands.
    if (nRest > 0 && mine.ll - Math.log(CANDIDATES) > llUp) { g = mine; at = i; }
    up = own;
  }
  if (!g) return null;
  const lift = at === counts.length - 1 || (!name && at === 1);
  return { step: g.s, offset: g.o * RES, source: lift ? 'lift' : 'pool', n: total(counts[at]!), known, pool: name };
}

/** The heaviest loadable weight at or under `w`: the rung of the grid below it, or a weight this lift has logged in between. */
export function floorRung(l: Ladder, w: number): number {
  const k = Math.floor((w - l.offset) / l.step + 1e-9);
  const grid = Math.round((l.offset + k * l.step) * 100) / 100;
  let known: number | undefined;
  for (const x of l.known) if (x <= w + 1e-9) known = x;
  return known != null && known > grid ? known : grid;
}

/** The first loadable weight above `w`: the next rung of the grid, or a weight this lift has logged in between. */
export function nextRung(l: Ladder, w: number): number {
  const k = Math.floor((w - l.offset) / l.step + 1e-9) + 1;
  const grid = Math.round((l.offset + k * l.step) * 100) / 100;
  const known = l.known.find((x) => x > w + 1e-9);
  return known != null && known < grid ? known : grid;
}

/** The heaviest loadable weight below `w`: the rung under it, or a weight this lift has logged in between. */
export const prevRung = (l: Ladder, w: number): number => floorRung(l, w - 1e-6);
