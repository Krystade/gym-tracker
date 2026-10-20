import { describe, expect, it } from 'vitest';
import type { SetEntry } from '../types';
import { ladderOf, nextRung } from './ladder';

// Synthetic logs with known gear (generic lift names; no user data): each listed weight is one session's set.
let seq = 0;
const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10);
const sets = (exercise: string, weights: number[], over: Partial<SetEntry> = {}, start = 0): SetEntry[] =>
  weights.map((weight, i) => ({ id: `t|${seq}`, date: day(start + i * 3), seq: seq++, exercise, setNo: 1, weight, reps: 10, flags: [], source: 't', ...over }));
const range = (from: number, to: number, by: number) => Array.from({ length: Math.round((to - from) / by) + 1 }, (_, i) => from + i * by);

// A cable stack in 2.5s, used by several lifts (with his round-number habit: most weights on 5s and 10s).
const cable = [
  ...sets('Cable Curl', [40, 42.5, 45, 47.5, 50, 52.5, 55, 50, 52.5, 57.5]),
  ...sets('Face Pull', [20, 22.5, 25, 27.5, 30, 32.5, 25, 30]),
  ...sets('Cable Pushdown', [50, 52.5, 55, 57.5, 60, 62.5, 65, 60, 70, 72.5, 75]),
  ...sets('Cable Lateral Raise', [10, 12.5, 10, 12.5, 15]),
];

describe('learn/ladder (item 01)', () => {
  it('learns a cable stack in 2.5s from the pool, and a thin cable lift sits on it (its own two weights would say 10)', () => {
    const log = [...cable, ...sets('Overhead Cable Extension', [30, 40], {}, 40)];
    expect(ladderOf(log, 'Cable Curl')).toMatchObject({ step: 2.5, source: 'pool', pool: 'cable' });
    const thin = ladderOf(log, 'Overhead Cable Extension')!;
    expect(thin).toMatchObject({ step: 2.5, source: 'pool' });
    // Discriminating: the same two weights alone pick 10.
    expect(ladderOf(sets('Overhead Cable Extension', [30, 40]), 'Overhead Cable Extension')!.step).toBe(10);
  });

  it('gives a dedicated stack with enough sessions its own coarser step (a seated row in 10s beside a 2.5 cable stack)', () => {
    const row = sets('Seated Cable Row', [100, 110, 120, 130, 120, 130, 140, 130, 140, 150, 140, 150], {}, 60);
    const log = [...cable, ...row];
    expect(ladderOf(log, 'Seated Cable Row')).toMatchObject({ step: 10, source: 'lift' });
    expect(ladderOf(log, 'Cable Curl')!.step).toBe(2.5);
    // Two sessions of it are not enough to leave the pool.
    expect(ladderOf([...cable, ...row.slice(0, 2)], 'Seated Cable Row')!.step).toBe(2.5);
  });

  it('reads past typos and kg conversions (27.25 and 47 in a 2.5 stack)', () => {
    const log = [...cable, ...sets('Cable Pushdown', [27.25, 47], {}, 80)];
    expect(ladderOf(log, 'Cable Pushdown')!.step).toBe(2.5);
    expect(ladderOf(log, 'Cable Pushdown')!.known).not.toContain(27.25);
  });

  it('learns dumbbells in 5s, and each machine from its own stack', () => {
    const log = [
      ...sets('DB Curl', [20, 25, 30, 25, 30, 35]), ...sets('DB Lateral Raise', [10, 15, 20, 15, 20]), ...sets('Hammer Curl', [25, 30, 35, 40]),
      ...sets('Leg Press', range(200, 320, 10), {}, 10), ...sets('Seated Leg Curl', range(100, 150, 5), {}, 10),
    ];
    expect(ladderOf(log, 'DB Curl')).toMatchObject({ step: 5, pool: 'dumbbell' });
    expect(ladderOf(log, 'Leg Press')).toMatchObject({ step: 10, pool: null });
    expect(ladderOf(log, 'Seated Leg Curl')).toMatchObject({ step: 5, pool: null });
  });

  it('has nothing to say from one distinct weight, or none (today’s increment stands)', () => {
    expect(ladderOf(sets('Leg Press', [200, 200, 200]), 'Leg Press')).toBeNull();
    expect(ladderOf([], 'Leg Press')).toBeNull();
  });

  it('learns per gym: a new gym’s own stack once its weights show it, the person’s gear until then', () => {
    const two = [...cable, ...sets('Cable Curl', [40, 50], { gym: 'b' }, 90)];
    expect(ladderOf(two, 'Cable Curl', 'b')!.step).toBe(2.5); // two weights on 10s: the person's cable stack still
    expect(ladderOf(two, 'Face Pull', 'b')!.step).toBe(2.5); // never done at b
    const four = [...cable, ...sets('Cable Curl', [40, 50, 60, 70, 60, 70], { gym: 'b' }, 90)];
    expect(ladderOf(four, 'Cable Curl', 'b')!.step).toBe(10); // b's stack is in 10s
    expect(ladderOf(four, 'Face Pull', 'b')!.step).toBe(10); // and so is every cable lift there
    expect(ladderOf(four, 'Face Pull', '')!.step).toBe(2.5); // home is unchanged
  });

  it('ignores double-pulley weights (half the load: a different ladder)', () => {
    const log = [...cable, ...sets('Cable Pushdown', [33, 41, 37], { flags: ['double_pulley'] }, 70)];
    expect(ladderOf(log, 'Cable Pushdown')!.step).toBe(2.5);
  });

  it('steps to the next rung of an offset grid, or a weight logged in between', () => {
    const l = { step: 10, offset: 2.5, source: 'lift' as const, n: 9, known: [32.5, 37.5, 42.5], pool: null };
    expect(nextRung(l, 32.5)).toBe(37.5); // known add-on weight
    expect(nextRung(l, 42.5)).toBe(52.5);
    expect(nextRung({ ...l, known: [] }, 30)).toBe(32.5);
  });
});
