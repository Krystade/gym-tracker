import { describe, expect, it } from 'vitest';
import { betaCdf, lnGamma } from './num';

describe('lnGamma and betaCdf', () => {
  it('ln Γ at known points', () => {
    expect(lnGamma(1)).toBeCloseTo(0, 12);
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
    expect(lnGamma(0.01)).toBeCloseTo(4.599479878042022, 10);
  });
  it('the Beta CDF at closed forms: uniform, x^a, Beta(2, 3), the arcsine law, and small shapes', () => {
    for (const x of [0.01, 0.3, 0.77]) {
      expect(betaCdf(x, 1, 1)).toBeCloseTo(x, 12);
      expect(betaCdf(x, 3.5, 1)).toBeCloseTo(x ** 3.5, 12);
      expect(betaCdf(x, 0.5, 0.5)).toBeCloseTo((2 / Math.PI) * Math.asin(Math.sqrt(x)), 10);
    }
    expect(betaCdf(0.5, 2, 3)).toBeCloseTo(0.6875, 12);
    expect(betaCdf(0, 2, 3)).toBe(0);
    expect(betaCdf(1, 2, 3)).toBe(1);
    // A tiny shape puts nearly all its mass at 0: P(p ≤ 0.05) for Beta(0.02, 2) is 1 − (most of nothing).
    expect(betaCdf(0.05, 0.02, 2)).toBeGreaterThan(0.94);
    expect(betaCdf(0.05, 0.02, 2)).toBeLessThan(1);
    // Symmetric: I_x(a, b) = 1 − I_{1−x}(b, a).
    expect(betaCdf(0.2, 3.3, 7.1) + betaCdf(0.8, 7.1, 3.3)).toBeCloseTo(1, 12);
  });
});
