import { describe, expect, it } from 'vitest';
import { defaultProfile, DEFAULT_TARGETS, type Profile } from './profile';
import { customTiers, fitTargets, weeklyBudget } from './targets';
import type { SetEntry } from './types';

// Synthetic sets only.
let seq = 0;
const set = (date: string, exercise: string): SetEntry => ({ id: `t|${date}|${exercise}|${seq}`, date, seq: seq++, exercise, setNo: 1, weight: 50, reps: 10, flags: [], source: 't' });
const TODAY = '2026-10-06';

describe('weeklyBudget', () => {
  it('takes sets per session from the program, then from your sessions, then 15', () => {
    const p = { ...defaultProfile(), weeklyGoal: 2 };
    expect(weeklyBudget(p, { perSession: 14 }, [], TODAY)).toMatchObject({ sessions: 2, perSession: 14, sets: 28 });
    const day = (date: string, n: number) => [...Array(n)].map(() => set(date, 'Cable Curl'));
    const log = [...day('2026-09-21', 12), ...day('2026-10-01', 10), ...day('2026-09-28', 12), ...day('2026-09-24', 20)];
    expect(weeklyBudget(p, null, log, TODAY).perSession).toBe(12); // the median of 12, 12, 10 and 20
    expect(weeklyBudget(p, null, [set('2026-01-01', 'Cable Curl')], TODAY).perSession).toBe(15); // too old to count
    expect(weeklyBudget(p, null, log.slice(0, 22), TODAY).perSession).toBe(15); // two sessions are too few to go on
  });
});

describe('fitTargets', () => {
  const tiers = (p: Profile, n1: number) => {
    const ms = Object.keys(p.tiers) as (keyof Profile['tiers'])[];
    ms.forEach((m, i) => (p.tiers[m] = i < n1 ? 1 : i < n1 + 4 ? 2 : i < n1 + 9 ? 3 : 4));
    return p;
  };
  it('shrinks every range to fit the week, keeping priority 1 the largest', () => {
    const p = tiers(defaultProfile(), 4);
    const f = fitTargets(p, { sets: 28, sessions: 2, perSession: 14 }, 1.5);
    expect(f.scale).toBeLessThan(1);
    const t = f.targets;
    expect(t[1][1]).toBeLessThan(DEFAULT_TARGETS[1][1]);
    expect(t[1][0]).toBeGreaterThanOrEqual(t[2][0]);
    expect(t[2][0]).toBeGreaterThanOrEqual(t[3][0]);
    for (const tier of [1, 2, 3, 4] as const) { expect(t[tier][1]).toBeGreaterThanOrEqual(t[tier][0]); expect(t[tier][1]).toBeGreaterThanOrEqual(1); expect((t[tier][0] * 2) % 1).toBe(0); }
    // Every muscle at its midpoint fills about the capacity, no more.
    const mid = (Object.values(p.tiers) as (1 | 2 | 3 | 4)[]).reduce((a, tier) => a + (t[tier][0] + t[tier][1]) / 2, 0);
    expect(mid).toBeLessThanOrEqual(28 * 1.5 + 9); // rounding to 0.5 on 18 muscles
    expect(mid).toBeGreaterThan(28 * 1.5 * 0.7);
  });
  it('leaves the defaults alone when the week has room for them', () => {
    const f = fitTargets(tiers(defaultProfile(), 4), { sets: 200, sessions: 5, perSession: 40 }, 1.5);
    expect(f.scale).toBe(1);
    expect(f.targets).toEqual(DEFAULT_TARGETS);
  });
  it('keeps a hand-set range and takes it out of the budget first', () => {
    const p = { ...tiers(defaultProfile(), 4), custom: [1 as const], targets: { ...DEFAULT_TARGETS, 1: [10, 12] as [number, number] } };
    const mine = fitTargets(p, { sets: 28, sessions: 2, perSession: 14 }, 1.5);
    const auto = fitTargets({ ...p, custom: [] }, { sets: 28, sessions: 2, perSession: 14 }, 1.5);
    expect(mine.targets[1]).toEqual([10, 12]);
    expect(mine.targets[2][1]).toBeLessThan(auto.targets[2][1]); // what's left is shared by the rest
  });
});

describe('customTiers', () => {
  it('reads a saved profile without the field: tiers that differ from the defaults are hand-set', () => {
    const old = { ...defaultProfile(), targets: { ...DEFAULT_TARGETS, 2: [6, 9] as [number, number] } };
    delete (old as Partial<Profile>).custom;
    expect(customTiers(old)).toEqual([2]);
    expect(customTiers({ ...old, custom: [] })).toEqual([]);
  });
});
