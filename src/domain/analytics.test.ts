import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { addDays, calendarDays, planPerSession, REACH, REACH_WEEKS, SESSION_CAP, sessionReach, sessionsLeft, streak, usualPerSession, weekStart, weekStatus, weeklyMuscleSets, weeklySummary } from './analytics';
import { MUSCLES, type Muscle } from './muscles';

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
  it('counts warm-ups toward tonnage but not toward sets or sessions; holds stay out of tonnage', () => {
    const w = weeklySummary([s('2026-09-28', 'Bench Press', 100, 10), s('2026-09-28', 'Bench Press', 45, 10, { flags: ['warmup'] }),
      s('2026-09-29', 'Squat', 135, 5, { flags: ['warmup'] }), s('2026-09-28', 'Plate Pinch Hold', 45, 30, { flags: ['hold'] })], 1, '2026-09-30'); // the 29th: warm-ups alone
    expect(w[0]).toMatchObject({ sessions: 1, sets: 2, tonnage: 1000 + 450 + 675 });
  });
  it('returns zeroed results for no data', () => {
    expect(weeklySummary([], 3, '2026-09-30').every((x) => x.sessions === 0 && x.tonnage === 0)).toBe(true);
    expect(streak(weeklySummary([], 3, '2026-09-30'), 2)).toEqual({ current: 0, best: 0, thisWeekMet: false });
  });
  it('counts only days with a working lift set as sessions; cardio-only days show separately', () => {
    const tread = { seconds: 1200 };
    const c = [
      s('2026-09-21', 'Bench Press', 100, 10), // last week: a lift day
      s('2026-09-23', 'Treadmill', 0, null, { flags: ['cardio'], cardio: tread }), // and a cardio-only day
      s('2026-09-28', 'Bench Press', 100, 10), s('2026-09-28', 'Treadmill', 0, null, { flags: ['cardio'], cardio: tread }), // lift + cardio: one session
      s('2026-09-29', 'Treadmill', 0, null, { flags: ['cardio'], cardio: tread }),
      s('2026-09-30', 'Bike', 0, null, { flags: ['cardio'] }), // flagged cardio without numbers is still cardio
      s('2026-10-01', 'Bench Press', 45, 10, { flags: ['warmup'] }), // a warmup alone isn't a working set
    ];
    const w = weeklySummary(c, 2, '2026-10-01');
    expect(w.map((x) => [x.week, x.sessions, x.cardioDays, x.sets])).toEqual([['2026-09-21', 1, 1, 1], ['2026-09-28', 1, 2, 1]]);
    // Goal 2: one lift day plus a cardio day doesn't meet it, last week or this.
    expect(streak(w, 2)).toEqual({ current: 0, best: 0, thisWeekMet: false });
  });
  it('builds a calendar of set counts per day', () => {
    const c = calendarDays(e, 7, '2026-09-30');
    expect(c).toHaveLength(7);
    expect(c.at(-1)).toEqual({ date: '2026-09-30', sets: 0 });
    expect(c.find((d) => d.date === '2026-09-29')?.sets).toBe(1);
  });
});

// The week of Mon 12 – Sun 18 Oct 2026, one day at a time.
const WEEK = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'] as const;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

describe('sessionsLeft: what the rest of the week can still hold, at his goal', () => {
  it('counts the days to come, today included until he trains, never more than his goal has left', () => {
    // Goal 3, nothing done yet: three sessions left until only two days (Sat) and one (Sun) remain.
    expect(WEEK.map((d) => sessionsLeft(d, 3, 0, false))).toEqual([3, 3, 3, 3, 3, 2, 1]);
    // Goal 3, one session done earlier in the week: two left until Sunday.
    expect(WEEK.map((d) => sessionsLeft(d, 3, 1, false))).toEqual([2, 2, 2, 2, 2, 2, 1]);
    // Trained today: today is spent. Sunday's session ends the week.
    expect(WEEK.map((d) => sessionsLeft(d, 3, 1, true))).toEqual([2, 2, 2, 2, 2, 1, 0]);
  });
  it('leaves one more session while a day is left, even past the goal', () => {
    expect(WEEK.map((d) => sessionsLeft(d, 2, 2, false))).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(WEEK.map((d) => sessionsLeft(d, 2, 3, true))).toEqual([1, 1, 1, 1, 1, 1, 0]);
  });
});

describe('weekStatus: behind means the rest of the week can’t make it up, not that the week has days to go', () => {
  const tier1: [number, number] = [12, 20], tier3: [number, number] = [4, 6];
  /** Each weekday's status for `value` sets, the goal and the sessions done so far. */
  const week = (value: number, range: [number, number], goal: number, done: number, trainedToday = false) =>
    Object.fromEntries(WEEK.map((d, i) => [DAYS[i], weekStatus(value, range, sessionsLeft(d, goal, done, trainedToday))]));
  it('nothing done yet: on pace every day the sessions left can still reach the target', () => {
    expect(week(0, tier3, 2, 0)).toEqual({ Mon: 'pace', Tue: 'pace', Wed: 'pace', Thu: 'pace', Fri: 'pace', Sat: 'pace', Sun: 'pace' });
    // Twelve sets need two sessions (a session adds at most SESSION_CAP to a muscle): behind only once one session is left.
    expect(SESSION_CAP).toBeLessThan(12);
    expect(week(0, tier1, 2, 0)).toEqual({ Mon: 'pace', Tue: 'pace', Wed: 'pace', Thu: 'pace', Fri: 'pace', Sat: 'pace', Sun: 'under' });
    expect(week(0, tier1, 3, 0)).toEqual({ Mon: 'pace', Tue: 'pace', Wed: 'pace', Thu: 'pace', Fri: 'pace', Sat: 'pace', Sun: 'under' });
  });
  it('one session in that skipped the muscle (an upper day): its legs day can still come', () => {
    expect(week(0, tier3, 2, 1)).toEqual({ Mon: 'pace', Tue: 'pace', Wed: 'pace', Thu: 'pace', Fri: 'pace', Sat: 'pace', Sun: 'pace' });
    // At goal 2 the one session left can't hold 12: behind once the other session is done. At goal 3, two left, until Sunday.
    expect(week(0, tier1, 2, 1)).toEqual({ Mon: 'under', Tue: 'under', Wed: 'under', Thu: 'under', Fri: 'under', Sat: 'under', Sun: 'under' });
    expect(week(0, tier1, 3, 1)).toEqual({ Mon: 'pace', Tue: 'pace', Wed: 'pace', Thu: 'pace', Fri: 'pace', Sat: 'pace', Sun: 'under' });
    expect(week(2, tier1, 2, 1)).toEqual({ Mon: 'pace', Tue: 'pace', Wed: 'pace', Thu: 'pace', Fri: 'pace', Sat: 'pace', Sun: 'pace' });
  });
  it('the week over (trained on Sunday): anything short is behind; on target and over whatever the day', () => {
    expect(week(3, tier3, 2, 2, true)).toEqual({ Mon: 'pace', Tue: 'pace', Wed: 'pace', Thu: 'pace', Fri: 'pace', Sat: 'pace', Sun: 'under' });
    expect(week(5, tier3, 2, 0)).toEqual({ Mon: 'on', Tue: 'on', Wed: 'on', Thu: 'on', Fri: 'on', Sat: 'on', Sun: 'on' });
    expect(week(7, tier3, 2, 0)).toEqual({ Mon: 'over', Tue: 'over', Wed: 'over', Thu: 'over', Fri: 'over', Sat: 'over', Sun: 'over' });
  });
  it('the edge: exactly what the sessions left can add is on pace, a set more is behind', () => {
    expect(weekStatus(12 - SESSION_CAP, tier1, 1)).toBe('pace');
    expect(weekStatus(12 - SESSION_CAP - 0.5, tier1, 1)).toBe('under');
    expect(weekStatus(0, tier3, 0)).toBe('under');
  });
  it('without sessions left (a program), the plain status', () => {
    expect(weekStatus(2, tier3)).toBe('under');
    expect(weekStatus(4, tier3)).toBe('on');
    expect(weekStatus(6, tier3)).toBe('on');
    expect(weekStatus(6.5, tier3)).toBe('over');
  });
});

// ---- The pace at a realistic session (owner, 2026-10-21): S2 let every session left add 11 sets to any muscle, so nothing
// was ever behind before a trained Sunday. A session left now adds what his own sessions give that muscle, half again. ----

const only = (m: Partial<Record<Muscle, number>>): Record<Muscle, number> => Object.fromEntries(MUSCLES.map((x) => [x, m[x] ?? 0])) as Record<Muscle, number>;

describe('sessionReach: what one session left can realistically add to a muscle', () => {
  it('his usual sets a session for it, half again; the plan’s when larger; at least 3, at most 11', () => {
    const r = sessionReach(only({ Calves: 4, Quads: 1, Chest: 9, Lats: 2 }), only({ Lats: 5, Quads: 0 }));
    expect(r.Calves).toBe(6); // 4 × 1.5
    expect(r.Quads).toBe(3); // 1.5 lifted to the floor
    expect(r.Chest).toBe(11); // 13.5 held to the cap
    expect(r.Lats).toBe(7.5); // the plan's 5 beats his 2
    expect(r.Biceps).toBe(3); // never trained, not planned: the floor
    expect(REACH).toEqual({ factor: 1.5, floor: 3 });
    expect(sessionReach(only({ Calves: 4 })).Calves).toBe(6); // no plan
  });
});

describe('usualPerSession: his sets a session for each muscle over the 6 whole weeks before this one', () => {
  const sets = (date: string, exercise: string, k: number, over: Partial<SetEntry> = {}) => Array.from({ length: k }, () => s(date, exercise, 50, 10, over));
  // This week starts Mon 12 Oct; the six weeks before it run from Mon 31 Aug to Sun 11 Oct.
  it('the median over the days that trained it; this week, anything older, warm-ups and cardio left out', () => {
    expect(REACH_WEEKS).toBe(6);
    const e = [
      ...sets('2026-08-30', 'Standing Calf Raise', 9), // a Sunday: the week before the six, left out
      ...sets('2026-08-31', 'Standing Calf Raise', 2), // the six weeks' first day
      ...sets('2026-09-14', 'Standing Calf Raise', 3), ...sets('2026-09-14', 'Standing Calf Raise', 4, { flags: ['warmup'] }),
      ...sets('2026-09-21', 'Leg Extension', 3), // a day with no calves: not a zero in their median
      ...sets('2026-10-11', 'Standing Calf Raise', 5), // the six weeks' last day
      ...sets('2026-10-12', 'Standing Calf Raise', 10), // this week: left out
    ];
    const u = usualPerSession(e, '2026-10-14');
    expect(u.Calves).toBe(3); // median of 2, 3, 5
    expect(u.Quads).toBe(3);
    expect(u.Chest).toBe(0);
    // The same all week: Monday to Sunday read the same six weeks.
    for (const d of ['2026-10-12', '2026-10-18']) expect(usualPerSession(e, d)).toEqual(u);
    // An even count: the middle two averaged.
    expect(usualPerSession([...e, ...sets('2026-10-05', 'Standing Calf Raise', 4)], '2026-10-14').Calves).toBe(3.5);
    // A day counts at most SESSION_CAP for a muscle, as the week's sets do.
    expect(usualPerSession(sets('2026-10-05', 'Standing Calf Raise', 14), '2026-10-14').Calves).toBe(SESSION_CAP);
  });
});

describe('planPerSession: the most any one program day gives a muscle', () => {
  it('per day, direct and indirect, the largest day kept, capped', () => {
    const plan = [
      { slots: [{ exercise: 'Bench Press', sets: 4 }, { exercise: 'Standing Calf Raise', sets: 2 }] },
      { slots: [{ exercise: 'Bench Press', sets: 2 }, { exercise: 'Low-to-High Cable Fly', sets: 3 }] },
      { slots: [{ exercise: 'Standing Calf Raise', sets: 14 }] },
    ];
    const p = planPerSession(plan);
    expect(p.Chest).toBe(5); // day 2: 2 + 3
    expect(p['Front Delts']).toBe(2.5); // day 2: 1 + 1.5
    expect(p.Triceps).toBe(2); // day 1: 4 × 0.5
    expect(p.Calves).toBe(SESSION_CAP);
    expect(planPerSession(null)).toEqual(only({}));
  });
});

describe('weekStatus at his reach, every weekday: today counts until he trains', () => {
  const tier3: [number, number] = [4, 6], tier1: [number, number] = [12, 20];
  const week = (value: number, range: [number, number], goal: number, done: number, reach: number, trainedToday = false) =>
    Object.fromEntries(WEEK.map((d, i) => [DAYS[i], weekStatus(value, range, sessionsLeft(d, goal, done, trainedToday), reach)]));
  it('a muscle at the floor (3 a session): two sessions left reach 4 sets, one left does not', () => {
    expect(week(0, tier3, 2, 0, 3)).toEqual({ Mon: 'pace', Tue: 'pace', Wed: 'pace', Thu: 'pace', Fri: 'pace', Sat: 'pace', Sun: 'under' });
    // One session done that skipped it: one left all week, and 3 sets can't make 4. S2's 11 called this on pace all week.
    expect(week(0, tier3, 2, 1, 3)).toEqual({ Mon: 'under', Tue: 'under', Wed: 'under', Thu: 'under', Fri: 'under', Sat: 'under', Sun: 'under' });
    expect(week(0, tier3, 2, 1, SESSION_CAP)).toEqual({ Mon: 'pace', Tue: 'pace', Wed: 'pace', Thu: 'pace', Fri: 'pace', Sat: 'pace', Sun: 'pace' });
  });
  it('a muscle he gives 3 a session (4.5 with the margin) still makes 4 from one session; 2 done makes it with the floor', () => {
    expect(week(0, tier3, 2, 1, 4.5)).toEqual({ Mon: 'pace', Tue: 'pace', Wed: 'pace', Thu: 'pace', Fri: 'pace', Sat: 'pace', Sun: 'pace' });
    expect(week(2, tier3, 2, 1, 3)).toEqual({ Mon: 'pace', Tue: 'pace', Wed: 'pace', Thu: 'pace', Fri: 'pace', Sat: 'pace', Sun: 'pace' });
  });
  it('trained today: today is spent; trained on Sunday, the week is done and anything short is behind', () => {
    // Goal 3, one done (today's): two left until Saturday, where only Sunday is left.
    expect(week(4, tier1, 3, 1, 4.5, true)).toEqual({ Mon: 'pace', Tue: 'pace', Wed: 'pace', Thu: 'pace', Fri: 'pace', Sat: 'under', Sun: 'under' });
    // Not trained today: Saturday still has today and Sunday.
    expect(week(4, tier1, 3, 1, 4.5)).toEqual({ Mon: 'pace', Tue: 'pace', Wed: 'pace', Thu: 'pace', Fri: 'pace', Sat: 'pace', Sun: 'under' });
    expect(week(3.5, tier3, 2, 2, 11, true)).toEqual({ Mon: 'pace', Tue: 'pace', Wed: 'pace', Thu: 'pace', Fri: 'pace', Sat: 'pace', Sun: 'under' });
  });
  it('on target and over whatever the day and reach', () => {
    expect(week(5, tier3, 2, 1, 3)).toEqual({ Mon: 'on', Tue: 'on', Wed: 'on', Thu: 'on', Fri: 'on', Sat: 'on', Sun: 'on' });
    expect(week(7, tier3, 2, 1, 3)).toEqual({ Mon: 'over', Tue: 'over', Wed: 'over', Thu: 'over', Fri: 'over', Sat: 'over', Sun: 'over' });
  });
  it('the edge: exactly what the sessions left can add is on pace, a little more is behind', () => {
    expect(weekStatus(12 - 2 * 4.5, tier1, 2, 4.5)).toBe('pace');
    expect(weekStatus(12 - 2 * 4.5 - 0.5, tier1, 2, 4.5)).toBe('under');
  });
});
