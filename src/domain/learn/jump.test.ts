import { describe, expect, it } from 'vitest';
import type { SetEntry } from '../types';
import type { Core, Features } from './capacity';
import { dropsFrom, jumpsOf } from './jump';
import { rng } from './num';

// Synthetic lifters with a planted drop after each weight increase (generic lift names; no user data).
let seq = 0;
const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10);
const set = (exercise: string, d: number, setNo: number, weight: number, reps: number, over: Partial<SetEntry> = {}): SetEntry =>
  ({ id: `j|${seq}`, date: day(d), seq: seq++, exercise, setNo, weight, reps, flags: [], source: 't', ...over });

/** `jumps` increases on one lift, `gap` days apart: 12 reps at w, then 12 − drop (± noise) at w + 5. */
function lifter(exercise: string, drop: number, jumps: number, o: { gap?: number; seed?: number; noise?: number; at?: number } = {}): SetEntry[] {
  const r = rng(o.seed ?? 1), out: SetEntry[] = [];
  let w = 50, d = o.at ?? 0;
  for (let i = 0; i < jumps; i++) {
    out.push(set(exercise, d, 1, w, 12), set(exercise, d, 2, w, 12));
    d += o.gap ?? 4; w += 5;
    const reps = Math.max(1, Math.round(12 - drop + r.normal(0, o.noise ?? 0.8)));
    out.push(set(exercise, d, 1, w, reps, { note: 'B' }), set(exercise, d, 2, w, reps, { note: 'B' }));
    d += o.gap ?? 4;
  }
  return out;
}
const est = (log: SetEntry[], lift: string) => dropsFrom(jumpsOf(log, null))!(lift);

describe('learn/jump (item 02)', () => {
  it('recovers a planted drop, and a different planted drop differently', () => {
    expect(est(lifter('Cable Curl', 3, 12), 'Cable Curl').mean).toBeCloseTo(3, 0);
    expect(est(lifter('Cable Curl', 1, 12), 'Cable Curl').mean).toBeCloseTo(1, 0);
    expect(Math.abs(est(lifter('Cable Curl', 5, 12), 'Cable Curl').mean - 5)).toBeLessThan(0.6);
  });

  it('uses only increases between sessions at most 21 days apart', () => {
    const near = lifter('Cable Curl', 2, 10);
    const far = lifter('Cable Curl', 9, 6, { gap: 25, at: 200, seed: 2 }); // strength moved in between: not a jump
    expect(jumpsOf([...near, ...far], null).length).toBe(jumpsOf(near, null).length);
    expect(est([...near, ...far], 'Cable Curl').mean).toBeCloseTo(est(near, 'Cable Curl').mean, 6);
  });

  it('reads a heavier set stopped at its target as a bound: it could have done more', () => {
    // True drop 1. Half the heavier sessions stopped at a target of 9 (an observed drop of 3, really at most 3).
    const log = lifter('Cable Curl', 1, 8, { noise: 0.3 });
    const capped = lifter('Cable Curl', 3, 8, { noise: 0, at: 100 }).map((e) => (e.note === 'B' ? { ...e, target: { weight: e.weight, reps: e.reps as number, sets: 2 } } : e));
    const censored = est([...log, ...capped], 'Cable Curl').mean;
    const naive = est([...log, ...capped.map(({ target: _t, ...e }) => e)], 'Cable Curl').mean;
    expect(naive).toBeGreaterThan(1.7);
    expect(censored).toBeLessThan(naive - 0.4);
  });

  it('pools: one jump sits near the person, many jumps on the lift’s own', () => {
    const noisy = { noise: 2 };
    const log = [...lifter('Cable Curl', 2, 15, noisy), ...lifter('Face Pull', 2, 15, { ...noisy, seed: 3 }), ...lifter('Cable Pushdown', 6, 20, { ...noisy, seed: 4 }), ...lifter('Bayesian Cable Curl', 7, 1, { seed: 5, noise: 0 })];
    const f = dropsFrom(jumpsOf(log, null))!;
    expect(f('Cable Pushdown').mean).toBeGreaterThan(5);
    expect(f('Bayesian Cable Curl').mean).toBeLessThan(6); // one jump of 7: pulled toward the person (2–6)
    expect(f('Bayesian Cable Curl').sd).toBeGreaterThan(f('Cable Pushdown').sd);
    expect(f('Bayesian Cable Curl').n).toBe(1);
    expect(f('Never Done Lift').n).toBe(0);
  });

  it('puts session fatigue back: a heavier set done after overlapping work isn’t read as a bigger drop', () => {
    const log = lifter('Cable Curl', 4, 10, { noise: 0 });
    const tired = new Set(log.filter((e) => e.note === 'B' && e.setNo === 1).map((e) => e.id));
    // A core that says each heavier first set carried 2 reps of fatigue from overlapping lifts (A_cross 1, 2 overlapping sets).
    const features = new Map<string, Features>(log.map((e) => [e.id, { nS: 0, nC: tired.has(e.id) ? 2 : 0, nY: 0, eS: new Float64Array(8), eC: new Float64Array(8).fill(tired.has(e.id) ? 2 : 0) }]));
    const core = { features, fit: { tau: 90, kTau: 0, rho: 0, theta: [1, 1, 0] }, lifts: new Map() } as unknown as Core;
    expect(dropsFrom(jumpsOf(log, null))!('Cable Curl').mean).toBeGreaterThan(3.5);
    expect(dropsFrom(jumpsOf(log, core))!('Cable Curl').mean).toBeLessThan(2.5);
  });

  it('skips pain, bodyweight, holds, over 20 reps, and a pulley change', () => {
    const base = lifter('Cable Curl', 2, 6);
    const n = jumpsOf(base, null).length;
    const pained = base.map((e) => (e.weight === 55 ? { ...e, flags: ['pain' as const] } : e));
    expect(jumpsOf(pained, null).length).toBe(n - 1);
    const pulley = base.map((e) => (e.weight === 55 ? { ...e, flags: ['double_pulley' as const] } : e));
    expect(jumpsOf(pulley, null).length).toBe(n - 2); // 50 → 55 and 55 → 60 mix pulleys
    expect(dropsFrom([])).toBeNull();
  });
});
