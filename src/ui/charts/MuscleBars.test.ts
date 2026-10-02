import { describe, expect, it } from 'vitest';
import { paceStatus, weekPace } from './MuscleBars';

describe('paceStatus', () => {
  const wed = weekPace('2026-09-30'); // Wednesday
  const sun = weekPace('2026-10-04');
  it('Wednesday with 4 of 10–20 sets is on pace', () => expect(paceStatus(4, [10, 20], wed)).toBe('pace'));
  it('Wednesday with 1 set is under', () => expect(paceStatus(1, [10, 20], wed)).toBe('under'));
  it('Sunday with 9 of 10–20 is under', () => expect(paceStatus(9, [10, 20], sun)).toBe('under'));
  it('12 is on target whatever the day', () => expect(paceStatus(12, [10, 20], wed)).toBe('on'));
  it('over stays over', () => expect(paceStatus(25, [10, 20], wed)).toBe('over'));
  it('no pace means the plain status', () => expect(paceStatus(4, [10, 20])).toBe('under'));
  it('pace grows through the week and never exceeds 1', () => {
    expect(weekPace('2026-09-28')).toBeLessThan(wed);
    expect(sun).toBeLessThan(1);
  });
});
