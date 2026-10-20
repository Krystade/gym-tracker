import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BodyDay } from '../body';
import { MUSCLES, type Muscle } from '../muscles';
import { defaultProfile, type Profile, type Tier } from '../profile';
import { stall } from '../rotation';
import type { SetEntry } from '../types';
import { deloadLog, SIM_LIFTS, simDay, type SimLift, type SimOptions } from './deloadSim.sample';
import { BASE_WEEKS, countedWeeks, STEP, volumeAdvice, type MuscleVolume } from './volume';

// Item 07 on synthetic logs whose volume and shifts are known. deloadLog trains each lift twice a week, 3 sets a session, on days
// 0 and 4 (bench, leg press, RDL) or 1 and 5 (pulldown, row): 4 sessions a week. Per week, from the lifts' muscle vectors:
// Chest 6 (bench 1), Triceps 3 and Front Delts 3 (bench ½), Lats 9 (pulldown 1 + row ½), Mid-Back 9, Quads 6, Hamstrings 9
// (RDL 1 + leg press ½), Glutes 6, Biceps 6, Erectors 3, Rear Delts 3.

const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
const WEEKS = 8, END = simDay(WEEKS * 7);
const INCLINE: SimLift = { name: 'Incline Bench Press', E0: 200, step: 5 };
/** Ranges: Chest priority 1 (12–16), Triceps 2 (8–12), the rest 3 (5–8) unless given. */
function profile(t: Partial<Record<Tier, [number, number]>> = {}, tiers: Partial<Record<Muscle, Tier>> = { Chest: 1, Triceps: 2 }): Profile {
  const p = defaultProfile();
  return { ...p, targets: { ...p.targets, ...t }, tiers: { ...p.tiers, ...tiers } };
}
const at = (a: { muscles: MuscleVolume[] } | null, m: Muscle) => a!.muscles.find((x) => x.muscle === m)!;
const log = (seed: number, o: Partial<SimOptions> = {}, lifts = SIM_LIFTS) => deloadLog(seed, lifts, { weeks: WEEKS, ...o });
const lastWeek = (by: number, only?: number[]) => (w: number, l: number) => (w === WEEKS - 1 && (!only || only.includes(l)) ? by : 0);
const energy = (recent: number, usual: number): BodyDay[] => [
  { date: simDay(10), energy: usual as 3 }, { date: simDay(20), energy: usual as 3 }, { date: simDay(WEEKS * 7 - 3), energy: recent as 3 },
];

describe('his weekly volume, counted the evidence’s way', () => {
  it('is each muscle’s fractional sets a week over the last 3 whole weeks (direct 1, indirect ½), with his sessions a week', () => {
    const a = volumeAdvice(log(1), [], profile(), END)!;
    expect(a.weeks).toEqual([simDay(35), simDay(42), simDay(49)]);
    expect(a.sessions).toBe(4);
    const want: Partial<Record<Muscle, number>> = { Chest: 6, Triceps: 3, 'Front Delts': 3, Lats: 9, 'Mid-Back': 9, Quads: 6, Hamstrings: 9, Glutes: 6, Biceps: 6, Erectors: 3, 'Rear Delts': 3, Calves: 0 };
    for (const [m, v] of Object.entries(want)) expect(at(a, m as Muscle).base).toBe(v);
    expect(BASE_WEEKS).toBe(3);
  });
  it('leaves out a light week’s sets: their week isn’t his volume (pair: the same week unflagged counts)', () => {
    // Week 6 done light: one set a lift instead of three.
    const lighten = (light: boolean) => log(1).filter((e) => !(e.date >= simDay(42) && e.date < simDay(49) && e.setNo > 1))
      .map((e) => (light && e.date >= simDay(42) && e.date < simDay(49) ? { ...e, flags: [...e.flags, 'light' as const] } : e));
    const lit = volumeAdvice(lighten(true), [], profile(), END)!;
    expect(lit.weeks).toEqual([simDay(35), simDay(49)]);
    expect(at(lit, 'Chest').base).toBe(6);
    const plain = volumeAdvice(lighten(false), [], profile(), END)!;
    expect(plain.weeks.length).toBe(3);
    expect(at(plain, 'Chest').base).toBeCloseTo((6 + 2 + 6) / 3, 12);
  });
  it('a light week across two calendar weeks leaves both out, its normal days with it (pair: unflagged, both count)', () => {
    // Light from Friday of week 6 to Thursday of week 7 (days 46–52): one set a lift on those days.
    const lit = (light: boolean) => log(1).filter((e) => !(e.date >= simDay(46) && e.date <= simDay(52) && e.setNo > 1))
      .map((e) => (light && e.date >= simDay(46) && e.date <= simDay(52) ? { ...e, flags: [...e.flags, 'light' as const] } : e));
    const a = volumeAdvice(lit(true), [], profile(), END)!;
    expect(a.weeks).toEqual([simDay(35)]);
    expect(at(a, 'Chest').base).toBe(6);
    const b = volumeAdvice(lit(false), [], profile(), END)!;
    expect(b.weeks.length).toBe(3);
    expect(at(b, 'Chest').base).toBeCloseTo((6 + 4 + 4) / 3, 12);
  });
  it('leaves out a week with no session (a week off is a break, not his volume); none counted, nothing to step from', () => {
    const off = volumeAdvice(log(1, { off: (d) => d >= 42 && d < 49 }), [], profile(), END)!;
    expect(off.weeks).toEqual([simDay(35), simDay(49)]);
    expect(at(off, 'Chest').base).toBe(6);
    const gone = volumeAdvice(log(1, { off: (d) => d >= 35 }), [], profile(), END)!;
    expect(gone.weeks).toEqual([]);
    expect(MUSCLES.every((m) => at(gone, m).kind === 'none' && at(gone, m).base === null)).toBe(true);
    expect(countedWeeks(log(1), simDay(WEEKS * 7 + 3))).toEqual([simDay(35), simDay(42), simDay(49)]);
  });
});

describe('the step: +20 % of his own volume toward the range, never more', () => {
  it('below its range: aim = 1.2 × his volume, down to the half set; in it: met; above it: over, never cut', () => {
    const a = volumeAdvice(log(1), [], profile(), END)!;
    expect(at(a, 'Chest')).toMatchObject({ kind: 'raise', base: 6, aim: 7, band: [12, 16] }); // 7.2 → 7
    expect(at(a, 'Triceps')).toMatchObject({ kind: 'raise', base: 3, aim: 3.5 }); // 3.6 → 3.5
    expect(at(a, 'Quads')).toMatchObject({ kind: 'met', aim: null });
    expect(at(a, 'Lats')).toMatchObject({ kind: 'over', aim: null });
    expect(at(a, 'Calves')).toMatchObject({ kind: 'none' });
    expect(STEP).toBe(0.2);
  });
  it('stops at the range’s low end when 20 % would pass it', () => {
    const a = volumeAdvice(log(1), [], profile({ 3: [6.5, 8] }, { Chest: 3 }), END)!;
    expect(at(a, 'Chest')).toMatchObject({ kind: 'raise', base: 6, aim: 6.5 });
  });
  it('a step under half a set can’t show in his count: nothing to add (pair: half a set is a step)', () => {
    const one = log(1).filter((e) => e.exercise !== 'Bench Press' || e.setNo === 1); // bench 1 set a session: chest 2 a week
    expect(at(volumeAdvice(one, [], profile(), END), 'Chest')).toMatchObject({ kind: 'none', base: 2, aim: null }); // 2.4 → 2
    // Within half a set of the range: 6 a week against 6.4–8 rounds to 6, nothing; against 6.5–8 it's 6.5.
    expect(at(volumeAdvice(log(1), [], profile({ 3: [6.4, 8] }, { Chest: 3 }), END), 'Chest')).toMatchObject({ kind: 'none', aim: null });
    expect(at(volumeAdvice(log(1), [], profile({ 3: [6.5, 8] }, { Chest: 3 }), END), 'Chest')).toMatchObject({ kind: 'raise', aim: 6.5 });
    // 1⅓ a week (1, 1 and 2 sets over the 3 weeks) against 1.5–2.5: +⅙ is no step.
    const set = (d: number, n: number): SetEntry => ({ id: `t${d}-${n}`, date: simDay(d), seq: d * 10 + n, exercise: 'Machine Chest Press', setNo: n, weight: 100, reps: 10, flags: [], source: 'sim' });
    const t = at(volumeAdvice([set(30, 1), set(37, 1), set(44, 1), set(51, 1), set(51, 2)], [], profile({ 1: [1.5, 2.5] }), END), 'Chest');
    expect(t.base).toBeCloseTo(4 / 3, 9);
    expect(t.kind).toBe('none');
  });
  it('never past 11 fractional sets a session: one session a week of 10 chest sets aims at 11, not 12', () => {
    const day = (w: number, s: number): SetEntry => ({ id: `c${w}-${s}`, date: simDay(w * 7 + 2), seq: w * 100 + s, exercise: 'Machine Chest Press', setNo: s + 1, weight: 100, reps: 10, flags: [], source: 'sim' });
    const es = Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 10 }, (_, s) => day(w, s))).flat();
    const a = volumeAdvice(es, [], profile({ 1: [16, 20] }), END)!;
    expect(a.sessions).toBe(1);
    expect(at(a, 'Chest')).toMatchObject({ base: 10, aim: 11, kind: 'raise' });
  });
  it('the aim is never below his volume and never above +20 % of it (property, random logs and ranges)', () => {
    for (const seed of seeds) for (const lo of [2, 4, 7.5, 10, 13]) {
      const a = volumeAdvice(log(seed, { perWeek: 1 + (seed % 3) }), [], profile({ 1: [lo, lo + 4], 2: [lo / 2, lo], 3: [lo / 3, lo] }), END)!;
      for (const x of a.muscles) {
        if (x.aim == null) continue;
        expect(x.aim).toBeGreaterThan(x.base!);
        expect(x.aim).toBeLessThanOrEqual(x.base! * (1 + STEP) + 1e-9);
        expect(x.aim).toBeLessThanOrEqual(x.band[0]);
      }
    }
  });
});

describe('a raise only while he is recovering', () => {
  it('a steady log raises; down across lifts with low energy (06: deload) holds every raise, and makes no cut of its own', () => {
    for (const seed of seeds) {
      expect(at(volumeAdvice(log(seed), [], profile(), END), 'Chest').kind).toBe('raise');
      const a = volumeAdvice(log(seed, { shift: lastWeek(-0.06) }), energy(2, 4), profile(), END)!;
      expect(a.verdict).toBe('deload');
      expect(at(a, 'Chest')).toMatchObject({ kind: 'hold', why: 'deload', aim: 7 });
      expect(a.muscles.every((x) => x.kind !== 'raise' && (x.aim == null || x.aim > x.base!))).toBe(true);
    }
  });
  it('down across lifts without a second signal (06: alone) holds too', () => {
    const a = seeds.map((s) => volumeAdvice(log(s, { shift: lastWeek(-0.06) }), [], profile(), END)!);
    expect(a.map((x) => x.verdict)).toEqual(seeds.map(() => 'alone'));
    expect(a.map((x) => at(x, 'Chest').why)).toEqual(seeds.map(() => 'down'));
  });
  it('a light week on holds every raise', () => {
    const a = volumeAdvice(log(1), [], profile(), END, { from: simDay(WEEKS * 7 - 1) })!;
    expect(a.verdict).toBe('light');
    expect(at(a, 'Chest')).toMatchObject({ kind: 'hold', why: 'light' });
  });
  it('energy below his usual holds every raise; at his usual it doesn’t (pair)', () => {
    expect(at(volumeAdvice(log(1), energy(2, 4), profile(), END), 'Chest')).toMatchObject({ kind: 'hold', why: 'energy' });
    expect(at(volumeAdvice(log(1), energy(4, 4), profile(), END), 'Chest').kind).toBe('raise');
    // Energy only in the window: no usual to be below.
    expect(at(volumeAdvice(log(1), [{ date: simDay(WEEKS * 7 - 3), energy: 1 }], profile(), END), 'Chest').kind).toBe('raise');
  });
  it('one muscle’s lifts down holds that muscle, not the others (pair: the same log steady raises it)', () => {
    // Bench and incline (chest 12 a week, priority 1 at 16–20) both about 8 % down in the last week; the rest steady.
    const lifts = [...SIM_LIFTS, INCLINE], prof = profile({ 1: [16, 20] });
    const down = seeds.map((s) => volumeAdvice(log(s, { shift: lastWeek(-0.08, [0, 5]) }, lifts), [], prof, END)!);
    // Local: 06 doesn't read it as whole-body (one seed's noise elsewhere may tip it).
    expect(down.filter((a) => a.verdict === 'steady').length).toBeGreaterThanOrEqual(seeds.length - 1);
    const local = down.filter((a) => a.verdict === 'steady');
    expect(local.filter((a) => at(a, 'Chest').why === 'decline').length).toBeGreaterThanOrEqual(local.length - 1);
    expect(down.every((a) => at(a, 'Chest').decline!.p > at(a, 'Quads').decline!.p)).toBe(true);
    expect(local.filter((a) => at(a, 'Quads').kind === 'met' && at(a, 'Hamstrings').kind === 'over').length).toBe(local.length);
    expect(local.filter((a) => at(a, 'Erectors').kind === 'raise' && at(a, 'Rear Delts').kind === 'raise').length).toBe(local.length);
    const steady = seeds.map((s) => volumeAdvice(log(s, {}, lifts), [], prof, END)!);
    expect(at(steady[0], 'Chest')).toMatchObject({ base: 12, aim: 14 });
    expect(steady.filter((a) => at(a, 'Chest').kind === 'raise').length).toBe(seeds.length);
    expect(Math.max(...steady.map((a) => at(a, 'Chest').decline!.p))).toBeLessThan(0.5);
  });
  it('a muscle’s shift weighs its lifts by their share of its sets: the row down counts more for mid-back than for lats', () => {
    // Row (mid-back 1, lats ½) down 10 %; pulldown (lats 1, mid-back ½) steady: mid-back is ⅔ row, lats ⅓.
    const down = seeds.map((s) => volumeAdvice(log(s, { shift: lastWeek(-0.1, [3]) }), [], profile(), END)!);
    expect(down.every((a) => at(a, 'Mid-Back').decline!.p > at(a, 'Lats').decline!.p)).toBe(true);
    expect(down.every((a) => at(a, 'Mid-Back').decline!.shift.mean < at(a, 'Lats').decline!.shift.mean)).toBe(true);
  });
  it('with too few muscles for 06 to weigh, his energy is still read over his lifts’ recent sessions', () => {
    const chest = [SIM_LIFTS[0], INCLINE];
    const a = volumeAdvice(log(1, {}, chest), energy(2, 4), profile({ 1: [16, 20] }), END)!;
    expect(a.verdict).toBe('few');
    expect(a.energy).toEqual({ recent: 2, usual: 4, low: true });
    expect(at(a, 'Chest')).toMatchObject({ kind: 'hold', why: 'energy' });
    expect(at(volumeAdvice(log(1, {}, chest), energy(4, 4), profile({ 1: [16, 20] }), END), 'Chest').kind).toBe('raise');
  });
  it('sets stopped short at a target are lower bounds: no decline, so no hold (pair: the same reps without targets hold)', () => {
    const lifts = [...SIM_LIFTS, INCLINE];
    const stop = (logTarget: boolean) => seeds.map((s) => at(volumeAdvice(log(s, { stopAt: (w) => w === WEEKS - 1, short: 4, logTarget }, lifts), [], profile({ 1: [16, 20] }), END), 'Chest'));
    expect(stop(true).every((x) => x.kind === 'raise')).toBe(true);
    expect(stop(false).filter((x) => x.kind === 'hold').length).toBeGreaterThanOrEqual(seeds.length - 1);
  });
  it('a week off just now unloaded him: the decline before it no longer holds (pair: three days after, it does)', () => {
    const l = log(1, { shift: lastWeek(-0.06) });
    const last = l.reduce((d, e) => (e.date > d ? e.date : d), '');
    const after = (n: number) => new Date(Date.parse(last) + n * 864e5).toISOString().slice(0, 10);
    expect(at(volumeAdvice(l, [], profile(), after(7)), 'Chest')).toMatchObject({ kind: 'raise' });
    expect(volumeAdvice(l, [], profile(), after(7))!.verdict).toBe('break');
    expect(at(volumeAdvice(l, [], profile(), after(3)), 'Chest')).toMatchObject({ kind: 'hold' });
  });
  it('a direct lift likely to hurt holds its muscle; the muscles it trains indirectly still raise (pair: no pain raises)', () => {
    // Bench hurt (moderate) at every session of the last three weeks: its learned risk is past ½.
    const hurt = log(1).map((e) => (e.exercise === 'Bench Press' && e.date >= simDay(35) ? { ...e, flags: [...e.flags, 'pain' as const], painSeverity: 2 as const, painRegion: 'shoulder' as const } : e));
    const a = volumeAdvice(hurt, [], profile(), END)!;
    expect(at(a, 'Chest')).toMatchObject({ kind: 'hold', why: 'pain', lift: 'Bench Press' });
    expect(at(a, 'Triceps').kind).toBe('raise');
    expect(at(volumeAdvice(log(1), [], profile(), END), 'Chest').kind).toBe('raise');
  });
});

describe('stalls are rotation’s: volume never reads one', () => {
  it('lifts on a plateau (stall fires) still get their raise, as a progressing log does', () => {
    const flat = log(2, { progress: 0, weeks: 12 }), up = log(2, { weeks: 12 });
    const end = simDay(12 * 7);
    expect(SIM_LIFTS.some((l) => stall(flat, l.name, end))).toBe(true);
    const kinds = (es: SetEntry[]) => volumeAdvice(es, [], profile(), end)!.muscles.map((x) => x.kind);
    expect(kinds(flat)).toEqual(kinds(up));
    expect(at(volumeAdvice(flat, [], profile(), end), 'Chest').kind).toBe('raise');
  });
  it('the module imports nothing from rotation and never calls stall()', () => {
    const src = readFileSync(new URL('./volume.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/rotation/);
    expect(src).not.toMatch(/\bstall\s*\(/);
    expect(src).not.toMatch(/flatness|trend'/);
  });
});
