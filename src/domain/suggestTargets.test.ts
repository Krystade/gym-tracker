import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { defaultProfile, type Profile } from './profile';
import { MUSCLES } from './muscles';
import { goalSuggestion, prioritySuggestion } from './suggestTargets';

let seq = 0;
const s = (date: string, exercise: string, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `g|${seq}`, date, seq: seq++, exercise, setNo: 1, weight: 100, reps: 10, flags: [], source: 't', ...over,
});
const TODAY = '2026-10-14'; // Wednesday; the last 8 whole weeks run 17 Aug – 11 Oct
const day = (weeksAgo: number, n: number) => new Date(Date.UTC(2026, 9, 12 - 7 * weeksAgo + n)).toISOString().slice(0, 10);
/** `perWeek[i]` sessions in the week `i + 1` weeks ago, one Bench set each. */
const weeks = (perWeek: number[]) => perWeek.flatMap((n, i) => Array.from({ length: n }, (_, d) => s(day(i + 1, d), 'Bench Press')));
const goal = (n: number): Profile => ({ ...defaultProfile(), weeklyGoal: n });

describe('goalSuggestion: sessions a week from the last 8 whole weeks', () => {
  it('suggests the average, rounded, when it is a session or more from the goal', () => {
    const log = weeks([4, 4, 3, 4, 4, 3, 4, 4]); // 3.75
    expect(goalSuggestion(log, goal(2), TODAY)).toEqual({ goal: 4, average: 3.75 });
    expect(goalSuggestion(log, goal(3), TODAY)).toBeNull(); // 0.75 away
    expect(goalSuggestion(log, goal(5), TODAY)).toEqual({ goal: 4, average: 3.75 });
    expect(goalSuggestion(weeks([1, 1, 1, 1, 1, 1, 1, 1]), goal(3), TODAY)).toEqual({ goal: 1, average: 1 });
  });

  it('counts lifting days only: not this week, not cardio-only days, not warm-ups alone, nothing older than 8 weeks', () => {
    const log = [...weeks([3, 3, 3, 3, 3, 3, 3, 3]),
      ...[0, 1, 2].map((d) => s(day(0, d), 'Bench Press')), // this week
      ...[3, 4, 5].map((d) => s(day(1, d), 'Treadmill', { flags: ['cardio'], cardio: { seconds: 1200 } })),
      ...[3, 4, 5].map((d) => s(day(2, d), 'Bench Press', { flags: ['warmup'] })),
      ...[0, 1, 2, 3, 4, 5, 6].flatMap((d) => [9, 10, 11].map((w) => s(day(w, d), 'Bench Press')))];
    expect(goalSuggestion(log, goal(1), TODAY)).toEqual({ goal: 3, average: 3 });
  });

  it('averages only the weeks since you started, and needs two whole weeks of them', () => {
    expect(goalSuggestion(weeks([4, 4]), goal(2), TODAY)).toEqual({ goal: 4, average: 4 }); // not 8 / 8 = 1
    expect(goalSuggestion(weeks([4]), goal(2), TODAY)).toBeNull();
    expect(goalSuggestion([], goal(2), TODAY)).toBeNull();
    // A week with nothing after you started still counts, as a 0.
    expect(goalSuggestion(weeks([4, 0, 4]), goal(1), TODAY)).toEqual({ goal: 3, average: 8 / 3 });
  });

  it('never suggests under 1', () => {
    expect(goalSuggestion(weeks([0, 0, 0, 0, 0, 0, 0, 1]), goal(3), TODAY)).toEqual({ goal: 1, average: 1 / 8 });
  });
});

describe('prioritySuggestion: priorities from what you train', () => {
  // 8 weeks: lots of chest and lats, some biceps and quads, a little calves; nothing else.
  const log = Array.from({ length: 8 }, (_, w) => [
    ...Array.from({ length: 6 }, () => s(day(w + 1, 0), 'Machine Chest Press')), ...Array.from({ length: 6 }, () => s(day(w + 1, 0), 'Lat Pulldown')),
    ...Array.from({ length: 3 }, () => s(day(w + 1, 2), 'Cable Curl')), ...Array.from({ length: 3 }, () => s(day(w + 1, 2), 'Leg Extension')),
    s(day(w + 1, 2), 'Seated Calf Raise'),
  ]).flat();

  it('ranks the trained muscles into priorities 1–4, most sets first; untrained ones go to 4', () => {
    const sug = prioritySuggestion(log, defaultProfile(), TODAY)!;
    expect(sug.tiers.Chest).toBe(1);
    expect(sug.tiers.Lats).toBe(1);
    expect(sug.tiers.Calves).toBeGreaterThan(sug.tiers.Biceps);
    expect(sug.tiers.Quads).toBeLessThan(sug.tiers.Calves);
    // A week: chest, lats and biceps 6 sets (curls plus pulldowns' ½); triceps, front delts, mid-back, forearms and quads 3;
    // calves 1. Nine trained, split in four, and muscles with as many sets share the higher priority.
    const trained = Object.fromEntries(Object.entries(sug.tiers).filter(([, t]) => t !== 4));
    expect(trained).toEqual({ Chest: 1, Lats: 1, Biceps: 1, Triceps: 2, 'Front Delts': 2, 'Mid-Back': 2, Forearms: 2, Quads: 2 });
    expect(sug.tiers.Hamstrings).toBe(4);
    expect(sug.tiers.Abs).toBe(4);
    // Every muscle has one, and the changes list exactly the ones that differ from now (all 3 by default).
    expect(Object.keys(sug.tiers).sort()).toEqual([...MUSCLES].sort());
    expect(sug.changes.map(({ muscle, from, to }) => ({ muscle, from, to })))
      .toEqual(MUSCLES.filter((m) => sug.tiers[m] !== 3).map((m) => ({ muscle: m, from: 3, to: sug.tiers[m] })));
    // Each change carries its weekly sets, the reason it moved.
    const perWeek = Object.fromEntries(sug.changes.map((c) => [c.muscle, c.perWeek]));
    expect(perWeek).toMatchObject({ Chest: 6, Lats: 6, Biceps: 6, Calves: 1, Hamstrings: 0 });
  });

  it('is null when the priorities already match, and with under 4 sessions to go by', () => {
    const sug = prioritySuggestion(log, defaultProfile(), TODAY)!;
    expect(prioritySuggestion(log, { ...defaultProfile(), tiers: sug.tiers }, TODAY)).toBeNull();
    const three = log.filter((e) => e.date >= day(2, 0));
    expect(new Set(three.map((e) => e.date)).size).toBe(4);
    expect(prioritySuggestion(three, defaultProfile(), TODAY)).not.toBeNull();
    expect(prioritySuggestion(three.filter((e) => e.date !== day(2, 2)), defaultProfile(), TODAY)).toBeNull();
  });

  it('leaves warm-ups, cardio and this week out', () => {
    const extra = [...Array.from({ length: 40 }, () => s(day(1, 3), 'Hip Thrust', { flags: ['warmup'] })),
      ...Array.from({ length: 40 }, () => s(day(0, 0), 'Hip Thrust'))];
    expect(prioritySuggestion([...log, ...extra], defaultProfile(), TODAY)!.tiers.Glutes).toBe(4);
  });
});
