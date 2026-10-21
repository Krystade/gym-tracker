import { liftKey } from '../ids';
import { liftFactsVersion } from '../lifts';
import { settingsKey } from '../progression';
import { judgeDay, offersOf, restsOf, timedWorking, type DayPace, type Gap, type GapModel, type Judged } from '../superset';
import { restSeconds, SET_WORK } from '../timing';
import type { SetEntry } from '../types';
import { doneAt } from '../stats';
import { dayOf } from './capacity';
import { logBefore } from './index';
import { lnGamma } from './num';
import { LIFT_LOG_SD } from './pace';
import { pool, type Pooled, type Posterior } from './pool';
import { liftSimilarity } from './tags';

// Item 15: the gap model superset detection reads (domain/superset), learned from his timed sets. It says how likely a gap is
// as a switch to the next lift of a superset and as a rest after the lift before it. Owner: "most of this backed by proven math
// rather than magic numbers and hard coded decisions."
//
// Evidence labels: (a) research, cited; (b) learned from his log, by the method named; (c) a neutral default, which takes no
// action (a grid's uniform prior, an approximation that only widens or withholds).
//
// The unit is a gap: seconds from one timed working set's done-time to the next one's, the same day, in logs (x = ln g):
// inter-activity times are log-normal mixtures (a: Halfaker et al. 2015, WWW, which separates them the same way).
// - Rest after lift L (b): x ~ t_ν(c_L + l_L + u, σ² + sd_L² + v_u). c_L = ln(research rest + the set) (a: timing.restSeconds,
//   2:00 small lift / 3:00 big, owner 2026-10-19, and timing.SET_WORK); l_L his deviation from it, pooled person → family →
//   lift (learn/pool, learn/tags similarity) over his same-lift gaps. A gap to another lift is read against the rest of the
//   lift before it, and teaches no rest (c: inside a group it is a rest only if it wasn't a superset, and weighted 1 − P a lift
//   only ever switched from would learn its "rest" from its switches, and a lifter who always supersets it would never be
//   found: an error no tap can undo, where a false group's "Not a superset" can).
// - Switch between A and B (b): x ~ t_ν(μ0 + s_AB + u, ·), either way round (c: one parameter for the walk between two
//   lifts, the same both ways; a round read the other way can't learn a long switch of its own). μ0 and the prior's spread are the trials' own (a: Zhang,
//   Weakley et al. 2025, Sports Med, PMC12011898, Table 1: the paired exercises were done in succession in 15 of 19 trials,
//   10 s apart in one, under 30 s in one, 45 s in two; each with the set itself, timing.SET_WORK). s_AB pooled person → family
//   → pair (a pair's family: pairs of similar lifts, learn/tags similarity of both ends), from the switches of the groups he
//   did, each weighted by P(it was a superset) (soft EM: Dempster, Laird & Rubin 1977). "Not a superset" weighs 0: never a
//   switch.
// - Both read at one scale, the wider of the two: σ² + max(sd_L², sd_AB²) + v_u (c: a mixture's components held to a common
//   spread, so one can't win by collapsing narrow onto the other's gaps; a: Hathaway 1985, Ann Stat 13:795).
// - A switch is the shorter gap (c): one at or past his rest's centre is never evidence for a switch (its λ at most 0), so an
//   unlearned, wide switch can't out-weigh a well-learned rest far in its tail. It only withholds.
// - One spread σ for every gap (b), rests and switches alike: timing's scalar property, an interval's SD in proportion to its
//   length, so equal in logs (a: Gibbon 1977, Psych Rev 84:279). Normal–inverse-χ², the trials' spread as its prior worth one
//   gap (unit information, a: Kass & Wasserman 1995), so his gaps rule from the first. The predictive is Student's t: with
//   few gaps its tails are wide and no one gap can say much.
// - The day's own pace u (b), session-aware: a slow day's rests read slow, and so do its switches. The day effect's spread τ²
//   from his days (one-way ANOVA moments, Searle 1971's n0), the day's rests so far shrunk by τ² against σ² (empirical Bayes).
// - Recency (b): each gap weighs 2^(−age/h), a power prior on old sessions (a: Ibrahim & Chen 2000, Stat Sci 15:46), h averaged
//   over HALF_LIVES by how well each predicted every next day's rests from the days before (prequential likelihood, Bayesian
//   model averaging, as learn/session). A layoff leaves every gap older, so the counts and the dof fall and the bands widen
//   (owner: layoffs widen uncertainty).
// - Fits read only the days before `today` (a day's own gaps are its evidence, never its model too).

/** (c) Half-lives on the recency grid, days: doubling, from two weeks to over a year; uniform prior (the data weighs them). */
export const HALF_LIVES = [14, 28, 56, 112, 224, 448] as const;
/** (a) A prior worth one gap (unit information, Kass & Wasserman 1995): the prior's count for a mean and for the spread. */
const KAPPA0 = 1, NU0 = 1;
/** (a) Zhang, Weakley et al. 2025 (Sports Med; PMC12011898), Table 1: seconds between a superset's paired exercises in its 19 trials. "In succession" is 0; "under 30 s" is read as its midpoint. */
export const TRIAL_PAIR_REST: readonly number[] = [...Array<number>(15).fill(0), 10, 15, 45, 45];
/** Numerics: EM rounds at most, and the change in any P that counts as settled. */
const MAX_ROUNDS = 10, SETTLED = 1e-4;
/** Numerics: a half-life whose posterior weight is under this is left out of the mixture. */
const MIN_WEIGHT = 1e-4;

let SW0: { mu: number; sd: number } | null = null;
/** The trials' switch, in logs: the mean and SD of ln(rest between + the set) over Zhang 2025's 19 (a). */
export function switchPrior(): { mu: number; sd: number } {
  if (!SW0) {
    const xs = TRIAL_PAIR_REST.map((r) => Math.log(r + SET_WORK));
    const mu = xs.reduce((a, x) => a + x, 0) / xs.length;
    SW0 = { mu, sd: Math.sqrt(xs.reduce((a, x) => a + (x - mu) ** 2, 0) / (xs.length - 1)) };
  }
  return SW0;
}
/** A lift's research rest and the set, in logs (a): the centre his rests are read against. */
const CENTRES = new Map<string, number>();
const restCentre = (exercise: string) => {
  let c = CENTRES.get(exercise);
  if (c === undefined) { CENTRES.set(exercise, c = Math.log(restSeconds(exercise) + SET_WORK)); if (CENTRES.size > 4096) CENTRES.clear(); }
  return c;
};
const PAIR = '\u0000';
/** A pair's key, either way round: one switch between two lifts (the walk between them is the same both ways). */
const pairKey = (a: string, b: string) => { const x = liftKey(a), y = liftKey(b); return x < y ? `${x}${PAIR}${y}` : `${y}${PAIR}${x}`; };
const sameOr = (a: string, b: string) => (a === b ? 1 : Math.max(0, liftSimilarity(a, b)));
/** Two pairs are alike as both their ends are (a product of correlations is one: Schur). */
const pairSim = (p: string, q: string) => { const [a, b] = p.split(PAIR), [c, d] = q.split(PAIR); return Math.max(sameOr(a, c) * sameOr(b, d), sameOr(a, d) * sameOr(b, c)); };

/** ln of Student's t density's constant for ν dof, and its kernel at z (in scales from the centre). */
const ltConst = (nu: number) => lnGamma((nu + 1) / 2) - lnGamma(nu / 2) - 0.5 * Math.log(nu * Math.PI);
const ltKernel = (z: number, nu: number) => -((nu + 1) / 2) * Math.log1p((z * z) / nu);
const lse = (xs: readonly number[]) => { const m = Math.max(...xs); return m === -Infinity ? m : m + Math.log(xs.reduce((a, x) => a + Math.exp(x - m), 0)); };

/** A rest gap: its day, lift (key), ln seconds less the lift's research centre. */
interface RestGap { no: number; key: string; y: number }
/** A switch gap: its day, pair, ln seconds less the trials' centre, and its weight (P the group was a superset). */
interface SwitchGap { no: number; pair: string; y: number; w: number }

interface Stat { n: number; s: number; ss: number }
const add = (m: Map<string, Stat>, k: string, y: number, w: number) => {
  const t = m.get(k);
  if (t) { t.n += w; t.s += w * y; t.ss += w * y * y; } else m.set(k, { n: w, s: w * y, ss: w * y * y });
};

/** One recency weighting's fit (half-life h). */
interface Member {
  h: number; w: number;
  /** The common spread (ln s)² and its dof; the day effect's variance. */
  sigma2: number; nu: number; tau2: number;
  rest: Pooled; sw: Pooled;
  /** Weighted counts: rest and switch gaps. */
  nRest: number; nSw: number;
  restAt: Map<string, Posterior>; swAt: Map<string, Posterior>;
}
const restPost = (m: Member, key: string) => { let p = m.restAt.get(key); if (!p) m.restAt.set(key, p = m.rest.lift(key)); return p; };
const swPost = (m: Member, pair: string) => { let p = m.swAt.get(pair); if (!p) m.swAt.set(pair, p = m.sw.lift(pair)); return p; };

/** The pooled within-group spread (Normal–inverse-χ² with the trials' prior worth one gap): σ² and its dof. */
function spread(groups: Iterable<Stat>, sd0: number): { sigma2: number; nu: number } {
  let ss = 0, dof = 0;
  for (const g of groups) if (g.n > 0) { ss += Math.max(0, g.ss - (g.s * g.s) / g.n); dof += Math.max(0, g.n - 1); }
  return { sigma2: (NU0 * sd0 * sd0 + ss) / (NU0 + dof), nu: NU0 + dof };
}

/** Each lift's (or pair's) mean, pooled person → family → lift; the person level from the same gaps (EB), worth KAPPA0 at 0. */
function pooled(stats: Map<string, Stat>, sigma2: number, sim: (a: string, b: string) => number): { post: Pooled; n: number } {
  let n = 0, s = 0;
  const items: { key: string; est: number; v: number }[] = [];
  for (const [k, t] of stats) if (t.n > 0) { n += t.n; s += t.s; items.push({ key: k, est: t.s / t.n, v: sigma2 / t.n }); }
  return { post: pool(items, sim, { mean: s / (n + KAPPA0), personSd: Math.sqrt(sigma2 / (n + KAPPA0)), liftSd: LIFT_LOG_SD }), n };
}

/** Day effects' variance: one-way ANOVA moments (Searle 1971's n0) on each day's rest residuals against the lifts' centres. */
function dayVariance(rests: readonly RestGap[], centre: (key: string) => number, sigma2: number): number {
  const by = new Map<number, { m: number; s: number }>();
  for (const g of rests) { const d = by.get(g.no), r = g.y - centre(g.key); if (d) { d.m++; d.s += r; } else by.set(g.no, { m: 1, s: r }); }
  const D = by.size;
  if (D < 2) return 0;
  let N = 0, tot = 0, sm2 = 0;
  for (const d of by.values()) { N += d.m; tot += d.s; sm2 += d.m * d.m; }
  const grand = tot / N;
  let ssb = 0;
  for (const d of by.values()) ssb += d.m * (d.s / d.m - grand) ** 2;
  const n0 = (N - sm2 / N) / (D - 1);
  return n0 > 0 ? Math.max(0, (ssb / (D - 1) - sigma2) / n0) : 0;
}

function member(h: number, rests: readonly RestGap[], sws: readonly SwitchGap[], T: number, sd0: number): Member {
  const fade = (no: number) => (Number.isFinite(h) ? 2 ** (-(T - no) / h) : 1);
  const rs = new Map<string, Stat>(), ss = new Map<string, Stat>();
  for (const g of rests) add(rs, g.key, g.y, fade(g.no));
  for (const g of sws) if (g.w > 0) add(ss, g.pair, g.y, g.w * fade(g.no));
  const { sigma2, nu } = spread([...rs.values(), ...ss.values()], sd0);
  const rest = pooled(rs, sigma2, liftSimilarity), sw = pooled(ss, sigma2, pairSim);
  const m: Member = { h, w: 1, sigma2, nu, tau2: 0, rest: rest.post, sw: sw.post, nRest: rest.n, nSw: sw.n, restAt: new Map(), swAt: new Map() };
  m.tau2 = dayVariance(rests, (k) => restPost(m, k).mean, sigma2);
  return m;
}

/**
 * Each half-life's prequential log likelihood: every timed day's mean rest residual, predicted from the days before (lifts
 * shrunk to his level with one gap's weight), against N(0, τ² + σ²/m + the centres' own variance). σ² from the days so far;
 * τ² is a whole-log fit's (nuisance, shared by every h).
 */
function prequential(rests: readonly RestGap[], sd0: number, tau2: number): number[] {
  const days: RestGap[][] = [];
  for (const g of rests) { const d = days.at(-1); if (d && d[0].no === g.no) d.push(g); else days.push([g]); }
  return HALF_LIVES.map((h) => {
    const st = new Map<string, Stat>();
    let N = 0, S = 0, ll = 0, last = days[0]?.[0].no ?? 0;
    for (const day of days) {
      const f = 2 ** (-(day[0].no - last) / h);
      last = day[0].no;
      for (const t of st.values()) { t.n *= f; t.s *= f; t.ss *= f; }
      N *= f; S *= f;
      if (N > 0) {
        const { sigma2 } = spread(st.values(), sd0);
        const mP = S / (N + KAPPA0);
        let r = 0, vc = 0;
        for (const g of day) {
          const t = st.get(g.key), n = t?.n ?? 0, c = ((t?.s ?? 0) + KAPPA0 * mP) / (n + KAPPA0);
          r += g.y - c; vc += sigma2 / (n + KAPPA0);
        }
        const m = day.length, v = tau2 + sigma2 / m + vc / (m * m);
        r /= m;
        ll += -0.5 * Math.log(2 * Math.PI * v) - (r * r) / (2 * v);
      }
      for (const g of day) { add(st, g.key, g.y, 1); N += 1; S += g.y; }
    }
    return ll;
  });
}

/** A timed day before today: its date and number, timed working sets in order, its lifts, and its rest gaps. */
interface TDay { date: string; no: number; seq: SetEntry[]; lifts: Set<string> }

/** His gap model as of a day (the GapModel superset detection reads, with what the "?" and the tests look at). */
export interface SwitchModel extends GapModel {
  /** The half-lives' weights (HALF_LIVES order). */
  weights: number[];
  /** The common spread (ln s), the day effect's SD, both averaged over the half-lives. */
  sigma: number; tau: number;
  /** Switch gaps learned (Σ P), rest gaps learned, timed days read, and his rate π of supersets among the groups offered. */
  switches: number; rests: number; days: number; rate: number;
  /** The switches he did between `from` and `to`, either way round (Σ P, before fading). */
  pairSwitches(from: string, to: string): number;
  /** A gap's predictive (ln s): where a rest after `lift` and a switch `from`→`to` centre, and how wide, on a day with no rests yet. */
  rest(lift: string): { mean: number; sd: number };
  switch(from: string, to: string): { mean: number; sd: number };
  /**
   * The switch's median, s, on a day with these rests and these switches of the pair so far (the day's own pace and his switches
   * today move it: posterior predictive).
   */
  switchSeconds(from: string, to: string, today?: { rests?: readonly Gap[]; switches?: readonly Gap[] }): number;
}

function modelOf(members: Member[], rateOf: (keys: readonly string[]) => number, info: { days: number; switches: number; rests: number; rate: number; pairN: Map<string, number> }): SwitchModel {
  const { mu: mu0 } = switchPrior();
  const lw = members.map((m) => Math.log(m.w) + ltConst(m.nu));
  /** Per member: the day effect and its variance, given the day's rests. */
  const dayOf_ = (rests: readonly Gap[]) => members.map((m) => {
    if (!(m.tau2 > 0)) return { u: 0, v: 0 };
    let s = 0;
    for (const g of rests) s += Math.log(g.seconds) - restCentre(g.from) - restPost(m, liftKey(g.from)).mean;
    const n = rests.length;
    return { u: s / (n + m.sigma2 / m.tau2), v: 1 / (1 / m.tau2 + n / m.sigma2) };
  });
  const day = (rests: readonly Gap[]): DayPace => {
    const d = dayOf_(rests);
    return {
      llr(from, to, seconds) {
        const x = Math.log(seconds), kf = liftKey(from), pk = pairKey(from, to), c0 = restCentre(from);
        const lS: number[] = [], lR: number[] = [];
        let centre = 0;
        members.forEach((m, i) => {
          const r = restPost(m, kf), s = swPost(m, pk), { u, v } = d[i], cR = c0 + r.mean + u;
          centre += m.w * cR;
          // One scale for both (the wider's): a switch learned tighter than a rest can't win a gap by being narrow.
          const sc = Math.sqrt(m.sigma2 + Math.max(r.sd * r.sd, s.sd * s.sd) + v), base = lw[i] - Math.log(sc);
          lR.push(base + ltKernel((x - cR) / sc, m.nu));
          lS.push(base + ltKernel((x - (mu0 + s.mean + u)) / sc, m.nu));
        });
        // A switch is the shorter gap: a gap past his usual rest is never evidence of one (c: only withholds). Without this, a
        // switch still uncertain (wider) would out-weigh a well-learned rest far in its tail.
        const l = lse(lS) - lse(lR);
        return x >= centre ? Math.min(0, l) : l;
      },
    };
  };
  const avg = (f: (m: Member) => number) => members.reduce((a, m) => a + m.w * f(m), 0);
  const mixed = (f: (m: Member) => Posterior, centre: number) => {
    const mean = avg((m) => centre + f(m).mean);
    return { mean, sd: Math.sqrt(avg((m) => m.sigma2 + f(m).sd ** 2 + m.tau2 + (centre + f(m).mean - mean) ** 2)) };
  };
  const weights = HALF_LIVES.map((h) => members.find((m) => m.h === h)?.w ?? 0);
  return {
    day, prior: rateOf, weights,
    sigma: Math.sqrt(avg((m) => m.sigma2)), tau: Math.sqrt(avg((m) => m.tau2)),
    switches: info.switches, rests: info.rests, days: info.days, rate: info.rate,
    pairSwitches: (from, to) => info.pairN.get(pairKey(from, to)) ?? 0,
    rest: (lift) => mixed((m) => restPost(m, liftKey(lift)), restCentre(lift)),
    switch: (from, to) => mixed((m) => swPost(m, pairKey(from, to)), mu0),
    switchSeconds(from, to, today = {}) {
      const d = dayOf_(today.rests ?? []), pk = pairKey(from, to);
      const own = (today.switches ?? []).filter((g) => pairKey(g.from, g.to) === pk).map((g) => Math.log(g.seconds) - mu0);
      let ln = 0;
      members.forEach((m, i) => {
        const p = swPost(m, pk), { u } = d[i];
        // The pair's centre updated by today's switches of it (each one gap at σ², the day's pace taken out).
        let prec = 1 / (p.sd * p.sd), num = p.mean * prec;
        for (const y of own) { prec += 1 / m.sigma2; num += (y - u) / m.sigma2; }
        ln += m.w * (mu0 + num / prec + u);
      });
      return Math.exp(ln);
    },
  };
}

/** The model with no log: the trials' switch against the research rests (a), every group at even odds. */
export function coldGaps(): SwitchModel {
  const { sd } = switchPrior();
  return modelOf([member(Infinity, [], [], 0, sd)], () => 0.5, { days: 0, switches: 0, rests: 0, rate: 0.5, pairN: new Map() });
}

/** Lifts' keys seen on each day, for "sessions he did all of them in": the days (indices) each lift was timed on. */
function index(days: readonly TDay[]): Map<string, number[]> {
  const at = new Map<string, number[]>();
  days.forEach((d, i) => { for (const k of d.lifts) { const xs = at.get(k); if (xs) xs.push(i); else at.set(k, [i]); } });
  return at;
}

/**
 * P(the lifts `keys` are a superset) before day `upto` (exclusive), from judgments `hist`: (s + π)/(n + 1) with n the days he
 * timed all of them, s the P that day's group of them (or one holding them) was a superset, and π his rate among every group
 * the structure offered before then (Jeffreys' prior: (Σ P + ½)/(N + 1)).
 */
function rateFrom(days: readonly TDay[], at: Map<string, number[]>, hist: readonly Judged[][]) {
  // Per set of lifts: the days with all of them, and the running sum of that day's P (each day is asked for every day after).
  const tables = new Map<string, { idx: number[]; cum: number[] }>();
  const table = (keys: readonly string[]) => {
    const sig = [...keys].sort().join(PAIR);
    let t = tables.get(sig);
    if (t) return t;
    let rare: number[] = [];
    for (const k of keys) { const xs = at.get(k) ?? []; if (k === keys[0] || xs.length < rare.length) rare = xs; }
    t = { idx: [], cum: [0] };
    for (const i of rare) {
      if (!keys.every((k) => days[i].lifts.has(k))) continue;
      let p = 0;
      for (const j of hist[i] ?? []) if (keys.every((k) => j.keys.includes(k))) p = Math.max(p, j.p);
      t.idx.push(i); t.cum.push(t.cum.at(-1)! + p);
    }
    tables.set(sig, t);
    return t;
  };
  return (upto: number, pi: number) => (keys: readonly string[]): number => {
    const { idx, cum } = table(keys);
    let lo = 0, hi = idx.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (idx[mid] < upto) lo = mid + 1; else hi = mid; }
    return (cum[lo] + pi) / (lo + 1);
  };
}

/**
 * The E-step's switches (b: soft EM, Dempster, Laird & Rubin 1977): each gap where a judged group could switch, weighted
 * P(superset) × P(the round rests elsewhere), over every place the round could rest (each weighed by its λ: the place
 * marginalised, not picked; picking the likeliest would teach his switches from the shorter gaps of any alternation). A gap
 * of two groups goes by the likelier superset. "Not a superset" weighs 0.
 */
function weigh(days: readonly TDay[], hist: readonly Judged[][], mu0: number): { sws: SwitchGap[]; pairN: Map<string, number>; switches: number } {
  const sws: SwitchGap[] = [], pairN = new Map<string, number>();
  let switches = 0;
  days.forEach((d, i) => {
    const at = new Map<number, { sw: number; p: number }>();
    for (const j of hist[i]) {
      const top = Math.max(...j.turns.map((t) => t.l));
      const ws = j.turns.map((t) => Math.exp(t.l - top)), tot = ws.reduce((a, b) => a + b, 0);
      const sw = new Map<number, number>();
      j.turns.forEach((t, r) => {
        for (const k of t.sw) sw.set(k, (sw.get(k) ?? 0) + (j.p * ws[r]) / tot);
      });
      for (const [k, w] of sw) { const was = at.get(k); if (!was || j.p > was.p) at.set(k, { sw: w, p: j.p }); }
    }
    for (const [k, { sw }] of at) {
      const a = d.seq[k], b = d.seq[k + 1], g = (doneAt(b) - doneAt(a)) / 1000;
      if (!(sw > 0)) continue;
      const pair = pairKey(a.exercise, b.exercise);
      sws.push({ no: d.no, pair, y: Math.log(g) - mu0, w: sw });
      pairN.set(pair, (pairN.get(pair) ?? 0) + sw);
      switches += sw;
    }
  });
  return { sws, pairN, switches };
}

function fit(log: readonly SetEntry[], today: string, dismissed: Readonly<Record<string, string[][]>>): SwitchModel {
  const T = dayOf(today), { sd: sd0, mu: mu0 } = switchPrior();
  const byDate = new Map<string, SetEntry[]>();
  for (const e of log) if (e.loggedAt && e.date < today) { const d = byDate.get(e.date); if (d) d.push(e); else byDate.set(e.date, [e]); }
  const days: TDay[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const seq = timedWorking(byDate.get(date)!, date);
    if (seq.length) days.push({ date, no: dayOf(date), seq, lifts: new Set(seq.map((e) => settingsKey(e.exercise))) });
  }
  // His rests: every same-lift gap that says something (they don't depend on what is a superset).
  const rests: RestGap[] = [];
  const dayRests = days.map((d) => restsOf(d.seq));
  days.forEach((d, i) => { for (const g of dayRests[i]) rests.push({ no: d.no, key: liftKey(g.from), y: Math.log(g.seconds) - restCentre(g.from) }); });
  const at = index(days);
  const offers = days.map((d) => offersOf(d.seq));

  // The half-lives weighed by his rests (they don't depend on what is a superset: once a fit), τ² from them all (unfaded).
  const ll = prequential(rests, sd0, member(Infinity, rests, [], T, sd0).tau2);
  const top = Math.max(...ll), raw = ll.map((x) => Math.exp(x - top)), tot = raw.reduce((a, b) => a + b, 0);
  const hw = HALF_LIVES.map((_, j) => raw[j] / tot).map((w) => (w >= MIN_WEIGHT ? w : 0));
  const hs = hw.reduce((a, b) => a + b, 0);
  // The members for a set of switch gaps.
  const fitMembers = (sws: readonly SwitchGap[]): Member[] => {
    const out: Member[] = [];
    HALF_LIVES.forEach((h, j) => { if (hw[j] > 0) { const m = member(h, rests, sws, T, sd0); m.w = hw[j] / hs; out.push(m); } });
    return out;
  };

  // Soft EM: judge every day with the model so far and the history before it; learn the switches from what was judged.
  let members = fitMembers([]);
  let hist: Judged[][] = days.map(() => []);
  let first = true;
  const prefix = (h: readonly Judged[][]) => { const S = [0], N = [0]; h.forEach((js) => { S.push(S.at(-1)! + js.reduce((a, j) => a + j.p, 0)); N.push(N.at(-1)! + js.length); }); return { S, N }; };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const rate = rateFrom(days, at, hist);
    const model = modelOf(members, () => 0.5, { days: 0, switches: 0, rests: 0, rate: 0.5, pairN: new Map() });
    const { S, N } = prefix(hist);
    const next = days.map((d, i) => {
      const prior = first ? () => 0.5 : rate(i, (S[i] + 0.5) / (N[i] + 1));
      const view: GapModel = { day: model.day, prior };
      return judgeDay(offers[i], view, model.day(dayRests[i]), { dismissed: dismissed[d.date] ?? [] }).judged;
    });
    let change = 0;
    next.forEach((js, i) => {
      const was = new Map(hist[i].map((j) => [j.keys.join(PAIR), j.p]));
      for (const j of js) change = Math.max(change, Math.abs(j.p - (was.get(j.keys.join(PAIR)) ?? 0)));
      for (const [k, p] of was) if (!js.some((j) => j.keys.join(PAIR) === k)) change = Math.max(change, p);
    });
    hist = next;
    members = fitMembers(weigh(days, hist, mu0).sws);
    if (!first && change < SETTLED) break;
    first = false;
  }
  const { S, N } = prefix(hist);
  const pi = (S[days.length] + 0.5) / (N[days.length] + 1);
  const { pairN, switches } = weigh(days, hist, mu0);
  return modelOf(members, rateFrom(days, at, hist)(days.length, pi), { days: days.length, switches, rests: rests.length, rate: pi, pairN });
}

// Fitted once a day: the log before `today` is the same sets while he trains (a set logged today makes a new log array, the
// days before are the same objects), so it's kept for them, as learn/session's paceBefore. An edit to a past day, a new day,
// custom-lift facts or a "Not a superset" on a past day refit.
const FITS: { today: string; facts: number; dis: string; log: readonly SetEntry[]; model: SwitchModel }[] = [];
/**
 * His gap model as of `today`: learned from the timed days before it. `dismissed`: each day's "Not a superset" groups, by
 * date (state/notSuperset; never switches, and each counts against his rate).
 */
export function gapModel(entries: readonly SetEntry[], today: string, dismissed: Readonly<Record<string, string[][]>> = {}): SwitchModel {
  const log = logBefore(entries, today), facts = liftFactsVersion();
  const dis = JSON.stringify(Object.keys(dismissed).filter((d) => d < today && dismissed[d].length).sort().map((d) => [d, dismissed[d]]));
  for (const f of FITS) {
    if (f.today !== today || f.facts !== facts || f.dis !== dis || f.log.length !== log.length) continue;
    let same = true;
    for (let i = 0; same && i < log.length; i++) same = f.log[i] === log[i];
    if (same) return f.model;
  }
  const model = fit(log, today, dismissed);
  FITS.unshift({ today, facts, dis, log: [...log], model });
  if (FITS.length > 4) FITS.pop();
  return model;
}

/** A log's last date: a whole log is read with the model as of it (its last day judged on the days before, as Today was). */
export function lastDate(entries: readonly SetEntry[]): string {
  let d = '';
  for (const e of entries) if (e.date > d) d = e.date;
  return d;
}
