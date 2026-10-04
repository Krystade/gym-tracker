import { describe, expect, it } from 'vitest';
import { nextTime, plannedSets, suggest, warmups } from './suggest';
import { defaultSettings, nextTarget } from './progression';
import type { SetEntry } from './types';
import type { DayPlan, Program } from './program';

let seq = 0;
const s = (date: string, exercise: string, weight: number, reps: number, flags: SetEntry['flags'] = []): SetEntry =>
  ({ id: `${date}|${exercise}|${seq}`, date, seq: seq++, exercise, setNo: seq, weight, reps, flags, source: 'app' });
const program: Program = { key: 'program', perSession: 12, createdAt: '', days: [{ name: 'Day A', slots: [
  { exercise: 'Bench Press', sets: 4, repMin: 8, repMax: 12 }, { exercise: 'Cable Curl', sets: 2, repMin: 10, repMax: 15 }] }] };
const plan = (over: Partial<DayPlan> = {}): DayPlan => ({ key: 'day:2026-10-02', date: '2026-10-02', day: 0, skips: [], swaps: {}, ...over });

describe('plannedSets', () => {
  it('reads today’s slot, follows a swap, and ignores a skipped slot', () => {
    expect(plannedSets(program, plan(), 'bench press')).toBe(4);
    expect(plannedSets(program, plan({ swaps: { 'Cable Curl': 'Hammer Curl' } }), 'Hammer Curl')).toBe(2);
    expect(plannedSets(program, plan({ swaps: { 'Cable Curl': 'Hammer Curl' } }), 'Cable Curl')).toBeNull();
    expect(plannedSets(program, plan({ skips: ['Bench Press'] }), 'Bench Press')).toBeNull();
    expect(plannedSets(null, null, 'Bench Press')).toBeNull();
  });
});

describe('suggest', () => {
  const st = defaultSettings('Bench Press'); // 8–12, +5
  it('goes up after every set hit the top of the range, with sets from the program', () => {
    const log = [s('2026-09-28', 'Bench Press', 135, 12), s('2026-09-28', 'Bench Press', 135, 12), s('2026-09-28', 'Bench Press', 135, 12)];
    const x = suggest(log, 'Bench Press', st, '2026-10-02', 4)!;
    expect(x).toMatchObject({ weight: 140, reps: 8, repMax: 12, sets: 4, setsFrom: 'program', kind: 'increase' });
    expect(x.reason).toMatch(/12 on every set.*\+5 lb/);
  });
  it('stays and chases reps otherwise, matching last session’s working-set count', () => {
    const log = [s('2026-09-28', 'Bench Press', 95, 10, ['warmup']), s('2026-09-28', 'Bench Press', 135, 10), s('2026-09-28', 'Bench Press', 135, 9)];
    expect(suggest(log, 'Bench Press', st, '2026-10-02', null)).toMatchObject({ weight: 135, reps: 10, sets: 2, setsFrom: 'last', kind: 'reps' });
  });
  it('never uses the day’s own sets, so the suggestion holds all session', () => {
    const log = [s('2026-09-28', 'Bench Press', 135, 10), s('2026-10-02', 'Bench Press', 135, 12), s('2026-10-02', 'Bench Press', 135, 12)];
    expect(suggest(log, 'Bench Press', st, '2026-10-02', null)).toMatchObject({ weight: 135, reps: 11, sets: 1 });
  });
  it('with no history: reps and 3 sets, no weight', () => {
    expect(suggest([], 'Bench Press', st, '2026-10-02', null)).toMatchObject({ weight: null, reps: 8, sets: 3, setsFrom: 'default', kind: 'new', warmups: [] });
  });
});

describe('warmups', () => {
  it('ramps to heavy weights in 5 lb steps, and skips light, bodyweight and timed work', () => {
    expect(warmups(225, 'Bench Press')).toEqual([{ weight: 90, reps: 8 }, { weight: 135, reps: 5 }, { weight: 180, reps: 2 }]);
    expect(warmups(100, 'Bench Press')).toEqual([{ weight: 50, reps: 8 }, { weight: 75, reps: 4 }]);
    expect(warmups(40, 'Bench Press')).toEqual([]);
    expect(warmups(0, 'Pull-up')).toEqual([]);
    expect(warmups(100, 'Plank')).toEqual([]);
  });
  it('skips the ramp for isolation lifts', () => {
    expect(warmups(100, 'Cable Curl')).toEqual([]);
  });
});

describe('Phase 12 review fixes', () => {
  const st = defaultSettings('Bench Press');
  it('after training today, "next time" means the next session', () => {
    const log = [s('2026-09-28', 'Bench Press', 135, 12), s('2026-10-02', 'Bench Press', 140, 12), s('2026-10-02', 'Bench Press', 140, 12)];
    expect(nextTime(log, 'Bench Press', st, '2026-10-02', 4)).toMatchObject({ trainedToday: true, s: { weight: 145, sets: 2, setsFrom: 'last' } });
    expect(nextTime(log.slice(0, 1), 'Bench Press', st, '2026-10-02', 4)).toMatchObject({ trainedToday: false, s: { weight: 140, sets: 4 } });
  });
  it('labels timed holds in seconds', () => {
    expect(suggest([], 'Plank', defaultSettings('Plank'), '2026-10-02', null).unit).toBe(' s');
    expect(suggest([], 'Bench Press', st, '2026-10-02', null).unit).toBe('');
  });
});

describe('one hold check for every line', () => {
  const day1 = '2026-09-28', day2 = '2026-09-30', today = '2026-10-02';
  it('a custom lift whose sets carry the hold flag is timed in seconds, in the unit and in the target', () => {
    const name = 'Wall Sit Hold X';
    const log = [s(day1, name, 0, 30, ['hold']), s(day1, name, 0, 30, ['hold']), s(day2, name, 0, 30, ['hold']), s(day2, name, 0, 30, ['hold'])];
    const x = suggest(log, name, defaultSettings(name, true), today, null);
    expect(x.unit).toBe(' s');
    expect(nextTarget(log, name, defaultSettings(name, true), today)!.text).toBe('BW × 35s+ on every set');
  });
  it('a known hold logged without the flag is still timed in seconds in both', () => {
    const log = [s(day1, 'Plank', 0, 30), s(day2, 'Plank', 0, 30)];
    expect(suggest(log, 'Plank', defaultSettings('Plank'), today, null).unit).toBe(' s');
    expect(nextTarget(log, 'Plank', defaultSettings('Plank'), today)!.text).toBe('BW × 35s+ on every set');
  });
});
