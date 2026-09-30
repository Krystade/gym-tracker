import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { CATALOG } from './catalog';
import { MUSCLES, muscleVector, type Muscle } from './muscles';
import { defaultProfile, type Profile, type Tier } from './profile';
import { adherence, buildProgram, DEFAULT_PICK, nextDay, primaryExercise, programVolume, type DayPlan, type Program } from './program';

let seq = 0;
const s = (date: string, exercise: string, reps = 10, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `t${seq}`, date, seq: seq++, exercise, setNo: 1, weight: 50, reps, flags: [], source: 't', ...over,
});
const NOW = new Date('2026-09-30T12:00:00Z');
const total = (p: Program, d: number) => p.days[d].slots.reduce((a, x) => a + x.sets, 0);
const withTiers = (t: Partial<Record<Muscle, Tier>>, rest: Tier): Profile => {
  const p = defaultProfile();
  for (const m of MUSCLES) p.tiers[m] = t[m] ?? rest;
  return p;
};

describe('buildProgram', () => {
  it('builds a bounded program from catalog defaults with no history', () => {
    const p = buildProgram(defaultProfile(), [], { days: 2, perSession: 14 }, NOW);
    expect(p.days.map((d) => d.name)).toEqual(['Day A', 'Day B']);
    for (const d of [0, 1]) expect(total(p, d)).toBeLessThanOrEqual(14);
    expect(total(p, 0) + total(p, 1)).toBeGreaterThanOrEqual(26);
    for (const slot of p.days.flatMap((d) => d.slots)) {
      expect(slot.sets).toBeGreaterThanOrEqual(1);
      expect(slot.sets).toBeLessThanOrEqual(4);
      expect(CATALOG).toContain(slot.exercise);
    }
  });
  it('puts priority muscles first and gives them the volume', () => {
    const p = buildProgram(withTiers({ Biceps: 1, Triceps: 1, Abs: 1 }, 4), [], { days: 2, perSession: 14 }, NOW);
    const first = muscleVector(p.days[0].slots[0].exercise)!;
    expect(['Biceps', 'Triceps', 'Abs'].some((m) => first[m as Muscle] === 1)).toBe(true);
    const v = programVolume(p);
    for (const m of ['Biceps', 'Triceps', 'Abs'] as Muscle[]) expect(v[m]).toBeGreaterThanOrEqual(8);
    expect(v.Quads).toBeLessThan(v.Biceps);
  });
  it('still trains lower tiers a little, and never programs a 1-set slot', () => {
    const tiers = { Biceps: 1, Triceps: 1, Abs: 1, 'Side Delts': 2, 'Rear Delts': 2, Chest: 3, 'Front Delts': 3, Lats: 3, 'Mid-Back': 3, Traps: 3, Erectors: 3 } as const;
    const p = buildProgram(withTiers(tiers, 4), [], { days: 2, perSession: 14 }, NOW);
    const v = programVolume(p);
    expect(v.Chest + v.Lats + v['Mid-Back']).toBeGreaterThanOrEqual(2);
    expect(v['Side Delts']).toBeGreaterThanOrEqual(4);
    for (const slot of p.days.flatMap((d) => d.slots)) expect(slot.sets).toBeGreaterThanOrEqual(2);
  });
  it('honours 3 days of 10', () => {
    const p = buildProgram(defaultProfile(), [], { days: 3, perSession: 10 }, NOW);
    expect(p.days).toHaveLength(3);
    for (const d of [0, 1, 2]) expect(total(p, d)).toBeLessThanOrEqual(10);
  });
});

describe('primaryExercise', () => {
  it('prefers the most-logged direct exercise, else the default', () => {
    const e = [...Array.from({ length: 10 }, () => s('2026-09-01', 'Bayesian Cable Curl')), s('2026-09-01', 'DB Curl'), s('2026-09-02', 'DB Curl')];
    expect(primaryExercise('Biceps', e)).toBe('Bayesian Cable Curl');
    expect(primaryExercise('Biceps', [])).toBe(DEFAULT_PICK.Biceps);
  });
  it('steers away from a lift that recently drew pain, and favours recent use', () => {
    const hurt = [...Array.from({ length: 12 }, () => s('2026-06-01', 'Overhead DB Triceps Extension')), s('2026-09-07', 'Overhead DB Triceps Extension', 10, { flags: ['pain'] })];
    const ok = Array.from({ length: 6 }, () => s('2026-09-20', 'Cable Pushdown'));
    expect(primaryExercise('Triceps', [...hurt, ...ok], '2026-09-30')).toBe('Cable Pushdown');
    const old = Array.from({ length: 30 }, () => s('2024-01-01', 'Preacher Curl'));
    const recent = Array.from({ length: 8 }, () => s('2026-09-01', 'Incline DB Curl'));
    expect(primaryExercise('Biceps', [...old, ...recent], '2026-09-30')).toBe('Incline DB Curl');
  });
});

describe('programVolume', () => {
  it('sums one pass of every day', () => {
    const p: Program = { key: 'program', perSession: 14, createdAt: '', days: [0, 1].map((i) => ({ name: `D${i}`, slots: [{ exercise: 'Lat Pulldown', sets: 3, repMin: 8, repMax: 12 }] })) };
    const v = programVolume(p);
    expect(v.Lats).toBe(6);
    expect(v.Biceps).toBe(3);
  });
});

const PROG: Program = {
  key: 'program', perSession: 14, createdAt: '',
  days: [
    { name: 'Day A', slots: [{ exercise: 'Cable Curl', sets: 3, repMin: 10, repMax: 15 }, { exercise: 'Cable Pushdown', sets: 3, repMin: 10, repMax: 15 }] },
    { name: 'Day B', slots: [{ exercise: 'Cable Crunch', sets: 3, repMin: 10, repMax: 15 }] },
  ],
};
const plan = (date: string, day: number, over: Partial<DayPlan> = {}): DayPlan => ({ key: `day:${date}`, date, day, skips: [], swaps: {}, ...over });

describe('nextDay', () => {
  it('rotates after the last day that had sets logged, across gaps', () => {
    expect(nextDay(PROG, [], [], '2026-09-30')).toBe(0);
    const logged = [s('2026-09-01', 'Cable Curl')];
    expect(nextDay(PROG, [plan('2026-09-01', 0)], logged, '2026-09-03')).toBe(1);
    expect(nextDay(PROG, [plan('2026-09-01', 0)], logged, '2026-09-24')).toBe(1);
    expect(nextDay(PROG, [plan('2026-09-01', 0), plan('2026-09-05', 1)], logged, '2026-09-24')).toBe(1);
  });
});

describe('adherence', () => {
  const d = '2026-09-29';
  const logged = [s(d, 'Cable Curl'), s(d, 'Cable Curl'), s(d, 'Rope Pushdown'), s(d, 'Rope Pushdown'), s(d, 'Rope Pushdown'), s(d, 'Cable Curl', 12, { flags: ['warmup'] })];
  it('counts swapped exercises as done', () => {
    expect(adherence(PROG, [plan(d, 0, { swaps: { 'Cable Pushdown': 'Rope Pushdown' } })], logged, '2026-09-01', '2026-09-30')).toEqual({ planned: 6, done: 5 });
  });
  it('counts a skipped slot as planned but not done, and caps at the planned sets', () => {
    expect(adherence(PROG, [plan(d, 0, { skips: ['Cable Curl'], swaps: { 'Cable Pushdown': 'Rope Pushdown' } })], logged, '2026-09-01', '2026-09-30')).toEqual({ planned: 6, done: 3 });
    const extra = [...logged, s(d, 'Rope Pushdown'), s(d, 'Rope Pushdown')];
    expect(adherence(PROG, [plan(d, 0, { swaps: { 'Cable Pushdown': 'Rope Pushdown' } })], extra, '2026-09-01', '2026-09-30').done).toBe(5);
  });
});

describe('Phase 4 review fixes', () => {
  it('never puts more than sets-per-session on a day, for every days × sets the screen accepts', () => {
    const profiles = [defaultProfile(), withTiers({ Biceps: 1, Triceps: 1, Abs: 1, 'Side Delts': 2, 'Rear Delts': 2 }, 4)];
    for (const prof of profiles) for (let days = 1; days <= 6; days++) for (let per = 8; per <= 20; per++) {
      const p = buildProgram(prof, [], { days, perSession: per }, NOW);
      for (let d = 0; d < days; d++) expect(total(p, d), `${days}×${per} day ${d}`).toBeLessThanOrEqual(per);
    }
  });
  it('gives each logged set to one slot when a swap targets an exercise already planned', () => {
    const d = '2026-09-29';
    const curls = [s(d, 'Cable Curl'), s(d, 'Cable Curl'), s(d, 'Cable Curl')];
    expect(adherence(PROG, [plan(d, 0, { swaps: { 'Cable Pushdown': 'Cable Curl' } })], curls, '2026-09-01', '2026-09-30')).toEqual({ planned: 6, done: 3 });
  });
  it('scores a past day against the slots it was planned with, not the program as edited since', () => {
    const d = '2026-09-29';
    const logged = [s(d, 'Cable Curl'), s(d, 'Cable Curl'), s(d, 'Cable Curl')];
    const snap = plan(d, 0, { slots: [{ exercise: 'Cable Curl', sets: 3, repMin: 10, repMax: 15 }] });
    const edited: Program = { ...PROG, days: [{ name: 'Day A', slots: [{ exercise: 'Leg Press', sets: 4, repMin: 8, repMax: 12 }] }, PROG.days[1]] };
    expect(adherence(edited, [snap], logged, '2026-09-01', '2026-09-30')).toEqual({ planned: 3, done: 3 });
    const gone: Program = { ...PROG, days: [PROG.days[0]] };
    expect(adherence(gone, [{ ...snap, day: 1 }], logged, '2026-09-01', '2026-09-30')).toEqual({ planned: 3, done: 3 });
  });
  it('records the plan for a date once working sets are logged, with the day’s slots', async () => {
    const { planToRecord } = await import('./program');
    const d = '2026-09-29';
    expect(planToRecord(PROG, [], [], d)).toBeNull();
    const r = planToRecord(PROG, [], [s(d, 'Cable Curl')], d)!;
    expect(r).toMatchObject({ key: `day:${d}`, date: d, day: 0, skips: [], swaps: {} });
    expect(r.slots).toEqual(PROG.days[0].slots);
    expect(planToRecord(PROG, [r], [s(d, 'Cable Curl')], d)).toBeNull();
    const old = plan(d, 1);
    expect(planToRecord(PROG, [old], [s(d, 'Cable Curl')], d)).toMatchObject({ day: 1, slots: PROG.days[1].slots });
  });
});
