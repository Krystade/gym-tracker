import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { MUSCLES, muscleVector, type Muscle } from './muscles';
import { defaultProfile, type Profile } from './profile';
import { DEFAULT_PICK, fillScore, nextDay, quickDay, type DayPlan, type Program } from './program';

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
    // Monday to Wednesday of the week of Thursday 2026-10-08.
    const week = ['2026-10-05', '2026-10-06', '2026-10-07'].flatMap((d) => Array.from({ length: 6 }, () => s(d, 'Machine Chest Press')));
    const day = quickDay(defaultProfile(), [...allTrained(), ...week], '2026-10-08', upTo(8));
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

// Owner, 2026-11-21: minimums first, the cheapest to finish by priority first (a muscle 2 sets from its minimum beats one 6 sets
// from it at 50 %), a minimum of 0 done at once; once every minimum is met, toward the maximums the same way. The calendar week.
describe('quickDay fills the cheapest minimum first (owner, 2026-11-21)', () => {
  const THU = '2026-10-08', MON = '2026-10-05', SUN = '2026-10-04';
  const only = (t: Partial<Record<Muscle, 1 | 2 | 3 | 4>>, targets: Partial<Profile['targets']> = {}): Profile => {
    const p = defaultProfile();
    return { ...p, tiers: Object.fromEntries(MUSCLES.map((m) => [m, t[m] ?? 4])) as Profile['tiers'], targets: { ...p.targets, 1: [12, 20], 2: [10, 14], ...targets } };
  };
  const sets = (date: string, ex: string, n: number) => Array.from({ length: n }, () => s(date, ex));
  it('2 sets from its minimum beats 6 sets from it at 50 % (the owner’s example)', () => {
    // Biceps 10 of 12 this week (2 to go), Triceps 6 of 12 (50 %, 6 to go): room for one pair.
    const log = [...sets('2026-10-05', 'Cable Curl', 5), ...sets('2026-10-06', 'Cable Curl', 5), ...sets('2026-10-06', 'Cable Pushdown', 6)];
    const day = quickDay(only({ Biceps: 1, Triceps: 1 }), log, THU, upTo(2));
    expect(day).toHaveLength(1);
    expect(trains(day[0].exercise, 'Biceps')).toBe(true);
    // Room for four: Biceps' pair finishes it, then Triceps.
    const four = quickDay(only({ Biceps: 1, Triceps: 1 }), log, THU, upTo(4));
    expect(four.some((x) => trains(x.exercise, 'Triceps'))).toBe(true);
  });
  it('a minimum of 0 is already met: nothing goes to it while another minimum is short', () => {
    const p = only({ Biceps: 1, Quads: 2 }, { 2: [0, 6] });
    const day = quickDay(p, [], THU, upTo(4));
    expect(day.every((x) => trains(x.exercise, 'Biceps'))).toBe(true);
  });
  it('once every minimum is met, toward the maximums, the cheapest to finish first', () => {
    // Both past 12: Triceps 18 of 20 (2 to go) before Biceps 12 of 20 (8 to go).
    const log = [...sets('2026-10-06', 'Cable Curl', 12), ...sets('2026-10-06', 'Cable Pushdown', 18)];
    const [first] = quickDay(only({ Biceps: 1, Triceps: 1 }), log, THU, upTo(2));
    expect(trains(first.exercise, 'Triceps')).toBe(true);
  });
  it('reads the calendar week: last Sunday’s sets are last week’s', () => {
    // Chest, priority 1, did its minimum on Sunday; on Monday its week starts again at 0.
    const log = [...allTrained(), ...sets(SUN, 'Machine Chest Press', 12)];
    const [first] = quickDay(only({ Chest: 1, Quads: 2 }), log, MON, upTo(2));
    expect(trains(first.exercise, 'Chest')).toBe(true);
  });
  it('keeps priority 3–4 to the low share while a priority 1–2 muscle is short', () => {
    // Three priority 3s at 4 (cheaper per set than Chest's 12): 8 sets go to Chest; priority 3 waits.
    const day = quickDay(only({ Chest: 1, Calves: 3, Abs: 3, Forearms: 3 }, { 3: [4, 6] }), allTrained(), THU, upTo(8));
    expect(day.reduce((a, x) => a + (trains(x.exercise, 'Chest') ? x.sets : 0), 0)).toBe(8);
  });
});

describe('fillScore', () => {
  it('per set of what is left: 2 sets to a minimum of 4 beats 6 to a minimum of 12, at the same 50 %', () => {
    expect(fillScore(1, 4, 2)).toBeGreaterThan(fillScore(1, 12, 6));
    expect(fillScore(3, 4, 2)).toBeGreaterThan(fillScore(3, 12, 6));
  });
  it('a goal of 0, or one met, scores 0; priority weighs the same distance', () => {
    expect(fillScore(1, 0, 0)).toBe(0);
    expect(fillScore(2, 10, 10)).toBe(0);
    expect(fillScore(2, 10, 11)).toBe(0);
    expect(fillScore(1, 12, 6)).toBeGreaterThan(fillScore(2, 12, 6));
    // Half a set short still costs a pair.
    expect(fillScore(1, 12, 11.5)).toBe(fillScore(1, 12, 10));
  });
});
