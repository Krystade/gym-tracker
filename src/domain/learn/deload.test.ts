import { describe, expect, it } from 'vitest';
import type { BodyDay } from '../body';
import type { SetEntry } from '../types';
import { BREAK_DAYS, LIGHT_DAYS, lightWeek, RECENT, scaleOf, shiftOf, systemic } from './deload';
import { deloadLog, SIM_LIFTS, simDay, type SimOptions } from './deloadSim.sample';
import { learn } from '.';
import { pool } from './pool';
import { liftSimilarity } from './tags';
import { normCdf } from './num';
import type { Core, LiftCore } from './capacity';

const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const WEEKS = 8, END = simDay(WEEKS * 7);
const runs = (o: Partial<SimOptions>, body: BodyDay[] = []) => seeds.map((s) => systemic(deloadLog(s, SIM_LIFTS, { weeks: WEEKS, ...o }), body, END)!);
const ps = (o: Partial<SimOptions>) => runs(o).map((x) => x.p);
const lastWeek = (by: number) => (w: number) => (w === WEEKS - 1 ? by : 0);

describe('systemic decline on synthetic logs with a known shift', () => {
  it('reads a whole-body drop as a decline and a steady log as none (pair)', () => {
    const down = ps({ shift: lastWeek(-0.06) }), flat = ps({});
    expect(mean(down)).toBeGreaterThan(0.8);
    expect(down.filter((p) => p > 0.5).length).toBe(seeds.length);
    expect(mean(flat)).toBeLessThan(0.25);
    expect(flat.filter((p) => p > 0.5).length).toBe(0);
  });
  it('a smaller drop is called less often than a larger one', () => {
    expect(mean(ps({ shift: lastWeek(-0.04) }))).toBeLessThan(mean(ps({ shift: lastWeek(-0.06) })));
    expect(mean(ps({ shift: lastWeek(-0.04) }))).toBeGreaterThan(mean(ps({})));
  });
  it('one lift down, the rest steady, is that lift’s, not his: pooling keeps it off the person (pair with all down)', () => {
    const one = ps({ shift: (w, l) => (w === WEEKS - 1 && l === 0 ? -0.1 : 0) });
    expect(mean(one)).toBeLessThan(0.4);
    expect(one.filter((p) => p > 0.5).length).toBeLessThanOrEqual(1);
  });
  it('sets stopped short at a target are lower bounds: no decline; the same reps without targets read as one (negative control)', () => {
    const censored = ps({ stopAt: (w) => w === WEEKS - 1 }), raw = ps({ stopAt: (w) => w === WEEKS - 1, logTarget: false });
    expect(Math.max(...censored)).toBeLessThan(0.5);
    expect(Math.min(...raw)).toBeGreaterThan(0.5);
  });
  it('P(decline) is the even-odds Savage–Dickey posterior of the pooled person shift, times its chance of being down', () => {
    const log = deloadLog(3, SIM_LIFTS, { weeks: WEEKS, shift: lastWeek(-0.04) });
    const s = systemic(log, [], END)!;
    const core = learn(log.filter((e) => e.date < END)).core;
    const pl = pool(s.lifts.map((x) => ({ key: x.key, est: x.d, v: x.sd ** 2 })), liftSimilarity, { mean: 0, personSd: s.scale, liftSd: s.scale });
    const npdf = (x: number, v: number) => Math.exp(-0.5 * x * x / v) / Math.sqrt(2 * Math.PI * v);
    const bf = npdf(0, s.scale ** 2) / npdf(pl.person.mean, pl.person.sd ** 2);
    expect(s.shift.mean).toBeCloseTo(pl.person.mean, 12);
    expect(s.p).toBeCloseTo(bf / (1 + bf) * normCdf(-pl.person.mean / pl.person.sd), 12);
    expect(s.lifts.length).toBe(SIM_LIFTS.length);
    expect(core.lifts.size).toBe(SIM_LIFTS.length);
  });
  it('with no evidence either way P(decline) is a quarter, never past even odds (no data never suggests a deload)', () => {
    // Shifts with huge variances: the pooled posterior is the prior, the Bayes factor 1, P(shift) ½, P(down) ½.
    const pl = pool([{ key: 'a', est: 0, v: 1e6 }, { key: 'b', est: 0, v: 1e6 }], liftSimilarity, { mean: 0, personSd: 0.03, liftSd: 0.03 });
    const npdf = (x: number, v: number) => Math.exp(-0.5 * x * x / v) / Math.sqrt(2 * Math.PI * v);
    const bf = npdf(0, 0.03 ** 2) / npdf(pl.person.mean, pl.person.sd ** 2);
    expect(bf / (1 + bf) * normCdf(-pl.person.mean / pl.person.sd)).toBeCloseTo(0.25, 3);
  });
});

describe('the second signal and the verdict', () => {
  const down = { shift: lastWeek(-0.06) };
  const energy = (recent: number, usual: number): BodyDay[] => [
    { date: simDay(10), energy: usual as 3 }, { date: simDay(20), energy: usual as 3 }, { date: simDay(WEEKS * 7 - 3), energy: recent as 3 }, { date: END, energy: recent as 3 },
  ];
  it('a decline with energy below his usual is a deload; at his usual it is a decline alone (pair)', () => {
    expect(runs(down, energy(2, 4)).map((x) => x.verdict)).toEqual(seeds.map(() => 'deload'));
    expect(runs(down, energy(4, 4)).map((x) => x.verdict)).toEqual(seeds.map(() => 'alone'));
    expect(runs(down).map((x) => x.verdict)).toEqual(seeds.map(() => 'alone'));
    expect(runs(down, energy(2, 4))[0].energy).toEqual({ recent: 2, usual: 4, low: true });
  });
  it('low energy with no decline is no deload', () => {
    expect(runs({}, energy(1, 4)).map((x) => x.verdict)).toEqual(seeds.map(() => 'steady'));
  });
  it('energy only in the window has no usual to be below: no signal (a missing baseline is never low)', () => {
    expect(runs(down, [{ date: END, energy: 1 }])[0]).toMatchObject({ energy: null, verdict: 'alone' });
  });
  const hurt = (log: SetEntry[], lifts: string[]) => {
    const day = simDay(WEEKS * 7 - 7);
    return log.map((e) => (e.date >= day && lifts.includes(e.exercise) && e.setNo === 3 ? { ...e, flags: [...e.flags, 'pain' as const] } : e));
  };
  it('pain in two regions in the window is a second signal; in one region it is local (pair)', () => {
    // Bench (shoulder) and leg press (lower back, as care.ts reads it); bench alone is one region.
    const two = seeds.map((s) => systemic(hurt(deloadLog(s, SIM_LIFTS, { weeks: WEEKS, ...down }), ['Bench Press', 'Leg Press']), [], END)!);
    expect(two.every((x) => x.pain.length === 2)).toBe(true);
    expect(two.filter((x) => x.verdict === 'deload').length).toBeGreaterThanOrEqual(seeds.length - 1);
    const one = seeds.map((s) => systemic(hurt(deloadLog(s, SIM_LIFTS, { weeks: WEEKS, ...down }), ['Bench Press']), [], END)!);
    expect(one.every((x) => x.pain.length === 1 && x.verdict !== 'deload')).toBe(true);
  });
});

describe('stretches, breaks and layoffs', () => {
  it('a week off just now unloaded him: break; six days is still the stretch (pair)', () => {
    const log = deloadLog(1, SIM_LIFTS, { weeks: WEEKS, shift: lastWeek(-0.06) });
    const last = log.reduce((d, e) => (e.date > d ? e.date : d), '');
    const at = (n: number) => new Date(Date.parse(last) + n * 864e5).toISOString().slice(0, 10);
    expect(systemic(log, [], at(BREAK_DAYS))!.verdict).toBe('break');
    expect(systemic(log, [], at(BREAK_DAYS - 1))!.verdict).not.toBe('break');
  });
  it('a stretch starts after a gap of exactly BREAK_DAYS between sessions, not one day shorter (pair)', () => {
    const at = (day: number): SetEntry => ({ id: `b${day}`, date: simDay(day), seq: day, exercise: 'Bench Press', setNo: 1, weight: 100, reps: 10, flags: [], source: 'sim' });
    expect(systemic([at(0), at(BREAK_DAYS), at(BREAK_DAYS + 3)], [], simDay(BREAK_DAYS + 4))!.since).toBe(simDay(BREAK_DAYS));
    expect(systemic([at(0), at(BREAK_DAYS - 1), at(BREAK_DAYS + 3)], [], simDay(BREAK_DAYS + 4))!.since).toBe(simDay(0));
  });
  it('a week-long gap starts a new stretch: the decline must show after it (each lift needs RECENT + 1 sessions since)', () => {
    // No training for a week, ending 6 days before the end: under RECENT + 1 sessions per lift since, so nothing to judge.
    const gap = (d: number) => d >= WEEKS * 7 - 6 - BREAK_DAYS && d < WEEKS * 7 - 6;
    const s = systemic(deloadLog(1, SIM_LIFTS, { weeks: WEEKS, shift: lastWeek(-0.06), off: gap }), [], END)!;
    expect(s.verdict).toBe('few');
    expect(s.since >= simDay(WEEKS * 7 - 6)).toBe(true);
    const shorter = (d: number) => d >= WEEKS * 7 - 6 - (BREAK_DAYS - 4) && d < WEEKS * 7 - 6; // 3 days off: the gap between sessions stays under a week
    expect(systemic(deloadLog(1, SIM_LIFTS, { weeks: WEEKS, shift: lastWeek(-0.06), off: shorter }), [], END)!.verdict).not.toBe('few');
  });
  it('a longer wait between the reference and the recent sessions widens the shift’s SD (layoffs widen it)', () => {
    const core = { drift: 0.01 } as Core;
    const obs = (gap: number) => [0, 7, 14, 14 + gap, 21 + gap].map((day, i) => ({ date: simDay(day), day, z: 5 + (i > 2 ? -0.05 : 0), v: 0.001 }));
    const l = (gap: number) => ({ key: 'bench press', name: 'Bench Press', obs: obs(gap) }) as unknown as LiftCore;
    const near = shiftOf(core, l(7), 0, 1000)!, far = shiftOf(core, l(35), 0, 1000)!;
    expect(near.d).toBeCloseTo(far.d, 2);
    expect(far.sd).toBeGreaterThan(near.sd * 1.2);
  });
  it('one muscle’s lifts alone are not systemic: few', () => {
    const chest = [{ name: 'Bench Press', E0: 250, step: 5 }, { name: 'Incline Bench Press', E0: 200, step: 5 }];
    expect(systemic(deloadLog(1, chest, { weeks: WEEKS, shift: lastWeek(-0.08) }), [], END)!.verdict).toBe('few');
  });
  it('RECENT is the shortest sustained run: two sessions', () => expect(RECENT).toBe(2));
});

describe('the scale of a shift, learned from his past stretches', () => {
  it('grows past the prior when his stretches swing together, and stays near it when they don’t', () => {
    // Four 3-week stretches split by week-long breaks; the whole body ±8 % in each stretch's last week.
    const off = (d: number) => d % 28 >= 21;
    const swing = (w: number) => (w % 4 === 2 ? (Math.floor(w / 4) % 2 ? 0.08 : -0.08) : 0);
    const big = scaleOf(learn(deloadLog(2, SIM_LIFTS, { weeks: 16, perWeek: 2, off, shift: swing })).core, deloadLog(2, SIM_LIFTS, { weeks: 16, perWeek: 2, off, shift: swing }), simDay(16 * 7));
    const calm = scaleOf(learn(deloadLog(2, SIM_LIFTS, { weeks: 16, perWeek: 2, off })).core, deloadLog(2, SIM_LIFTS, { weeks: 16, perWeek: 2, off }), simDay(16 * 7));
    expect(big).toBeGreaterThan(calm * 1.3);
    expect(calm).toBeLessThan(0.04);
  });
});

describe('the light week', () => {
  const set = (date: string, light = true): SetEntry => ({ id: date, date, seq: 0, exercise: 'Bench Press', setNo: 1, weight: 100, reps: 8, flags: light ? ['light'] : [], source: 'app' });
  it('is on for LIGHT_DAYS from his tap, then off; an early end stops it', () => {
    expect(lightWeek([], '2026-10-20', { from: '2026-10-20' })).toEqual({ from: '2026-10-20', to: '2026-10-26' });
    expect(lightWeek([], simDay(LIGHT_DAYS - 1), { from: simDay(0) })).not.toBeNull();
    expect(lightWeek([], simDay(LIGHT_DAYS), { from: simDay(0) })).toBeNull();
    expect(lightWeek([], simDay(3), { from: simDay(0), end: simDay(3) })).toBeNull();
    expect(lightWeek([], simDay(2), { from: simDay(0), end: simDay(3) })).not.toBeNull();
  });
  it('is read from the log’s light sets on another phone, from the first of the run', () => {
    const log = [set(simDay(0), false), set(simDay(10)), set(simDay(12))];
    expect(lightWeek(log, simDay(13))).toEqual({ from: simDay(10), to: simDay(16) });
    expect(lightWeek(log, simDay(17))).toBeNull();
    expect(lightWeek([set(simDay(0), false)], simDay(1))).toBeNull();
  });
  it('a light week on means no suggestion, and its sessions start a new stretch after it', () => {
    const log = deloadLog(1, SIM_LIFTS, { weeks: WEEKS, shift: lastWeek(-0.06) });
    expect(systemic(log, [], END, { from: simDay(WEEKS * 7 - 2) })!.verdict).toBe('light');
    const lit = log.map((e) => (e.date >= simDay(WEEKS * 7 - 7) && e.date < simDay(WEEKS * 7 - 4) ? { ...e, flags: [...e.flags, 'light' as const] } : e));
    const s = systemic(lit, [], simDay(WEEKS * 7 + 4))!;
    expect(s.since > simDay(WEEKS * 7 - 4)).toBe(true);
  });
});
