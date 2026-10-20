import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { calibratedE1rm, oneRm, painFactor, strength, testDue, TEST_REPS, weightForReps } from './estimators';
import { painRisk } from './learn/pain';
import { painGate } from './painPlan';
import { likelyRegion } from './care';
import { simulate, SIM_LIFTS } from './learn/coreSim.sample';
import { learn, testSd } from './learn';
import { liftKey } from './ids';
import { addDays } from './analytics';

describe('oneRm', () => {
  it('matches Epley and the weight-dependent formula', () => {
    expect(oneRm('epley', 100, 10)).toBeCloseTo(133.33, 1);
    // 100 lb = 45.36 kg; wd factor = 1 + 9^0.85/(−2.55+4.58·ln 45.36) = 1 + 6.47/14.92
    expect(oneRm('wd', 100, 10)).toBeCloseTo(143.4, 0);
    expect(oneRm('wd', 100, 1)).toBe(100);
  });
  it('stays finite and positive at very light loads (falls back to Epley below 4 kg)', () => {
    const v = oneRm('wd', 5, 12)!;
    expect(Number.isFinite(v) && v > 5).toBe(true);
    expect(v).toBeCloseTo(oneRm('epley', 5, 12)!, 5);
  });
  it('rejects unusable sets', () => {
    expect(oneRm('epley', 0, 10)).toBeNull();
    expect(oneRm('wd', 100, 0)).toBeNull();
    expect(oneRm('wd', 100, 31)).toBeNull();
  });
  it('inverts both formulas', () => {
    expect(weightForReps('epley', 120, 6)).toBeCloseTo(100, 3);
    const w = weightForReps('wd', 143.4, 10);
    expect(oneRm('wd', w, 10)).toBeCloseTo(143.4, 1);
  });
  it('is continuous and monotonic in weight, so rep-max inversion round-trips at light loads', () => {
    for (const f of ['epley', 'wd'] as const) {
      let prev = 0;
      for (let w = 1; w <= 300; w += 0.5) { const v = oneRm(f, w, 12)!; expect(v).toBeGreaterThan(prev); expect(v - prev).toBeLessThan(3); prev = v; }
      for (const w of [10, 15, 20, 35, 60]) expect(weightForReps(f, oneRm(f, w, 12)!, 12)).toBeCloseTo(w, 1);
    }
  });
});

// Synthetic logs from the learning core's simulator (learn/coreSim.sample), whose true e1RM per set is known.
const lastDate = (es: readonly SetEntry[]) => es.reduce((a, e) => (e.date > a ? e.date : a), '');
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('calibratedE1rm: the learning core’s fatigue-adjusted level (item 04)', () => {
  // Error in logs against the true fresh e1RM at each lift's last session, for the core's level and for the old rule (the best
  // Epley reading of the last 3 sessions). The 1RM extrapolates along the reps–load slope, so it is only as good as κ: with a
  // back-off set (two loads in a day) κ is learned and the error more than halves; without one κ stays on its prior, and the
  // level is still no worse than the old rule.
  const errors = (backoff: boolean) => {
    const neu: number[] = [], old: number[] = [];
    for (let seed = 1; seed <= 4; seed++) {
      const { entries, sets } = simulate(seed, { sessions: 80, pLog: 0.5, backoff });
      for (const l of SIM_LIFTS) {
        const mine = entries.filter((e) => e.exercise === l.name);
        const last = lastDate(mine);
        const truthE = sets.get(mine.find((e) => e.date === last)!.id)!.E;
        neu.push(Math.abs(Math.log(calibratedE1rm(entries, l.name)! / truthE)));
        const dates = [...new Set(mine.map((e) => e.date))].sort().slice(-3);
        const epley = Math.max(...mine.filter((e) => dates.includes(e.date)).map((e) => e.weight * (1 + (e.reps as number) / 30)));
        old.push(Math.abs(Math.log(epley / truthE)));
      }
    }
    return { neu: mean(neu), old: mean(old) };
  };
  it('on simulated logs with back-off sets it lands nearer the true e1RM than the old best Epley of the last 3 sessions, by half or more', () => {
    const e = errors(true);
    expect(e.neu).toBeLessThan(e.old / 2);
    expect(e.neu).toBeLessThan(0.03);
  });
  it('without a second load in a day (κ on its prior) it is still no worse than the old rule', () => {
    const e = errors(false);
    expect(e.neu).toBeLessThanOrEqual(e.old);
  });
  it('is the level of the log before the date: that day and later are left out', () => {
    const { entries } = simulate(2, { sessions: 30 });
    const d = [...new Set(entries.map((e) => e.date))].sort()[20];
    expect(calibratedE1rm(entries, 'Bench Press', d)).toBe(calibratedE1rm(entries.filter((e) => e.date < d), 'Bench Press'));
    expect(calibratedE1rm(entries, 'Bench Press', d)).not.toBe(calibratedE1rm(entries, 'Bench Press'));
    const lv = learn(entries).core.lifts.get(liftKey('Bench Press'))!.level;
    expect(calibratedE1rm(entries, 'Bench Press')).toBeCloseTo(Math.exp(lv.at(-1)!.x), 9);
  });
  it('null for a lift with no level: nothing logged, or bodyweight only', () => {
    const { entries } = simulate(1, { sessions: 10 });
    expect(calibratedE1rm(entries, 'Squat Jump')).toBeNull();
    const pull: SetEntry[] = [0, 1, 2].map((i) => ({ id: `p${i}`, date: `2026-09-0${i + 1}`, seq: i, exercise: 'Pull-up', setNo: 1, weight: 0, reps: 8, flags: ['bodyweight'], source: 't' }));
    expect(calibratedE1rm(pull, 'Pull-up')).toBeNull();
  });
});

describe('strength: the level on a day, and how sure it is', () => {
  it('its SD grows with the days since the lift’s last session, faster past two weeks (layoff); before any test it carries the RIR bias’s', () => {
    const { entries } = simulate(3, { sessions: 60, pLog: 0.5 });
    const last = lastDate(entries.filter((e) => e.exercise === 'Lat Pulldown'));
    const at = (n: number) => strength(entries, 'Lat Pulldown', addDays(last, n))!;
    expect(at(0).e1rm).toBe(at(60).e1rm);
    expect(at(7).sd).toBeGreaterThan(at(0).sd);
    // Per week: the drift alone up to two weeks; past them the layoff adds its own.
    expect((at(42).sd ** 2 - at(28).sd ** 2) / 2).toBeGreaterThan(at(14).sd ** 2 - at(7).sd ** 2);
    expect(at(0).sys).toBeGreaterThan(0.01);
    expect(at(0).u).toBeCloseTo(Math.hypot(at(0).sd, at(0).sys), 12);
  });
});

describe('testDue: when a test would at least halve what the app doesn’t know (item 05)', () => {
  // Two days after the log's last day: a fresh session, the third or later of every lift's run.
  const due = (entries: SetEntry[]) => {
    const today = addDays(lastDate(entries), 2);
    return SIM_LIFTS.filter((l) => testDue(entries, l.name, today));
  };
  it('due on most lifts before any test; after tests (35 % of sessions), on few', () => {
    let before = 0, after = 0;
    for (let seed = 1; seed <= 3; seed++) {
      before += due(simulate(seed, { sessions: 120, pLog: 0.5 }).entries).length;
      after += due(simulate(seed, { sessions: 120, pLog: 0.5, testFrac: 0.35 }).entries).length;
    }
    expect(before).toBeGreaterThanOrEqual(0.7 * 30);
    expect(after).toBeLessThanOrEqual(0.2 * 30);
  });
  it('is due exactly when the uncertainty is above what one test reads the level to (raised for the chance it hurts), and the weight is for about 10 reps', () => {
    const { entries } = simulate(5, { sessions: 120, pLog: 0.5 });
    const today = addDays(lastDate(entries), 2);
    const core = learn(entries).core;
    for (const l of SIM_LIFTS) {
      const s = strength(entries, l.name, today)!;
      const d = testDue(entries, l.name, today);
      expect(!!d, l.name).toBe(s.u > testSd(core, liftKey(l.name), TEST_REPS) * painFactor(painRisk(entries, l.name, today).p));
      if (!d) continue;
      expect(Math.abs(d.reps - TEST_REPS), l.name).toBeLessThanOrEqual(5);
      expect(d.after).toBeLessThan(d.u / Math.SQRT2 + 1e-12);
      expect(d.jump).toBe(false);
    }
  });
  it('today’s increase is the test: its first set at the new weight, no extra set', () => {
    const { entries } = simulate(1, { sessions: 120, pLog: 0.5 });
    const today = addDays(lastDate(entries), 2);
    const l = SIM_LIFTS.find((x) => testDue(entries, x.name, today))!;
    const plain = testDue(entries, l.name, today)!;
    const jump = testDue(entries, l.name, today, undefined, { kind: 'increase', weight: plain.weight + 5 })!;
    expect(jump).toMatchObject({ jump: true, weight: plain.weight + 5 });
    expect(testDue(entries, l.name, today, undefined, { kind: 'reps', weight: plain.weight + 5 })).toEqual(plain);
  });
  it('never while pain holds or eases the lift, or once it has hurt today; mild pain last time stops nothing by itself (item 08, a)', () => {
    const { entries } = simulate(1, { sessions: 120, pLog: 0.5 });
    const today = addDays(lastDate(entries), 2);
    const l = SIM_LIFTS.find((x) => testDue(entries, x.name, today))!.name;
    const one = (date: string, exercise: string, flags: SetEntry['flags'], over: Partial<SetEntry> = {}): SetEntry => ({ id: `x|${date}|${exercise}|${flags.join()}|${over.painSeverity}`, date, seq: 1e6, exercise, setNo: 9, weight: 10, reps: 5, flags, source: 't', ...over });
    const lastS = lastDate(entries.filter((x) => x.exercise === l));
    // Moderate, unknown or sharp on its last session: held or eased, so no test (and its severity is what the gate reads).
    for (const sev of [2, 3, undefined] as const) expect(testDue([...entries, one(lastS, l, ['pain'], sev ? { painSeverity: sev } : {})], l, today), `sev ${sev}`).toBeNull();
    // Mild: the test is weighed by the chance it hurts, as any test is.
    const mild = [...entries, one(lastS, l, ['pain'], { painSeverity: 1 })];
    const s = strength(mild, l, today)!;
    expect(!!testDue(mild, l, today)).toBe(s.u > testSd(learn(mild).core, liftKey(l), TEST_REPS) * painFactor(painRisk(mild, l, today).p));
    // Hurt earlier today, at any severity.
    expect(testDue([...entries, one(today, l, ['pain', 'warmup'], { painSeverity: 1 })], l, today)).toBeNull();
    // Another lift loading the same region hurt (moderate) two days ago: held, so no test; mild there, no hold.
    const near = SIM_LIFTS.find((x) => x.name !== l && likelyRegion(x.name) === likelyRegion(l));
    if (near) {
      expect(testDue([...entries, one(addDays(today, -2), near.name, ['pain'], { painSeverity: 2 })], l, today)).toBeNull();
      expect(painGate([...entries, one(addDays(today, -2), near.name, ['pain'], { painSeverity: 1 })], l, today)).toBeNull();
    }
    const other = SIM_LIFTS.find((x) => x.name !== l)!.name;
    expect(testDue([...entries, one(today, other, ['test'])], l, today)).toBeNull();
    expect(testDue([...entries, one(addDays(today, -1), other, ['test'])], l, today)).not.toBeNull();
    // 50 days off: today is the first session back, then the second; the third may test.
    const later = addDays(today, 50);
    const lastL = lastDate(entries.filter((x) => x.exercise === l));
    const back = (n: number) => entries.filter((e) => e.exercise === l && e.date === lastL)
      .flatMap((e) => Array.from({ length: n }, (_, k) => ({ ...e, id: `${e.id}|b${k}`, loggedAt: undefined, date: addDays(later, k * 3) })));
    expect(testDue(entries, l, later)).toBeNull();
    expect(testDue([...entries, ...back(1)], l, addDays(later, 3))).toBeNull();
    expect(testDue([...entries, ...back(2)], l, addDays(later, 6))).not.toBeNull();
  });
  it('never once hurting is the likelier outcome (item 08, b): a test that hurts reads nothing', () => {
    const { entries } = simulate(1, { sessions: 120, pLog: 0.5 });
    const today = addDays(lastDate(entries), 2);
    const l = SIM_LIFTS.find((x) => testDue(entries, x.name, today))!.name;
    // Mild pain on each of its last six sessions: acceptable (a), so nothing holds it, but it keeps coming back (b).
    const days = [...new Set(entries.filter((e) => e.exercise === l).map((e) => e.date))].sort();
    const hurt = new Set(days.slice(-6));
    const sore = entries.map((e) => (e.exercise === l && hurt.has(e.date) && e.setNo === 1 ? { ...e, id: `${e.id}|p`, flags: [...e.flags, 'pain' as const], painSeverity: 1 as const } : e));
    expect(painGate(sore, l, today)).toBeNull();
    expect(painRisk(sore, l, today).p).toBeGreaterThanOrEqual(0.5);
    expect(testDue(sore, l, today)).toBeNull();
    expect(painFactor(0)).toBe(1);
    expect(painFactor(0.375)).toBeCloseTo(2, 12);
    expect(painFactor(0.5)).toBe(Infinity);
    expect(painFactor(0.55)).toBe(Infinity);
  });
  it('never for a hold or cardio', () => {
    const plank: SetEntry[] = [0, 1, 2, 3].map((i) => ({ id: `h${i}`, date: `2026-09-0${i + 1}`, seq: i, exercise: 'Plank', setNo: 1, weight: 0, reps: 60, flags: ['hold'], source: 't' }));
    expect(testDue(plank, 'Plank', '2026-09-20')).toBeNull();
    expect(testDue([], 'Treadmill', '2026-09-20')).toBeNull();
  });
});
