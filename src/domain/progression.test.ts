import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { defaultSettings, estimateRir, isWorking, nextTarget, prCheck, priorE1rm, rirOffset, settingsKey } from './progression';

let seq = 0;
const s = (date: string, setNo: number, weight: number, reps: number | null, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `t|${date}|curl|${setNo}|${seq}`, date, seq: seq++, exercise: 'Curl', setNo, weight, reps, flags: [], source: 't', ...over,
});
const S = { key: 'curl', repMin: 8, repMax: 12, increment: 5 };

describe('settings', () => {
  it('defaults isolation lifts to 10-15 and compounds to 8-12', () => {
    expect(defaultSettings('Incline DB Curl')).toMatchObject({ repMin: 10, repMax: 15, increment: 5 });
    expect(defaultSettings('Cable Pushdown')).toMatchObject({ repMin: 10, repMax: 15 });
    expect(defaultSettings('Bench Press')).toMatchObject({ repMin: 8, repMax: 12 });
    expect(settingsKey('  Bench   press ')).toBe('bench press');
  });
});

describe('isWorking', () => {
  it('excludes warmups and partials', () => {
    expect(isWorking(s('d', 1, 50, 10))).toBe(true);
    expect(isWorking(s('d', 1, 50, 10, { flags: ['warmup'] }))).toBe(false);
    expect(isWorking(s('d', 1, 50, null, { flags: ['partial'] }))).toBe(false);
  });
});

describe('nextTarget', () => {
  it('says go up when every working set at the top weight hit the top of the range', () => {
    const e = [s('2026-01-01', 1, 30, 12), s('2026-01-01', 2, 30, 12), s('2026-01-01', 3, 30, 13)];
    expect(nextTarget(e, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'increase', weight: 35, reps: 8 });
  });
  it('holds weight and asks for one more rep otherwise, using the weakest set', () => {
    const e = [s('2026-01-01', 1, 30, 12), s('2026-01-01', 2, 30, 10), s('2026-01-01', 3, 30, 7)];
    expect(nextTarget(e, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'reps', weight: 30, reps: 8 });
  });
  it('goes up at the top of the range even when logged RIR says there was more left', () => {
    const e = [s('2026-01-01', 1, 30, 12, { rir: 4 }), s('2026-01-01', 2, 30, 12)];
    expect(nextTarget(e, 'Curl', S, '2026-01-08')?.kind).toBe('increase');
  });
  it('uses only the top working weight of a ramping session and ignores warmups', () => {
    const e = [s('2026-01-01', 1, 20, 15, { flags: ['warmup'] }), s('2026-01-01', 2, 60, 12), s('2026-01-01', 3, 80, 12), s('2026-01-01', 4, 100, 9)];
    expect(nextTarget(e, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'reps', weight: 100, reps: 10 });
  });
  it('ignores sets logged today and uses the previous session', () => {
    const e = [s('2026-01-01', 1, 30, 12), s('2026-01-01', 2, 30, 12), s('2026-01-08', 1, 35, 6)];
    expect(nextTarget(e, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'increase', weight: 35 });
  });
  it('repeats last time when there are no working sets, and returns null with no history', () => {
    const e = [s('2026-01-01', 1, 0, 15, { flags: ['bodyweight'] }), s('2026-01-01', 2, 0, 12, { flags: ['bodyweight'] })];
    expect(nextTarget(e, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'reps', weight: 0, reps: 13 });
    expect(nextTarget([s('2026-01-01', 1, 40, null, { flags: ['partial'] })], 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'repeat', weight: 40 });
    expect(nextTarget([], 'Curl', S, '2026-01-08')).toBeNull();
  });
  it('caps rep targets at the top of the range', () => {
    const e = [s('2026-01-01', 1, 30, 12), s('2026-01-01', 2, 30, 11)];
    expect(nextTarget(e, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'reps', reps: 12 });
  });
});

describe('estimateRir', () => {
  it('estimates from prior e1RM plus an offset for non-failure training sets, clamped 0..5', () => {
    // prior e1RM 40 → at 30 lb Epley predicts 10 reps; 8 done → 2 short of the recent best, +2 offset → ~4
    expect(estimateRir(s('d', 1, 30, 8), [], 40)).toBe(4);
    expect(estimateRir(s('d', 1, 30, 8), [], 40, 0)).toBe(2);
    expect(estimateRir(s('d', 1, 30, 12), [], 40)).toBe(0);
    expect(estimateRir(s('d', 1, 5, 12), [], 40)).toBe(5);
  });
  it('only estimates the first working set at a weight; later ones are fatigue-confounded', () => {
    const a = s('d', 1, 30, 10), b = s('d', 2, 30, 9), c = s('d', 3, 30, 8);
    expect(estimateRir(a, [a, b, c], 40)).toBe(2);
    expect(estimateRir(b, [a, b, c], 40)).toBeNull();
    expect(estimateRir(c, [a, b, c], 40)).toBeNull();
  });
  it('treats a set followed by a 3+ rep drop at the same weight as near failure', () => {
    const a = s('d', 1, 30, 10), b = s('d', 2, 30, 6);
    expect(estimateRir(a, [a, b], 60)).toBe(1);
  });
  it('returns null when RIR was logged, or for bodyweight/partial, or without any prior', () => {
    expect(estimateRir(s('d', 1, 30, 8, { rir: 2 }), [], 40)).toBeNull();
    expect(estimateRir(s('d', 1, 0, 8, { flags: ['bodyweight'] }), [], 40)).toBeNull();
    expect(estimateRir(s('d', 1, 30, 8), [], null)).toBeNull();
  });
  it('learns the offset from logged RIR once there are 3 samples', () => {
    const base = [s('2026-01-01', 1, 30, 10)]; // prior e1RM 40 → 10 reps predicted at 30 lb
    const logged = ['2026-01-08', '2026-01-15', '2026-01-22'].map((d) => s(d, 1, 30, 10, { rir: 0 }));
    expect(rirOffset(base, 'Curl')).toBe(2);
    expect(rirOffset([...base, ...logged], 'Curl')).toBe(0);
    expect(rirOffset([...base, ...logged.map((x) => ({ ...x, rir: 5 }))], 'Curl')).toBe(3);
  });
});

describe('zero-rep sets', () => {
  it('are not working sets and do not drag the target down', () => {
    expect(isWorking(s('d', 1, 100, 0))).toBe(false);
    const t = nextTarget([s('2026-01-01', 1, 100, 8), s('2026-01-01', 2, 100, 0)], 'Curl', { key: 'curl', repMin: 8, repMax: 12, increment: 5 }, '2026-01-08');
    expect(t?.text).toBe('100 lb × 9+ on every set');
  });
});

describe('priorE1rm and prCheck', () => {
  const e = [s('2026-01-01', 1, 30, 10), s('2026-01-08', 1, 35, 8), s('2026-01-15', 1, 30, 12)];
  it('takes the best of the last three sessions before the date', () => {
    expect(priorE1rm(e, 'Curl', '2026-01-15')).toBeCloseTo(35 * (1 + 8 / 30), 5);
    expect(priorE1rm(e, 'Curl', '2026-01-01')).toBeNull();
  });
  it('flags e1RM PRs and rep PRs at a weight', () => {
    const pr = s('2026-01-22', 1, 35, 10);
    expect(prCheck([...e, pr], pr)).toEqual({ e1rm: true, reps: true });
    const repOnly = s('2026-01-22', 2, 30, 13);
    expect(prCheck([...e, repOnly], repOnly)).toEqual({ e1rm: false, reps: true });
    const none = s('2026-01-22', 3, 30, 9);
    expect(prCheck([...e, none], none)).toEqual({ e1rm: false, reps: false });
  });
  it('does not call the first working set after warm-ups or partials a PR', () => {
    const wu = s('2026-02-01', 1, 20, 15, { flags: ['warmup'], exercise: 'Row' }), first = s('2026-02-01', 2, 60, 10, { exercise: 'Row' });
    expect(prCheck([wu, first], first)).toEqual({ e1rm: false, reps: false });
    const part = s('2026-02-02', 1, 40, null, { flags: ['partial'], exercise: 'Press' }), next = s('2026-02-02', 2, 40, 8, { exercise: 'Press' });
    expect(prCheck([part, next], next)).toEqual({ e1rm: false, reps: false });
  });
});
