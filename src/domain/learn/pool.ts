import { backward, cholesky, forward } from './num';

// Partial pooling across the learning core's layers (00-core §1.1): population prior → person → family → lift.
//
// One quantity θ (a lift's fatigue slope, its reps–load curve, its usual rest…) is modelled for every lift as
//   θ_L = μ0 + p + f_L + l_L
// where μ0 is the population value from the literature, p ~ N(0, sP²) is how far this person sits from the population
// (between-person SD, from the literature), f ~ N(0, tF²·K) is shared by similar lifts (K: learn/tags similarity, a valid
// correlation), and l_L ~ N(0, tL²) is the lift's own. Each lift with data gives an estimate e_L with sampling variance v_L.
// The posterior is Gaussian-process regression with that kernel: a lift with 3 sets sits near its family, one with 300 sets
// on its own data, and a lift never done gets its family's value with a family-sized SD. tF² and tL² are estimated from the
// estimates themselves (weighted method of moments: the spread of e around the person mean beyond sampling noise, and how
// much similar lifts move together), shrunk toward a prior total `liftSd²` with the weight of two lifts.

export interface PoolPrior {
  /** μ0: the population value, or the person's own value when another fit already estimates it. */
  mean: number;
  /** sP: between-person SD around μ0 (or the SD of the person value when it is supplied as `mean`). */
  personSd: number;
  /** Prior scale of the spread between one person's lifts; a prior only, shrunk away by the data. */
  liftSd: number;
}
export interface PoolItem { key: string; est: number; v: number }
export interface Posterior { mean: number; sd: number }
export interface Pooled {
  person: Posterior;
  /** Estimated family (shared) and lift-own variance components. */
  tF2: number; tL2: number;
  /** Posterior of lift `key`, given its similarity to each pooled lift (`sim(key, other)`); for any lift, with data or not. */
  lift(key: string): Posterior;
  /** Its family's value: person + shared part, without the lift's own deviation or data. */
  family(key: string): Posterior;
  /**
   * A weighted mean of lifts' values, Σ w·θ / Σ w (e.g. a muscle's, its lifts weighted by their share of its sets): the lifts'
   * shared person and family parts counted once, not as if independent. `prior`: its variance before the data (for a test of 0).
   */
  combo(ws: readonly { key: string; w: number }[]): Posterior & { prior: number };
  n: number;
}

const PRIOR_WEIGHT = 2; // the prior total counts as two lifts' worth of evidence

/**
 * Variance components by weighted moments, each shrunk toward the prior with the weight of PRIOR_WEIGHT lifts:
 *  - the total T = tF² + tL² from the diagonal moments d_i² − v_i ≈ T (the spread beyond sampling noise);
 *  - the family share φ = tF²/T from the off-diagonal moments d_i·d_j ≈ φ·T·K_ij (how much similar lifts move together).
 * A plug-in T of 0 would claim every lift is identical and give a posterior SD near 0; the prior weight keeps the claim honest.
 */
function components(d: number[], v: number[], K: (i: number, j: number) => number, prior: number): [number, number] {
  const n = d.length;
  let T = prior;
  for (let round = 0; round < 3; round++) {
    let sw = 0, sm = 0;
    for (let i = 0; i < n; i++) { const w = 1 / (v[i] + T) ** 2; sw += w; sm += w * (d[i] * d[i] - v[i]); }
    const That = sw > 0 ? Math.max(0, sm / sw) : prior;
    T = (PRIOR_WEIGHT * prior + n * That) / (PRIOR_WEIGHT + n);
  }
  let num = 0, den = 0, m = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const k = K(i, j);
    if (k <= 0) continue;
    const w = 1 / ((v[i] + T) * (v[j] + T));
    num += w * k * d[i] * d[j]; den += w * k * k * T; m++;
  }
  const phiHat = den > 0 ? Math.max(0, Math.min(1, num / den)) : 0.5;
  const pairs = Math.min(m, n); // pairs are not independent: count them as at most n lifts' worth
  const phi = (PRIOR_WEIGHT * 0.5 + pairs * phiHat) / (PRIOR_WEIGHT + pairs);
  return [phi * T, (1 - phi) * T];
}

/**
 * Pools per-lift estimates (see the model above). `sim(a, b)` is the similarity of two lifts by key (1 for the same lift).
 * Items with non-finite estimates or variances are left out.
 */
export function pool(items: readonly PoolItem[], sim: (a: string, b: string) => number, prior: PoolPrior): Pooled {
  const data = items.filter((x) => Number.isFinite(x.est) && Number.isFinite(x.v) && x.v > 0);
  const n = data.length;
  const sP2 = prior.personSd ** 2;
  const keys = data.map((x) => x.key);
  const Kc = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { const k = i === j ? 1 : Math.max(0, sim(keys[i], keys[j])); Kc[i * n + j] = k; Kc[j * n + i] = k; }
  // Person mean for the moments: precision-weighted around μ0 with the person prior.
  const T0 = prior.liftSd ** 2;
  let num = prior.mean / Math.max(sP2, 1e-9), den = 1 / Math.max(sP2, 1e-9);
  for (const x of data) { num += x.est / (x.v + T0); den += 1 / (x.v + T0); }
  const m = num / den;
  const [tF2, tL2] = n ? components(data.map((x) => x.est - m), data.map((x) => x.v), (i, j) => Kc[i * n + j], T0) : [T0 / 2, T0 / 2];

  // GP posterior: Σ = sP²·J + tF²·K + tL²·I + diag(v).
  const S = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) S[i * n + j] = sP2 + tF2 * Kc[i * n + j] + (i === j ? tL2 + data[i].v : 0);
  let ok = cholesky(S, n);
  for (let jitter = 1e-9; !ok && jitter < 1; jitter *= 100) {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) S[i * n + j] = sP2 + tF2 * Kc[i * n + j] + (i === j ? tL2 + data[i].v + jitter : 0);
    ok = cholesky(S, n);
  }
  const alpha = n && ok ? backward(S, n, forward(S, n, data.map((x) => x.est - prior.mean))) : new Float64Array(0);
  const index = new Map(keys.map((k, i) => [k, i]));
  const post = (c: Float64Array, prior0: number): Posterior => {
    let mean = prior.mean;
    for (let i = 0; i < n; i++) mean += c[i] * alpha[i];
    const y = n ? forward(S, n, c) : new Float64Array(0);
    let q = 0;
    for (let i = 0; i < n; i++) q += y[i] * y[i];
    return { mean, sd: Math.sqrt(Math.max(1e-12, prior0 - q)) };
  };
  const row = (key: string, own: boolean): Float64Array => {
    const c = new Float64Array(n);
    const self = index.get(key);
    for (let i = 0; i < n; i++) c[i] = sP2 + tF2 * (i === self ? 1 : Math.max(0, sim(key, keys[i]))) + (own && i === self ? tL2 : 0);
    return c;
  };
  const person = post(new Float64Array(n).fill(sP2), sP2);
  const combo = (ws: readonly { key: string; w: number }[]) => {
    const total = ws.reduce((a, x) => a + x.w, 0);
    const u = ws.filter((x) => x.w > 0).map((x) => ({ key: x.key, w: x.w / total }));
    // Cov(Σ u·θ, e_i) = Σ u·Cov(θ_l, θ_i); Var(Σ u·θ) = Σ Σ u·u'·(sP² + tF²·K + tL²·[same lift]).
    const c = new Float64Array(n);
    for (const x of u) { const r = row(x.key, true); for (let i = 0; i < n; i++) c[i] += x.w * r[i]; }
    let prior0 = 0;
    for (const a of u) for (const b of u) prior0 += a.w * b.w * (sP2 + (a.key === b.key ? tF2 + tL2 : tF2 * Math.max(0, sim(a.key, b.key))));
    return { ...post(c, prior0), prior: prior0 };
  };
  return {
    person, tF2, tL2, n, combo,
    lift: (key) => post(row(key, true), sP2 + tF2 + tL2),
    family: (key) => post(row(key, false), sP2 + tF2),
  };
}
