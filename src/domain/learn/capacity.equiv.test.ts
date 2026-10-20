import { describe, expect, it } from 'vitest';
import type { SetEntry } from '../types';
import { fitCore } from './capacity';
import { GOLDEN } from './capacity.golden';
import { digest, SCENARIOS } from './equiv.sample';
import { paceOf } from './pace';

// The session-block fit (stage 1b) against the stage-1 implementation it replaced (e9402be): the same numbers, to 1e-9 relative,
// on every synthetic scenario, whether the fit starts cold or reuses cached sessions and rows from earlier fits.

/** Index and size of the largest relative difference (|a − b| / max(1, |a|, |b|)); a length mismatch is Infinity. */
function worst(a: number[], b: number[]): { at: number; d: number } {
  if (a.length !== b.length) return { at: -1, d: Infinity };
  let at = -1, d = 0;
  a.forEach((x, i) => {
    const e = Math.abs(x - b[i]) / Math.max(1, Math.abs(x), Math.abs(b[i]));
    if (!(e <= d)) { at = i; d = Number.isNaN(e) ? Infinity : e; }
  });
  return { at, d };
}
const cold = (es: readonly SetEntry[]) => es.map((e) => structuredClone(e));
const check = (name: string, log: readonly SetEntry[], censor?: boolean) => {
  const w = worst(digest(fitCore(log, { censor }), paceOf(log)), GOLDEN[name]);
  expect(w.d, `${name}: digest[${w.at}]`).toBeLessThanOrEqual(1e-9);
};

describe('learn/capacity: the same fit as stage 1 (e9402be)', () => {
  // First in the file, so the kept rows start empty: a log three times longer with the same start must grow them in place.
  it('the kept rows grow, keeping the sessions they already hold', () => {
    const { log } = SCENARIOS.fiveYears();
    fitCore(log.slice(0, 2000));
    const longer = log.slice(0, 6000);
    const numbers = (es: readonly SetEntry[]) => digest(fitCore(es), null);
    const grown = numbers(longer);
    expect(worst(grown, numbers(cold(longer))).d).toBe(0);
    check('fiveYears', log);
  });

  for (const [name, make] of Object.entries(SCENARIOS)) {
    it(`${name}: cold, and after cached fits of an earlier log and an edited one`, () => {
      const { log, censor } = make();
      check(name, cold(log), censor);
      // Warm every cache with the log minus its last sets, and with an old set edited (a new object), then fit the log itself:
      // its sessions come from the cache, and the rows are copied only from the first session that differs.
      const at = log.length >> 2;
      fitCore(log.slice(0, -15), { censor });
      fitCore(log.map((e, i) => (i === at ? { ...e, reps: (e.reps ?? 0) + 2 } : e)), { censor });
      check(name, log, censor);
      check(name, [...log], censor);
    });
  }

  it('two logs fitted in turn (two profiles) each keep their own numbers', () => {
    const a = SCENARIOS.plain().log, b = SCENARIOS.backoff().log;
    check('plain', a); check('backoff', b); check('plain', a); check('backoff', [...b]);
  });

  it('the golden table is not empty and every value is finite (a broken digest cannot pass)', () => {
    expect(Object.keys(GOLDEN).sort()).toEqual(Object.keys(SCENARIOS).sort());
    for (const xs of Object.values(GOLDEN)) { expect(xs.length).toBeGreaterThan(150); expect(xs.every(Number.isFinite)).toBe(true); }
  });
});
