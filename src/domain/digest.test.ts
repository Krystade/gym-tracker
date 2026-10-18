import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { defaultProfile, type Profile } from './profile';
import { digestWeek, weekDigest } from './digest';
import { activityOf } from '../push/activity';

let seq = 0;
const s = (date: string, exercise: string, weight: number, reps: number | null, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `t|${seq}`, date, seq: seq++, exercise, setNo: 1, weight, reps, flags: weight === 0 && reps != null ? ['bodyweight'] : [], source: 't', ...over,
});
const sets = (n: number, date: string, exercise: string, weight: number, reps: number, over: Partial<SetEntry> = {}) =>
  Array.from({ length: n }, () => s(date, exercise, weight, reps, over));
const tread = (date: string, seconds: number, miles?: number) => s(date, 'Treadmill', 0, null, { flags: ['cardio'], cardio: { seconds, ...(miles != null && { miles }) } });

// Weeks start Monday. The digest's week: 5–11 October; the week before: 28 September–4 October.
const WEEK = '2026-10-05', BEFORE = '2026-09-28';
const profile = (over: Partial<Profile> = {}): Profile => ({ ...defaultProfile(), weeklyGoal: 2, ...over });

describe('digestWeek: which week the digest is about', () => {
  it('is last week, except on a Sunday when the recap opens it: then the week ending that day', () => {
    expect(digestWeek('2026-10-12')).toBe(WEEK); // Monday
    expect(digestWeek('2026-10-17')).toBe(WEEK); // Saturday
    expect(digestWeek('2026-10-18')).toBe(WEEK); // Sunday: still last week on Today
    expect(digestWeek('2026-10-18', true)).toBe('2026-10-12'); // Sunday's recap is about the week it ends
    expect(digestWeek('2026-10-12', true)).toBe(WEEK); // a recap tapped on Monday: the week just gone
  });
});

describe('weekDigest', () => {
  const entries = [
    // The week before: one session, 3 sets, no cardio.
    ...sets(3, BEFORE, 'Bench Press', 135, 8),
    // The week: two sessions (the goal), 7 working sets, three Bench PRs (140, then 145, then the day's
    // volume passing 3 × 1,080 on the 100 × 8).
    s('2026-10-05', 'Bench Press', 95, 5, { flags: ['warmup'] }), // a warm-up: no set toward the week
    s('2026-10-05', 'Bench Press', 140, 8), s('2026-10-05', 'Bench Press', 145, 8), s('2026-10-05', 'Bench Press', 100, 8),
    ...sets(4, '2026-10-08', 'Lat Pulldown', 120, 10),
    tread('2026-10-09', 1200), tread('2026-10-10', 900), // two cardio-only days, 35 minutes
    // This week (not in the digest).
    ...sets(5, '2026-10-12', 'Leg Press', 300, 10),
  ];

  it('counts sessions against the goal, the streak, sets and PRs, as Stats and the recap do', () => {
    const d = weekDigest(entries, profile(), WEEK);
    expect(d).toMatchObject({ week: WEEK, end: '2026-10-11', sessions: 2, goal: 2, cardioDays: 2, sets: 7, prs: 3, cardioMinutes: 35 });
    expect(d.streak).toBe(1); // met this week, missed the week before
    // The same PR count the recap sent for that week.
    expect(d.prs).toBe(activityOf(entries, null, [], '2026-10-11').week.prs);
  });

  it('lists each lift with its sets and PRs, most sets first; cardio by bouts', () => {
    expect(weekDigest(entries, profile(), WEEK).lifts).toEqual([
      { exercise: 'Lat Pulldown', sets: 4, prs: 0, cardio: false },
      { exercise: 'Bench Press', sets: 3, prs: 3, cardio: false },
      { exercise: 'Treadmill', sets: 2, prs: 0, cardio: true },
    ]);
  });

  it('names the muscles furthest under their target, most short first, and none that met it', () => {
    const p = profile({ targets: { 1: [10, 14], 2: [13, 15], 3: [3, 5], 4: [1, 2] } });
    p.tiers.Lats = 1; p.tiers.Hamstrings = 1; p.tiers.Chest = 2;
    const under = weekDigest(entries, p, WEEK).under;
    // Hamstrings got 0 of 10 and Chest 3 of 13: both 10 short, and the higher priority comes first; Lats 4 of 10.
    expect(under.map((u) => u.muscle)).toEqual(['Hamstrings', 'Chest', 'Lats']); // three at most
    expect(under[1]).toEqual({ muscle: 'Chest', sets: 3, target: [13, 15] });
    // Met: Lats' 4 sets reach a target of 4, so it isn't named.
    const met = profile({ targets: { 1: [4, 6], 2: [6, 9], 3: [0, 1], 4: [0, 1] } });
    met.tiers.Lats = 1;
    expect(weekDigest(entries, met, WEEK).under.map((u) => u.muscle)).not.toContain('Lats');
    expect(weekDigest(entries, met, WEEK).under).toEqual([]);
  });

  it('carries the week before, to compare against', () => {
    expect(weekDigest(entries, profile(), WEEK).before).toEqual({ sessions: 1, sets: 3, prs: 0, cardioMinutes: 0 });
    // A week before with a PR and cardio in it.
    const more = [s('2026-09-21', 'Bench Press', 100, 8), ...entries, tread(BEFORE, 600)];
    expect(weekDigest(more, profile(), WEEK).before).toEqual({ sessions: 1, sets: 3, prs: 1, cardioMinutes: 10 });
  });

  it('cardio minutes are 0 for a week without cardio, and nothing is counted from another week', () => {
    const d = weekDigest(entries, profile(), BEFORE);
    expect(d).toMatchObject({ sessions: 1, sets: 3, prs: 0, cardioMinutes: 0, cardioDays: 0 });
    expect(d.lifts).toEqual([{ exercise: 'Bench Press', sets: 3, prs: 0, cardio: false }]);
  });

  it('a lift with a PR from a warm-up alone is listed with 0 sets', () => {
    const e = [s(BEFORE, 'Squat', 135, 5), s(WEEK, 'Squat', 185, 5, { flags: ['warmup'] })];
    expect(weekDigest(e, profile(), WEEK)).toMatchObject({ sessions: 0, sets: 0, prs: 1, lifts: [{ exercise: 'Squat', sets: 0, prs: 1, cardio: false }] });
  });
});
