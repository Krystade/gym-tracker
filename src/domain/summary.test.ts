import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { daySummary, prSetIds } from './summary';

let seq = 0;
const s = (date: string, exercise: string, weight: number, reps: number, flags: SetEntry['flags'] = []): SetEntry => ({
  id: `t|${date}|${exercise}|${seq}`, date, seq: seq++, exercise, setNo: 1, weight, reps, flags, source: 't',
});
const TODAY = '2026-10-05';

describe('prSetIds', () => {
  it('marks a set that beats every earlier set of the lift, not the first set ever', () => {
    const first = s('2026-09-28', 'Bench Press', 135, 8);
    const pr = s(TODAY, 'Bench Press', 140, 8);
    const after = s(TODAY, 'Bench Press', 140, 7); // done after the PR, below it
    const ids = prSetIds([first, pr, after], TODAY);
    expect([...ids]).toEqual([pr.id]);
    expect(prSetIds([first], '2026-09-28').size).toBe(0);
  });

  it('a set later beaten on an earlier day is still the PR it was when done', () => {
    const old = s('2026-09-28', 'Bench Press', 135, 8);
    const today = s(TODAY, 'Bench Press', 140, 8);
    expect(prSetIds([old, today], TODAY).has(today.id)).toBe(true);
  });

  it('ignores warm-ups, holds and other lifts', () => {
    const base = s('2026-09-28', 'Bench Press', 135, 8);
    const warm = s(TODAY, 'Bench Press', 200, 5, ['warmup']);
    const curl = s(TODAY, 'Cable Curl', 80, 10);
    expect(prSetIds([base, warm, curl], TODAY).size).toBe(0);
  });
});

describe('daySummary', () => {
  it("leads with each lift's top set against last time, and counts sets per muscle", () => {
    const entries = [
      s('2026-09-28', 'Bench Press', 130, 10), s('2026-09-28', 'Bench Press', 135, 8), // top = heaviest, not most reps
      s(TODAY, 'Bench Press', 140, 8), s(TODAY, 'Bench Press', 140, 6), s(TODAY, 'Bench Press', 95, 5, ['warmup']),
      s(TODAY, 'Lat Pulldown', 110, 10), s(TODAY, 'Lat Pulldown', 110, 9),
    ];
    const d = daySummary(entries, TODAY);
    expect(d.lifts.map((l) => l.exercise)).toEqual(['Bench Press', 'Lat Pulldown']);
    const bench = d.lifts[0];
    expect([bench.top.weight, bench.top.reps]).toEqual([140, 8]);
    expect([bench.last?.weight, bench.last?.reps]).toEqual([135, 8]);
    expect(bench.pr).toBe(true);
    expect(d.lifts[1].last).toBeNull();
    // Warm-ups don't count; whole sets on the prime movers.
    expect(d.muscles.find(([m]) => m === 'Chest')?.[1]).toBe(2);
    expect(d.muscles.find(([m]) => m === 'Lats')?.[1]).toBe(2);
    expect(d.muscles[0][1]).toBeGreaterThanOrEqual(d.muscles.at(-1)![1]); // most-trained first
  });

  it('is empty on a day with no working sets', () => {
    expect(daySummary([s(TODAY, 'Bench Press', 95, 5, ['warmup'])], TODAY).lifts).toEqual([]);
  });
});
