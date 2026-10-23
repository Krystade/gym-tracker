import { describe, expect, it } from 'vitest';
import type { SetEntry } from '../domain/types';
import type { DayPlan, Program } from '../domain/program';
import { leftToDo } from './TodayPlan';
import { foldCount } from './ExerciseCard';

// Follow-up to the test-set fix (owner, 2026-10-23): a one-rep max test is strength, not one of the plan's sets.
const D = '2026-10-23';
let seq = 0;
const set = (weight: number, reps: number, flags: SetEntry['flags'] = []): SetEntry => ({
  id: `t|${seq}`, date: D, seq: seq++, exercise: 'DB Curl', setNo: 1, weight, reps, flags, source: 't',
});
const program: Program = { key: 'program', perSession: 3, createdAt: '2026-10-01T00:00:00Z', days: [{ name: 'A', slots: [{ exercise: 'DB Curl', sets: 3, repMin: 8, repMax: 12 }] }] };
const plan: DayPlan = { key: `day:${D}`, date: D, day: 0, skips: [], swaps: {} };
const testPlusTwo = [set(45, 1, ['test']), set(35, 9), set(35, 7)];

describe('a test set is not one of the plan’s sets', () => {
  it('a test and 2 working sets leave the 3-set lift still to do', () => {
    expect(leftToDo(program, plan, testPlusTwo)).toEqual(['DB Curl']);
    expect(leftToDo(program, plan, [...testPlusTwo, set(35, 7)])).toEqual([]);
  });

  it('the folded card counts 2/3, not 3/3', () => {
    expect(foldCount(testPlusTwo, 3)).toEqual({ complete: false, count: '2/3 sets' });
    expect(foldCount([...testPlusTwo, set(35, 7)], 3)).toEqual({ complete: true, count: '3/3 sets ✓' });
  });
});
