import { describe, expect, it } from 'vitest';
import type { SetEntry } from '../domain/types';
import type { DayPlan, Program } from '../domain/program';
import { activityOf, restDatesOf } from './activity';
import { readinessPlanned, type PlanDay, type WeekPlan } from '../domain/learn/schedule';
import { defaultProfile } from '../domain/profile';

let seq = 0;
const s = (date: string, exercise: string, weight: number, reps: number, flags: SetEntry['flags'] = []): SetEntry => ({
  id: `t|${date}|${exercise}|${seq}`, date, seq: seq++, exercise, setNo: 1, weight, reps, flags, source: 't',
});
const program = { key: 'program', perSession: 4, createdAt: '2026-01-01', days: [{ name: 'Day A', slots: [] }, { name: 'Day B', slots: [] }] } as Program;
const plan = (date: string, day: number): DayPlan => ({ key: `day:${date}`, date, day, skips: [], swaps: {} });

describe('activityOf', () => {
  // Wednesday 14 October 2026; the week began Monday 12 October.
  const TODAY = '2026-10-14';

  it('counts this week, finds the last logged day, and names the day that comes up next', () => {
    const entries = [
      s('2026-10-05', 'Bench Press', 135, 8), // last week
      s('2026-10-12', 'Bench Press', 140, 8), // a PR, this week
      s('2026-10-12', 'Bench Press', 140, 8),
      s('2026-10-12', 'Bench Press', 95, 5, ['warmup']),
      s('2026-10-13', 'Squat', 185, 5),
    ];
    const a = activityOf(entries, program, [plan('2026-10-12', 0), plan('2026-10-13', 1)], TODAY, undefined, 'UTC');
    // Untimed sets, two weeks: no routine shown yet and no times, so nothing learned. No goal is sent without one.
    expect(a).toEqual({ date: '2026-10-13', next: 'Day A', week: { start: '2026-10-12', sessions: 2, sets: 3, prs: 1, cardio: 0 },
      remind: [null, null, null, null, null, null, null] });
  });

  it('cardio-only days are not sessions; they go separately', () => {
    const tread = (date: string): SetEntry => ({ ...s(date, 'Treadmill', 0, 0, ['cardio']), reps: null, cardio: { seconds: 1200 } });
    const entries = [s('2026-10-12', 'Bench Press', 140, 8), tread('2026-10-12'), tread('2026-10-13'), tread(TODAY)];
    expect(activityOf(entries, null, [], TODAY).week).toEqual({ start: '2026-10-12', sessions: 1, sets: 1, prs: 0, cardio: 2 });
  });

  it('after a session today the next day moves on; with no program there is none', () => {
    const entries = [s('2026-10-12', 'Bench Press', 140, 8), s(TODAY, 'Squat', 185, 5)];
    expect(activityOf(entries, program, [plan('2026-10-12', 0), plan(TODAY, 1)], TODAY).next).toBe('Day A');
    expect(activityOf(entries, program, [plan('2026-10-12', 0)], TODAY)).toMatchObject({ date: TODAY, next: 'Day B' });
    expect(activityOf(entries, null, [], TODAY).next).toBeNull();
    expect(activityOf([], null, [], TODAY, 3, 'UTC')).toEqual({ date: '0000-00-00', next: null, week: { start: '2026-10-12', sessions: 0, sets: 0, prs: 0, cardio: 0 },
      goal: 3, remind: [null, null, null, null, null, null, null] });
    expect(activityOf([], null, [], TODAY, 9, 'UTC').goal).toBeUndefined();
  });

  it('carries the learned reminder schedule: days and times only, the same as the fit', () => {
    const at = (date: string, hhmm: string): SetEntry => ({ ...s(date, 'Bench Press', 100, 8), loggedAt: `${date}T${hhmm}:00.000Z`, source: 'app' });
    // Five weeks of Monday and Thursday at 19:00 UTC, never Tuesday.
    const entries: SetEntry[] = [];
    for (let w = 0; w < 5; w++) for (const d of [0, 3]) { const date = new Date(Date.UTC(2026, 8, 7 + 7 * w + d)).toISOString().slice(0, 10); entries.push(at(date, '19:00')); }
    const a = activityOf(entries, null, [], TODAY, 3, 'UTC');
    expect(a.remind).toHaveLength(7);
    expect(a.remind![1]).toMatch(/^(19|2\d):\d\d$/); // Monday: after his 19:00
    expect(a.remind![2]).toBe('off'); // Tuesday: never
    expect(JSON.stringify(a)).not.toMatch(/Bench/);
  });

  it('names the region and lift of pain yesterday or today not yet asked about; nothing else of it (item 08)', () => {
    const hurt = (date: string, ex: string, more: Partial<SetEntry> = {}): SetEntry => ({ ...s(date, ex, 110, 12, ['pain']), painRegion: 'elbow', painSeverity: 2, note: 'private words', ...more });
    const a = activityOf([s('2026-10-12', 'Bench Press', 140, 8), hurt('2026-10-13', 'Cable Pushdown')], null, [], TODAY);
    expect(a.pain).toEqual([{ date: '2026-10-13', region: 'elbow', lift: 'Cable Pushdown' }]);
    expect(JSON.stringify(a)).not.toMatch(/private|Bench|110|painSeverity/);
    expect(activityOf([hurt('2026-10-12', 'Cable Pushdown')], null, [], TODAY)).not.toHaveProperty('pain'); // two days ago
    expect(activityOf([hurt('2026-10-13', 'Cable Pushdown', { morning: 'settled' })], null, [], TODAY)).not.toHaveProperty('pain'); // answered
    expect(activityOf([hurt('2026-10-13', 'Cable Pushdown', { morning: 'skipped' })], null, [], TODAY)).not.toHaveProperty('pain'); // dismissed
    expect(activityOf([hurt(TODAY, 'A Very Long Lift Name With Many Words In It Indeed')], null, [], TODAY).pain![0].lift).toBe('A Very Long Lift Name With Many Words…'); // cut at a word, 40 at most
  });
});

describe("the week plan's rest dates for the reminder (readiness S5, owner Q6)", () => {
  const TODAY = '2026-10-14'; // Wednesday
  const day = (date: string, train: boolean, fixed: PlanDay['fixed'] = null, kind: 'goal-met' | 'recovering' | 'usual' | 'spare' = 'spare'): PlanDay =>
    ({ date, label: date, train, fixed, session: null, ready: null, light: false, rest: train ? null : { kind, label: kind } });
  const planned = (verdict: string, days: PlanDay[], today = TODAY) => ({ verdict: { kind: verdict }, plan: { today, days } as unknown as WeekPlan });

  it('the rest days up to the next session still to come: never one that rests on a session not done yet', () => {
    // Rest today and Thursday, train Friday, rest Saturday: Saturday rests on Friday's session, so it waits for it.
    expect(restDatesOf(planned('rest', [day(TODAY, false), day('2026-10-15', false), day('2026-10-16', true), day('2026-10-17', false), day('2026-10-18', false)]), TODAY))
      .toEqual([TODAY, '2026-10-15']);
    // Today trains: nothing after it is certain yet.
    expect(restDatesOf(planned('go', [day(TODAY, true), day('2026-10-15', false), day('2026-10-16', true)]), TODAY)).toEqual([]);
    // He trained today: the days after it rest on a session that's done, up to the next one.
    expect(restDatesOf(planned('go', [day(TODAY, true, 'trained'), day('2026-10-15', false, null, 'recovering'), day('2026-10-16', true), day('2026-10-17', false)]), TODAY))
      .toEqual(['2026-10-15']);
    // A layoff's forced session today is still to come.
    expect(restDatesOf(planned('go', [day(TODAY, true, 'layoff'), day('2026-10-15', false)]), TODAY)).toEqual([]);
  });

  it('"Goal met · extra session optional" today keeps its reminder; the met goal’s later days are the plan’s rest days', () => {
    const met = [day(TODAY, false, null, 'goal-met'), day('2026-10-15', false, null, 'goal-met'), day('2026-10-16', false, null, 'goal-met'), day('2026-10-17', false, null, 'goal-met'), day('2026-10-18', false, null, 'goal-met')];
    expect(restDatesOf(planned('go', met), TODAY)).toEqual(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    // The planner's own rest today ("Rest today" on the tile) is one.
    expect(restDatesOf(planned('rest', met), TODAY)).toEqual([TODAY, '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  });

  it('none without a plan for today: the Worker reminds as before', () => {
    expect(restDatesOf(null, TODAY)).toBeUndefined();
    expect(restDatesOf({ verdict: { kind: 'rest' }, plan: null }, TODAY)).toBeUndefined();
    expect(restDatesOf(planned('rest', [day('2026-10-13', false)], '2026-10-13'), TODAY)).toBeUndefined(); // yesterday's plan
  });

  it('from the planner itself: his goal met on Monday, Wednesday is optional and Thursday to Sunday rest', () => {
    const entries = [s('2026-10-12', 'Bench Press', 140, 8), s('2026-10-12', 'Bench Press', 140, 8)];
    const r = readinessPlanned({ entries, body: [], weeklyGoal: 1, program: null, plans: [], quick: null, today: TODAY, tz: 'UTC', profile: defaultProfile() });
    expect(r.verdict.why).toBe('goal-met');
    expect(restDatesOf(r, TODAY)).toEqual(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    // Goal 3, two days left to make it up: today trains, so nothing is sent yet.
    const short = readinessPlanned({ entries, body: [], weeklyGoal: 3, program: null, plans: [], quick: null, today: '2026-10-17', tz: 'UTC', profile: defaultProfile() });
    expect(short.plan!.days[0].train).toBe(true);
    expect(restDatesOf(short, '2026-10-17')).toEqual([]);
  });

  it('activityOf sends only dates from today, for 7 days, each once and in order; none at all without them', () => {
    const base = activityOf([], null, [], TODAY, 3, 'UTC');
    expect(base).not.toHaveProperty('rest');
    expect(activityOf([], null, [], TODAY, 3, 'UTC', [])).toEqual(base);
    expect(activityOf([], null, [], TODAY, 3, 'UTC', ['2026-10-13'])).toEqual(base); // yesterday's: past
    expect(activityOf([], null, [], TODAY, 3, 'UTC', ['2026-10-18', TODAY, '2026-10-18', '2026-10-21', '2026-10-20']).rest).toEqual([TODAY, '2026-10-18', '2026-10-20']);
  });
});
