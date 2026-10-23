import { describe, expect, it } from 'vitest';
import { fmtPerSide, perSide, PLATE_SIZES, platesOf } from './plates';
import type { Gym } from './equipment';

describe('plates', () => {
  it('splits what is over the 45 lb bar evenly, heaviest plates first', () => {
    expect(perSide(120, 'Smith Flat Press')).toEqual({ side: 37.5, plates: [35, 2.5] });
    expect(fmtPerSide(120, 'Bench Press')).toBe('37.5 a side · 35 + 2.5');
    expect(fmtPerSide(225, 'Barbell Squat')).toBe('90 a side · 45 + 45');
    expect(fmtPerSide(137.5, 'Bench Press')).toBe('46.25 a side'); // no plate makes 1.25: just the side
  });
  it('only for bar lifts with something on the bar', () => {
    expect(perSide(45, 'Bench Press')).toBeNull();
    expect(perSide(120, 'Flat DB Press')).toBeNull();
    expect(perSide(120, 'Machine Chest Press')).toBeNull();
    expect(perSide(95, 'Paused Barbell Row')).toEqual({ side: 25, plates: [25] }); // not in the catalog, but says barbell
  });
  // Round 28 (owner, 2026-10-22): plate sizes are the gym's; 35s by default, for every gym, so a gym without them turns them off.
  it('loads 35s by default, and only the plates the gym has', () => {
    expect(PLATE_SIZES).toEqual([45, 35, 25, 10, 5, 2.5]);
    expect(fmtPerSide(115, 'Smith Incline Press')).toBe('35 a side · 35');
    const gym = (plates?: number[]): Gym => ({ id: 'g', name: 'G', equipment: [], exclude: [], include: [], ...(plates && { plates }) });
    expect(platesOf(gym())).toEqual(PLATE_SIZES);
    expect(platesOf(null)).toEqual(PLATE_SIZES);
    const no35 = platesOf(gym([45, 25, 10, 5, 2.5]));
    expect(fmtPerSide(115, 'Smith Incline Press', no35)).toBe('35 a side · 25 + 10');
    // Heaviest first can miss where another mix makes it: only 45s and 35s, 70 a side is two 35s.
    expect(fmtPerSide(185, 'Bench Press', [45, 35])).toBe('70 a side · 35 + 35');
    expect(fmtPerSide(120, 'Bench Press', [45, 35])).toBe('37.5 a side'); // can't be made: just the side
  });
});
