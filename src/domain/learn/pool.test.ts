import { describe, expect, it } from 'vitest';
import { rng } from './num';
import { pool } from './pool';

// Synthetic lifts in families: θ = μ + p + f(family) + l, each seen with its own sampling variance (thin lifts noisy).
function world(seed: number, o: { tF: number; tL: number; n: number }) {
  const r = rng(seed);
  const fam = (i: number) => i % 3;
  const f = [0, 1, 2].map(() => r.normal(0, o.tF));
  const p = r.normal(0, 0.2);
  const items = Array.from({ length: o.n }, (_, i) => {
    const truth = 1 + p + f[fam(i)] + r.normal(0, o.tL);
    const v = (r.next() < 0.5 ? 0.6 : 0.08) ** 2; // half the lifts thin, half well measured
    return { key: `l${i}`, truth, est: truth + r.normal(0, Math.sqrt(v)), v };
  });
  const sim = (a: string, b: string) => (a === b ? 1 : fam(+a.slice(1)) === fam(+b.slice(1)) ? 0.8 : 0);
  return { items, sim };
}
const rmse = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / xs.length);

describe('learn/pool', () => {
  it('EB beats no pooling and stays within 2× of complete pooling, across spreads', () => {
    for (const [tF, tL] of [[0.1, 0.05], [0.3, 0.15], [0.05, 0.3]]) {
      const eNone: number[] = [], eEb: number[] = [], eAll: number[] = [];
      for (let seed = 1; seed <= 40; seed++) {
        const { items, sim } = world(seed, { tF, tL, n: 12 });
        const p = pool(items, sim, { mean: 1, personSd: 0.2, liftSd: 0.3 });
        const w = items.reduce((a, x) => a + 1 / x.v, 0), m = items.reduce((a, x) => a + x.est / x.v, 0) / w;
        for (const x of items) { eNone.push(x.est - x.truth); eEb.push(p.lift(x.key).mean - x.truth); eAll.push(m - x.truth); }
      }
      expect(rmse(eEb)).toBeLessThan(rmse(eNone));
      expect(rmse(eEb)).toBeLessThan(2 * rmse(eAll));
    }
  });

  it('a thin lift sits near its family; a well-measured one on its own data; a new one gets the family with a family-sized SD', () => {
    const items = [
      { key: 'a', est: 2.0, v: 0.0004 }, { key: 'b', est: 2.1, v: 0.0004 }, { key: 'c', est: 1.9, v: 0.0004 },
      { key: 'thin', est: 0.5, v: 1 }, { key: 'own', est: 1.2, v: 0.0001 },
      { key: 'x', est: 0.0, v: 0.0004 }, { key: 'y', est: 0.1, v: 0.0004 },
    ];
    const famOf: Record<string, number> = { a: 0, b: 0, c: 0, thin: 0, own: 2, x: 1, y: 1, fresh: 0 };
    const sim = (p: string, q: string) => (p === q ? 1 : famOf[p] === famOf[q] ? 0.9 : 0);
    const p = pool(items, sim, { mean: 1, personSd: 0.3, liftSd: 0.5 });
    expect(p.lift('thin').mean).toBeGreaterThan(1.5);
    expect(p.lift('own').mean).toBeCloseTo(1.2, 1);
    const fresh = p.lift('fresh');
    expect(fresh.mean).toBeGreaterThan(1.5);
    expect(fresh.sd).toBeGreaterThan(p.lift('a').sd * 5);
  });

  it('does not claim lifts are identical when the data show no spread (posterior SD stays above zero)', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ key: `l${i}`, est: 1, v: 0.25 }));
    const p = pool(items, (a, b) => (a === b ? 1 : 0), { mean: 1, personSd: 0.01, liftSd: 0.5 });
    expect(p.tF2 + p.tL2).toBeGreaterThan(0.25 * 0.5 ** 2 * 0.5);
    expect(p.lift('l0').sd).toBeGreaterThan(0.1);
  });

  it('with no data returns the prior', () => {
    const p = pool([], () => 0, { mean: 30, personSd: 2, liftSd: 3 });
    expect(p.lift('any').mean).toBe(30);
    expect(p.lift('any').sd).toBeCloseTo(Math.sqrt(4 + 9), 6);
  });
});

describe('learn/pool combo: a weighted mean of lifts, their shared parts counted once', () => {
  /** Solves A x = b (small, dense, Gaussian elimination with partial pivoting). */
  const solve = (A: number[][], b: number[]) => {
    const n = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      const p = M.reduce((best, r, i) => (i >= c && Math.abs(r[c]) > Math.abs(M[best][c]) ? i : best), c);
      [M[c], M[p]] = [M[p], M[c]];
      for (let i = c + 1; i < n; i++) { const f = M[i][c] / M[c][c]; for (let j = c; j <= n; j++) M[i][j] -= f * M[c][j]; }
    }
    const x = Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
    return x;
  };
  it('equals the brute-force Gaussian posterior of Σ w·θ / Σ w (the joint over every lift), and a single lift is lift()', () => {
    const { items, sim } = world(7, { tF: 0.2, tL: 0.1, n: 6 });
    const prior = { mean: 1, personSd: 0.2, liftSd: 0.3 };
    const p = pool(items, sim, prior);
    const keys = items.map((x) => x.key), n = keys.length;
    const C = keys.map((a) => keys.map((b) => prior.personSd ** 2 + p.tF2 * (a === b ? 1 : sim(a, b)) + (a === b ? p.tL2 : 0)));
    const S = C.map((r, i) => r.map((c, j) => c + (i === j ? items[i].v : 0)));
    const w = [3, 0, 1, 0, 0, 2], tot = 6;
    const cw = keys.map((_, i) => C.reduce((a, r, l) => a + (w[l] / tot) * r[i], 0)); // Cov(Σ u θ, e_i)
    const mean = prior.mean + solve(S, items.map((x) => x.est - prior.mean)).reduce((a, z, i) => a + z * cw[i], 0);
    const pv = w.reduce((a, wl, l) => a + w.reduce((b, wk, k) => b + (wl / tot) * (wk / tot) * C[l][k], 0), 0);
    const v = pv - solve(S, cw).reduce((a, z, i) => a + z * cw[i], 0);
    const c = p.combo(keys.map((key, i) => ({ key, w: w[i] })));
    expect(c.mean).toBeCloseTo(mean, 10);
    expect(c.sd).toBeCloseTo(Math.sqrt(v), 10);
    expect(c.prior).toBeCloseTo(pv, 12);
    expect(n).toBe(6);
    const one = p.combo([{ key: 'l2', w: 5 }]);
    expect(one.mean).toBeCloseTo(p.lift('l2').mean, 12);
    expect(one.sd).toBeCloseTo(p.lift('l2').sd, 12);
  });
});
