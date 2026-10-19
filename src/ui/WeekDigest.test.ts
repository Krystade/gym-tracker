import { describe, expect, it } from 'vitest';
import type { SetEntry } from '../domain/types';
import { defaultProfile, type Profile } from '../domain/profile';
import { weekDigest } from '../domain/digest';
import { keptDigest, type KeptDigest } from './WeekDigest';

let seq = 0;
const s = (date: string, exercise: string, weight: number, reps: number, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `t|${seq}`, date, seq: seq++, exercise, setNo: 1, weight, reps, flags: [], source: 't', ...over,
});
const sets = (n: number, date: string, exercise: string, weight: number, reps: number) => Array.from({ length: n }, () => s(date, exercise, weight, reps));

// The digest's week: 5–11 October (weeks start Monday); today is Wednesday the 14th.
const WEEK = '2026-10-05';
const log = [
  ...sets(3, '2026-09-29', 'Bench Press', 135, 8),
  ...sets(3, '2026-10-06', 'Bench Press', 145, 8), ...sets(3, '2026-10-06', 'Lat Pulldown', 120, 10),
  ...sets(2, '2026-10-09', 'Leg Press', 200, 10),
  ...sets(2, '2026-10-12', 'Squat', 185, 5),
];
// Two fittings of the same goal: today's sets move the fitted targets, which move the muscles under target.
const fitted: Profile = { ...defaultProfile(), weeklyGoal: 2 };
const refitted: Profile = { ...fitted, targets: { ...fitted.targets, 1: [2, 4], 2: [2, 3], 3: [1, 2], 4: [1, 1] } };

describe('keptDigest: last week worked out from the whole log once, while today’s sets come in', () => {
  it('tells the two fittings apart (the instrument)', () => {
    expect(weekDigest(log, refitted, WEEK).under).not.toEqual(weekDigest(log, fitted, WEEK).under);
  });

  it('is the digest of the log as it is, with the targets as they are', () => {
    const k: KeptDigest = {};
    expect(keptDigest(k, log, fitted, WEEK)).toEqual({ d: weekDigest(log, fitted, WEEK), logged: true });
    const today = [...log, ...sets(4, '2026-10-14', 'Bench Press', 150, 8)];
    expect(keptDigest(k, today, refitted, WEEK).d).toEqual(weekDigest(today, refitted, WEEK));
    const edited = today.map((e, i) => (i === 4 ? { ...e, weight: 160 } : e)); // a set last week, changed: a new PR
    expect(keptDigest(k, edited, refitted, WEEK).d).toEqual(weekDigest(edited, refitted, WEEK));
    expect(keptDigest(k, edited, refitted, WEEK).d.prs).not.toBe(weekDigest(today, refitted, WEEK).prs);
    const goal = { ...refitted, weeklyGoal: 4 };
    expect(keptDigest(k, edited, goal, WEEK).d).toEqual(weekDigest(edited, goal, WEEK));
  });

  it('works out the whole log again only when a set up to the week’s end, the week or the goal changes', () => {
    const k: KeptDigest = {};
    keptDigest(k, log, fitted, WEEK);
    const base = k.base;
    keptDigest(k, [...log, s('2026-10-14', 'Bench Press', 150, 8)], refitted, WEEK); // a set today, targets refitted
    expect(k.base).toBe(base);
    const curl = s('2026-10-08', 'Curl', 40, 10);
    keptDigest(k, [...log, curl], refitted, WEEK); // one last week
    expect(k.base).not.toBe(base);
    const again = k.base;
    keptDigest(k, [...log, curl].filter((e) => e.exercise !== 'Squat'), refitted, WEEK); // this week's go
    expect(k.base).toBe(again);
    keptDigest(k, [...log.slice(1), curl], refitted, WEEK); // one removed
    expect(k.base).not.toBe(again);
    const removed = k.base;
    keptDigest(k, [...log.slice(1), curl], { ...refitted, weeklyGoal: 3 }, WEEK);
    expect(k.base).not.toBe(removed);
  });

  it('says whether anything was logged by the week’s end', () => {
    expect(keptDigest({}, sets(2, '2026-10-13', 'Squat', 185, 5), fitted, WEEK).logged).toBe(false);
  });
});
