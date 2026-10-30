import { describe, expect, it } from 'vitest';
import { MUSCLES, type Muscle } from '../muscles';
import { defaultProfile, type Profile, type Tier } from '../profile';
import { buildProgram, programVolume, type DayPlan, type Program, type Slot } from '../program';
import type { SetEntry } from '../types';
import { rng } from './num';
import { readiness, readinessModel } from './readiness';
import { shuffleSessions, simulateRecovery } from './recoverySim.sample';
import {
  decidedBy, fullSets, MAX_PATTERNS, planWeek, PRIORITY_WEIGHT, ranksAbove, readinessPlanned, readyOnSetGrid, REST_GAIN, searchWeek, sessionOptions, slotVolume, volumeScore,
  type PlanFacts, type PlanInput, type PlanPick, type WeekPlan,
} from './schedule';
import { planAims, volumeAdvice } from './volume';

// learn/schedule (readiness S3): the week's plan. The search against an independent brute force on random facts, its edge cases,
// and the planner on synthetic logs. Synthetic only; no personal data.

const addD = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const wd = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const nextMonday = (d: string) => { let x = addD(d, 1); while (wd(x) !== 1) x = addD(x, 1); return x; };
/** `n` sets of `reps` of a lift on `date` from 17:00, three minutes apart; RIR 0 when `fail`. */
const session = (date: string, exercise: string, n: number, reps: number, fail: boolean, extra: Partial<SetEntry> = {}): SetEntry[] =>
  Array.from({ length: n }, (_, k) => ({
    id: `t|${date}|${exercise}|${k + 1}`, date, seq: k, loggedAt: new Date(Date.parse(`${date}T17:00:00Z`) + k * 180e3).toISOString(),
    exercise, setNo: k + 1, weight: 100, reps, flags: [], source: 'test', ...(fail ? { rir: 0 } : { rir: 3 }), ...extra,
  }));
const slot = (exercise: string, sets = 3): Slot => ({ exercise, sets, repMin: 8, repMax: 12 });
const program = (days: [string, Slot[]][]): Program => ({ key: 'program', perSession: 12, createdAt: '', days: days.map(([name, slots]) => ({ name, slots })) });
const plan = (date: string, day: number, extra: Partial<DayPlan> = {}): DayPlan => ({ key: `day:${date}`, date, day, skips: [], swaps: {}, ...extra });
const popcount = (x: number) => { let n = 0; for (; x; x &= x - 1) n++; return n; };

/** Every string anywhere in a value (labels, reasons, evidence, names). */
const strings = (x: unknown, out: string[] = []): string[] => {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) x.forEach((y) => strings(y, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((y) => strings(y, out));
  return out;
};
/** A clock time: "17:40", "7:05", "5pm", "5 am". Owner Q2: none, anywhere (learn/readiness's detector). */
const CLOCK = /\d{1,2}:\d{2}|\b\d{1,2}\s?(am|pm)\b/i;
const clockTimes = (x: unknown) => strings(x).filter((s) => CLOCK.test(s));

// ---- The search against a brute force ---------------------------------------------------------------------------------------

/**
 * An independent brute force: every pattern with the goal's training days and the forced ones, every sequence of sessions the
 * cycle allows (each day once a cycle, the cycle's days left first), every order; ranked lexicographically, then the earlier day.
 */
function brute(f: PlanFacts): { score: PlanPick['score']; mask: number } | null {
  const D = f.days, T = Math.min(f.sessions, D), k = T - (f.fixed != null ? 1 : 0);
  const seqs: number[][] = [];
  const all = new Set(f.all);
  const grow = (seq: number[], done: Set<number>) => {
    if (seq.length === k) { seqs.push(seq); return; }
    if (!all.size) { seqs.push(seq); return; }
    for (const s of f.all) {
      if (done.has(s)) continue;
      const nd = new Set(done); nd.add(s);
      grow([...seq, s], nd.size === all.size ? new Set() : nd);
    }
  };
  const start = new Set(f.all.filter((s) => !f.left.includes(s)));
  grow([], start.size === all.size ? new Set() : start);
  let best: { score: PlanPick['score']; mask: number } | null = null;
  for (let mask = 0; mask < 1 << D; mask++) {
    if (popcount(mask) !== T || (mask & f.forced) !== f.forced || (f.fixed != null && !(mask & 1))) continue;
    const free = [...Array(D).keys()].filter((d) => mask & (1 << d) && !(d === 0 && f.fixed != null));
    for (const seq of seqs) {
      let ready = f.fixed != null ? f.ready(f.fixed, 0) ?? 0 : 0;
      seq.forEach((s, i) => { ready += f.ready(s, free[i]) ?? 0; });
      const availability = [...Array(D).keys()].reduce((a, d) => a + (mask & (1 << d) ? f.avail[d] : 0), 0);
      const p: PlanPick = { mask, order: [], score: { sessions: T, volume: volumeScore(f, seq), ready, availability } };
      if (!best || ranksAbove(p, { mask: best.mask, order: [], score: best.score })) best = { score: p.score, mask };
    }
  }
  return best;
}

const SOME: Muscle[] = ['Chest', 'Lats', 'Quads', 'Biceps', 'Calves'];
function randomFacts(seed: number): PlanFacts {
  const r = rng(seed);
  const D = 1 + Math.floor(r.next() * 7);
  const n = Math.floor(r.next() * 5);
  const all = [...Array(n).keys()];
  const left = all.filter(() => r.next() < 0.5);
  const fixed = r.next() < 0.3 ? n : null; // today's session, its own index (as planWeek makes it)
  const vol = Array.from({ length: n + 1 }, () => Object.fromEntries(SOME.filter(() => r.next() < 0.6).map((m) => [m, Math.round(r.next() * 11)])));
  const ready = Array.from({ length: n + 1 }, () => Array.from({ length: D }, () => (r.next() < 0.1 ? null : Math.round(r.next() * 100))));
  const avail = Array.from({ length: D }, () => Math.round(r.next() * 4) / 4); // quarters: ties happen
  const sessions = Math.max(fixed != null ? 1 : 0, Math.floor(r.next() * 9));
  return {
    // Forced (trained today, or a layoff) only with a session to plan, as planWeek makes it.
    days: D, sessions, forced: fixed != null || (sessions > 0 && r.next() < 0.2) ? 1 : 0, vol, left, all, fixed,
    base: Object.fromEntries(SOME.map((m) => [m, Math.round(r.next() * 6)])),
    weight: Object.fromEntries(SOME.map((m) => [m, r.pick([4, 3, 2, 0])])),
    cap: Object.fromEntries(SOME.map((m) => [m, Math.round(r.next() * 20)])),
    ready: (s, d) => ready[s][d], avail,
  };
}

describe('learn/schedule: the search', () => {
  const cases = Array.from({ length: 400 }, (_, i) => randomFacts(i + 1));

  it('finds the brute force’s best on 400 random weeks (every tier, the order, ties to the earlier day)', () => {
    let differ = 0, ties = 0, readyDecides = 0, availDecides = 0;
    for (const f of cases) {
      const s = searchWeek(f), b = brute(f)!;
      expect(s.best.score.sessions).toBe(b.score.sessions);
      expect(s.best.score.volume).toBeCloseTo(b.score.volume, 9);
      expect(s.best.score.ready).toBe(b.score.ready);
      expect(s.best.score.availability).toBeCloseTo(b.score.availability, 9);
      expect(s.best.mask).toBe(b.mask);
      // The order it reports adds up to its Ready.
      const sum = s.best.order.reduce<number>((a, x, d) => a + (x == null ? 0 : f.ready(x, d) ?? 0), 0);
      expect(sum).toBe(s.best.score.ready);
      // How often the later tiers decide (so the equality above isn't all ties).
      for (const w of s.bestWith) if (w && w !== s.best) {
        differ++;
        const t = decidedBy(s.best, w);
        if (t === 'ready') readyDecides++; else if (t === 'availability') availDecides++; else if (t === 'tie') ties++;
      }
    }
    expect(readyDecides).toBeGreaterThan(50);
    expect(availDecides).toBeGreaterThan(20);
    expect(ties).toBeGreaterThan(5);
    expect(differ).toBeGreaterThan(200);
  });

  it('the goal: exactly the sessions needed (never more), every forced day, all days when it needs them all; ≤ 128 patterns', () => {
    for (const f of cases) {
      const s = searchWeek(f), T = Math.min(f.sessions, f.days);
      expect(popcount(s.best.mask)).toBe(T);
      expect(s.best.mask & f.forced).toBe(f.forced);
      if (f.sessions >= f.days) expect(s.best.mask).toBe((1 << f.days) - 1); // zero slack: today trains, every day does
      expect(s.patterns).toBe(1 << f.days);
      expect(s.patterns).toBeLessThanOrEqual(MAX_PATTERNS);
      expect(s.scored).toBeLessThanOrEqual(s.patterns);
      // Every training day has a session when there are sessions to plan; rest days none.
      s.best.order.forEach((x, d) => {
        if (!(s.best.mask & (1 << d))) expect(x).toBeNull();
        else if (f.all.length || (d === 0 && f.fixed != null)) expect(x).not.toBeNull();
      });
    }
  });

  it('recovery never trades volume: the sessions’ volume is the best of the cycle’s choices whatever Ready says', () => {
    let moved = 0;
    for (const f of cases) {
      const s = searchWeek(f);
      const k = Math.min(f.sessions, f.days) - (f.fixed != null ? 1 : 0);
      const top = Math.max(...sessionOptions(f.left, f.all, k).map((o) => volumeScore(f, o.flat())));
      expect(s.best.score.volume).toBeCloseTo(top, 9);
      // Ready reversed: same volume, and the same sessions (as a multiset) whenever only one choice is best.
      const rev = searchWeek({ ...f, ready: (x, d) => 100 - (f.ready(x, d) ?? 0) });
      expect(rev.best.score.volume).toBeCloseTo(s.best.score.volume, 9);
      if (rev.best.mask !== s.best.mask) moved++;
    }
    expect(moved).toBeGreaterThan(30); // Ready does move the days (else the check above proves little)
  });

  it('priority 4 counts 0: sets for a muscle weighted 0 never change the choice; weighted, they do (pair)', () => {
    const f: PlanFacts = {
      days: 7, sessions: 1, forced: 0, vol: [{ Chest: 6 }, { Chest: 6, Calves: 8 }], left: [0, 1], all: [0, 1], fixed: null,
      base: {}, weight: { Chest: 4, Calves: PRIORITY_WEIGHT[4] }, cap: { Chest: 20, Calves: 20 }, ready: (s) => (s === 0 ? 90 : 80), avail: Array(7).fill(0.5),
    };
    expect(PRIORITY_WEIGHT[4]).toBe(0);
    const a = searchWeek(f);
    expect(a.kept).toBe(2); // a tie on volume: Ready picks session 0
    expect(a.best.order.find((x) => x != null)).toBe(0);
    const b = searchWeek({ ...f, weight: { Chest: 4, Calves: PRIORITY_WEIGHT[1] } });
    expect(b.kept).toBe(1);
    expect(b.best.order.find((x) => x != null)).toBe(1); // volume first: the Calves day, Ready or not
  });

  it('the cycle: its days left come first; whole cycles after; a day never twice in one', () => {
    expect(sessionOptions([2, 3], [0, 1, 2, 3], 1)).toEqual([[[2]], [[3]]]);
    expect(sessionOptions([2, 3], [0, 1, 2, 3], 2)).toEqual([[[2, 3]]]);
    expect(sessionOptions([2, 3], [0, 1, 2, 3], 3)).toEqual([[[2, 3], [0]], [[2, 3], [1]], [[2, 3], [2]], [[2, 3], [3]]]);
    expect(sessionOptions([], [0, 1], 5)).toEqual([[[0, 1], [0, 1], [0]], [[0, 1], [0, 1], [1]]]);
    expect(sessionOptions([1], [], 3)).toEqual([[]]);
    expect(sessionOptions([1], [0, 1], 0)).toEqual([[]]);
  });

  it('edge cases: the last day, the goal met, no sessions to plan, a forced day the goal doesn’t need', () => {
    const base: PlanFacts = { days: 1, sessions: 1, forced: 0, vol: [{ Chest: 3 }], left: [0], all: [0], fixed: null, base: {}, weight: { Chest: 4 }, cap: { Chest: 10 }, ready: () => 10, avail: [0.1] };
    expect(searchWeek(base).best).toMatchObject({ mask: 1, order: [0] }); // Sunday, one needed: today, however unready
    expect(searchWeek({ ...base, sessions: 0 }).best).toMatchObject({ mask: 0, order: [null] }); // goal met: rest
    const none = searchWeek({ ...base, days: 4, sessions: 2, vol: [], left: [], all: [], avail: [0.2, 0.9, 0.1, 0.9] });
    expect(none.best.mask).toBe(0b1010); // no sessions: still the goal's days, on his likeliest days
    expect(none.best.order).toEqual([null, null, null, null]);
    // Today forced (a layoff) against his likeliest days.
    expect(searchWeek({ ...base, days: 4, sessions: 2, forced: 1, avail: [0.2, 0.9, 0.1, 0.9] }).best.mask).toBe(0b0011);
  });
});

// ---- The planner on synthetic logs ------------------------------------------------------------------------------------------

/** A weekly routine: one upper session on `weekday` (0 Sunday … 6 Saturday) for `weeks` weeks before `today`. */
const routine = (today: string, weekday: number, weeks: number, fail = false): SetEntry[] => {
  let d = addD(today, -1);
  while (wd(d) !== weekday) d = addD(d, -1);
  const out: SetEntry[] = [];
  for (let w = 0; w < weeks; w++) { const x = addD(d, -7 * w); out.push(...session(x, 'Bench Press', 3, 10, fail), ...session(x, 'Lat Pulldown', 3, 10, fail)); }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
};
const UL = program([['Upper', [slot('Bench Press', 4), slot('Lat Pulldown', 4), slot('DB Curl', 3)]], ['Legs', [slot('Leg Press', 4), slot('Leg Extension', 3)]]]);
const input = (o: Partial<PlanInput> & Pick<PlanInput, 'entries' | 'today'>): PlanInput => ({
  body: [], weeklyGoal: 2, program: UL, plans: [], quick: null, tz: 'UTC', profile: defaultProfile(), ...o,
});
const trainDays = (p: WeekPlan) => p.days.filter((d) => d.train).map((d) => d.label);

describe('learn/schedule: the week', () => {
  const MON = '2026-03-02', WED = '2026-03-04', SUN = '2026-03-08';
  const log = routine(MON, 6, 12); // Saturdays

  it('plans from today to Sunday, by day: the goal’s sessions, the rest with a reason; labels today, tomorrow, weekday', () => {
    const p = planWeek(input({ entries: log, today: WED }));
    expect(p.days.map((d) => d.date)).toEqual(['2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08']);
    expect(p.days.map((d) => d.label)).toEqual(['today', 'tomorrow', 'Fri', 'Sat', 'Sun']);
    expect(p.week).toMatchObject({ goal: 2, done: 0, needed: 2, daysLeft: 5 });
    expect(p.days.filter((d) => d.train).length).toBe(2);
    for (const d of p.days) {
      if (d.train) { expect(d.session).not.toBeNull(); expect(d.ready!.ready).not.toBeNull(); expect(d.rest).toBeNull(); }
      else { expect(d.session).toBeNull(); expect(d.rest!.label.length).toBeGreaterThan(0); }
    }
    expect(p.todayInPlan).toBe(p.days[0].train);
    expect(p.patterns).toBe(32);
    expect(new Set(p.days.filter((d) => d.train).map((d) => d.session!.name))).toEqual(new Set(['Upper', 'Legs'])); // one cycle
  });

  it('today counts as a day he can train; his usual days order the days ahead: a Saturday lifter on Monday, goal 2: today and Saturday', () => {
    const p = planWeek(input({ entries: log, today: MON, weeklyGoal: 2 }));
    expect(trainDays(p)).toEqual(['today', 'Sat']);
    expect(p.days.slice(1, 5).every((d) => d.rest!.kind === 'usual')).toBe(true);
    expect(p.days[6].rest!.kind).toBe('goal-met');
    expect(p.days[6].rest!.label).toBe('Goal met by Sat'); // by the session planned that day
    // The goal met by today's session, still to come: said so (once trained, "Goal met today": the pair below).
    expect(planWeek(input({ entries: log, today: MON, weeklyGoal: 1 })).days[1].rest!.label).toBe('Goal met with today’s session');
    expect(p.evidence.find((e) => e.rule.startsWith('Ties'))).toMatchObject({ kind: 'learned', acts: true });
    expect(p.evidence.find((e) => e.rule.startsWith('Today counts'))).toMatchObject({ kind: 'research', acts: true });
    // Pair: a Wednesday lifter, the same week: today and Wednesday.
    expect(trainDays(planWeek(input({ entries: routine(MON, 3, 12), today: MON, weeklyGoal: 2 })))).toEqual(['today', 'Wed']);
    // A spare week (7 days for 1 session) still trains today: a tie never rests today.
    expect(trainDays(planWeek(input({ entries: log, today: MON, weeklyGoal: 1 })))).toEqual(['today']);
    expect(readinessPlanned(input({ entries: log, today: MON, weeklyGoal: 1 })).verdict.kind).not.toBe('rest');
    // No log to learn days from: every day alike, the earliest win.
    const fresh = planWeek(input({ entries: [], today: MON, weeklyGoal: 2 }));
    expect(trainDays(fresh)).toEqual(['today', 'tomorrow']);
    expect(fresh.evidence.find((e) => e.rule.startsWith('Ties'))).toMatchObject({ kind: 'default', acts: false });
  });

  it('never Rest when the goal is at risk: zero slack trains every day left; and the verdict is never Rest then (table)', () => {
    let tight = 0, rested = 0;
    // Sore: a synthetic lifter (learn/recovery fitted) with its upper day done this cycle and the legs to failure yesterday.
    const { entries: sim } = simulateRecovery(1, { sessions: 60, failFrac: 0.3 });
    const SIM_MON = nextMonday(addD(sim.at(-1)!.date, 1)), simPlans = [plan(sim.at(-1)!.date, 0)];
    for (const lifted of ['none', 'daily', 'sore'] as const) for (let k = 0; k < 7; k++) {
      const today = addD(lifted === 'sore' ? SIM_MON : MON, k);
      // Daily: a session every day of the week before today (k done).
      const week = lifted === 'daily' ? Array.from({ length: k }, (_, i) => session(addD(MON, i), 'Bench Press', 3, 10, false)).flat() : [];
      const sore = [...session(addD(today, -1), 'Leg Press', 5, 12, true), ...session(addD(today, -1), 'Leg Extension', 4, 12, true)];
      // One log per day for all seven goals: the same sets, so the recovery fit is the last call's (readinessModel), not refitted.
      const entries = lifted === 'sore' ? [...sim, ...sore] : [...log, ...week];
      const done = lifted === 'daily' ? k : lifted === 'sore' && k > 0 ? 1 : 0;
      for (const goal of [1, 2, 3, 4, 5, 6, 7]) {
        const r = readinessPlanned(input({ entries, today, weeklyGoal: goal, ...(lifted === 'sore' ? { plans: simPlans } : {}) }));
        const p = r.plan!;
        const T = Math.min(Math.max(0, goal - done), 7 - k);
        expect(p.days.filter((d) => d.train).length).toBe(T); // the goal met whenever it can be, never more
        if (goal - done >= 7 - k) { tight++; expect(p.days.every((d) => d.train)).toBe(true); expect(r.verdict.kind).not.toBe('rest'); }
        if (r.verdict.kind === 'rest') {
          rested++;
          expect(r.week.slack).toBeGreaterThanOrEqual(1); expect(p.todayInPlan).toBe(false); expect(r.week.met).toBe(false);
          expect(p.restGain!.sets).toBeGreaterThanOrEqual(1);
        }
      }
    }
    expect(tight).toBeGreaterThan(30);
    expect(rested).toBeGreaterThanOrEqual(10); // the table holds rest days too (the sore lifter's)
  }, 15_000); // 147 plans: about 2 s alone, past vitest's 5 s default on a loaded deploy runner

  it('the goal met: the days ahead rest, “Goal met”; the verdict is a Go, “extra session optional”, never Rest (owner S4); trained today anyway: today is in the plan (pair)', () => {
    const done = [...log, ...session(MON, 'Bench Press', 3, 10, false), ...session('2026-03-03', 'Lat Pulldown', 3, 10, false)];
    const p = planWeek(input({ entries: done, today: WED, weeklyGoal: 2 }));
    expect(p.week.needed).toBe(0);
    expect(p.week.met).toBe(true);
    expect(p.days.every((d) => !d.train && d.rest!.kind === 'goal-met' && d.rest!.label === 'Goal met')).toBe(true);
    const r = readinessPlanned(input({ entries: done, today: WED, weeklyGoal: 2 }));
    expect(r.verdict).toEqual({ kind: 'go', why: 'goal-met', label: 'Goal met · extra session optional' });
    expect(r.evidence.find((e) => e.rule.startsWith('The goal met'))).toMatchObject({ kind: 'research', acts: true });
    // A light week on: the extra session, if any, light; still never Rest.
    expect(readinessPlanned(input({ entries: done, today: WED, weeklyGoal: 2, tapped: { from: MON } })).verdict).toEqual({ kind: 'light', why: 'goal-met', label: 'Goal met · go light if you train' });
    // Pair: one session short, the same week is not met, and the verdict is not the goal's.
    const short = readinessPlanned(input({ entries: done, today: WED, weeklyGoal: 3 }));
    expect(short.week.met).toBe(false);
    expect(short.verdict.why).not.toBe('goal-met');
    expect(short.evidence.find((e) => e.rule.startsWith('The goal met'))!.acts).toBe(false);
    const extra = [...done, ...session(WED, 'DB Curl', 2, 10, false)];
    const q = planWeek(input({ entries: extra, today: WED, weeklyGoal: 2 }));
    expect(q.days[0]).toMatchObject({ train: true, fixed: 'trained' });
    expect(q.days.slice(1).every((d) => !d.train && d.rest!.label === 'Goal met today')).toBe(true);
    expect(readinessPlanned(input({ entries: extra, today: WED, weeklyGoal: 2 })).verdict.kind).not.toBe('rest');
  });

  /** The model's own readings with Ready set by day: `now` today (as low energy marks today only), `later` after. */
  const readAt = (entries: SetEntry[], today: string, now: number, later: number) => {
    const real = readinessModel(entries, [], today, 'UTC');
    return { recovery: null, sessionReady: (slots: readonly Slot[], date: string) => ({ ...real.sessionReady(slots, date), ready: date === today ? now : later }) };
  };

  it('Ready on the whole-set grid: a fraction of a set fresher later doesn’t rest today; a whole set does (table, pair)', () => {
    const T: [number | null, number, number | null][] = [[null, 0, null], [null, 12, null], [90, 12, 92], [95, 12, 92], [80, 12, 83], [100, 7, 100], [0, 3, 0], [17, 3, 33], [16, 3, 0]];
    for (const [ready, total, want] of T) expect(readyOnSetGrid({ ready, total })).toBe(want);
    // One 11-set session: 90 vs 94 is 9.9 vs 10.3 of 11, both 10; 80 is 8.8, 9: a whole set less.
    const upper = program([['Upper', UL.days[0].slots]]);
    const tie = planWeek(input({ entries: log, today: MON, weeklyGoal: 1, program: upper }), readAt(log, MON, 90, 94));
    expect(tie.days[0]).toMatchObject({ train: true, fixed: null });
    const far = planWeek(input({ entries: log, today: MON, weeklyGoal: 1, program: upper }), readAt(log, MON, 80, 94));
    expect(far.days[0]).toMatchObject({ train: false, rest: { kind: 'recovering' } });
  });

  it('rest today for recovery only when waiting gains a whole set at full strength, unrounded (owner S4: REST_GAIN; table, pairs)', () => {
    expect(REST_GAIN).toBe(1);
    expect(fullSets({ ready: 81, total: 10 })).toBeCloseTo(8.1, 12);
    expect(fullSets({ ready: null, total: 10 })).toBe(0);
    // One 10-set session, the week's one: today `now`, every later day 90 (9 sets).
    const ten = program([['Upper', [slot('Bench Press', 4), slot('Lat Pulldown', 3), slot('DB Curl', 3)]]]);
    const at = (now: number) => {
      const i = input({ entries: log, today: MON, weeklyGoal: 1, program: ten });
      const p = planWeek(i, readAt(log, MON, now, 90));
      return { p, v: readiness({ ...i, todayInPlan: p.todayInPlan }).verdict };
    };
    // [today's Ready, rests today, the gain (sets), held back from a rest]
    const T: [number, boolean, number | null, boolean][] = [
      [90, false, null, false], // equal: today
      [86, false, null, false], // 8.6 and 9 sets both round to 9: the grid ties, today
      [84, false, 0.6, true], // 8.4 rounds to 8, a whole set less on the grid; unrounded 0.6 of a set: today trains
      [81, false, 0.9, true],
      [80, true, 1, false], // exactly a set: rest
      [70, true, 2, false],
    ];
    for (const [now, rests, gain, held] of T) {
      const { p, v } = at(now);
      expect(p.days[0].train, `${now}`).toBe(!rests);
      expect(v.kind === 'rest', `${now}`).toBe(rests);
      if (gain == null) expect(p.restGain, `${now}`).toBeNull();
      else { expect(p.restGain!.sets, `${now}`).toBeCloseTo(gain, 9); expect(p.restGain!.held, `${now}`).toBe(held); }
      expect(p.evidence.find((e) => e.rule.startsWith('Rest today for recovery'))!.acts, `${now}`).toBe(held);
      expect(p.days.filter((d) => d.train).length).toBe(1); // the goal's one session either way
    }
    // Held back: today trains the session, its own Ready; the rest days' reasons stand.
    const held = at(84).p;
    expect(held.days[0]).toMatchObject({ train: true, fixed: null, session: { name: 'Upper' } });
    expect(held.days.slice(1).every((d) => !d.train && d.rest!.kind === 'goal-met')).toBe(true);
  });

  it('a layoff: today trains though it reads least ready; two days off, the same readings rest today (pair)', () => {
    const lowToday = (entries: SetEntry[], today: string) => readAt(entries, today, 40, 90);
    const away = routine(addD(MON, -9), 6, 12); // last Saturday 10 days before Monday
    const p = planWeek(input({ entries: away, today: MON, weeklyGoal: 1 }), lowToday(away, MON));
    expect(p.days[0]).toMatchObject({ train: true, fixed: 'layoff' });
    expect(p.evidence.find((e) => e.rule.startsWith('A layoff'))).toMatchObject({ kind: 'research', acts: true });
    expect(readinessPlanned(input({ entries: away, today: MON, weeklyGoal: 1 })).verdict).toMatchObject({ kind: 'go', why: 'layoff' });
    const near = planWeek(input({ entries: log, today: MON, weeklyGoal: 1 }), lowToday(log, MON));
    expect(near.days[0]).toMatchObject({ train: false, fixed: null, rest: { kind: 'recovering' } });
    expect(near.evidence.find((e) => e.rule.startsWith('A layoff'))!.acts).toBe(false);
  });

  it('the last day of the week: one needed trains today; none needed rests', () => {
    const p = planWeek(input({ entries: log, today: SUN, weeklyGoal: 1 }));
    expect(p.days.map((d) => [d.label, d.train])).toEqual([['today', true]]);
    expect(p.patterns).toBe(2);
    const done = [...log, ...session(MON, 'Bench Press', 3, 10, false)];
    expect(planWeek(input({ entries: done, today: SUN, weeklyGoal: 1 })).days[0]).toMatchObject({ train: false, rest: { kind: 'goal-met' } });
  });

  it('no candidates (no program, no quick day): the goal’s days still plan, with no session; the quick day with no program', () => {
    const p = planWeek(input({ entries: log, today: MON, weeklyGoal: 2, program: null }));
    expect(p.days.filter((d) => d.train).length).toBe(2);
    expect(p.days.every((d) => d.session == null && d.ready == null)).toBe(true);
    const q = planWeek(input({ entries: log, today: MON, weeklyGoal: 2, program: null, quick: [slot('DB Curl', 2), slot('Cable Pushdown', 2)] }));
    expect(q.days.filter((d) => d.train).map((d) => d.session!.kind)).toEqual(['quick', 'quick']);
    // A program: the quick day is never planned.
    expect(planWeek(input({ entries: log, today: MON, quick: [slot('DB Curl', 2)] })).days.every((d) => !d.train || d.session!.kind === 'program')).toBe(true);
  });

  it('a light week: its sessions light at half the sets, the goal kept; without it, full (pair)', () => {
    const light = planWeek(input({ entries: log, today: MON, weeklyGoal: 2, tapped: { from: MON } }));
    const full = planWeek(input({ entries: log, today: MON, weeklyGoal: 2 }));
    expect(light.days.filter((d) => d.train).length).toBe(2);
    expect(light.days.filter((d) => d.train).every((d) => d.light)).toBe(true);
    expect(full.days.some((d) => d.light)).toBe(false);
    expect(light.evidence.find((e) => e.rule.startsWith('A deload'))!.acts).toBe(true);
    const chest = (p: WeekPlan) => p.volume.find((v) => v.muscle === 'Chest')!;
    expect(chest(light).planned).toBeCloseTo(chest(full).planned / 2, 9);
    expect(readinessPlanned(input({ entries: log, today: MON, weeklyGoal: 2, tapped: { from: MON } })).verdict.kind).toBe('light');
    // The cut is shown, not planned around: a light week ending Wednesday leaves the days where they were, its days light.
    const part = planWeek(input({ entries: log, today: MON, weeklyGoal: 2, tapped: { from: addD(MON, -4) } }));
    expect(trainDays(part)).toEqual(trainDays(full));
    expect(part.days.map((d) => d.light)).toEqual(part.days.map((d) => d.train && d.date <= addD(MON, 2)));
    expect(part.days.some((d) => d.light) && part.days.some((d) => d.train && !d.light)).toBe(true);
  });

  it('the cycle: days not yet done come first (a day done comes round only once the rest are); trained today fixes today', () => {
    const P = program([['A', [slot('Bench Press')]], ['B', [slot('Lat Pulldown')]], ['C', [slot('Leg Press')]], ['D', [slot('DB Curl')]]]);
    const plans = [plan('2026-02-21', 0), plan('2026-02-28', 1)]; // A and B on the last two Saturdays
    const names = (p: WeekPlan) => p.days.filter((d) => d.train).map((d) => d.session!.name).sort();
    expect(names(planWeek(input({ entries: log, today: MON, weeklyGoal: 2, program: P, plans })))).toEqual(['C', 'D']);
    expect(names(planWeek(input({ entries: log, today: MON, weeklyGoal: 1, program: P, plans })))).toHaveLength(1);
    expect(['C', 'D']).toContain(names(planWeek(input({ entries: log, today: MON, weeklyGoal: 1, program: P, plans })))[0]);
    // Trained today on D (opened plan): today is D; the week then needs C, then a new cycle.
    const today = [...log, ...session(MON, 'DB Curl', 3, 10, false)];
    const p = planWeek(input({ entries: today, today: MON, weeklyGoal: 3, program: P, plans: [...plans, plan(MON, 3)] }));
    expect(p.days[0]).toMatchObject({ train: true, fixed: 'trained', session: { name: 'D' } });
    const rest = p.days.slice(1).filter((d) => d.train).map((d) => d.session!.name);
    expect(rest[0]).toBe('C');
    expect(rest).toHaveLength(2);
  });

  it('P4 counts 0 in the choice and the table; at priority 1 the same sets decide (pair)', () => {
    const P = program([['A', [slot('Bench Press', 4)]], ['B', [slot('Bench Press', 4), slot('Seated Calf Raise', 4)]]]);
    const prof = (t: Tier): Profile => { const p = defaultProfile(); p.tiers.Chest = 1; p.tiers.Calves = t; return p; };
    const at = (t: Tier) => planWeek(input({ entries: log, today: MON, weeklyGoal: 1, program: P, profile: prof(t) }));
    const p4 = at(4);
    expect(p4.volume.find((v) => v.muscle === 'Calves')).toMatchObject({ tier: 4, band: [0, 0], aim: [0, 0], gap: 0 });
    expect(p4.evidence.find((e) => e.rule.startsWith('Which sessions'))!.acts).toBe(false); // a tie: A or B alike
    const p1 = at(1);
    expect(p1.evidence.find((e) => e.rule.startsWith('Which sessions'))!.acts).toBe(true);
    expect(p1.days.find((d) => d.train)!.session!.name).toBe('B');
  });

  it('a session counts each muscle up to SESSION_CAP sets (table)', () => {
    const T: [Slot[], number][] = [[[slot('Bench Press', 10)], 10], [[slot('Bench Press', 11)], 11], [[slot('Bench Press', 14)], 11], [[slot('Bench Press', 8), slot('Bench Press', 8)], 11]];
    for (const [slots, chest] of T) expect(slotVolume(slots).Chest).toBe(chest);
  });

  it('pain is read as of today on every day: a later day’s Ready is today’s pain, not its fade (pair)', () => {
    const hurt = log.map((e) => (e.exercise === 'Lat Pulldown' && e.date >= addD(MON, -28) ? { ...e, flags: [...e.flags, 'pain' as const] } : e));
    const LU = program([UL.days[1], UL.days[0]].map((d) => [d.name, d.slots] as [string, Slot[]])); // legs first: upper later
    const p = planWeek(input({ entries: hurt, today: MON, weeklyGoal: 2, program: LU }));
    const m = readinessModel(hurt, [], MON, 'UTC');
    const later = p.days.filter((d) => d.train && d.date > MON);
    expect(later.map((d) => d.session!.name)).toEqual(['Upper']);
    for (const d of later) expect(d.ready!.ready).toBe(m.sessionReady(d.session!.slots, d.date, { painAt: MON }).ready);
    // Pair: read by its own date, the risk has faded (else this proves nothing).
    expect(later.some((d) => m.sessionReady(d.session!.slots, d.date).ready! > d.ready!.ready!)).toBe(true);
  });

  it('volume follows the aim: a program built at the aims, one cycle a week, plans every set it holds; the gap to each band shown', () => {
    const prof = defaultProfile();
    for (const m of ['Chest', 'Lats', 'Quads'] as Muscle[]) prof.tiers[m] = 1;
    for (const m of ['Biceps', 'Triceps', 'Side Delts'] as Muscle[]) prof.tiers[m] = 2;
    const hist = routine(MON, 3, 6); // Wednesdays: some volume to step from
    const adv = volumeAdvice(hist, [], prof, MON);
    const aims = planAims(adv, prof);
    const P = buildProgram(prof, hist, { days: 3, perSession: 12, aims: Object.fromEntries(MUSCLES.map((m) => [m, aims[m].plan])) }, new Date(`${MON}T12:00:00Z`));
    const p = planWeek(input({ entries: hist, today: MON, weeklyGoal: 3, program: P, profile: prof }));
    expect(p.days.filter((d) => d.train).length).toBe(3);
    const pv = programVolume(P);
    let stepped = 0;
    for (const v of p.volume) {
      const own = P.days.reduce((a, d) => a + (slotVolume(d.slots)[v.muscle] ?? 0), 0);
      expect(v.planned, v.muscle).toBeCloseTo(own, 9); // every set the program holds, a session counted up to 11
      expect(v.aim).toEqual(aims[v.muscle].plan);
      expect(v.gap).toBeCloseTo(Math.max(0, v.band[0] - v.planned), 9);
      if (aims[v.muscle].from === 'step' && pv[v.muscle] >= v.aim[0]) { stepped++; expect(v.planned).toBeGreaterThanOrEqual(v.aim[0] - 1e-9); }
    }
    expect(stepped).toBeGreaterThanOrEqual(2); // stepped muscles, +20 % from his own weeks, held to it
    expect(p.volume.some((v) => v.gap > 0)).toBe(true); // the aim is a step, not the band at once
  });

  it('evidence: every rule labelled (a) with a citation, (b) with a method, or (c) taking no action', () => {
    for (const p of [planWeek(input({ entries: log, today: MON })), planWeek(input({ entries: [], today: WED, weeklyGoal: 5 })), planWeek(input({ entries: log, today: MON, tapped: { from: MON } }))]) {
      expect(p.evidence.length).toBeGreaterThanOrEqual(8);
      for (const e of p.evidence) {
        if (e.kind === 'research') expect(e.cite, e.rule).toBeTruthy();
        if (e.kind === 'learned') expect(e.method, e.rule).toBeTruthy();
        if (e.kind === 'default') expect(e.acts, e.rule).toBe(false);
      }
    }
  });
});

describe('learn/schedule: Ready moves the days', () => {
  // A synthetic lifter (true τ′ 32 h, φ 8); the last cycle's Upper done, then legs to failure on Sunday; Monday's plan for the
  // week's one session: Legs.
  const setup = (seed: number) => {
    const { entries: base } = simulateRecovery(seed, { sessions: 60, failFrac: 0.3 });
    const lastBase = base.at(-1)!.date, today = nextMonday(addD(lastBase, 1)), sun = addD(today, -1);
    const legs = [...session(sun, 'Leg Press', 5, 12, true), ...session(sun, 'Leg Extension', 4, 12, true)];
    return { entries: [...base, ...legs], today, plans: [plan(lastBase, 0)] };
  };
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  it('the legs trained to failure yesterday go later in the week; today rests “recovering”, naming the legs', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const { entries, today, plans } = setup(seed);
      const p = planWeek(input({ entries, today, plans, weeklyGoal: 1 }));
      const at = p.days.findIndex((d) => d.train);
      expect(p.days[at].session!.name).toBe('Legs');
      expect(at).toBeGreaterThanOrEqual(1);
      expect(p.days[0].rest).toMatchObject({ kind: 'recovering' });
      expect(p.days[0].rest!.muscles!.length).toBeGreaterThan(0);
      expect(p.days[0].rest!.muscles).toContain('Quads');
      expect(p.days[0].rest!.label).toMatch(/^Recovering: .*Quads.* fresh by (tomorrow|Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
      expect(p.days[at].ready!.ready!).toBeGreaterThan(readiness({ ...input({ entries, today, plans }), program: program([['Legs', UL.days[1].slots]]) }).ready! + 20);
    }
  });

  it('negative control: with the sessions shuffled in time, today rarely rests for recovery (vs every seed in order)', () => {
    let real = 0, shuffled = 0;
    for (const seed of SEEDS) {
      const { entries, today, plans } = setup(seed);
      const a = planWeek(input({ entries, today, plans, weeklyGoal: 1 }));
      if (a.days[0].rest?.kind === 'recovering') real++;
      const b = planWeek(input({ entries: shuffleSessions(entries, 100 + seed), today, plans, weeklyGoal: 1 }));
      if (b.days[0].rest?.kind === 'recovering') shuffled++;
    }
    expect(real).toBe(SEEDS.length);
    expect(shuffled).toBeLessThanOrEqual(SEEDS.length / 3);
  }, 60000);

  it('recovery never reduces the week’s volume: the same sessions and sets as with Ready held flat', () => {
    const P = program([...UL.days.map((d) => [d.name, d.slots] as [string, Slot[]]), ['Full', [slot('Bench Press', 2), slot('Leg Press', 2), slot('Lat Pulldown', 2)]]]);
    let moved = 0;
    for (const seed of SEEDS.slice(0, 4)) {
      const { entries, today } = setup(seed);
      const real = readinessModel(entries, [], today, 'UTC');
      const flat = { recovery: null, sessionReady: (slots: readonly Slot[], date: string) => ({ ...real.sessionReady(slots, date), ready: 100 }) };
      for (const goal of [1, 2, 3, 5]) {
        const i = input({ entries, today, weeklyGoal: goal, program: P });
        const a = planWeek(i), b = planWeek(i, flat);
        expect(a.score.volume).toBeCloseTo(b.score.volume, 9);
        const names = (p: WeekPlan) => p.days.filter((d) => d.train).map((d) => d.session!.name).sort();
        expect(names(a)).toEqual(names(b));
        a.volume.forEach((v, k) => expect(v.planned).toBeCloseTo(b.volume[k].planned, 9));
        const plan = (p: WeekPlan) => p.days.map((d) => d.session?.name ?? '-').join(' ');
        if (plan(a) !== plan(b)) moved++;
      }
    }
    expect(moved).toBeGreaterThan(3); // ...while Ready does move the sessions between days (else this proves little)
  });
});

describe('learn/schedule: by the day, never a clock time (owner Q2)', () => {
  it('the detector catches a planted time (so the check below can fail)', () => {
    expect(clockTimes({ days: [{ rest: { label: 'Recovering: Quads fresh by 17:40' } }] })).toEqual(['Recovering: Quads fresh by 17:40']);
    expect(clockTimes(['Goal met by Thu', '2026-03-02', 'Rest at 6pm'])).toEqual(['Rest at 6pm']);
  });

  it('no string in any plan holds a clock time: every reason and verdict, over a synthetic year of days', () => {
    const { entries, body } = simulateRecovery(3, { sessions: 120, failFrac: 0.3, energy: { slope: 0.02 } });
    const P = program([['A', [slot('Bench Press', 4), slot('Leg Press', 4)]], ['B', [slot('Lat Pulldown', 4), slot('DB Curl', 3)]], ['C', [slot('Leg Press', 3), slot('DB Lateral Raise', 3)]]]);
    const dates = [...new Set(entries.map((e) => e.date))];
    const outs: unknown[] = [];
    const kinds = new Set<string>();
    for (let i = 10; i < dates.length; i += 5) for (const goal of [1, 2, 4, 7]) {
      // The day after a session (the log up to it): a day he may or may not train.
      const today = addD(dates[i], 1), log = entries.filter((e) => e.date < today);
      const r = readinessPlanned({ entries: log, body, weeklyGoal: goal, program: P, plans: [plan(dates[i - 1], i % 3)], quick: null, today, tz: 'UTC', profile: defaultProfile() });
      outs.push(r);
      for (const d of r.plan!.days) if (d.rest) kinds.add(d.rest.kind);
      kinds.add(r.verdict.kind);
    }
    for (const k of ['goal-met', 'recovering', 'usual', 'go', 'rest', 'tight']) expect(kinds.has(k), k).toBe(true);
    expect(strings(outs).length).toBeGreaterThan(5000);
    expect(clockTimes(outs)).toEqual([]);
  }, 60000);
});
