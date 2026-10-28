import { describe, expect, it } from 'vitest';
import { nextSet, nextTime, plannedSets, setDrop, suggest, warmups } from './suggest';
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
  it('goes up after every set hit the top of the range two sessions running, with sets from the program', () => {
    const log = ['2026-09-25', '2026-09-28'].flatMap((d) => [s(d, 'Bench Press', 135, 12), s(d, 'Bench Press', 135, 12), s(d, 'Bench Press', 135, 12)]);
    const x = suggest(log, 'Bench Press', st, '2026-10-02', 4)!;
    expect(x).toMatchObject({ weight: 140, reps: 8, repMax: 12, sets: 4, setsFrom: 'program', kind: 'increase' });
    expect(x.reason).toBe('Range topped two sessions running (36 reps last time, within 2 of 3 × 12), so +5 lb.');
  });
  it('stays at last time’s reps otherwise, matching last session’s working-set count', () => {
    const log = [s('2026-09-28', 'Bench Press', 95, 10, ['warmup']), s('2026-09-28', 'Bench Press', 135, 10), s('2026-09-28', 'Bench Press', 135, 9)];
    expect(suggest(log, 'Bench Press', st, '2026-10-02', null)).toMatchObject({ weight: 135, reps: 9, perSet: [10, 9], sets: 2, setsFrom: 'last', kind: 'reps' });
  });
  it('never uses the day’s own sets, so the suggestion holds all session', () => {
    const log = [s('2026-09-28', 'Bench Press', 135, 9), s('2026-10-02', 'Bench Press', 135, 12), s('2026-10-02', 'Bench Press', 135, 12)];
    expect(suggest(log, 'Bench Press', st, '2026-10-02', null)).toMatchObject({ weight: 135, reps: 9, sets: 1 });
  });
  it('after a test day, takes the weight from the test and the sets from the last working session', () => {
    const log = [s('2026-09-25', 'Bench Press', 135, 10), s('2026-09-25', 'Bench Press', 135, 10), s('2026-09-28', 'Bench Press', 225, 1, ['test'])];
    const x = suggest(log, 'Bench Press', st, '2026-10-02', null);
    // 225 / (1 + 12/30) ≈ 160.7 → 160.
    expect(x).toMatchObject({ weight: 160, reps: 8, sets: 2, setsFrom: 'last', kind: 'test' });
    expect(x.reason).toBe('Your test set puts 12 reps at about 160 lb, so that’s the working weight now.');
    // A test done after the working sets counts toward the weight, not the set count: 10 + 12 + 12 = 34 of 3 × 12 → up, 2 sets.
    const mixed = ['2026-09-25', '2026-09-28'].flatMap((d) => [s(d, 'Bench Press', 135, 10), s(d, 'Bench Press', 135, 12), s(d, 'Bench Press', 135, 12, ['test'])]);
    expect(suggest(mixed, 'Bench Press', st, '2026-10-02', null)).toMatchObject({ weight: 140, reps: 8, sets: 2, setsFrom: 'last', kind: 'increase' });
  });
  it('pain last time: the same weight and reps (moderate), or a step lighter (sharp), and says why (item 08)', () => {
    const hurt = (sev: 2 | 3) => [s('2026-09-28', 'Bench Press', 135, 12), s('2026-09-28', 'Bench Press', 135, 12), { ...s('2026-09-28', 'Bench Press', 135, 12, ['pain']), painSeverity: sev }];
    const held = suggest(hurt(2), 'Bench Press', st, '2026-10-02', 3)!;
    expect(held).toMatchObject({ kind: 'hold', weight: 135, perSet: [12, 12, 12] });
    expect(held.reason).toBe('Moderate pain last time: hold until it’s mild or gone. Same weight and reps as last time.');
    const eased = suggest(hurt(3), 'Bench Press', st, '2026-10-02', 3)!;
    expect(eased).toMatchObject({ kind: 'ease', weight: 130, perSet: [12, 12, 12] });
    expect(eased.reason).toBe('Sharp pain last time: one step lighter, the same reps. Once it’s mild or gone, it builds back up from here.');
  });
  it('with no history: reps and 3 sets, no weight', () => {
    expect(suggest([], 'Bench Press', st, '2026-10-02', null)).toMatchObject({ weight: null, reps: 8, sets: 3, setsFrom: 'default', kind: 'new', warmups: [] });
  });
});

describe('warmups', () => {
  it('ramps to heavy weights in 5 lb steps, and skips light, bodyweight and timed work', () => {
    // One ramp set at about 55%: warm-up sets only pay off near-maximal loads, and time is short.
    expect(warmups(225, 'Bench Press')).toEqual([{ weight: 125, reps: 5 }]);
    expect(warmups(100, 'Bench Press')).toEqual([{ weight: 55, reps: 5 }]);
    expect(warmups(40, 'Bench Press')).toEqual([]);
    expect(warmups(0, 'Pull-up')).toEqual([]);
    expect(warmups(100, 'Plank')).toEqual([]);
  });
  it('skips the ramp for isolation lifts', () => {
    expect(warmups(100, 'Cable Curl')).toEqual([]);
  });
  it('only the session’s first compound lift gets the ramp', () => {
    const st = defaultSettings('Bench Press');
    const log = [s('2026-09-28', 'Bench Press', 135, 10), s('2026-09-28', 'Bench Press', 135, 10)];
    expect(suggest(log, 'Bench Press', st, '2026-10-02', null).warmups).toHaveLength(1);
    // A compound already done today: Bench comes second, so it starts at its working weight.
    expect(suggest([...log, s('2026-10-02', 'Leg Press', 200, 10)], 'Bench Press', st, '2026-10-02', null).warmups).toEqual([]);
    // Isolation work before it doesn't count, and nor do Bench's own sets today.
    expect(suggest([...log, s('2026-10-02', 'Cable Curl', 40, 12), s('2026-10-02', 'Bench Press', 135, 10)], 'Bench Press', st, '2026-10-02', null).warmups).toHaveLength(1);
  });
});

describe('Phase 12 review fixes', () => {
  const st = defaultSettings('Bench Press');
  it('after training today, "next time" means the next session', () => {
    const log = [s('2026-09-25', 'Bench Press', 135, 12), s('2026-09-28', 'Bench Press', 135, 12), s('2026-09-30', 'Bench Press', 140, 12), s('2026-09-30', 'Bench Press', 140, 12),
      s('2026-10-02', 'Bench Press', 140, 12), s('2026-10-02', 'Bench Press', 140, 12)];
    expect(nextTime(log, 'Bench Press', st, '2026-10-02', 4)).toMatchObject({ trainedToday: true, s: { weight: 145, sets: 2, setsFrom: 'last' } });
    expect(nextTime(log.slice(0, 2), 'Bench Press', st, '2026-10-02', 4)).toMatchObject({ trainedToday: false, s: { weight: 140, sets: 4 } });
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
    expect(nextTarget(log, name, defaultSettings(name, true), today)!.text).toBe('BW × 35 · 35 s');
  });
  it('a known hold logged without the flag is still timed in seconds in both', () => {
    const log = [s(day1, 'Plank', 0, 30), s(day2, 'Plank', 0, 30)];
    expect(suggest(log, 'Plank', defaultSettings('Plank'), today, null).unit).toBe(' s');
    expect(nextTarget(log, 'Plank', defaultSettings('Plank'), today)!.text).toBe('BW × 35 s');
  });
});

describe('nextSet (item 11: owner, 2026-10-23)', () => {
  const DB = { key: 'db curl', repMin: 10, repMax: 15, increment: 5 };
  const day = '2026-10-23';
  const oct12 = [s('2026-10-12', 'DB Curl', 45, 1, ['test']), s('2026-10-12', 'DB Curl', 35, 9), s('2026-10-12', 'DB Curl', 35, 7)];
  const at = (log: SetEntry[], today: SetEntry[], planned: number | null = 3) =>
    nextSet([...log, ...today], 'DB Curl', day, suggest([...log, ...today], 'DB Curl', DB, day, planned), today);
  it('waits for a training set: nothing done, or only a test', () => {
    expect(at(oct12, [])).toBeNull();
    expect(at(oct12, [s(day, 'DB Curl', 45, 1, ['test'])])).toBeNull();
    expect(at(oct12, [s(day, 'DB Curl', 20, 10, ['warmup'])])).toBeNull();
  });
  it('without a learned drop, steps as today’s targets do (10 · 8 · 8), and never from a test', () => {
    expect(setDrop([...oct12, s(day, 'DB Curl', 35, 9)], 'DB Curl', day, 1)).toBeNull();
    // 35 × 9 against a 10: the 8 after it is 2 down, so 7.
    expect(at(oct12, [s(day, 'DB Curl', 35, 9)])).toMatchObject({ weight: 35, reps: 7, extra: false, learned: false });
    // A test single first changes nothing: the next set is from the 35s.
    expect(at(oct12, [s(day, 'DB Curl', 45, 1, ['test']), s(day, 'DB Curl', 35, 9)])).toMatchObject({ weight: 35, reps: 7, extra: false });
    // The targets flat from here: the same reps.
    expect(at(oct12, [s(day, 'DB Curl', 35, 9), s(day, 'DB Curl', 35, 8)])).toMatchObject({ weight: 35, reps: 8, extra: false });
  });
  it('past the planned sets it is an extra set, and keeps coming', () => {
    const three = [s(day, 'DB Curl', 35, 10), s(day, 'DB Curl', 35, 8), s(day, 'DB Curl', 35, 8)];
    expect(at(oct12, three)).toMatchObject({ weight: 35, reps: 8, extra: true });
    expect(at(oct12, [...three, s(day, 'DB Curl', 30, 9)])).toMatchObject({ weight: 30, reps: 9, extra: true });
    // The test isn't one of the sets planned.
    expect(at(oct12, [s(day, 'DB Curl', 45, 1, ['test']), ...three.slice(0, 2)])).toMatchObject({ extra: false });
  });
  it('with a learned drop, the last set’s reps less it', () => {
    // Eight sessions of 12, 10, 8: his sets drop about 2.
    const days = ['2026-09-01', '2026-09-04', '2026-09-08', '2026-09-11', '2026-09-15', '2026-09-18', '2026-09-22', '2026-09-25'];
    const log = days.flatMap((d) => [s(d, 'DB Curl', 30, 12), s(d, 'DB Curl', 30, 10), s(d, 'DB Curl', 30, 8)]);
    const d = setDrop(log, 'DB Curl', day, 1)!;
    expect(d).toBeGreaterThan(1.5);
    // 30 × 14 with 1 planned: an extra set from what he did, 14 less about 2 (the plan has no step past its one set).
    expect(at(log, [s(day, 'DB Curl', 30, 14)], 1)).toMatchObject({ weight: 30, reps: Math.round(14 - d), extra: true, learned: true, why: expect.stringContaining('your sets drop') });
    expect(Math.round(14 - d)).toBe(12);
  });
});
