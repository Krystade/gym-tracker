import { describe, expect, it } from 'vitest';
import { fmtPerSide, perSide } from './plates';

describe('plates', () => {
  it('splits what is over the 45 lb bar evenly, heaviest plates first', () => {
    expect(perSide(120, 'Smith Flat Press')).toEqual({ side: 37.5, plates: [25, 10, 2.5] });
    expect(fmtPerSide(120, 'Bench Press')).toBe('37.5 a side · 25 + 10 + 2.5');
    expect(fmtPerSide(225, 'Barbell Squat')).toBe('90 a side · 45 + 45');
    expect(fmtPerSide(137.5, 'Bench Press')).toBe('46.25 a side'); // no plate makes 1.25: just the side
  });
  it('only for bar lifts with something on the bar', () => {
    expect(perSide(45, 'Bench Press')).toBeNull();
    expect(perSide(120, 'Flat DB Press')).toBeNull();
    expect(perSide(120, 'Machine Chest Press')).toBeNull();
    expect(perSide(95, 'Paused Barbell Row')).toEqual({ side: 25, plates: [25] }); // not in the catalog, but says barbell
  });
});
