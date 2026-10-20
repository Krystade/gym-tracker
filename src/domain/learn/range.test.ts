import { describe, expect, it } from 'vitest';
import { envelope, fitRange } from './range';

describe('learn/range (item 03)', () => {
  it('leaves a range that absorbs the step', () => {
    expect(fitRange('Leg Press', { repMin: 8, repMax: 12 }, 2)).toEqual({ repMin: 8, repMax: 12, how: 'fits' });
    expect(fitRange('Cable Curl', { repMin: 10, repMax: 15 }, 5)).toMatchObject({ how: 'fits' }); // lands exactly on 10
  });
  it('raises the top first, so the first heavier session lands inside', () => {
    expect(fitRange('Incline DB Curl', { repMin: 10, repMax: 15 }, 6.4)).toEqual({ repMin: 10, repMax: 17, how: 'top' });
    expect(fitRange('Machine Row', { repMin: 8, repMax: 12 }, 6)).toEqual({ repMin: 8, repMax: 14, how: 'top' });
  });
  it('lowers the bottom when the top would leave the evidence envelope', () => {
    // A barbell compound caps at 15: 10 + 6 = 16 won't do; 12 − 6 = 6 is inside its floor of 5.
    expect(fitRange('Bench Press', { repMin: 10, repMax: 12 }, 6)).toEqual({ repMin: 6, repMax: 12, how: 'bottom' });
  });
  it('says the step is too big when no range in the envelope absorbs it', () => {
    expect(fitRange('Bench Press', { repMin: 8, repMax: 12 }, 9)).toEqual({ repMin: 8, repMax: 12, how: 'too-big' });
  });
  it('never leaves the envelope of the lift’s class', () => {
    expect(envelope('Bench Press')).toEqual({ floor: 5, cap: 15 });
    expect(envelope('Leg Press')).toEqual({ floor: 6, cap: 20 });
    expect(envelope('DB Lateral Raise')).toEqual({ floor: 8, cap: 25 });
    for (const lift of ['Bench Press', 'Leg Press', 'DB Lateral Raise', 'Smith Squat', 'Cable Curl']) {
      const { floor, cap } = envelope(lift);
      for (let d = 0; d <= 20; d += 0.5) for (const [lo, hi] of [[8, 12], [10, 15], [6, 10]]) {
        const r = fitRange(lift, { repMin: lo, repMax: hi }, d);
        if (r.how === 'top') expect(r.repMax).toBeLessThanOrEqual(cap);
        if (r.how === 'bottom') expect(r.repMin).toBeGreaterThanOrEqual(floor);
        if (r.how !== 'too-big') expect(r.repMax - d).toBeGreaterThanOrEqual(r.repMin);
      }
    }
  });
});
