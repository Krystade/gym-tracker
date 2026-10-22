import { describe, expect, it } from 'vitest';
import { addDays } from './analytics';
import { trend, type BodyDay } from './body';
import { coreBefore } from './learn';
import type { Core, LiftCore } from './learn/capacity';
import { simulate, SIM_LIFTS } from './learn/coreSim.sample';
import { kneeFrom, kneePlan } from './learn/rest';
import { tagsOf } from './learn/tags';
import type { Program } from './program';
import {
  bandStatus, bestRests, bestSetPoints, CARRY, FATIGUE_GATE, fatiguePerSet, muscleSpan, muscleWeeks, movesTogether, nextSession, REL_STALE, relativeStrength,
} from './statsCore';
import { restSeconds } from './timing';
import type { SetEntry } from './types';

// Stats v2's last tiles, on synthetic logs only (no personal data): the learning core's numbers against simulated lifters whose
// truth is known (learn/coreSim.sample), and each gate both ways.

const set = (date: string, exercise: string, weight: number, reps: number, o: Partial<SetEntry> = {}): SetEntry =>
  ({ id: `${date}|${exercise}|${weight}|${reps}|${o.setNo ?? 1}`, date, seq: 0, exercise, setNo: 1, weight, reps, flags: [], source: 'test', ...o });

describe('relativeStrength: e1RM over the trended body weight that day', () => {
  const body: BodyDay[] = [{ date: '2026-08-01', weight: 200 }, { date: '2026-08-15', weight: 196 }, { date: '2026-09-20', weight: 190 }];
  const t = trend(body);
  const lifts = [
    { name: 'Bench Press', points: [{ date: '2026-08-02', v: 250 }, { date: '2026-08-20', v: 260 }, { date: '2026-09-25', v: 270 }] },
    { name: 'Pull-up', points: [{ date: '2026-08-02', v: 240 }] },
  ];

  it('divides by the trend at the latest weigh-in on or before the session, and leaves out a bodyweight lift', () => {
    const rows = relativeStrength(lifts, body, '2026-08-01', '2026-10-01');
    expect(rows.map((r) => r.name)).toEqual(['Bench Press']);
    const [r] = rows;
    expect(r.points.map((p) => p.bw)).toEqual([t[0].trend, t[1].trend, t[2].trend]);
    expect(r.now.ratio).toBeCloseTo(270 / t[2].trend, 10);
    expect(r.change).toBeCloseTo(270 / t[2].trend - 250 / t[0].trend, 10);
  });

  it('a weigh-in reads for REL_STALE days after it, never before it; no weigh-in, no rows', () => {
    const late = [{ name: 'Bench Press', points: [{ date: '2026-07-30', v: 250 }, { date: addDays('2026-09-20', REL_STALE), v: 260 }, { date: addDays('2026-09-20', REL_STALE + 1), v: 261 }] }];
    const [r] = relativeStrength(late, body, '2026-07-01', '2026-12-31');
    expect(r.points.map((p) => p.date)).toEqual([addDays('2026-09-20', REL_STALE)]);
    expect(r.change).toBeNull(); // one point: no change
    expect(relativeStrength(lifts, [], '2026-08-01', '2026-10-01')).toEqual([]);
    expect(relativeStrength(lifts, [{ date: '2026-08-01', energy: 3 }], '2026-08-01', '2026-10-01')).toEqual([]);
  });

  it('a change only once its points are two weeks apart; points outside the range are left out', () => {
    const [r] = relativeStrength(lifts, body, '2026-08-02', '2026-08-15');
    expect(r.points).toHaveLength(1);
    const [s] = relativeStrength([{ name: 'Bench Press', points: [{ date: '2026-08-02', v: 250 }, { date: '2026-08-15', v: 255 }] }], body, '2026-08-01', '2026-10-01');
    expect(s.change).toBeNull();
    const [u] = relativeStrength([{ name: 'Bench Press', points: [{ date: '2026-08-02', v: 250 }, { date: '2026-08-16', v: 255 }] }], body, '2026-08-01', '2026-10-01');
    expect(u.change).not.toBeNull();
  });
});

describe('muscleWeeks and muscleSpan: each muscle a week against its band', () => {
  // Mondays: 2026-09-07, 09-14, 09-21, 09-28 (the week under way).
  const log = [
    set('2026-09-08', 'Bench Press', 200, 8), set('2026-09-08', 'Bench Press', 200, 8, { setNo: 2 }),
    set('2026-09-15', 'Bench Press', 200, 8),
    set('2026-09-29', 'Bench Press', 200, 8),
  ];
  it('a column per Monday-to-Sunday week, from the range\'s first week to today\'s', () => {
    const w = muscleWeeks(log, '2026-09-01', '2026-09-30');
    expect(w.weeks).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
    expect(w.sets.Chest).toEqual([0, 2, 1, 0, 1]);
  });
  it('averages the whole weeks since the first logged set, the week under way left out; counts under, within and over', () => {
    const w = muscleWeeks(log, '2026-09-01', '2026-09-30');
    const s = muscleSpan(w.weeks, w.sets.Chest, [1, 1.5], '2026-09-08');
    expect(s).toEqual({ weeks: 3, avg: 1, under: 1, within: 1, over: 1 });
    expect(muscleSpan(w.weeks, w.sets.Chest, [1, 1.5], null)).toEqual({ weeks: 0, avg: null, under: 0, within: 0, over: 0 });
    // Only the week under way: it's read.
    expect(muscleSpan(['2026-09-28'], [1], [1, 2], '2026-09-29')).toEqual({ weeks: 1, avg: 1, under: 0, within: 1, over: 0 });
  });
  it('bandStatus: under the low end, over the high end, else within', () => {
    expect([bandStatus(0.9, [1, 2]), bandStatus(1, [1, 2]), bandStatus(2, [1, 2]), bandStatus(2.1, [1, 2])]).toEqual(['under', 'within', 'within', 'over']);
  });
});

describe('bestSetPoints: the plain reading beside the core\'s level', () => {
  it('the best Epley set each session in the range, oldest first; warm-ups and other lifts left out', () => {
    const log = [
      set('2026-09-03', 'Bench Press', 200, 5), set('2026-09-03', 'Bench Press', 190, 8, { setNo: 2 }), set('2026-09-03', 'Bench Press', 300, 5, { setNo: 3, flags: ['warmup'] }),
      set('2026-09-03', 'Bench Press', 150, 5, { setNo: 4 }), // a lighter set after the best: the best stands
      set('2026-09-01', 'Bench Press', 180, 5), set('2026-09-01', 'Lat Pulldown', 300, 5), set('2026-08-01', 'Bench Press', 400, 5),
    ];
    expect(bestSetPoints(log, 'bench press', '2026-08-15', '2026-09-30')).toEqual([{ date: '2026-09-01', v: 180 * (1 + 5 / 30) }, { date: '2026-09-03', v: 190 * (1 + 8 / 30) }]);
  });
});

const T = { aSame: 5, tau: 120, rho: 0.1, aCross: 1.5 };
const aLift = SIM_LIFTS.map((_, i) => T.aSame * (1 + ((i % 3) - 1) * 0.15));
/** A lifter whose fatigue is large and recovers within his rests (learn/rest.test's): his knees can be in use. */
const shortRests = (seed: number, sessions = 150) => simulate(seed, { sessions, gapMedian: 90, gapSd: 0.6, truth: { ...T, aLift } });

describe('fatiguePerSet: what the earlier sets cost the next one, behind the §9 gates', () => {
  it('on synthetic lifters, each lift shown holds its true loss at the 3rd set inside its 90 % interval 8 times in 10 or more, unbiased', () => {
    let shown = 0, held = 0, err = 0;
    for (const [seed, o] of [[1, {}], [2, {}], [3, { gapMedian: 90 }], [4, { targets: true }], [5, {}], [6, { gapMedian: 90 }]] as const) {
      const { entries, truth } = simulate(seed, { sessions: 120, pLog: 0.5, ...o });
      const f = fatiguePerSet(coreBefore(entries, '2099-01-01'))!;
      expect(f).not.toBeNull();
      const K = (t: number) => truth.rho + (1 - truth.rho) * Math.exp(-t / truth.tau);
      for (const l of f.lifts) {
        const want = truth.aLift[SIM_LIFTS.findIndex((x) => x.name === l.name)] * (K(f.gap) + K(2 * f.gap));
        shown++; err += l.loss[1] - want;
        if (Math.abs(l.loss[1] - want) <= FATIGUE_GATE.z * l.sd[1]) held++;
        expect(l.loss[0]).toBeLessThan(l.loss[1]);
        expect(l.loss[1]).toBeLessThan(l.loss[2]);
        expect(l.loss[1] - FATIGUE_GATE.z * l.sd[1]).toBeGreaterThan(0);
      }
    }
    expect(shown).toBeGreaterThan(40);
    // The most sets first.
    const f = fatiguePerSet(coreBefore(simulate(1, { sessions: 120, pLog: 0.5 }).entries, '2099-01-01'))!;
    expect(new Set(f.lifts.map((l) => l.sets)).size).toBeGreaterThan(1);
    for (let i = 1; i < f.lifts.length; i++) expect(f.lifts[i - 1].sets).toBeGreaterThanOrEqual(f.lifts[i].sets);
    expect(held / shown).toBeGreaterThanOrEqual(0.8);
    expect(Math.abs(err / shown)).toBeLessThan(0.08);
  });

  it('null under 50 sessions, and for no core', () => {
    const { entries } = simulate(7, { sessions: FATIGUE_GATE.sessions - 1, pLog: 0.5 });
    expect(fatiguePerSet(coreBefore(entries, '2099-01-01'))).toBeNull();
    expect(fatiguePerSet(null)).toBeNull();
    const ok = simulate(7, { sessions: FATIGUE_GATE.sessions + 10, pLog: 0.5 });
    expect(fatiguePerSet(coreBefore(ok.entries, '2099-01-01'))).not.toBeNull();
  });

  it('a lift without a within-session contrast of its own, or whose interval reaches zero, is left out; none left, null', () => {
    const core = coreBefore(simulate(8, { sessions: 120, pLog: 0.5 }).entries, '2099-01-01')!;
    const all = fatiguePerSet(core)!.lifts.map((l) => l.key);
    const lifts = new Map(core.lifts);
    const [a, b, c] = all;
    lifts.set(a, { ...lifts.get(a)!, aSameOwn: null });
    // The 3rd set's interval just past zero (SD a hair over mean / z), and one just short of it.
    const at = (k: string, f: number) => { const l = lifts.get(k)!; lifts.set(k, { ...l, aSame: { mean: l.aSame.mean, sd: (f * l.aSame.mean) / FATIGUE_GATE.z } }); };
    at(b, 1.001); at(c, 0.999);
    expect(fatiguePerSet({ ...core, lifts })!.lifts.map((l) => l.key)).toEqual(all.filter((k) => k !== a && k !== b));
    const none = new Map([...core.lifts].map(([k, l]) => [k, { ...l, aSameOwn: null }]));
    expect(fatiguePerSet({ ...core, lifts: none })).toBeNull();
  });

  it('the cross line only when it clears zero', () => {
    const core = coreBefore(simulate(9, { sessions: 120, pLog: 0.5, gapMedian: 90 }).entries, '2099-01-01')!;
    const f = fatiguePerSet(core)!;
    expect(f.cross).not.toBeNull();
    expect(f.cross!.mean).toBeGreaterThan(FATIGUE_GATE.z * f.cross!.sd);
    expect(fatiguePerSet({ ...core, fit: { ...core.fit, theta: [core.fit.theta[0], 0, core.fit.theta[2]] } })!.cross).toBeNull();
  });
});

describe('bestRests: the learned knee, only where in use', () => {
  it('lists a lift whose knee is in use (the timer\'s), with the research default beside it; none for long rests', () => {
    const { entries } = shortRests(1);
    const core = coreBefore(entries, '2099-01-01')!;
    const date = addDays(entries.at(-1)!.date, 1);
    const names = SIM_LIFTS.map((l) => l.name);
    const rows = bestRests(core, names, date);
    const used = names.filter((n) => kneeFrom(core, n, [{ exercise: n, ago: 0 }], { date })?.use);
    expect(used.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.name).sort()).toEqual([...used].sort());
    for (const r of rows) {
      const k = kneeFrom(core, r.name, [{ exercise: r.name, ago: 0 }], { date })!;
      expect([r.seconds, r.lo, r.hi]).toEqual([k.usual, k.lo, k.hi]);
      expect(r.research).toBe(restSeconds(r.name));
    }
    // Asked only about the lifts named, each once.
    expect(bestRests(core, [used[0], used[0].toUpperCase()], date)).toHaveLength(1);
    const long = coreBefore(simulate(1, { sessions: 150, gapMedian: 400, truth: { ...T, aLift } }).entries, '2099-01-01')!;
    expect(bestRests(long, names, date)).toEqual([]);
    expect(bestRests(coreBefore(simulate(1, { sessions: 60, timedFrac: 0 }).entries, '2099-01-01'), names, date)).toEqual([]);
  });
});

describe('nextSession: the program\'s next day at his pace and at the timer\'s rests', () => {
  const program: Program = {
    key: 'program', perSession: 12, createdAt: '2024-01-01',
    days: [
      { name: 'Push', slots: [{ exercise: 'Bench Press', sets: 3, repMin: 8, repMax: 12 }, { exercise: 'Incline DB Press', sets: 3, repMin: 8, repMax: 12 }, { exercise: 'Treadmill', sets: 1, repMin: 0, repMax: 0, minutes: 10 }] },
      { name: 'Pull', slots: [{ exercise: 'Lat Pulldown', sets: 3, repMin: 8, repMax: 12 }] },
    ],
  };
  it('reads the next day, tomorrow once today has a set; its rests say where each comes from', () => {
    const { entries } = shortRests(2);
    const last = entries.at(-1)!.date;
    const n = nextSession(entries, program, [], last, { kept: (ex) => (ex === 'Incline DB Press' ? 150 : undefined) })!;
    expect(n.date).toBe(addDays(last, 1));
    expect(n.name).toBe('Push');
    expect([n.sets, n.lifts]).toEqual([6, 2]);
    expect(n.pace.seconds).toBeGreaterThan(0);
    expect(n.plan).toBeGreaterThan(0);
    const inc = n.rests.find((r) => r.exercise === 'Incline DB Press')!;
    expect([inc.seconds, inc.from]).toEqual([150, 'kept']);
    // The others: his knee where it's in use (as the timer would run it), else the research default.
    const knee = kneePlan(entries, n.date);
    for (const r of n.rests.filter((x) => x.exercise !== 'Incline DB Press')) {
      const k = knee?.(r.exercise, [{ exercise: r.exercise, ago: 0 }]) ?? null;
      expect([r.from, r.seconds]).toEqual(k != null ? ['knee', k] : ['default', restSeconds(r.exercise)]);
    }
    expect(n.rests.some((r) => r.from === 'knee')).toBe(true);
    const day = addDays(last, 3);
    expect(nextSession(entries, program, [], day)!.date).toBe(day);
  });
  it('null without a program, an empty day, or his pace (two timed days)', () => {
    const { entries } = shortRests(2, 80);
    const last = entries.at(-1)!.date;
    expect(nextSession(entries, null, [], last)).toBeNull();
    expect(nextSession(entries, { ...program, days: [] }, [], last)).toBeNull();
    expect(nextSession(entries, { ...program, days: [{ name: 'Empty', slots: [] }] }, [], last)).toBeNull();
    const untimed = simulate(2, { sessions: 80, timedFrac: 0 }).entries;
    expect(nextSession(untimed, program, [], untimed.at(-1)!.date)).toBeNull();
  });
});

describe('movesTogether: the family layer\'s carry-over ratio', () => {
  it('on synthetic lifters the ratio is within ±10 % of the truth for 9 pairs in 10 or more; only lifts of one movement pair', () => {
    let pairs = 0, near = 0;
    for (const [seed, o] of [[1, {}], [2, { family: 0.02 }], [3, { targets: true }], [4, { pLog: 0 }], [5, {}], [6, { targets: true, backoff: true }]] as const) {
      const { entries, sets } = simulate(seed, { sessions: 120, pLog: 0.5, ...o });
      const last = entries.at(-1)!.date;
      const ps = movesTogether(coreBefore(entries, '2099-01-01'), addDays(last, -83), last);
      for (const p of ps) {
        expect(p.family).toBeTruthy();
        expect(p.weeks).toBeGreaterThanOrEqual(CARRY.min);
        const dates = [...new Set(entries.filter((e) => e.exercise === p.base).map((e) => e.date))].filter((d) => entries.some((e) => e.exercise === p.other && e.date === d));
        const d = dates.at(-1)!;
        const E = (n: string) => sets.get(entries.find((e) => e.exercise === n && e.date === d)!.id)!.E;
        pairs++;
        if (Math.abs(Math.log(p.ratio) - Math.log(E(p.other) / E(p.base))) <= CARRY.accuracy) near++;
        // Never across movements: a press with a pulldown, a curl with a press.
        expect(tagsOf(p.base).move).toBe(tagsOf(p.other).move);
      }
    }
    expect(pairs).toBeGreaterThan(20);
    expect(near / pairs).toBeGreaterThanOrEqual(0.9);
  });

  it('the base is the lift with more sessions; steadiest first; a pair needs CARRY.min weeks both were trained in', () => {
    const { entries } = simulate(1, { sessions: 120, pLog: 0.5 });
    const core = coreBefore(entries, '2099-01-01')!;
    const last = entries.at(-1)!.date;
    const ps = movesTogether(core, addDays(last, -83), last);
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) expect(core.lifts.get(p.base.toLowerCase())!.sessions).toBeGreaterThanOrEqual(core.lifts.get(p.other.toLowerCase())!.sessions);
    for (let i = 1; i < ps.length; i++) expect(ps[i].spread).toBeGreaterThanOrEqual(ps[i - 1].spread);
    expect(movesTogether(core, addDays(last, -27), last)).toEqual([]); // 4 weeks: under 8 weeks in any pair
    expect(movesTogether(null, '2000-01-01', last)).toEqual([]);
  });

  it('a hand-built pair: the ratio in the last shared week, the spread 1.645 sample SDs of the weekly log-ratio, 8 shared weeks, pounds only', () => {
    // Tuesdays from 2026-06-02; Bench Press weeks 0–9, Incline DB Press weeks 2–9 (8 shared), its log-ratio wobbling by d.
    const d = [0.02, -0.01, 0.03, 0, -0.02, 0.01, -0.03, 0.02];
    const lvl = (weeks: number[], x: (w: number) => number) => weeks.map((w) => ({ date: addDays('2026-06-02', 7 * w), day: 7 * w, x: x(w), sd: 0.01 }));
    const lift = (name: string, sessions: number, level: LiftCore['level'], unit: LiftCore['unit'] = 'lb') => ({ key: name.toLowerCase(), name, unit, sessions, level }) as unknown as LiftCore;
    const bx = (w: number) => Math.log(200) + 0.01 * w;
    const bench = lift('Bench Press', 30, lvl([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], bx));
    const incline = lift('Incline DB Press', 20, lvl([2, 3, 4, 5, 6, 7, 8, 9], (w) => bx(w) + Math.log(0.4) + d[w - 2]));
    const core = (...ls: LiftCore[]) => ({ lifts: new Map(ls.map((l) => [l.key, l])) }) as unknown as Core;
    const [p] = movesTogether(core(bench, incline), '2026-06-01', '2026-08-31');
    expect(p).toMatchObject({ base: 'Bench Press', other: 'Incline DB Press', weeks: 8 });
    expect(p.ratio).toBeCloseTo(0.4 * Math.exp(d[7]), 10);
    const m = d.reduce((a, b) => a + b, 0) / d.length, sd = Math.sqrt(d.reduce((a, x) => a + (x - m) ** 2, 0) / (d.length - 1));
    expect(p.spread).toBeCloseTo(CARRY.z * sd, 10);
    // 7 shared weeks, though each lift has 8 of its own: no pair.
    const early = lift('Bench Press', 30, lvl([0, 1, 2, 3, 4, 5, 6, 7], bx));
    const late = lift('Incline DB Press', 20, lvl([1, 2, 3, 4, 5, 6, 7, 8], (w) => bx(w) + Math.log(0.4)));
    expect(movesTogether(core(early, late), '2026-06-01', '2026-08-31')).toEqual([]);
    // A lift read in body mass never pairs with one in pounds.
    expect(movesTogether(core(bench, { ...incline, unit: 'body' }), '2026-06-01', '2026-08-31')).toEqual([]);
  });

  it('the shared drift of a movement steadies its ratios (the spread falls when the family moves as one)', () => {
    let alone = 0, shared = 0;
    for (const seed of [1, 2, 3, 4]) {
      const a = simulate(seed, { sessions: 120, pLog: 0.5, trend: 0 }).entries, b = simulate(seed, { sessions: 120, pLog: 0.5, trend: 0, family: 0.03 }).entries;
      const sp = (es: SetEntry[]) => { const last = es.at(-1)!.date; const ps = movesTogether(coreBefore(es, '2099-01-01'), addDays(last, -83), last); return ps.reduce((s, p) => s + p.spread, 0) / Math.max(1, ps.length); };
      const lv = (es: SetEntry[]) => { const c = coreBefore(es, '2099-01-01')!; return [...c.lifts.values()].reduce((s, l) => s + Math.abs(l.level.at(-1)!.x - l.level[0].x), 0); };
      alone += sp(a) / lv(a); shared += sp(b) / lv(b);
    }
    expect(shared).toBeLessThan(alone);
  });
});
