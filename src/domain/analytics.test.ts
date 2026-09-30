import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { addDays, calendarDays, streak, weekStart, weeklyMuscleSets, weeklySummary } from './analytics';

let seq = 0;
const s = (date: string, exercise: string, weight: number, reps: number | null, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `t${seq}`, date, seq: seq++, exercise, setNo: 1, weight, reps, flags: [], source: 't', ...over,
});

describe('weeks', () => {
  it('starts weeks on Monday, including Sunday sessions in the previous week', () => {
    expect(weekStart('2026-09-28')).toBe('2026-09-28'); // Monday
    expect(weekStart('2026-10-04')).toBe('2026-09-28'); // Sunday
    expect(weekStart('2026-01-01')).toBe('2025-12-29'); // across a year
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('weeklyMuscleSets', () => {
  it('counts direct 1 and indirect 0.5, skips warmups, lists unmapped names', () => {
    const e = [
      s('2026-09-29', 'Cable Curl', 60, 12), s('2026-09-29', 'Cable Curl', 60, 12, { flags: ['warmup'] }),
      s('2026-09-30', 'Lat Pulldown', 100, 10), s('2026-09-30', 'Mystery Move', 10, 10),
      s('2026-10-06', 'Cable Curl', 60, 12),
    ];
    const r = weeklyMuscleSets(e, '2026-09-28');
    expect(r.sets.Biceps).toBe(1.5);
    expect(r.sets.Lats).toBe(1);
    expect(r.sets.Chest).toBe(0);
    expect(r.unmapped).toEqual(['Mystery Move']);
  });
  it('caps a muscle at 11 fractional sets per session', () => {
    const e = Array.from({ length: 14 }, () => s('2026-09-29', 'Cable Curl', 60, 12));
    expect(weeklyMuscleSets(e, '2026-09-28').sets.Biceps).toBe(11);
  });
});

describe('summary, streak, calendar', () => {
  const e = [
    s('2026-09-01', 'Bench Press', 100, 10), s('2026-09-03', 'Bench Press', 100, 10), // week of 8/31: 2 sessions
    s('2026-09-08', 'Bench Press', 100, 10), s('2026-09-10', 'Pull-up', 0, 8, { flags: ['bodyweight'] }), // 9/7: 2
    // 9/14: none
    s('2026-09-22', 'Bench Press', 100, 10), s('2026-09-24', 'Bench Press', 105, 8), // 9/21: 2
    s('2026-09-29', 'Bench Press', 100, 10), // 9/28 (current): 1
  ];
  it('fills empty weeks and sums tonnage without bodyweight', () => {
    const w = weeklySummary(e, 5, '2026-09-30');
    expect(w.map((x) => [x.week, x.sessions])).toEqual([['2026-08-31', 2], ['2026-09-07', 2], ['2026-09-14', 0], ['2026-09-21', 2], ['2026-09-28', 1]]);
    expect(w[1].tonnage).toBe(1000);
    expect(w[3].tonnage).toBe(1840);
  });
  it('counts a streak of weeks meeting the goal; the in-progress week does not break it', () => {
    const r = streak(weeklySummary(e, 5, '2026-09-30'), 2);
    expect(r).toEqual({ current: 1, best: 2, thisWeekMet: false });
  });
  it('returns zeroed results for no data', () => {
    expect(weeklySummary([], 3, '2026-09-30').every((x) => x.sessions === 0 && x.tonnage === 0)).toBe(true);
    expect(streak(weeklySummary([], 3, '2026-09-30'), 2)).toEqual({ current: 0, best: 0, thisWeekMet: false });
  });
  it('builds a calendar of set counts per day', () => {
    const c = calendarDays(e, 7, '2026-09-30');
    expect(c).toHaveLength(7);
    expect(c.at(-1)).toEqual({ date: '2026-09-30', sets: 0 });
    expect(c.find((d) => d.date === '2026-09-29')?.sets).toBe(1);
  });
});
