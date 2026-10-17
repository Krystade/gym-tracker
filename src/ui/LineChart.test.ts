import { describe, expect, it } from 'vitest';
import { yAxis } from './LineChart';

const ticks = (ys: number[], tenths = false) => { const a = yAxis(ys, tenths); return [a.y0, (a.y0 + a.y1) / 2, a.y1].map(a.fmt); };

describe('yAxis', () => {
  it('shows distances under 10 mi in tenths, every tick different', () => {
    expect(ticks([1.15, 1.27], true)).toEqual(['1.1', '1.2', '1.3']);
    expect(ticks([1.25, 1.3], true)).toEqual(['1.2', '1.3', '1.4']);
    expect(ticks([2, 2], true)).toEqual(['1.9', '2.0', '2.1']);
    expect(ticks([1.15, 1.35], true)).toEqual(['1.1', '1.3', '1.5']); // the middle tick lands on a step
  });
  it('goes to whole numbers from 10 mi, and for pounds', () => {
    expect(new Set(ticks([9.8, 10.4], true)).size).toBe(3);
    expect(ticks([225.4, 226.1])).toEqual(['225', '226', '227']);
    expect(ticks([100, 100])).toEqual(['99', '100', '101']);
  });
  it('keeps a wide range and never dips below 0 for positive values', () => {
    const a = yAxis([200, 260], false);
    expect(a.y0).toBeLessThanOrEqual(200);
    expect(a.y1).toBeGreaterThanOrEqual(260);
    expect(yAxis([0.1, 0.2], true).y0).toBe(0);
    expect(yAxis([0, 0], false).y0).toBe(0);
  });
});
