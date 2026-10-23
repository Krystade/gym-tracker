import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { defaultSettings, estimateRir, isProgressionSet, isWorking, nextTarget, priorE1rm, rirOffset, settingsKey } from './progression';
import { prKinds } from './records';

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
  it('defaults a hold, known by name or by its log, to 20–40 s', () => {
    expect(defaultSettings('Plank')).toMatchObject({ repMin: 20, repMax: 40 });
    expect(defaultSettings('Wall Sit Hold X', true)).toMatchObject({ repMin: 20, repMax: 40 });
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
    const e = [s('2026-01-01', 1, 30, 11), s('2026-01-01', 2, 30, 11), s('2026-01-01', 3, 30, 11)]; // 33: one short of going up
    expect(nextTarget(e, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'reps', reps: 12 });
  });
  it('goes up once total reps at the top weight reach sets × top of range − 2', () => {
    const day = (...reps: number[]) => reps.map((r, i) => s('2026-01-01', i + 1, 30, r));
    expect(nextTarget(day(12, 12, 10), 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'increase', weight: 35, reps: 8 }); // 34 of 34
    expect(nextTarget(day(12, 10, 10), 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'reps', weight: 30, reps: 11 }); // 32
    // Enough in total, but a set below the bottom of the range: stay.
    expect(nextTarget(day(15, 15, 7), 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'reps', weight: 30, reps: 8 });
    // One heavier top set gets no slack: 35 × 10 after two at 30 isn't the top of the range.
    const top = [s('2026-01-01', 1, 30, 12), s('2026-01-01', 2, 30, 12), s('2026-01-01', 3, 35, 10)];
    expect(nextTarget(top, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'reps', weight: 35, reps: 11 });
  });
});

describe('test sets', () => {
  const test = (date: string, setNo: number, weight: number, reps: number, rir = 0) => s(date, setNo, weight, reps, { flags: ['test'], rir });
  it('count toward progression as e1RM evidence (owner, 2026-10-19)', () => {
    // An AMRAP test after the working sets: 30 × 12, e1RM 42, puts 12 reps within reach at 30, the range's top, so it goes up,
    // though 12 + 10 alone is 22 of 2 × 12 − 1.
    const e = [s('2026-01-01', 1, 30, 12), s('2026-01-01', 2, 30, 10), test('2026-01-01', 3, 30, 12)];
    expect(nextTarget(e, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'increase', weight: 35, reps: 8, done: { total: 22, sets: 2 }, byTest: { weight: 30, reps: 12, at: 30 } });
    // Without it, the reps climb.
    expect(nextTarget(e.slice(0, 2), 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'reps', weight: 30 });
    // A heavier test isn't the weight the sets aim at: 30 × 12, 12 topped the range, so up to 35 by the sets themselves.
    const heavier = [s('2026-01-01', 1, 30, 12), s('2026-01-01', 2, 30, 12), test('2026-01-01', 3, 35, 9)];
    expect(nextTarget(heavier, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'increase', weight: 35, reps: 8 });
    expect(nextTarget(heavier, 'Curl', S, '2026-01-08')!.byTest).toBeUndefined();
    // An older test doesn't override working sets done since.
    const later = [test('2025-12-20', 1, 60, 1), s('2026-01-01', 1, 30, 10), s('2026-01-01', 2, 30, 10)];
    expect(nextTarget(later, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'reps', weight: 30, reps: 11 });
    expect(isProgressionSet(test('2026-01-01', 1, 30, 12))).toBe(true);
    expect(isProgressionSet(s('2026-01-01', 1, 30, 12, { flags: ['test', 'warmup'] }))).toBe(false);
  });
  it('in a working session are strength, not rep targets: a test single never becomes the sets to repeat (owner, 2026-10-23)', () => {
    // DB curl, 3 planned, Oct 12: 45 × 1 (a test), 35 × 9, 35 × 7. Was "1 · 1 · 1 @ 45 lb": the single read as the top set.
    const DB = { key: 'db curl', repMin: 10, repMax: 15, increment: 5 };
    const e = [test('2026-10-12', 1, 45, 1), s('2026-10-12', 2, 35, 9), s('2026-10-12', 3, 35, 7)];
    const t = nextTarget(e, 'Curl', DB, '2026-10-23', 3)!;
    expect(t).toMatchObject({ kind: 'reps', weight: 35, perSet: [10, 8, 8] });
    expect(t.text).toBe('35 lb × 10 · 8 · 8');
    // Its e1RM (45 lb, about 8.6 reps at 35) is a line of its own, and doesn't top the range.
    expect(t.parts.find((p) => p.key === 'test')).toMatchObject({ what: 'Your test set', value: expect.stringContaining('45 lb × 1') });
  });
  it('a test newer than the last working session resets the weight to its e1RM at the top of the range', () => {
    const base = [s('2026-01-01', 1, 30, 10), s('2026-01-01', 2, 30, 10)];
    // A 50 lb single: e1RM 50, 50 / (1 + 12/30) ≈ 35.7, to the 5 lb step: 35.
    expect(nextTarget([...base, test('2026-01-04', 1, 50, 1)], 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'test', weight: 35, reps: 8 });
    // An AMRAP stopped 2 short counts its reps in reserve: 40 × (1 + 10/30) ≈ 53.3 → 38.1 → 40. The best test wins.
    const amrap = [...base, test('2026-01-04', 1, 40, 8, 2), test('2026-01-04', 2, 40, 5)];
    expect(nextTarget(amrap, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'test', weight: 40, reps: 8 });
    // With no working session before it, too.
    expect(nextTarget([test('2026-01-04', 1, 50, 1)], 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'test', weight: 35 });
    // A lift on a 2.5 lb step rounds to it.
    expect(nextTarget([...base, test('2026-01-04', 1, 50, 1)], 'Curl', { ...S, increment: 2.5 }, '2026-01-08')).toMatchObject({ weight: 35 });
    expect(nextTarget([...base, test('2026-01-04', 1, 52, 1)], 'Curl', { ...S, increment: 2.5 }, '2026-01-08')).toMatchObject({ weight: 37.5 });
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
  it('a late set done first at a weight makes the others not first', () => {
    const late = s('d', 3, 30, 10), a = s('d', 1, 30, 9), b = s('d', 2, 30, 9);
    expect(estimateRir(a, [late, a, b], 40)).toBeNull();
    expect(estimateRir(late, [late, a, b], 40)).toBe(2);
  });
  it('the next set is the one done next, not the next set number', () => {
    const late = s('d', 3, 30, 10), a = s('d', 1, 30, 6);
    expect(estimateRir(late, [late, a], null)).toBe(1);
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
    expect(t?.text).toBe('100 lb × 9');
  });
});

describe('priorE1rm, and PRs at a weight', () => {
  const e = [s('2026-01-01', 1, 30, 10), s('2026-01-08', 1, 35, 8), s('2026-01-15', 1, 30, 12)];
  const kinds = (all: SetEntry[], set: SetEntry) => [...(prKinds(all).get(set.id) ?? [])].sort();
  it('takes the best of the last three sessions before the date', () => {
    expect(priorE1rm(e, 'Curl', '2026-01-15')).toBeCloseTo(35 * (1 + 8 / 30), 5);
    expect(priorE1rm(e, 'Curl', '2026-01-01')).toBeNull();
  });
  it('flags e1RM PRs and rep PRs at a weight (the shared rule in domain/records)', () => {
    const pr = s('2026-01-22', 1, 35, 10);
    expect(kinds([...e, pr], pr)).toEqual(['e1rm', 'reps', 'rm10']);
    const more = s('2026-01-22', 2, 30, 13);
    expect(kinds([...e, more], more)).toEqual(['reps', 'sessionVolume', 'setVolume']);
    const none = s('2026-01-22', 3, 30, 9);
    expect(kinds([...e, none], none)).toEqual([]);
  });
  it('does not call the first working set after warm-ups or partials a PR', () => {
    const wu = s('2026-02-01', 1, 20, 15, { flags: ['warmup'], exercise: 'Row' }), first = s('2026-02-01', 2, 60, 10, { exercise: 'Row' });
    expect(kinds([wu, first], first)).toEqual([]);
    const part = s('2026-02-02', 1, 40, null, { flags: ['partial'], exercise: 'Press' }), next = s('2026-02-02', 2, 40, 8, { exercise: 'Press' });
    expect(kinds([part, next], next)).toEqual([]);
  });
});

describe('rirOffset learns from first sets only', () => {
  it('ignores later same-weight sets, which are fatigue-confounded', () => {
    const base = [s('2026-01-01', 1, 30, 10)];
    const days = ['2026-01-08', '2026-01-15', '2026-01-22'];
    const first = days.map((d) => s(d, 1, 30, 10, { rir: 2 }));
    const later = days.map((d) => s(d, 2, 30, 6, { rir: 2 })); // 4 short of best at RIR 2 → would drag the mean offset from 2 to 0
    expect(rirOffset([...base, ...first, ...later], 'Curl')).toBe(2);
  });
});

describe('nextTarget for a bodyweight hold', () => {
  const H = { key: 'plank', repMin: 20, repMax: 40, increment: 5 };
  const p = (date: string, setNo: number, secs: number): SetEntry =>
    ({ id: `p|${date}|${setNo}`, date, seq: seq++, exercise: 'Plank', setNo, weight: 0, reps: secs, flags: ['hold', 'bodyweight'], source: 't' });
  it('adds 5 s up to the top of the range', () => {
    expect(nextTarget([p('2026-10-01', 1, 30), p('2026-10-01', 2, 30)], 'Plank', H, '2026-10-02')).toMatchObject({ kind: 'reps', weight: 0, reps: 35 });
    expect(nextTarget([p('2026-10-01', 1, 38), p('2026-10-01', 2, 38)], 'Plank', H, '2026-10-02')).toMatchObject({ reps: 40 });
  });
  it('at the top, keeps the time and says to add weight or move to a harder variation', () => {
    const t = nextTarget([p('2026-10-01', 1, 40), p('2026-10-01', 2, 45)], 'Plank', H, '2026-10-02')!;
    expect(t).toMatchObject({ kind: 'maxed', weight: 0, reps: 40 });
    expect(t.text).toMatch(/harder variation/);
  });
});

describe('nextTarget with the sets the plan has today (owner, 2026-10-19)', () => {
  const lift = (exercise: string, date: string, weight: number, reps: number[]): SetEntry[] =>
    reps.map((r, i) => ({ ...s(date, i + 1, weight, r), exercise, id: `t|${date}|${exercise}|${i}|${seq}` }));
  const push = lift('Cable Pushdown', '2026-10-15', 120, [11, 11, 8]);
  const crunch = lift('Cable Crunch', '2026-10-15', 70, [7, 7, 7, 9]);
  const at = (log: SetEntry[], ex: string, planned?: number | null) => nextTarget(log, ex, defaultSettings(ex), '2026-10-19', planned);

  it('goes from the best N sets at the top weight when the plan has N and last time had more: 120 × 11, 11, 8 at 2 sets → 12+', () => {
    expect(at(push, 'Cable Pushdown')).toMatchObject({ kind: 'reps', weight: 120, reps: 9 }); // unknown plan: the weakest set, as ever
    expect(at(push, 'Cable Pushdown', null)).toMatchObject({ kind: 'reps', reps: 9 });
    expect(at(push, 'Cable Pushdown', 2)).toMatchObject({ kind: 'reps', weight: 120, reps: 12, text: '120 lb × 12 · 12' });
    expect(at(push, 'Cable Pushdown', 3)).toMatchObject({ reps: 9 });
    expect(at(push, 'Cable Pushdown', 5)).toMatchObject({ reps: 9 }); // more planned than done: all of them
    expect(at(push, 'Cable Pushdown', 1)).toMatchObject({ reps: 12 });
  });

  it('is unchanged when the plan has as many sets as were done: 70 × 7, 7, 7, 9 at 4 sets → 8+', () => {
    expect(at(crunch, 'Cable Crunch', 4)).toMatchObject({ kind: 'reps', weight: 70, reps: 8 });
    expect(at(crunch, 'Cable Crunch')).toMatchObject({ reps: 8 });
    expect(at(crunch, 'Cable Crunch', 1)).toMatchObject({ reps: 10 });
  });

  it('goes up when the best N are at the top of the range, and says so for N sets', () => {
    const log = lift('Cable Pushdown', '2026-10-15', 120, [15, 15, 9]);
    expect(at(log, 'Cable Pushdown')).toMatchObject({ kind: 'reps', reps: 10 });
    expect(at(log, 'Cable Pushdown', 2)).toMatchObject({ kind: 'increase', weight: 125, reps: 10, done: { total: 30, sets: 2 } });
  });

  it('reaches the program’s rows and the card through suggest', async () => {
    const { suggest } = await import('./suggest');
    expect(suggest(push, 'Cable Pushdown', defaultSettings('Cable Pushdown'), '2026-10-19', 2)).toMatchObject({ sets: 2, reps: 12, weight: 120 });
    expect(suggest(push, 'Cable Pushdown', defaultSettings('Cable Pushdown'), '2026-10-19', null)).toMatchObject({ sets: 3, reps: 9 });
  });
});

describe('per-set rep targets (owner, 2026-10-19): each set from last time’s same set, and learnt from targets hit', () => {
  let n = 0;
  /** A session of Cable Pushdown at 120: reps, with RIR and the per-set targets it was given where passed. */
  const day = (date: string, reps: number[], o: { rir?: (number | undefined)[]; targets?: number[]; weight?: number } = {}): SetEntry[] =>
    reps.map((r, i) => ({
      id: `ps|${n}`, date, seq: n++, exercise: 'Cable Pushdown', setNo: i + 1, weight: o.weight ?? 120, reps: r, flags: [], source: 't',
      ...(o.rir?.[i] != null && { rir: o.rir[i] }),
      ...(o.targets && { target: { weight: 120, reps: o.targets[Math.min(i, o.targets.length - 1)], sets: o.targets.length } }),
    }));
  const st = defaultSettings('Cable Pushdown'); // 10–15
  const t = (log: SetEntry[], planned?: number | null) => nextTarget(log, 'Cable Pushdown', st, '2026-10-19', planned)!;

  it('11, 11, 8 → 12 · 12 · 9; the best 2 with 2 planned; the last again for a set more than last time', () => {
    expect(t(day('2026-10-15', [11, 11, 8]))).toMatchObject({ kind: 'reps', weight: 120, reps: 9, perSet: [12, 12, 9], text: '120 lb × 12 · 12 · 9' });
    expect(t(day('2026-10-15', [11, 11, 8]), 2).perSet).toEqual([12, 12]);
    expect(t(day('2026-10-15', [11, 8, 11]), 2).perSet).toEqual([12, 12]); // the best two, in the order done
    expect(t(day('2026-10-15', [10, 8, 12]), 2).perSet).toEqual([11, 13]);
    expect(t(day('2026-10-15', [11, 11, 8]), 4).perSet).toEqual([12, 12, 9, 9]);
  });

  it('Cable Crunch 70 × 7, 7, 7, 9 at 4 sets → 8 · 8 · 8 · 10', () => {
    const crunch = [7, 7, 7, 9].map((r, i): SetEntry => ({ id: `cc|${i}`, date: '2026-10-15', seq: n++, exercise: 'Cable Crunch', setNo: i + 1, weight: 70, reps: r, flags: [], source: 't' }));
    expect(nextTarget(crunch, 'Cable Crunch', defaultSettings('Cable Crunch'), '2026-10-19', 4)).toMatchObject({ reps: 8, perSet: [8, 8, 8, 10] });
  });

  it('never targets past a set’s capacity, reps + RIR: a set at RIR 0 gets no rep; unknown RIR caps nothing', () => {
    expect(t(day('2026-10-15', [11, 11, 8], { rir: [2, 1, 0] })).perSet).toEqual([12, 12, 8]);
    expect(t(day('2026-10-15', [11, 11, 8], { rir: [0, undefined, 0] })).perSet).toEqual([11, 12, 8]);
    // Every set at its limit: last time again.
    const limit = t(day('2026-10-15', [11, 11, 8], { rir: [0, 0, 0] }));
    expect(limit.perSet).toEqual([11, 11, 8]);
    expect(limit.why).toMatch(/limit/);
    // Never past the top of the range either.
    expect(t(day('2026-10-15', [15, 13, 9])).perSet).toEqual([15, 14, 10]);
  });

  it('after targets hit, +1 on every set', () => {
    const log = [...day('2026-10-12', [11, 11, 8], { targets: [11, 10, 8] }), ...day('2026-10-15', [12, 12, 9], { targets: [12, 12, 9] })];
    expect(t(log)).toMatchObject({ perSet: [13, 13, 10] });
    expect(t(log).why).toMatch(/hit/);
  });

  it('after a miss, +1 on the one set with the most room (RIR, else the weakest), not on every set', () => {
    const missed = day('2026-10-15', [12, 11, 9], { targets: [12, 12, 9] });
    expect(t(missed).perSet).toEqual([12, 11, 10]);
    expect(t(missed).why).toMatch(/missed/i);
    expect(t(day('2026-10-15', [12, 11, 9], { targets: [12, 12, 9], rir: [2, 0, 1] })).perSet).toEqual([13, 11, 9]);
  });

  it('missed twice in the last 3: repeat last time; a hit since starts it climbing again', () => {
    const twice = [...day('2026-10-08', [11, 10, 8], { targets: [11, 11, 8] }), ...day('2026-10-12', [12, 12, 9], { targets: [12, 11, 9] }), ...day('2026-10-15', [12, 11, 9], { targets: [13, 12, 9] })];
    expect(t(twice)).toMatchObject({ kind: 'reps', perSet: [12, 11, 9] });
    expect(t(twice).why).toMatch(/repeat/i);
    // A miss 4 sessions back is out of the window: one miss in the last 3 is +1 on one set.
    const old = [...day('2026-10-01', [11, 10, 8], { targets: [11, 11, 8] }), ...day('2026-10-05', [11, 11, 8], { targets: [11, 11, 8] }),
      ...day('2026-10-08', [11, 11, 8], { targets: [11, 11, 8] }), ...day('2026-10-12', [11, 11, 8], { targets: [12, 11, 8] })];
    expect(t(old).perSet).toEqual([11, 11, 9]);
    const back = [...twice, ...day('2026-10-17', [12, 11, 9], { targets: [12, 11, 9] })];
    expect(nextTarget(back, 'Cable Pushdown', st, '2026-10-20')!.perSet).toEqual([13, 12, 10]);
  });

  it('reads a target at another weight as no target, and a set past the planned count as no part of it', () => {
    // Went up 5 lb against a 120 target: nothing to judge, so +1 on every set from the new weight.
    const heavier = day('2026-10-15', [10, 9, 8], { targets: [12, 12, 9], weight: 125 });
    expect(t(heavier).perSet).toEqual([11, 10, 9]);
    // 2 targeted sets, both hit; a third set beyond them doesn't count as a miss.
    const extra = day('2026-10-15', [12, 12, 7], { targets: [12, 12] });
    expect(t(extra).perSet).toEqual([13, 13, 8]);
  });

  it('keeps the weight increase, test, carry and the bodyweight hold as they were', () => {
    expect(t(day('2026-10-15', [15, 15, 14]))).toMatchObject({ kind: 'increase', weight: 125, reps: 10 });
    expect(t(day('2026-10-15', [15, 15, 14])).perSet).toBeUndefined();
  });

  it('reaches the card through suggest: as many targets as sets', async () => {
    const { suggest } = await import('./suggest');
    expect(suggest(day('2026-10-15', [11, 11, 8]), 'Cable Pushdown', st, '2026-10-19', 2)).toMatchObject({ sets: 2, perSet: [12, 12], reps: 12 });
    expect(suggest(day('2026-10-15', [11, 11, 8]), 'Cable Pushdown', st, '2026-10-19', null)).toMatchObject({ sets: 3, perSet: [12, 12, 9] });
  });
});

describe('learned steps, drops and ranges (items 01–03, 2026-10-20)', () => {
  // A cable lifter: a stack in 2.5s, and weight increases that cost `drop` reps on the first heavier sets.
  const lift = (exercise: string, from: number, jumps: number, drop: number, start = 0, by = 2.5): SetEntry[] => {
    const out: SetEntry[] = [];
    let d = start, w = from;
    const at = (i: number) => new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10);
    for (let i = 0; i < jumps; i++) {
      for (const r of [15, 15, 14]) out.push(s(at(d), out.length + 1, w, r, { exercise }));
      d += 4; w += by;
      for (const r of [15 - drop, 15 - drop, 14 - drop]) out.push(s(at(d), out.length + 1, w, r, { exercise }));
      d += 4;
    }
    return out;
  };
  const C = { key: 'cable curl', repMin: 10, repMax: 15, increment: 5 };
  const history = [...lift('Cable Curl', 40, 6, 2), ...lift('Face Pull', 20, 6, 2, 1), ...lift('Cable Pushdown', 50, 6, 2, 2)];
  const lastDay = history.reduce((a, e) => (e.date > a ? e.date : a), '');
  const topped = (exercise: string, w: number) => [15, 15, 14].map((r, i) => s(lastDay, 90 + i, w, r, { exercise }));
  const next = '2026-06-01';

  it('goes up one learned rung (2.5 on a cable stack), each set last time’s less the learned drop', () => {
    const t = nextTarget([...history, ...topped('Cable Curl', 60)], 'Cable Curl', C, next)!;
    expect(t).toMatchObject({ kind: 'increase', weight: 62.5, step: 2.5, perSet: [13, 13, 12], reps: 12 });
    expect(t.drop!.mean).toBeCloseTo(2, 0);
    expect(t.why).toContain('your cable steps');
  });

  it('floors a fractional drop: a miss costs more than an easy day', () => {
    // Increases that cost 2 and 3 reps in turn: about 2.5 learned.
    const mixed = [...lift('Cable Curl', 40, 4, 2), ...lift('Cable Curl', 50, 4, 3, 40), ...lift('Face Pull', 20, 6, 2, 1), ...lift('Cable Pushdown', 50, 6, 3, 2)];
    const t = nextTarget([...mixed, ...[15, 15, 14].map((r, i) => s('2026-05-30', 400 + i, 60, r, { exercise: 'Cable Curl' }))], 'Cable Curl', C, next)!;
    const frac = t.drop!.mean % 1;
    expect(frac).toBeGreaterThan(0.25);
    expect(frac).toBeLessThan(0.75);
    expect(t.perSet).toEqual([15, 15, 14].map((r) => Math.floor(r - t.drop!.mean)));
  });

  it('keeps a typed increment, and today’s rules with nothing to learn from', () => {
    expect(nextTarget([...history, ...topped('Cable Curl', 60)], 'Cable Curl', { ...C, increment: 10 }, next)).toMatchObject({ weight: 70, step: 10 });
    const alone = topped('Cable Curl', 60);
    expect(nextTarget(alone, 'Cable Curl', C, next)).toMatchObject({ kind: 'increase', weight: 65, reps: 10 });
    expect(nextTarget(alone, 'Cable Curl', C, next)!.perSet).toBeUndefined();
  });

  it('raises the top of the range when this lift’s jumps cost more than the range is wide', () => {
    // DB curls in 5s whose increases cost 7 reps: 10–15 can't absorb that, so build to 17 first.
    const db = [...lift('Incline DB Curl', 20, 6, 7, 0, 5), ...topped('Incline DB Curl', 35)];
    const t = nextTarget(db, 'Incline DB Curl', C, next)!;
    expect(t.kind).toBe('reps');
    expect(t.range).toMatchObject({ repMin: 10, repMax: 17, how: 'top' });
    expect(t.perSet).toEqual([16, 16, 15]);
    expect(t.why).toContain('to 17 before going up');
    // At 17s it goes up, and lands inside the range.
    const built = [...db, ...[17, 17, 16].map((r, i) => s('2026-05-30', 200 + i, 35, r, { exercise: 'Incline DB Curl' }))];
    const up = nextTarget(built, 'Incline DB Curl', C, next)!;
    expect(up).toMatchObject({ kind: 'increase', weight: 40 });
    expect(Math.min(...up.perSet!)).toBeGreaterThanOrEqual(9);
  });

  it('learns only from days before the target’s day: today’s sets never move today’s target', () => {
    const log = [...history, ...topped('Cable Curl', 60)];
    const before = nextTarget(log, 'Cable Curl', C, next)!;
    // Today: a 62.5 session that dropped 9 reps.
    const today = [6, 6].map((r, i) => s(next, 300 + i, 62.5, r, { exercise: 'Cable Curl' }));
    expect(nextTarget([...log, ...today], 'Cable Curl', C, next)).toEqual(before);
  });
});
