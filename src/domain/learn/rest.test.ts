import { describe, expect, it } from 'vitest';
import { planSeconds, restFor, SET_WORK, stepsOf, type KneeRest, type Prior } from '../timing';
import { liftKey } from '../ids';
import type { SetEntry } from '../types';
import { fitCore, type Core } from './capacity';
import { simulate, SIM_LIFTS } from './coreSim.sample';
import { DELTA, effortLoss, kneeAfter, kneeFrom, kneePlan, restDelta } from './rest';

// Item 17, the rest knee, on synthetic lifters with KNOWN fatigue (learn/coreSim.sample): Rahimi-like recovery (A 5 reps at
// K = 1, τ 120 s, ρ 0.1, so a set after 1 min rests loses ~2.6 reps and after 5 min ~0.7), a lift at 0.85 of the person's A.
const T = { aSame: 5, tau: 120, rho: 0.1, aCross: 1.5 };
const aLift = SIM_LIFTS.map((_, i) => T.aSame * (1 + ((i % 3) - 1) * 0.15));
const BENCH = SIM_LIFTS[0].name;
const sim = (seed: number, o: Parameters<typeof simulate>[1] extends infer S ? Partial<S> : never = {}) =>
  simulate(seed, { sessions: 150, gapMedian: 90, gapSd: 0.6, ...o, truth: { ...T, aLift, ...o.truth } });

/**
 * The true knee by its definition, scanned second by second (not the code's closed form): the shortest rest t after one set at
 * which 30 s more saves under δ reps, the set's own recoverable loss being (1 − ρ)·A·e^(−(t + 40)/τ) (the simulator's Δt
 * between sets is the rest plus the set's 40 s).
 */
function trueKnee(A: number, tau: number, rho: number): number {
  const E = (t: number) => (1 - rho) * A * Math.exp(-(t + SET_WORK) / tau);
  for (let t = 0; t < 3600; t++) if (E(t) - E(t + 30) < DELTA) return t;
  return 3600;
}
const first = (exercise: string): Prior[] => [{ exercise, ago: 0 }];

describe('learn/rest: the knee recovered from synthetic logs with a known one', () => {
  it('δ is a whole-number count’s rounding SD (Sheppard), and the scanned truth is the knee of the simulator’s lifter', () => {
    expect(DELTA).toBeCloseTo(0.288675, 5);
    expect(trueKnee(aLift[0], T.tau, T.rho)).toBe(90); // 1:30
  });

  it('short rests (1–3 min), 150 sessions: in use in ≥ 6 of 8 seeds; each used band holds the truth; median off by ≤ 15 s on average', () => {
    const tk = trueKnee(aLift[0], T.tau, T.rho);
    let used = 0, held = 0, err = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const k = kneeFrom(fitCore(sim(seed).entries), BENCH, first(BENCH))!;
      if (!k.use) continue;
      used++; err += Math.abs(k.mid - tk);
      if (tk >= k.lo && tk <= k.hi) held++;
    }
    expect(used).toBeGreaterThanOrEqual(6);
    expect(held).toBe(used);
    expect(err / used).toBeLessThanOrEqual(15);
  });

  it('long rests (6–7 min, as his): the fit can put a tight band near 0:00 against a true 1:29, and the knee is never used — it is outside every rest he timed', () => {
    let tight = 0, used = 0, wrong = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const k = kneeFrom(fitCore(sim(seed, { gapMedian: 400 }).entries), BENCH, first(BENCH))!;
      if (k.tight) tight++;
      if (k.tight && k.hi < trueKnee(aLift[0], T.tau, T.rho)) wrong++;
      if (k.use) used++;
      expect(k.tried, `seed ${seed}: median ${k.mid} against rests ${k.rests.lo}–${k.rests.hi}`).toBe(false);
    }
    // The precondition: tight-but-wrong bands do occur here, so it is the range gate that holds them back.
    expect(tight).toBeGreaterThanOrEqual(4);
    expect(wrong).toBeGreaterThanOrEqual(3);
    expect(used).toBe(0);
  });

  it('a small, quickly recovered fatigue (knee under the timer’s 0:45): never used, the research default stands', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const k = kneeFrom(fitCore(simulate(seed, { sessions: 150, gapMedian: 90, gapSd: 0.6 }).entries), BENCH, first(BENCH))!;
      expect(k.use).toBe(false);
    }
  });
});

describe('learn/rest: the knee of one grid cell, exactly', () => {
  // A core whose rest posterior is a single cell (τ 120 s, ρ 0.1, A 5 known almost exactly): the knee then spreads only over
  // the cell's own span, τ log-uniform between the geometric midpoints to its neighbours (90, 180) and ρ over ±0.05, read at
  // the thirds' midpoints. The band's ends are the shortest and longest of those nine knees, scanned from the definition.
  const cell = { tau: 120, rho: 0.1, w: 1, theta: [5, 0, 0] as [number, number, number], cov: [1e-10, 0, 0, 0, 1e-10, 0, 0, 0, 1e-10] };
  const one = {
    rest: { cells: [cell], sets: 100, sessions: 10, breaks: 0, gaps: { lo: 60, hi: 400 }, lastDay: 0 },
    lifts: new Map([[liftKey(BENCH), { aSame: { mean: 5, sd: 1e-6 } }]]), fit: { theta: [5, 0, 0] }, habit: { mean: 2 }, bias: { mean: 1 }, drift: 0,
  } as unknown as Core;

  it('the band runs from the shortest to the longest knee over the cell’s span; the median is inside', () => {
    const lt0 = (Math.log(90) + Math.log(120)) / 2, lt1 = (Math.log(120) + Math.log(180)) / 2;
    const knees: number[] = [];
    for (const a of [1 / 6, 1 / 2, 5 / 6]) for (const b of [1 / 6, 1 / 2, 5 / 6]) knees.push(trueKnee(5, Math.exp(lt0 + a * (lt1 - lt0)), 0.05 + b * 0.1));
    const k = kneeFrom(one, BENCH, first(BENCH))!;
    expect(Math.max(...knees) - Math.min(...knees)).toBeGreaterThan(10); // the spread is real, not rounding (18 s here)
    expect(Math.abs(k.lo - Math.min(...knees))).toBeLessThanOrEqual(1);
    expect(Math.abs(k.hi - Math.max(...knees))).toBeLessThanOrEqual(1);
    expect(k.mid).toBeGreaterThan(k.lo);
    expect(k.mid).toBeLessThan(k.hi);
    expect(k.use).toBe(true);
  });
});

describe('learn/rest: only real times teach it', () => {
  it('no timed day: the rest fit is empty and there is no knee, though the main fit has every lift', () => {
    const core = fitCore(sim(3, { timedFrac: 0, sessions: 60 }).entries);
    expect(core.lifts.size).toBe(SIM_LIFTS.length);
    expect(core.rest.sets).toBe(0);
    expect(core.rest.gaps).toBeNull();
    expect(kneeFrom(core, BENCH, first(BENCH))).toBeNull();
  });

  it('half the days timed: the rest fit learns from those days only', () => {
    const { entries } = sim(4, { timedFrac: 0.5, sessions: 60 });
    const timedDays = new Set(entries.filter((e) => e.loggedAt).map((e) => e.date)).size;
    expect(timedDays).toBeGreaterThan(10);
    expect(timedDays).toBeLessThan(50);
    const core = fitCore(entries);
    expect(core.rest.sessions).toBe(timedDays);
    expect(core.sessions).toBe(60);
  });

  it('a day entered late (times guessed) is left out whole; a 40-min break is past the fence and its next set left out', () => {
    const { entries } = sim(5, { sessions: 60 });
    const base = fitCore(entries).rest;
    const day = entries[entries.length >> 1].date;
    const n = entries.filter((e) => e.date === day).length;
    const late = fitCore(entries.map((e) => (e.date === day ? { ...e, enteredAt: e.loggedAt } : e))).rest;
    expect(late.sets + late.breaks).toBe(base.sets + base.breaks - n);
    expect(late.sessions).toBe(base.sessions - 1);
    // A break between two sets of one lift: every set of the day after the first such pair's first, 40 min later.
    const d2 = entries.filter((e) => e.date === day);
    const i = d2.findIndex((e, j) => j > 0 && e.exercise === d2[j - 1].exercise) - 1;
    expect(i).toBeGreaterThanOrEqual(0);
    const cut = Date.parse(d2[i].loggedAt!);
    const broke = fitCore(entries.map((e) => (e.date === day && Date.parse(e.loggedAt!) > cut ? { ...e, loggedAt: new Date(Date.parse(e.loggedAt!) + 2400e3).toISOString() } : e))).rest;
    expect(broke.breaks).toBe(base.breaks + 1);
    expect(broke.sets).toBe(base.sets - 1);
  });
});

describe('learn/rest: what moves the knee', () => {
  const core = fitCore(sim(3).entries);
  const k = (prior: Prior[], date?: string) => kneeFrom(core, BENCH, prior, { date })!;

  it('position and session: more of the lift’s own sets before it → longer; an overlapping lift before it → longer; one with no overlap → the same', () => {
    const one = k(first(BENCH)), two = k([{ exercise: BENCH, ago: 130 }, ...first(BENCH)]), three = k([{ exercise: BENCH, ago: 260 }, { exercise: BENCH, ago: 130 }, ...first(BENCH)]);
    expect(two.mid).toBeGreaterThan(one.mid + 10);
    expect(three.mid).toBeGreaterThan(two.mid);
    const press = k([{ exercise: 'Incline DB Press', ago: 200 }, ...first(BENCH)]), curl = k([{ exercise: 'DB Curl', ago: 200 }, ...first(BENCH)]);
    expect(press.mid).toBeGreaterThan(one.mid);
    expect(curl.mid).toBe(one.mid);
    // Long ago is as good as never.
    expect(k([{ exercise: BENCH, ago: 3600 }, ...first(BENCH)]).mid).toBe(one.mid);
  });

  it('effort (Refalo 2023): nearer failure → longer, further → shorter, not logged → his usual; the losses as published', () => {
    [7.6, 5.1, 3.95, 2.8, 2.8].forEach((x, i) => expect(effortLoss([0, 1, 2, 3, 5][i])).toBeCloseTo(x, 10));
    expect(effortLoss(0.5)).toBeCloseTo(6.35, 10);
    const r = (rir: number | null) => k([{ exercise: BENCH, ago: 0, rir }]);
    expect(r(null).seconds).toBe(r(null).usual);
    expect(r(0).seconds).toBeGreaterThan(r(0).usual);
    expect(r(2).seconds).toBeLessThan(r(2).usual);
    expect(r(0).seconds).toBeGreaterThan(r(1).seconds);
    // The usual rest and its band don't read the set's own RIR.
    expect({ ...r(0), seconds: 0 }).toEqual({ ...r(null), seconds: 0 });
  });

  it('a layoff widens the band (a year off: no longer in use); the median barely moves', () => {
    const day = (n: number) => new Date((core.rest.lastDay + n) * 864e5).toISOString().slice(0, 10);
    const near = k(first(BENCH), day(1)), year = k(first(BENCH), day(365));
    expect(near.use).toBe(true);
    expect(year.hi - year.lo).toBeGreaterThan(near.hi - near.lo + 30);
    expect(Math.abs(year.mid - near.mid)).toBeLessThanOrEqual(5);
    expect(year.use).toBe(false);
  });

  it('a lift never done has no knee of its own', () => {
    expect(kneeFrom(core, 'Hack Squat', first('Hack Squat'))).toBeNull();
  });
});

describe('learn/rest: the timer and the plan', () => {
  const { entries } = sim(3);
  const core = fitCore(entries);

  it('kneeAfter reads the day’s timed hard sets up to the set (warm-ups and later sets left out), as of the days before', () => {
    const last = entries.at(-1)!.date;
    const day = entries.filter((e) => e.date === last);
    const set = day.find((e, i) => i >= 2 && e.exercise === day[i - 1].exercise)!;
    const at = Date.parse(set.loggedAt!);
    const before = entries.filter((e) => e.date < last);
    const warm: SetEntry = { ...day[0], id: 'warm', flags: ['warmup'], loggedAt: new Date(at - 30e3).toISOString() };
    const log = [...entries, warm];
    const prior: Prior[] = day.filter((e) => Date.parse(e.loggedAt!) <= at).map((e) => ({ exercise: e.exercise, ago: (at - Date.parse(e.loggedAt!)) / 1000, rir: e.rir ?? null }));
    expect(prior.length).toBeGreaterThanOrEqual(3);
    expect(kneeAfter(log, set)).toEqual(kneeFrom(fitCore(before), set.exercise, prior, { date: last }));
    expect(kneeAfter(log, warm)).toBeNull();
  });

  it('planSeconds asks each rest with the session so far (when each set would be done); his setting, warm-ups and cardio never ask', () => {
    const calls: { ex: string; prior: Prior[] }[] = [];
    const knee = (ex: string, prior: readonly Prior[]) => { calls.push({ ex, prior: [...prior] }); return 100; };
    const steps = stepsOf([{ exercise: 'Bench Press', sets: 3 }, { exercise: 'Bike', sets: 1, minutes: 5 }, { exercise: 'DB Curl', sets: 2 }], (ex) => (ex === 'Bench Press' ? 1 : 0));
    const t = planSeconds(steps, { knee, kept: (ex) => (ex === 'DB Curl' ? 150 : undefined) });
    // Warm-up 90 s, then bench 3 × (100 s rests), the bike (no rest after it), curls with his 150 s.
    expect(t).toBe(SET_WORK + 90 + SET_WORK + 100 + SET_WORK + 100 + SET_WORK + 100 + 300 + 0 + SET_WORK + 150 + SET_WORK);
    expect(calls.map((c) => c.ex)).toEqual(['Bench Press', 'Bench Press', 'Bench Press']);
    expect(calls[0].prior).toEqual([{ exercise: 'Bench Press', ago: 0 }]);
    expect(calls[1].prior).toEqual([{ exercise: 'Bench Press', ago: 140 }, { exercise: 'Bench Press', ago: 0 }]);
    expect(calls[2].prior).toEqual([{ exercise: 'Bench Press', ago: 280 }, { exercise: 'Bench Press', ago: 140 }, { exercise: 'Bench Press', ago: 0 }]);
    // A knee that says "none" leaves the research default.
    expect(planSeconds(stepsOf([{ exercise: 'Bench Press', sets: 2 }]), { knee: () => null })).toBe(SET_WORK + 180 + SET_WORK);
  });

  it('kneePlan: the knee where in use (the same as the timer’s at his usual effort); none where not, and none without timed days', () => {
    const date = new Date((core.rest.lastDay + 2) * 864e5).toISOString().slice(0, 10);
    const plan = kneePlan(entries, date)!;
    const k = kneeFrom(core, BENCH, first(BENCH), { date })!;
    expect(k.use).toBe(true);
    expect(plan(BENCH, first(BENCH))).toBe(k.usual);
    expect(kneePlan(sim(3, { gapMedian: 400 }).entries, date)!(BENCH, first(BENCH))).toBeNull();
    expect(kneePlan(sim(3, { timedFrac: 0, sessions: 40 }).entries, date)).toBeNull();
  });

  it('restDelta: δ as is when the plan fits; raised just enough when it doesn’t; never for a log without knees', () => {
    const date = new Date((core.rest.lastDay + 2) * 864e5).toISOString().slice(0, 10);
    const slots = [{ exercise: BENCH, sets: 5 }, { exercise: SIM_LIFTS[1].name, sets: 5 }, { exercise: SIM_LIFTS[2].name, sets: 5 }];
    const len = (d: number) => planSeconds(stepsOf(slots), { knee: kneePlan(entries, date, d)! });
    const full = len(DELTA);
    expect(restDelta(entries, date, slots, Math.ceil(full / 60) + 1)).toBe(DELTA);
    const budget = Math.floor(full / 60) - 3;
    const d = restDelta(entries, date, slots, budget);
    expect(d).toBeGreaterThan(DELTA);
    expect(len(d)).toBeLessThanOrEqual(budget * 60);
    expect(len(d * 0.9)).toBeGreaterThan(budget * 60);
    expect(restDelta(sim(3, { gapMedian: 400 }).entries, date, slots, 5)).toBe(DELTA);
  });
});

describe('restFor with a knee: the "?" says where the rest came from', () => {
  const set = (rir?: number): SetEntry => ({ id: 's', date: '2026-10-20', seq: 0, exercise: 'Bench Press', setNo: 1, weight: 185, reps: 6, flags: [], source: 'app', ...(rir != null && { rir }) });
  const knee = (o: Partial<KneeRest> = {}): KneeRest => ({ usual: 95, seconds: 95, mid: 93, lo: 70, hi: 115, tight: true, tried: true, use: true, rests: { lo: 50, hi: 280 }, delta: DELTA, ...o });
  const sum = (r: { parts: { s: number }[] }) => r.parts.reduce((a, x) => a + x.s, 0);

  it('in use: learned from your sets, its δ and band; this set’s RIR as the knee reads it', () => {
    const r = restFor(set(0), { knee: knee({ seconds: 135 }) });
    expect(r.seconds).toBe(135);
    expect(r.why).toEqual({ base: 95, from: 'knee', effort: 40 });
    expect(r.parts).toEqual([
      { what: 'Learned from your sets', s: 95, note: 'past it, 30 s more gains under 0.3 rep · likely 1:10–1:55' },
      { what: 'RIR 0', s: 40, add: true, note: 'nearer failure: more to recover' },
    ]);
    expect(restFor(set(3), { knee: knee({ seconds: 45 }) }).parts[1]).toEqual({ what: 'RIR 3', s: -50, add: true, note: 'further from failure: less to recover' });
    // A raised δ (the day's budget) is said as it is, rounded up.
    expect(restFor(set(), { knee: knee({ delta: 0.52 }) }).parts[0].note).toBe('past it, 30 s more gains under 0.6 rep · likely 1:10–1:55');
    expect(sum(r)).toBe(r.seconds);
  });

  it('not in use: the research default (and its ±30 s), saying how far his sets have got', () => {
    const wide = restFor(set(0), { knee: knee({ lo: 0, hi: 400, tight: false, use: false }) });
    expect(wide.seconds).toBe(210);
    expect(wide.parts).toEqual([
      { what: 'Research default', s: 180, note: 'big lift · your timed sets can’t pin your own yet: 0:00 to over 5:00' },
      { what: 'RIR 0', s: 30, add: true },
    ]);
    const below = restFor(set(), { knee: knee({ mid: 4, lo: 0, hi: 20, tried: false, use: false, rests: { lo: 260, hi: 470 } }) });
    expect(below.parts).toEqual([{ what: 'Research default', s: 180, note: 'big lift · your sets point to under 4:20, shorter than the rests you’ve timed' }]);
    const above = restFor(set(), { knee: knee({ mid: 520, lo: 480, hi: 560, tried: false, use: false, rests: { lo: 60, hi: 300 } }) });
    expect(above.parts[0].note).toBe('big lift · your sets point to over 5:00, longer than the rests you’ve timed');
    const narrowWide = restFor(set(), { knee: knee({ lo: 30, hi: 160, tight: false, use: false }) });
    expect(narrowWide.parts[0].note).toBe('big lift · your timed sets can’t pin your own yet: 0:30–2:40');
    expect(restFor(set(), { knee: null }).parts).toEqual([{ what: 'Research default', s: 180, note: 'big lift' }]);
  });

  it('his setting still rules, and says what his sets suggest once in use', () => {
    expect(restFor(set(), { kept: 150, knee: knee() }).parts).toEqual([{ what: 'Your setting', s: 150, note: 'Your sets suggest 1:35' }]);
    expect(restFor(set(), { kept: 95, knee: knee() }).parts).toEqual([{ what: 'Your setting', s: 95 }]);
    expect(restFor(set(), { kept: 150, knee: knee({ use: false, tight: false }) }).parts).toEqual([{ what: 'Your setting', s: 150, note: 'Research suggests 3:00' }]);
  });

  it('a warm-up is its fixed rest whatever the knee', () => {
    expect(restFor({ ...set(0), flags: ['warmup'] }, { knee: knee({ usual: 200, seconds: 240 }) }).seconds).toBe(90);
  });
});

// Keeps the Core import honest for readers: the knee reads Core.rest, not the main grid.
export type _Core = Core;
