import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { oneRm, strength, testDue, testWhy, TEST_EVERY_DAYS, TEST_REPS, weightForReps } from './estimators';
import { simulate, SIM_LIFTS } from './learn/coreSim.sample';
import { coreBefore, learn } from './learn';
import { strengthOf } from './learn/strength';
import { learnable } from './stats';
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

/** The learned level as of the days before `before` (what calibratedE1rm returned before it went, 2026-11-22: identical to it). */
const level = (entries: readonly SetEntry[], exercise: string, before = '9999-12-31'): number | null => {
  const core = coreBefore(learnable(entries), before);
  return core && (strengthOf(core, exercise, before)?.e1rm ?? null);
};

describe('the learned level: the learning core’s fatigue-adjusted e1RM (item 04)', () => {
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
        neu.push(Math.abs(Math.log(level(entries, l.name)! / truthE)));
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
    expect(level(entries, 'Bench Press', d)).toBe(level(entries.filter((e) => e.date < d), 'Bench Press'));
    expect(level(entries, 'Bench Press', d)).not.toBe(level(entries, 'Bench Press'));
    const lv = learn(entries).core.lifts.get(liftKey('Bench Press'))!.level;
    expect(level(entries, 'Bench Press')).toBeCloseTo(Math.exp(lv.at(-1)!.x), 9);
  });
  it('null for a lift with no level: nothing logged, or bodyweight only', () => {
    const { entries } = simulate(1, { sessions: 10 });
    expect(level(entries, 'Squat Jump')).toBeNull();
    const pull: SetEntry[] = [0, 1, 2].map((i) => ({ id: `p${i}`, date: `2026-09-0${i + 1}`, seq: i, exercise: 'Pull-up', setNo: 1, weight: 0, reps: 8, flags: ['bodyweight'], source: 't' }));
    expect(level(pull, 'Pull-up')).toBeNull();
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

describe('testDue: a test every 4 weeks, from the last one or from the lift’s first session (item 05, owner 2026-11-22)', () => {
  const sim = simulate(1, { sessions: 120, pLog: 0.5 }).entries;
  const l = SIM_LIFTS[0].name;
  const mine = sim.filter((e) => e.exercise === l);
  const first = mine.map((e) => e.date).sort()[0];
  const before = (d: string) => sim.filter((e) => e.date < d);
  const one = (date: string, exercise: string, flags: SetEntry['flags'], over: Partial<SetEntry> = {}): SetEntry => ({ id: `x|${date}|${exercise}|${flags.join()}|${over.painSeverity}`, date, seq: 1e6, exercise, setNo: 9, weight: 10, reps: 5, flags, source: 't', ...over });

  it('never tested: due 28 days after its first session, not a day before, and says where it counts from', () => {
    expect(TEST_EVERY_DAYS).toBe(28);
    expect(testDue(before(addDays(first, 27)), l, addDays(first, 27))).toBeNull();
    const d = testDue(before(addDays(first, 28)), l, addDays(first, 28))!;
    expect(d).toMatchObject({ since: first, tested: false, days: 28 });
    expect(testDue(before(addDays(first, 40)), l, addDays(first, 40))).toMatchObject({ since: first, days: 40 });
  });
  it('tested: due 28 days after the last test, whatever came between', () => {
    const t = addDays(first, 50);
    const log = [...before(t), { ...mine.find((e) => e.date < t && !e.flags.includes('warmup'))!, id: 'tst', date: t, flags: ['test' as const] }];
    for (const k of [1, 10, 27]) expect(testDue(log, l, addDays(t, k)), `day ${k}`).toBeNull();
    expect(testDue(log, l, addDays(t, 28))).toMatchObject({ since: t, tested: true, days: 28 });
  });
  it('the weight is for about 10 reps, and the test narrows what the app knows', () => {
    const today = addDays(lastDate(sim), 2);
    for (const x of SIM_LIFTS) {
      const d = testDue(sim, x.name, today)!;
      expect(d, x.name).not.toBeNull();
      expect(Math.abs(d.reps - TEST_REPS), x.name).toBeLessThanOrEqual(5);
      expect(d.after).toBeLessThan(d.u);
      expect(d.jump).toBe(false);
    }
  });
  it('not held back by pain, a light week or a lift’s first 2 sessions', () => {
    const today = addDays(lastDate(sim), 2);
    const lastS = lastDate(mine);
    expect(testDue(sim, l, today)).not.toBeNull();
    // Moderate, unknown or sharp pain last time (the pain plan holds or eases it), or pain earlier today: still due.
    for (const sev of [1, 2, 3, undefined] as const) expect(testDue([...sim, one(lastS, l, ['pain'], sev ? { painSeverity: sev } : {})], l, today), `sev ${sev}`).not.toBeNull();
    expect(testDue([...sim, one(today, l, ['pain', 'warmup'], { painSeverity: 3 })], l, today)).not.toBeNull();
    // A light week, by today's target.
    expect(testDue(sim, l, today, undefined, { kind: 'light', weight: 100 })).not.toBeNull();
    // 50 days off: the first session back is due (the old rule waited for the third).
    expect(testDue(sim, l, addDays(today, 50))).not.toBeNull();
  });
  it('one test a day: a test logged today on another lift holds this one to another day', () => {
    const today = addDays(lastDate(sim), 2);
    const other = SIM_LIFTS.find((x) => x.name !== l)!.name;
    expect(testDue([...sim, one(today, other, ['test'])], l, today)).toBeNull();
    expect(testDue([...sim, one(addDays(today, -1), other, ['test'])], l, today)).not.toBeNull();
  });
  it('today’s increase is the test: its first set at the new weight, no extra set', () => {
    const today = addDays(lastDate(sim), 2);
    const plain = testDue(sim, l, today)!;
    const jump = testDue(sim, l, today, undefined, { kind: 'increase', weight: plain.weight + 5 })!;
    expect(jump).toMatchObject({ jump: true, weight: plain.weight + 5, since: plain.since });
    expect(testDue(sim, l, today, undefined, { kind: 'reps', weight: plain.weight + 5 })).toEqual(plain);
  });
  it('the cadence is a setting: a shorter one comes sooner', () => {
    expect(testDue(before(addDays(first, 14)), l, addDays(first, 14))).toBeNull();
    expect(testDue(before(addDays(first, 14)), l, addDays(first, 14), undefined, null, 14)).not.toBeNull();
  });
  it('says why plainly', () => {
    expect(testWhy({ tested: true, days: 37 })).toBe('A test every 4 weeks, whatever the week: your last was 5 weeks ago.');
    expect(testWhy({ tested: false, days: 28 })).toBe('A test every 4 weeks, whatever the week: you started this lift 4 weeks ago and haven’t tested it yet.');
  });
  it('never for a hold, cardio or a lift never done', () => {
    const plank: SetEntry[] = [0, 1, 2, 3].map((i) => ({ id: `h${i}`, date: `2026-08-0${i + 1}`, seq: i, exercise: 'Plank', setNo: 1, weight: 0, reps: 60, flags: ['hold'], source: 't' }));
    expect(testDue(plank, 'Plank', '2026-09-20')).toBeNull();
    expect(testDue([], 'Treadmill', '2026-09-20')).toBeNull();
    expect(testDue(sim, 'Cable Fly', addDays(lastDate(sim), 2))).toBeNull();
  });
});
