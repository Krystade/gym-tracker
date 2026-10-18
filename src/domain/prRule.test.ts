import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { prIds, prToast } from './records';
import { daySummary, prSetIds } from './summary';
import { activityOf } from '../push/activity';

// One PR rule, read in four places: History's badge (prIds), Today's rows and the day summary (prSetIds, daySummary),
// the banner on saving a set (prToast) and the weekly recap push (activityOf). Each case is a set that breaks a
// record this week; every place has to call it a PR, and a set that breaks nothing has to be one nowhere.
let seq = 0;
const s = (date: string, exercise: string, weight: number, reps: number | null, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `t|${seq}`, date, seq: seq++, exercise, setNo: 1, weight, reps, flags: reps === null ? ['partial'] : weight === 0 ? ['bodyweight'] : [], source: 't', ...over,
});
const TODAY = '2026-10-14'; // a Wednesday; the week began Monday 12 October
const LAST = '2026-10-05', THIS = '2026-10-12';
const tread = (date: string, seconds: number, miles: number) => s(date, 'Treadmill', 0, null, { flags: ['cardio'], cardio: { seconds, miles } });
const plank = (date: string, secs: number) => s(date, 'Plank', 0, secs, { flags: ['hold', 'bodyweight'] });

const CASES: [string, () => { before: SetEntry[]; set: SetEntry; after?: SetEntry[] }][] = [
  ['best e1RM', () => ({ before: [s(LAST, 'Bench Press', 135, 8)], set: s(THIS, 'Bench Press', 145, 8) })],
  ['more reps at a weight', () => ({ before: [s(LAST, 'Bench Press', 135, 8), s(LAST, 'Bench Press', 145, 6)], set: s(THIS, 'Bench Press', 120, 9) })],
  // The partial set is the PR; a lighter working set after it puts the lift in the day summary.
  ['heaviest weight, from a partial set', () => ({ before: [s(LAST, 'Bench Press', 135, 8)], set: s(THIS, 'Bench Press', 155, null), after: [s(THIS, 'Bench Press', 100, 5)] })],
  ['a rep max', () => ({ before: [s(LAST, 'Bench Press', 135, 8), s(LAST, 'Bench Press', 160, 2)], set: s(THIS, 'Bench Press', 140, 6) })],
  ['session volume', () => ({ before: [s(LAST, 'Bench Press', 100, 10), s(LAST, 'Bench Press', 100, 10), s(THIS, 'Bench Press', 100, 10), s(THIS, 'Bench Press', 100, 10)], set: s(THIS, 'Bench Press', 50, 2) })],
  ['bodyweight: most reps', () => ({ before: [s(LAST, 'Pull-up', 0, 10)], set: s(THIS, 'Pull-up', 0, 12) })],
  ['a hold: longest hold', () => ({ before: [plank(LAST, 45)], set: plank(THIS, 60) })],
  ['cardio: farthest', () => ({ before: [tread(LAST, 1200, 1.5)], set: tread(THIS, 1200, 1.75) })],
];

describe('one PR rule: History, Today, the banner and the recap agree', () => {
  for (const [name, make] of CASES) {
    it(name, () => {
      const { before, set, after = [] } = make();
      const entries = [...before, set, ...after];
      // Soft, so one broken rule shows every place it breaks.
      expect.soft(prIds(entries).has(set.id), 'History badge').toBe(true);
      expect.soft(prSetIds(entries, THIS).has(set.id), "Today's row").toBe(true);
      expect.soft(prToast(entries, set) ?? 'no banner', 'banner').toMatch(/^PR! /);
      expect.soft(activityOf(entries, null, [], TODAY).week.prs, 'recap').toBe(1);
      if (!set.cardio) expect.soft(daySummary(entries, THIS).lifts.find((l) => l.exercise === set.exercise)?.pr, 'day summary').toBe(true);
    });
  }

  it('a set that breaks nothing is a PR nowhere', () => {
    const before = [s(LAST, 'Bench Press', 135, 8), s(LAST, 'Bench Press', 135, 8)];
    const set = s(THIS, 'Bench Press', 130, 8);
    const entries = [...before, set];
    expect(prIds(entries).has(set.id)).toBe(false);
    expect(prSetIds(entries, THIS).size).toBe(0);
    expect(prToast(entries, set)).toBeNull();
    expect(activityOf(entries, null, [], TODAY).week.prs).toBe(0);
    expect(daySummary(entries, THIS).lifts[0].pr).toBe(false);
  });

  it('a warm-up that beats a record is a PR everywhere, but never a set or a session toward the goals', () => {
    const set = s(THIS, 'Bench Press', 225, 5, { flags: ['warmup'] });
    const entries = [s(LAST, 'Bench Press', 135, 8), set, s(THIS, 'Bench Press', 100, 5)];
    expect(prIds(entries).has(set.id)).toBe(true);
    expect(prToast(entries, set)).toMatch(/^PR! /);
    const week = activityOf(entries, null, [], TODAY).week;
    expect(week.prs).toBe(1);
    expect(daySummary(entries, THIS).lifts[0].pr).toBe(true);
    expect([week.sets, week.sessions]).toEqual([1, 1]); // the warm-up isn't a set toward the week
    // A day of warm-ups alone is no session, whatever PRs it holds.
    const only = [s(LAST, 'Bench Press', 135, 8), s(THIS, 'Bench Press', 225, 5, { flags: ['warmup'] })];
    expect(activityOf(only, null, [], TODAY).week).toMatchObject({ sessions: 0, sets: 0, prs: 1 });
  });
});
