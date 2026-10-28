import { describe, expect, it } from 'vitest';
import type { BodyDay } from './body';
import { testDue } from './estimators';
import { learn } from './learn';
import { deloadLog, SIM_LIFTS, simDay } from './learn/deloadSim.sample';
import { defaultSettings, nextTarget, priorE1rm } from './progression';
import { rotation as rotationAt, sinceProgress, stall as stallAt, type RotationContext } from './rotation';
// These read the plateau mechanics at the old bar, P > 0.5; the default's own bar (STALL_P, owner 2026-10-28) has its test below.
const OLD_P = 0.5;
const stall = (e: SetEntry[], n: string, t: string) => stallAt(e, n, t, OLD_P);
const rotation = (e: SetEntry[], l: string, t: string, ctx: RotationContext = {}) => rotationAt(e, l, t, { stallP: OLD_P, ...ctx });
import { suggest } from './suggest';
import type { SetEntry } from './types';

// Item 06 where it meets the rest of the app: a light week's targets, its sessions kept out of progression and the stall count,
// tests held off, and rotation offers waiting while a deload is suggested.

const set = (date: string, setNo: number, weight: number, reps: number, light = false): SetEntry =>
  ({ id: `${date}|${setNo}`, date, seq: setNo, exercise: 'Bench Press', setNo, weight, reps, flags: light ? ['light'] : [], source: 'app' });
const session = (date: string, weight: number, reps: number[], light = false) => reps.map((r, i) => set(date, i + 1, weight, r, light));
const log = [...session('2026-09-01', 100, [10, 9, 9]), ...session('2026-09-04', 100, [10, 10, 9]), ...session('2026-09-08', 100, [11, 10, 10])];
const st = { ...defaultSettings('Bench Press'), increment: 2.5 }; // a typed increment: the light weight is a multiple of it

describe('a light week’s target', () => {
  it('is half the sets, about 10 % lighter, at the bottom of the range, stopping about 3 short', () => {
    const t = nextTarget(log, 'Bench Press', st, '2026-09-11', 3, true)!;
    expect(t).toMatchObject({ kind: 'light', weight: 90, reps: st.repMin, perSet: [st.repMin, st.repMin] });
    expect(t.why).toMatch(/10 % lighter, half the sets, stop about 3 short/);
    expect(nextTarget(log, 'Bench Press', st, '2026-09-11', 4, true)!.perSet).toHaveLength(2);
    expect(nextTarget(log, 'Bench Press', st, '2026-09-11', 1, true)!.perSet).toHaveLength(1);
    expect(nextTarget(log, 'Bench Press', st, '2026-09-11', 5, true)!.perSet).toHaveLength(3);
    // The same day out of a light week: the normal target (pair).
    expect(nextTarget(log, 'Bench Press', st, '2026-09-11', 3)!.kind).not.toBe('light');
  });
  it('rounds the lighter weight down to a loadable one', () => {
    expect(nextTarget(log, 'Bench Press', { ...st, increment: 15 }, '2026-09-11', 3, true)!.weight).toBe(90);
    expect(nextTarget(log, 'Bench Press', { ...st, increment: 20 }, '2026-09-11', 3, true)!.weight).toBe(80);
  });
  it('suggest carries the halved sets', () => {
    const s = suggest(log, 'Bench Press', st, '2026-09-11', 4, true);
    expect(s).toMatchObject({ kind: 'light', sets: 2, weight: 90, perSet: [st.repMin, st.repMin] });
    expect(suggest(log, 'Bench Press', st, '2026-09-11', 4).sets).toBe(4);
  });
});

describe('a light week’s sessions are not progressed from', () => {
  const light = [...log, ...session('2026-09-11', 90, [8, 8], true)];
  it('the first target after it is the one before it (pair: unflagged, the light session is last time)', () => {
    const before = nextTarget(log, 'Bench Press', st, '2026-09-11', 3)!;
    const after = nextTarget(light, 'Bench Press', st, '2026-09-18', 3)!;
    expect({ kind: after.kind, weight: after.weight, perSet: after.perSet }).toEqual({ kind: before.kind, weight: before.weight, perSet: before.perSet });
    const plain = light.map((e) => ({ ...e, flags: [] }));
    expect(nextTarget(plain, 'Bench Press', st, '2026-09-18', 3)!.weight).toBe(90);
  });
  it('nor read as the recent best', () => {
    const heavy = [...log, ...session('2026-09-11', 150, [12], true)];
    expect(priorE1rm(heavy, 'Bench Press', '2026-09-12')).toBe(priorE1rm(log, 'Bench Press', '2026-09-12'));
    expect(priorE1rm(heavy.map((e) => ({ ...e, flags: [] })), 'Bench Press', '2026-09-12')).toBeGreaterThan(priorE1rm(log, 'Bench Press', '2026-09-12')!);
  });
  it('nor counted toward a stall', () => {
    const flat = [...log, ...session('2026-09-11', 100, [10, 9, 9]), ...session('2026-09-15', 100, [10, 9, 9])];
    const n = sinceProgress(flat, 'Bench Press', '2026-09-20')!.sessions;
    expect(sinceProgress([...flat, ...session('2026-09-18', 90, [8, 8], true)], 'Bench Press', '2026-09-20')!.sessions).toBe(n);
    expect(sinceProgress([...flat, ...session('2026-09-18', 90, [8, 8])], 'Bench Press', '2026-09-20')!.sessions).toBe(n + 1);
  });
  it('the core reads a light set as a lower bound: lighter, fewer reps, and the level doesn’t fall', () => {
    const sim = deloadLog(1, SIM_LIFTS, { weeks: 8 });
    const last = sim.filter((e) => e.exercise === 'Bench Press').reduce((d, e) => (e.date > d ? e.date : d), '');
    const w = sim.find((e) => e.date === last && e.exercise === 'Bench Press')!.weight;
    const extra = (lightFlag: boolean) => [...sim, ...[1, 2].map((k) => ({ ...set(simDay(8 * 7 + 1), k, Math.round(w * 0.9), 3, lightFlag), id: `x${k}` }))];
    const lvl = (es: SetEntry[]) => learn(es).core.lifts.get('bench press')!.level.at(-1)!.x;
    const base = lvl(sim);
    expect(Math.abs(lvl(extra(true)) - base)).toBeLessThan(0.01);
    expect(lvl(extra(false))).toBeLessThan(base - 0.02);
  });
});

describe('tests and rotation in a light week or a suggested deload', () => {
  it('no test is due in a light week (by its target, or by the log’s light sets)', () => {
    // Three weeks since the last session: the level has drifted enough for a test to be due.
    const sim = deloadLog(2, SIM_LIFTS, { weeks: 6 });
    const d = simDay(6 * 7 + 20);
    const due = testDue(sim, 'Bench Press', d);
    expect(due).not.toBeNull();
    expect(testDue(sim, 'Bench Press', d, undefined, { kind: 'light', weight: 100 })).toBeNull();
    const lit = [...sim, { ...set(simDay(6 * 7 + 18), 1, 100, 8, true), exercise: 'Leg Press', id: 'lp' }];
    expect(testDue(lit, 'Bench Press', d)).toBeNull();
  });
  it('a stalled lift’s rotation waits while a deload is suggested, and is offered without one (pair)', () => {
    const sim = deloadLog(3, SIM_LIFTS, { weeks: 12, progress: 0, shift: (w) => (w === 11 ? -0.06 : 0) });
    const end = simDay(84);
    const low: BodyDay[] = [{ date: simDay(10), energy: 4 }, { date: end, energy: 2 }];
    const usual: BodyDay[] = [{ date: simDay(10), energy: 4 }, { date: end, energy: 4 }];
    expect(stall(sim, 'Bench Press', end)).not.toBeNull();
    expect(rotation(sim, 'Bench Press', end, { body: low })).toBeNull();
    expect(rotation(sim, 'Bench Press', end, { body: usual })).not.toBeNull();
    expect(rotation(sim, 'Bench Press', end, { body: usual, light: { from: simDay(82) } })).toBeNull();
  });
});
