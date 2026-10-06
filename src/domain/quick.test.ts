import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { MUSCLES, muscleVector, type Muscle } from './muscles';
import { defaultProfile, type Profile } from './profile';
import { DEFAULT_PICK, nextDay, quickDay, type DayPlan, type Program } from './program';

let seq = 0;
const s = (date: string, exercise: string): SetEntry => ({
  id: `q|${date}|${exercise}|${seq}`, date, seq: seq++, exercise, setNo: 1, weight: 50, reps: 10, flags: [], source: 't',
});
const TODAY = '2026-10-05';
const days = (n: number) => new Date(Date.UTC(2026, 9, 5 - n)).toISOString().slice(0, 10);
const trains = (ex: string, m: Muscle) => muscleVector(ex)?.[m] === 1;
const upTo = (n: number) => (slots: { sets: number }[]) => slots.reduce((a, x) => a + x.sets, 0) <= n;
// Every muscle trained ten days ago (outside the week), so recency decides only what the test changes.
const allTrained = (ago = 10) => MUSCLES.map((m) => s(days(ago), DEFAULT_PICK[m]));

describe('quickDay', () => {
  it('skips what this week already trained', () => {
    const week = [1, 2, 3].flatMap((d) => Array.from({ length: 6 }, () => s(days(d), 'Machine Chest Press')));
    const day = quickDay(defaultProfile(), [...allTrained(), ...week], TODAY, upTo(8));
    expect(day.length).toBeGreaterThan(0);
    expect(day.some((x) => trains(x.exercise, 'Chest'))).toBe(false);
  });

  it('weighs priorities: a priority-1 muscle comes before a priority-4 one', () => {
    const p: Profile = { ...defaultProfile(), tiers: { ...defaultProfile().tiers, Quads: 1, Biceps: 4 } };
    const [first] = quickDay(p, allTrained(), TODAY, upTo(2));
    expect(trains(first.exercise, 'Quads')).toBe(true);
  });

  it('breaks a tie with whatever was trained longest ago', () => {
    const log = [...allTrained(10).filter((e) => !trains(e.exercise, 'Calves')), s(days(30), DEFAULT_PICK.Calves)];
    const [first] = quickDay(defaultProfile(), log, TODAY, upTo(2));
    expect(trains(first.exercise, 'Calves')).toBe(true);
  });

  it('fills the time it is given, in pairs of sets', () => {
    const day = quickDay(defaultProfile(), allTrained(), TODAY, upTo(9));
    expect(day.reduce((a, x) => a + x.sets, 0)).toBe(8);
    expect(day.every((x) => x.sets % 2 === 0 && x.repMin > 0)).toBe(true);
  });

  it('ignores the day’s own sets, so the plan holds while you work through it', () => {
    const base = quickDay(defaultProfile(), allTrained(), TODAY, upTo(8));
    const after = quickDay(defaultProfile(), [...allTrained(), s(TODAY, base[0].exercise), s(TODAY, base[0].exercise)], TODAY, upTo(8));
    expect(after).toEqual(base);
  });
});

describe('a quick day and the rotation', () => {
  const program: Program = { key: 'program', perSession: 4, createdAt: '', days: [{ name: 'Day A', slots: [] }, { name: 'Day B', slots: [] }] };
  it('leaves the next program day where it was', () => {
    const plans: DayPlan[] = [
      { key: 'day:a', date: days(3), day: 0, skips: [], swaps: {} },
      { key: 'day:q', date: days(1), day: 1, skips: [], swaps: {}, quick: 20, slots: [] },
    ];
    expect(nextDay(program, plans, [s(days(3), 'Leg Press'), s(days(1), 'Cable Curl')], TODAY)).toBe(1);
  });
});
