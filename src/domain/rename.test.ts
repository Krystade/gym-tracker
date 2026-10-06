import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import type { DayPlan, Program } from './program';
import { setId } from './ids';
import { renameAliases, renameInPlan, renameInProgram, renameSets } from './rename';
import { nameKey } from './notes';

// Synthetic sets only.
const s = (date: string, exercise: string, setNo: number, weight: number, source = 'app'): SetEntry => ({
  id: setId(source, date, exercise, setNo), date, seq: setNo, exercise, setNo, weight, reps: 10, flags: [], source,
});

describe('renameSets', () => {
  it('moves every set of the lift to the new name, with new ids, and tombstones the old ones', () => {
    const a = s('2026-09-01', 'Pushdown', 1, 50), b = s('2026-09-01', 'Pushdown', 2, 55), other = s('2026-09-01', 'Curl', 1, 30);
    const r = renameSets([a, b, other], 'Pushdown', 'Cable Pushdown');
    expect(r.put.map((e) => [e.exercise, e.setNo, e.id])).toEqual([
      ['Cable Pushdown', 1, setId('app', '2026-09-01', 'Cable Pushdown', 1)],
      ['Cable Pushdown', 2, setId('app', '2026-09-01', 'Cable Pushdown', 2)],
    ]);
    expect(r.put[0]).toMatchObject({ weight: 50, asWritten: 'Pushdown' });
    expect(r.remove).toEqual([a.id, b.id]);
  });
  it('a merge numbers the moved sets after the ones already there that day, so no id collides', () => {
    const there = s('2026-09-01', 'Cable Pushdown', 1, 60), moved = s('2026-09-01', 'Pushdown', 1, 50), alone = s('2026-09-02', 'Pushdown', 1, 52);
    const r = renameSets([there, moved, alone], 'Pushdown', 'Cable Pushdown');
    expect(r.put.map((e) => [e.date, e.setNo])).toEqual([['2026-09-01', 2], ['2026-09-02', 1]]);
    expect(new Set(r.put.map((e) => e.id)).has(there.id)).toBe(false);
  });
  it('a change of case only keeps the ids and tombstones nothing', () => {
    const a = s('2026-09-01', 'cable curl', 1, 30);
    const r = renameSets([a], 'cable curl', 'Cable Curl');
    expect(r.put).toMatchObject([{ id: a.id, exercise: 'Cable Curl' }]);
    expect(r.remove).toEqual([]);
  });
  it('keeps a name the set was first written as', () => {
    const a = { ...s('2026-09-01', 'Pushdown', 1, 50), asWritten: 'pushdowns' };
    expect(renameSets([a], 'Pushdown', 'Cable Pushdown').put[0].asWritten).toBe('pushdowns');
  });
});

describe('renameInProgram and renameInPlan', () => {
  const slot = (exercise: string, sets: number) => ({ exercise, sets, repMin: 8, repMax: 12 });
  it('renames slots, and a day that already has the target keeps one slot with the larger count', () => {
    const p: Program = { key: 'program', perSession: 10, createdAt: 'x', days: [
      { name: 'Day A', slots: [slot('Pushdown', 3), slot('Curl', 2)] },
      { name: 'Day B', slots: [slot('Cable Pushdown', 2), slot('Pushdown', 4)] },
    ] };
    const r = renameInProgram(p, 'Pushdown', 'Cable Pushdown')!;
    expect(r.days.map((d) => d.slots.map((x) => [x.exercise, x.sets]))).toEqual([
      [['Cable Pushdown', 3], ['Curl', 2]],
      [['Cable Pushdown', 4]],
    ]);
    expect(renameInProgram(p, 'Leg Press', 'Hack Squat')).toBeNull(); // nothing to change
  });
  it('renames swaps both ways, skips and quick slots in a day plan', () => {
    const d: DayPlan = { key: 'day:2026-09-01', date: '2026-09-01', day: 0, skips: ['Pushdown'], swaps: { Pushdown: 'Rope Pushdown', Curl: 'Pushdown' }, slots: [slot('Pushdown', 2)] };
    expect(renameInPlan(d, 'Pushdown', 'Cable Pushdown')).toEqual({ ...d, skips: ['Cable Pushdown'], swaps: { 'Cable Pushdown': 'Rope Pushdown', Curl: 'Cable Pushdown' }, slots: [slot('Cable Pushdown', 2)] });
    expect(renameInPlan(d, 'Leg Press', 'Hack Squat')).toBeNull();
  });
});

describe('renameAliases', () => {
  it('points mappings at the new name and maps the old name to it', () => {
    expect(renameAliases({ pushdowns: 'Pushdown', curl: 'Cable Curl' }, 'Pushdown', 'Cable Pushdown'))
      .toEqual({ pushdowns: 'Cable Pushdown', curl: 'Cable Curl', [nameKey('Pushdown')]: 'Cable Pushdown' });
  });
});
