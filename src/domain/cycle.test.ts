import { describe, expect, it } from 'vitest';
import { cycleLength, cycleStarts, mergeCycle, predictPhase, type CyclePhase } from './cycle';
import { addDays } from './analytics';

// Synthetic logs only: a period logged on `len` days from each start, nothing else.
const periods = (starts: string[], len = 5): Record<string, CyclePhase> =>
  Object.fromEntries(starts.flatMap((s) => Array.from({ length: len }, (_, i) => [addDays(s, i), 'period' as CyclePhase])));
/** Three starts 28 days apart: two counted lengths of 28, the last start on 2026-03-01. */
const regular = () => periods(['2026-01-04', '2026-02-01', '2026-03-01']);

describe('cycleStarts', () => {
  it('starts a cycle on a period day with no period day in the 10 days before it', () => {
    expect(cycleStarts(regular())).toEqual(['2026-01-04', '2026-02-01', '2026-03-01']);
  });
  it('a gap of 10 or more days starts a new cycle; a shorter one continues the same', () => {
    // 2026-01-01 then 2026-01-11: 9 clear days between, so the 10 days before the 11th hold the 1st.
    expect(cycleStarts({ '2026-01-01': 'period', '2026-01-11': 'period' })).toEqual(['2026-01-01']);
    expect(cycleStarts({ '2026-01-01': 'period', '2026-01-12': 'period' })).toEqual(['2026-01-01', '2026-01-12']);
  });
  it('ignores the other phases', () => {
    expect(cycleStarts({ '2026-01-01': 'luteal', '2026-01-05': 'period', '2026-01-06': 'follicular' })).toEqual(['2026-01-05']);
  });
});

describe('cycleLength', () => {
  it('is the median of the counted gaps', () => {
    expect(cycleLength(regular())).toBe(28);
    expect(cycleLength(periods(['2026-01-01', '2026-01-27', '2026-02-26', '2026-03-26']))).toBe(28); // 26, 30, 28
  });
  it('drops gaps outside 21 to 45 days', () => {
    // 50 (a missed log), then 28 and 30: still two counted, median 29.
    expect(cycleLength(periods(['2026-01-01', '2026-02-20', '2026-03-20', '2026-04-19']))).toBe(29);
    // 20, then 28: only one counted.
    expect(cycleLength(periods(['2026-01-01', '2026-01-21', '2026-02-18']))).toBeNull();
    // 46 and 28: only one counted.
    expect(cycleLength(periods(['2026-01-01', '2026-02-16', '2026-03-16']))).toBeNull();
    // 21 and 45 are both inside.
    expect(cycleLength(periods(['2026-01-01', '2026-01-22', '2026-03-08']))).toBe(33);
  });
  it('needs at least 2 counted lengths', () => {
    expect(cycleLength({})).toBeNull();
    expect(cycleLength(periods(['2026-01-04']))).toBeNull();
    expect(cycleLength(periods(['2026-01-04', '2026-02-01']))).toBeNull();
  });
});

describe('predictPhase', () => {
  const day = (n: number) => addDays('2026-03-01', n - 1); // cycle day n of the last cycle
  it('makes no prediction with fewer than 2 lengths', () => {
    expect(predictPhase(periods(['2026-02-01', '2026-03-01']), day(8))).toBeNull();
  });
  it('splits L = 28 at the textbook boundaries', () => {
    const d = regular();
    expect(predictPhase(d, day(1))).toBe('period');
    expect(predictPhase(d, day(5))).toBe('period');
    expect(predictPhase(d, day(6))).toBe('follicular');
    expect(predictPhase(d, day(11))).toBe('follicular');
    expect(predictPhase(d, day(12))).toBe('ovulation');
    expect(predictPhase(d, day(16))).toBe('ovulation');
    expect(predictPhase(d, day(17))).toBe('luteal');
    expect(predictPhase(d, day(28))).toBe('luteal');
  });
  it('makes no prediction past L + 10 (a late or missed start)', () => {
    expect(predictPhase(regular(), day(38))).toBe('luteal');
    expect(predictPhase(regular(), day(39))).toBeNull();
  });
  it('counts from the last start on or before the day, not one logged after it', () => {
    const d = regular();
    expect(predictPhase(d, '2026-02-10')).toBe('follicular'); // day 10 of February's cycle
    expect(predictPhase(d, '2026-01-01')).toBeNull(); // before any start
  });
});

describe('mergeCycle', () => {
  it('takes the cloud days the phone lacks, and the phone wins a date both have', () => {
    const m = mergeCycle([{ date: '2026-01-02', phase: 'luteal' }], { '2026-01-01': 'period', '2026-01-02': 'period' });
    expect(m.days).toEqual({ '2026-01-01': 'period', '2026-01-02': 'luteal' });
    expect(m.pull).toEqual([{ date: '2026-01-01', phase: 'period' }]);
    expect(m.changed).toBe(true);
  });
  it('a day cleared on the phone is cleared in the cloud', () => {
    const m = mergeCycle([{ date: '2026-01-01', phase: null }], { '2026-01-01': 'period' });
    expect(m.days).toEqual({});
    expect(m.changed).toBe(true);
  });
  it('writes nothing when the cloud already matches', () => {
    expect(mergeCycle([{ date: '2026-01-01', phase: 'period' }], { '2026-01-01': 'period' }).changed).toBe(false);
    expect(mergeCycle([{ date: '2026-01-01', phase: null }], {}).changed).toBe(false);
  });
});
