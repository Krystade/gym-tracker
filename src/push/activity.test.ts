import { describe, expect, it } from 'vitest';
import type { SetEntry } from '../domain/types';
import type { DayPlan, Program } from '../domain/program';
import { activityOf } from './activity';

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
    const a = activityOf(entries, program, [plan('2026-10-12', 0), plan('2026-10-13', 1)], TODAY);
    expect(a).toEqual({ date: '2026-10-13', next: 'Day A', week: { start: '2026-10-12', sessions: 2, sets: 3, prs: 1 } });
  });

  it('after a session today the next day moves on; with no program there is none', () => {
    const entries = [s('2026-10-12', 'Bench Press', 140, 8), s(TODAY, 'Squat', 185, 5)];
    expect(activityOf(entries, program, [plan('2026-10-12', 0), plan(TODAY, 1)], TODAY).next).toBe('Day A');
    expect(activityOf(entries, program, [plan('2026-10-12', 0)], TODAY)).toMatchObject({ date: TODAY, next: 'Day B' });
    expect(activityOf(entries, null, [], TODAY).next).toBeNull();
    expect(activityOf([], null, [], TODAY)).toEqual({ date: '0000-00-00', next: null, week: { start: '2026-10-12', sessions: 0, sets: 0, prs: 0 } });
  });
});
