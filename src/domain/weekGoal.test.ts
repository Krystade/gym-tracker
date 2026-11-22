import { describe, expect, it } from 'vitest';
import { streak, weeklySummary } from './analytics';
import { buddySteps } from './achievements';
import { earned, earnedOn, INCOME } from './buddies/points';
import { trainingOf } from './buddies/stats';
import { goalHit, goalsFor, goalWeekDays, minimumsOf, ownSetGoal, weekCount } from './weekGoal';
import { defaultProfile, type Profile } from './profile';
import type { SetEntry } from './types';

// Owner, 2026-11-21: a sets-a-week goal beside the sessions goal; a calendar week counts as a goal week once EITHER is met, for
// the points and tickets, Goal weeks and Best run, and the streaks alike. Synthetic sets only.

let seq = 0;
const set = (date: string, exercise: string, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `w${seq}`, date, seq: seq++, exercise, setNo: 1, weight: 50, reps: 10, flags: [], source: 't', ...over,
});
const many = (date: string, exercise: string, n: number) => Array.from({ length: n }, () => set(date, exercise));
/** A profile with a sessions goal of 2 and a hand-set sets goal. */
const own = (sets: number, sessions = 2): Profile => ({ ...defaultProfile(), weeklyGoal: sessions, setGoal: sets });
// 2026-11-16 is a Monday.
const MON = '2026-11-16', TUE = '2026-11-17', WED = '2026-11-18', SUN = '2026-11-22', NEXT_MON = '2026-11-23';

describe('goalHit', () => {
  it('either goal makes the week; which one says so', () => {
    expect(goalHit({ sessions: 1, sets: 10 }, { sessions: 2, sets: 20 })).toBeNull();
    expect(goalHit({ sessions: 2, sets: 10 }, { sessions: 2, sets: 20 })).toBe('sessions');
    expect(goalHit({ sessions: 1, sets: 20 }, { sessions: 2, sets: 20 })).toBe('sets');
    expect(goalHit({ sessions: 3, sets: 25 }, { sessions: 2, sets: 20 })).toBe('both');
    // No sets goal (a friend's week): sessions alone.
    expect(goalHit({ sessions: 1, sets: 999 }, { sessions: 2 })).toBeNull();
  });
});

describe('weekCount', () => {
  it('counts sessions and fractional muscle-sets, warm-ups and cardio aside, each muscle capped at 11 a day', () => {
    const log = [
      ...many(MON, 'Machine Chest Press', 2), // chest 2, triceps 1, front delts 1
      set(MON, 'Cable Curl', { flags: ['warmup'] }),
      set(TUE, 'Treadmill', { flags: ['cardio'], reps: null, cardio: { seconds: 600 } }),
      ...many(WED, 'Cable Curl', 14), // capped at 11
      ...many(NEXT_MON, 'Cable Curl', 5), // next week
    ];
    expect(weekCount(log, WED)).toEqual({ sessions: 2, sets: 4 + 11 });
    expect(weekCount(log, WED, MON)).toEqual({ sessions: 1, sets: 4 });
  });
});

describe('goalsFor', () => {
  it('a hand-set sets goal holds every week', () => {
    const g = goalsFor(own(30, 3), []);
    expect(g(MON)).toEqual({ sessions: 3, sets: 30 });
    expect(ownSetGoal({ setGoal: 0 })).toBeNull();
  });
  it('unset: the muscles’ minimums added up, fitted as the week began, so the week’s own sets never move it', () => {
    const p = defaultProfile();
    const before = [...many('2026-11-02', 'Machine Chest Press', 12), ...many('2026-11-05', 'Leg Press', 12)];
    const g = goalsFor(p, before)(MON);
    expect(g.sets).toBeGreaterThan(0);
    expect(goalsFor(p, [...before, ...many(MON, 'Cable Curl', 30)])(WED)).toEqual(g);
    // With nothing logged: the defaults fitted to 2 sessions of 15 sets (yield 1.5).
    expect(goalsFor(p, [])(MON).sets).toBe(minimumsOf({ tiers: p.tiers, targets: { 1: [6, 10], 2: [5, 7], 3: [2, 3], 4: [0, 0] } }));
  });
});

describe('goalWeekDays', () => {
  it('a week of one session meets the sets goal on that day; two sessions meet the sessions goal; neither, no goal week', () => {
    const log = [
      ...many(MON, 'Cable Curl', 11), ...many(MON, 'Cable Pushdown', 11), // one big session: 22 sets
      ...many('2026-11-24', 'Cable Curl', 4), ...many('2026-11-26', 'Cable Curl', 4), // two small sessions
      ...many('2026-12-01', 'Cable Curl', 4), // one small one
    ];
    expect(goalWeekDays(log, () => ({ sessions: 2, sets: 20 }))).toEqual([
      { week: MON, date: MON, by: 'sets' },
      { week: NEXT_MON, date: '2026-11-26', by: 'sessions' },
    ]);
    // The sessions goal alone (as before): the big session's week is no goal week.
    expect(goalWeekDays(log, () => ({ sessions: 2 })).map((x) => x.week)).toEqual([NEXT_MON]);
  });
});

describe('every goal week reads the one test', () => {
  // One session of 22 sets in each of three weeks: never the sessions goal of 2, always the sets goal of 20.
  const log = ['2026-11-02', '2026-11-09', MON].flatMap((d) => [...many(d, 'Cable Curl', 11), ...many(d, 'Cable Pushdown', 11)]);
  const p = own(20);
  it('points and tickets pay a sets-goal week, on the day it was met', () => {
    const t = trainingOf(log, { start: '2026-11-01', today: SUN, profile: p });
    expect(t.goalWeeks).toEqual(['2026-11-02', '2026-11-09', MON]);
    const e = earned(t, null);
    expect(e.parts.goalWeeks).toBe(3 * INCOME.goalWeek);
    expect(e.parts.goalWeekTickets).toBe(3 * INCOME.goalWeekTickets);
    expect(earnedOn(t, null, MON).parts.goalWeeks).toBe(INCOME.goalWeek);
    // The sessions goal alone would pay none of them.
    expect(trainingOf(log, { start: '2026-11-01', today: SUN, profile: { ...p, setGoal: undefined, weeklyGoal: 2 } }).goalWeeks.length).toBeLessThan(3);
  });
  it('Goal weeks counts them', () => {
    expect(buddySteps(log, { since: '2026-11-01', today: SUN, profile: p })['goal-weeks'].map((x) => x.value)).toEqual([1, 2, 3]);
  });
  it('the streak runs through them', () => {
    const st = streak(weeklySummary(log, 8, SUN), goalsFor(p, log));
    expect(st).toMatchObject({ current: 3, best: 3, thisWeekMet: true });
    expect(streak(weeklySummary(log, 8, SUN), 2).current).toBe(0);
  });
});
