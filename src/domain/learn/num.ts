// Small numeric helpers for the learning core: the normal distribution, symmetric solves and a seeded random stream.
// No data and no rules here, only arithmetic.

const SQRT2PI = Math.sqrt(2 * Math.PI);
export const normPdf = (x: number): number => Math.exp(-0.5 * x * x) / SQRT2PI;

/** Φ(x), the standard normal CDF (Abramowitz & Stegun 7.1.26 via erf; |error| < 1.5e-7). */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** The inverse Mills ratio φ(a)/(1 − Φ(a)): how far a normal truncated below at `a` (in SDs) sits above its mean. */
export function mills(a: number): number {
  if (a > 5) return a + 1 / a; // asymptotic: the tail ratio, where 1 − Φ underflows
  const tail = 1 - normCdf(a);
  return tail < 1e-300 ? a : normPdf(a) / tail;
}

/**
 * The mean and variance of N(mu, s²) truncated below at `lo`: a lower bound on a quantity known only as a normal guess.
 * The Tobit step for a set that stopped at its target (it could have done more, never less).
 */
export function truncBelow(mu: number, s: number, lo: number): { mean: number; v: number } {
  if (!(s > 0)) return { mean: Math.max(mu, lo), v: 0 };
  const a = (lo - mu) / s;
  if (a < -8) return { mean: mu, v: s * s };
  const l = mills(a);
  return { mean: mu + s * l, v: s * s * Math.max(1e-6, 1 - l * (l - a)) };
}

/** Cholesky of a symmetric positive-definite n×n matrix (row-major, length n²), in place below the diagonal; false if not PD. */
export function cholesky(a: Float64Array, n: number): boolean {
  for (let j = 0; j < n; j++) {
    let d = a[j * n + j];
    for (let k = 0; k < j; k++) d -= a[j * n + k] * a[j * n + k];
    if (!(d > 0)) return false;
    const ljj = Math.sqrt(d);
    a[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = a[i * n + j];
      for (let k = 0; k < j; k++) s -= a[i * n + k] * a[j * n + k];
      a[i * n + j] = s / ljj;
    }
  }
  return true;
}
/** Solves L y = b (forward) for a Cholesky factor from `cholesky`. */
export function forward(l: Float64Array, n: number, b: ArrayLike<number>): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= l[i * n + k] * y[k];
    y[i] = s / l[i * n + i];
  }
  return y;
}
/** Solves Lᵀ x = y (backward). */
export function backward(l: Float64Array, n: number, y: ArrayLike<number>): Float64Array {
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= l[k * n + i] * x[k];
    x[i] = s / l[i * n + i];
  }
  return x;
}

/** Inverse and log-determinant of a symmetric positive-definite 3×3 (row-major); null if not PD. */
export function inv3(m: ArrayLike<number>): { inv: number[]; logDet: number } | null {
  const [a, b, c, , e, f, , , i] = [m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]];
  const A = e * i - f * f, B = c * f - b * i, C = b * f - c * e;
  const det = a * A + b * B + c * C;
  if (!(det > 0) || !(a > 0)) return null;
  const D = a * i - c * c, E = b * c - a * f, F = a * e - b * b;
  return { inv: [A / det, B / det, C / det, B / det, D / det, E / det, C / det, E / det, F / det], logDet: Math.log(det) };
}

/** True when `xs` is already sorted by `cmp` (a linear check that lets a caller skip the sort). */
export function inOrder<T>(xs: readonly T[], cmp: (a: T, b: T) => number): boolean {
  for (let i = 1; i < xs.length; i++) if (cmp(xs[i - 1], xs[i]) > 0) return false;
  return true;
}

/** A seeded random stream (mulberry32) with normals: synthetic test data that is the same on every run. */
export function rng(seed: number) {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | null = null;
  const normal = (mu = 0, sd = 1): number => {
    if (spare != null) { const z = spare; spare = null; return mu + sd * z; }
    let u = 0, v = 0, r = 0;
    do { u = next() * 2 - 1; v = next() * 2 - 1; r = u * u + v * v; } while (r >= 1 || r === 0);
    const f = Math.sqrt(-2 * Math.log(r) / r);
    spare = v * f;
    return mu + sd * u * f;
  };
  return {
    next, normal,
    uniform: (a: number, b: number) => a + (b - a) * next(),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    lognormal: (logMedian: number, sd: number) => Math.exp(normal(logMedian, sd)),
    shuffle: <T>(xs: T[]): T[] => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; },
  };
}
export type Rng = ReturnType<typeof rng>;

/** ln Γ(x) for x > 0 (Lanczos, g = 7, 9 terms; relative error < 1e-13). */
export function lnGamma(x: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** The continued fraction for the incomplete beta (modified Lentz; Numerical Recipes betacf). */
function betaCf(x: number, a: number, b: number): number {
  const TINY = 1e-300;
  let c = 1, d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return h;
}

/** I_x(a, b), the Beta(a, b) CDF at x: P(p ≤ x) for p ~ Beta(a, b), a, b > 0. */
export function betaCdf(x: number, a: number, b: number): number {
  if (!(x > 0)) return 0;
  if (!(x < 1)) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  return x < (a + 1) / (a + b + 2) ? front * betaCf(x, a, b) / a : 1 - front * betaCf(1 - x, b, a) / b;
}
