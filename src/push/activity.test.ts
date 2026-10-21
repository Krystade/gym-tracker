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
    expect(activityOf([hurt(TODAY, 'A Very Long Lift Name With Many Words In It Indeed')], null, [], TODAY).pain![0].lift).toHaveLength(40);
  });
});
