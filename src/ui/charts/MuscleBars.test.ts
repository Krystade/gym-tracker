import { describe, expect, it } from 'vitest';
import { sessionsLeft } from '../../domain/analytics';
import { paceStatus, paceOrder } from './MuscleBars';

// The week's own cases, day by day, are domain/analytics' (weekStatus); here, that the bars read them.
describe('paceStatus', () => {
  const wed = sessionsLeft('2026-09-30', 2, 1, false); // Wednesday, one of two sessions done: one left
  const sunDone = sessionsLeft('2026-10-04', 2, 2, true); // Sunday, trained today: none left
  it('Wednesday with 1 of 10–20 sets is on pace: one session can add the 9', () => expect(paceStatus(1, [10, 20], wed)).toBe('pace'));
  it('Wednesday with 0 of 12–20 is under: one session can’t add 12', () => expect(paceStatus(0, [12, 20], wed)).toBe('under'));
  it('Sunday, the week done, with 8 of 10–20 is under', () => expect(paceStatus(8, [10, 20], sunDone)).toBe('under'));
  it('Monday asks nothing of the week yet: 0 sets is on pace', () => expect(paceStatus(0, [10, 20], sessionsLeft('2026-09-28', 2, 0, false))).toBe('pace'));
  it('12 is on target whatever the day', () => expect(paceStatus(12, [10, 20], wed)).toBe('on'));
  it('over stays over', () => expect(paceStatus(25, [10, 20], wed)).toBe('over'));
  it('no sessions left given means the plain status', () => expect(paceStatus(4, [10, 20])).toBe('under'));
});

describe('paceOrder', () => {
  it('puts muscles behind first, then on pace, on target and over, keeping order within each', () => {
    const sets = { Chest: 12, Lats: 1, Quads: 4, Biceps: 25, Glutes: 0 } as Record<string, number>;
    // One session left: Glutes' 12 is out of its reach, Lats' 11 and Quads' 8 aren't.
    expect(paceOrder(['Chest', 'Lats', 'Quads', 'Biceps', 'Glutes'], (m) => paceStatus(sets[m], [12, 20], 1)))
      .toEqual(['Glutes', 'Lats', 'Quads', 'Chest', 'Biceps']);
  });
});
