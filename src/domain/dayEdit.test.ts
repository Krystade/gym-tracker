import { describe, expect, it } from 'vitest';
import { changeLift, setWeight } from './dayEdit';
import { setId } from './ids';
import type { Flag, SetEntry } from './types';

// Synthetic sets only: fixing a day's logged sets in place from History.
let seq = 0;
const s = (exercise: string, setNo: number, weight: number, reps: number | null, flags: Flag[] = [], date = '2026-05-02'): SetEntry => ({
  id: setId('notes', date, exercise, setNo), date, seq: seq++, exercise, setNo, weight, reps, flags, source: 'notes',
});

describe('changeLift', () => {
  it('moves the lift’s sets that day to the picked lift, ids and values kept, numbered after that lift’s own sets', () => {
    const day = [s('Cable Pushdown', 1, 80, 11, ['unsure']), s('Incline Bench Pushdown', 1, 70, 12), s('Cable Pushdown', 2, 85, 10), s('Cable Curl', 1, 40, 12)];
    const out = changeLift(day, 'Cable Pushdown', 'Incline Bench Pushdown');
    expect(out).toEqual([
      { ...day[0], exercise: 'Incline Bench Pushdown', setNo: 2 },
      { ...day[2], exercise: 'Incline Bench Pushdown', setNo: 3 },
    ]);
  });
  it('matches the lift however it was spelt, and moving it onto itself is nothing', () => {
    const day = [s('cable  pushdown', 1, 80, 11), s('Cable Pushdown', 2, 85, 10)];
    expect(changeLift(day, 'Cable Pushdown', 'Rope Pushdown').map((e) => [e.exercise, e.setNo])).toEqual([['Rope Pushdown', 1], ['Rope Pushdown', 2]]);
    expect(changeLift(day, 'Cable Pushdown', 'cable pushdown')).toEqual([]);
  });
});

describe('setWeight', () => {
  it('sets the picked sets’ weight, and a bar on a BW set clears its bodyweight flag', () => {
    const day = [s('Bench Press', 1, 0, 15, ['bodyweight', 'warmup']), s('Bench Press', 2, 135, 8), s('Incline Bench Press', 1, 0, 12, ['bodyweight'])];
    const out = setWeight(day, [day[0].id, day[2].id], 45);
    expect(out).toEqual([{ ...day[0], weight: 45, flags: ['warmup'] }, { ...day[2], weight: 45, flags: [] }]);
  });
  it('leaves out sets already at that weight, and cardio', () => {
    const day = [s('Bench Press', 1, 45, 15), { ...s('Bike', 1, 0, null, ['cardio']), cardio: { seconds: 600 } } as SetEntry];
    expect(setWeight(day, day.map((e) => e.id), 45)).toEqual([]);
  });
});
