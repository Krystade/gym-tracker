import { describe, expect, it } from 'vitest';
import { addDays } from './analytics';
import { defaultProfile, type Profile } from './profile';
import type { DayPlan, Program } from './program';
import type { Flag, SetEntry } from './types';
import { achievements, achievementsOf, amount, closest, DEFS, familySteps, gained, platesAt, STRENGTH, unlockedOn, unlockKey, unlockText, type Context } from './achievements';
import { synthLog } from './achievements.sample';

// Synthetic sets only.
let seq = 0;
const set = (date: string, exercise: string, weight: number, reps: number | null, flags: Flag[] = [], extra: Partial<SetEntry> = {}): SetEntry =>
  ({ id: `t|${date}|${exercise}|${++seq}`, date, seq, exercise, setNo: seq, weight, reps, flags, source: 'app', ...extra });
const MON = '2026-01-05';
const day = (n: number) => addDays(MON, n);
/** The whole log counts unless a test says when counting started. */
const WHOLE = '2000-01-01';
const ctx = (over: Partial<Context> = {}): Context => ({ profile: { ...defaultProfile(), weeklyGoal: 2 }, today: '2026-12-31', since: WHOLE, ...over });
const steps = (entries: SetEntry[], c = ctx()) => familySteps(entries, c);
const reached = (entries: SetEntry[], id: string, c = ctx()) => achievements(entries, c).unlocks.filter((u) => u.id === id);

describe('showing up', () => {
  it('a session is a day with a working lift set: not warm-ups alone, not cardio alone; pain still counts', () => {
    const log = [set(day(0), 'Bench Press', 135, 8, ['warmup']), set(day(1), 'Treadmill', 0, null, ['cardio'], { cardio: { seconds: 900 } }),
      set(day(2), 'Bench Press', 135, 8, ['pain'])];
    expect(steps(log).sessions.map((s) => s.date)).toEqual([day(2)]);
  });
  it('the 10th session is bronze, dated that day', () => {
    const log = Array.from({ length: 12 }, (_, i) => set(day(i * 2), 'Cable Curl', 30, 10));
    expect(reached(log, 'sessions').map((x) => [x.tier, x.date])).toEqual([['starter', day(0)], ['bronze', day(18)]]);
  });
  it('goal weeks add up across gaps, dated by the goal-th session; a missed week takes nothing away', () => {
    const log = [0, 1, 3, 6].flatMap((w) => [set(day(w * 7), 'Cable Curl', 30, 10), set(day(w * 7 + 2), 'Cable Curl', 30, 10)]);
    expect(reached(log, 'goal-weeks').map((x) => [x.tier, x.date])).toEqual([['starter', day(2)], ['bronze', day(44)]]);
    expect(steps(log)['best-run'].at(-1)!.value).toBe(2); // best ever, kept
  });
  it('one session in a week does not meet a goal of 2', () => {
    expect(steps([set(day(0), 'Cable Curl', 30, 10)])['goal-weeks']).toEqual([]);
  });
  it('best run: 4 goal weeks in a row is bronze; breaking the run later never lowers it', () => {
    const log = [0, 1, 2, 3, 5].flatMap((w) => [set(day(w * 7), 'Cable Curl', 30, 10), set(day(w * 7 + 1), 'Cable Curl', 30, 10)]);
    const a = achievements(log, ctx());
    expect(a.unlocks.find((u) => u.id === 'best-run')!.date).toBe(day(22));
    expect(a.tracks.find((t) => t.id === 'best-run')!.value).toBe(4);
  });
  it('back at it: 14 full days away, not 13', () => {
    expect(steps([set(day(0), 'Cable Curl', 30, 10), set(day(15), 'Cable Curl', 30, 10)]).comeback).toHaveLength(1);
    expect(steps([set(day(0), 'Cable Curl', 30, 10), set(day(14), 'Cable Curl', 30, 10)]).comeback).toHaveLength(0);
  });
  it('plan done: every non-skipped slot gets its sets; swaps are followed; one short is not done', () => {
    const plan = (date: string, extra: Partial<DayPlan> = {}): DayPlan => ({ key: `day:${date}`, date, day: 0, skips: [], swaps: {},
      slots: [{ exercise: 'Bench Press', sets: 2, repMin: 8, repMax: 12 }, { exercise: 'Cable Curl', sets: 1, repMin: 10, repMax: 15 }], ...extra });
    const log = [set(day(0), 'Bench Press', 135, 8), set(day(0), 'Bench Press', 135, 8), set(day(0), 'Cable Curl', 30, 10),
      set(day(2), 'Bench Press', 135, 8), set(day(2), 'Cable Curl', 30, 10),
      set(day(4), 'Machine Chest Press', 100, 10), set(day(4), 'Machine Chest Press', 100, 10),
      set(day(6), 'Bench Press', 135, 8), set(day(6), 'Bench Press', 135, 8)];
    const plans = [plan(day(0)), plan(day(2)), plan(day(4), { swaps: { 'Bench Press': 'Machine Chest Press' }, skips: ['Cable Curl'] }), plan(day(6), { skips: ['Cable Curl'] })];
    expect(steps(log, ctx({ plans }))['plan-days'].map((s) => s.date)).toEqual([day(0), day(4), day(6)]);
  });
  it('rested well: a light week, then a session the week after', () => {
    const log = [set(day(0), 'Bench Press', 115, 8, ['light']), set(day(8), 'Bench Press', 135, 8)];
    expect(steps(log)['light-week'].map((s) => s.date)).toEqual([day(8)]);
    expect(steps([set(day(0), 'Bench Press', 115, 8, ['light']), set(day(15), 'Bench Press', 135, 8)])['light-week']).toEqual([]);
    // Two light weeks in a row are one rest: it counts when training is back, not when the second light week starts.
    const two = [set(day(0), 'Bench Press', 115, 8, ['light']), set(day(7), 'Bench Press', 115, 8, ['light']), set(day(14), 'Bench Press', 135, 8)];
    expect(steps(two)['light-week'].map((s) => s.date)).toEqual([day(14)]);
  });
  it('plan done and cardio stay off the sheet until the log can earn them', () => {
    const log = [set(day(0), 'Bench Press', 135, 8)];
    expect(achievements(log, ctx()).hidden).toEqual(['plan-days', 'cardio']);
    const program = { key: 'program', days: [], perSession: 12, createdAt: '' } as Program;
    expect(achievements([...log, set(day(1), 'Treadmill', 0, null, ['cardio'], { cardio: { seconds: 60 } })], ctx({ program })).hidden).toEqual([]);
  });
});

describe('getting stronger', () => {
  it('PRs: a lift’s first day never; a PR on a pain-flagged or light set never counts', () => {
    const log = [set(day(0), 'Cable Curl', 30, 10), set(day(2), 'Cable Curl', 35, 10), set(day(4), 'Cable Curl', 40, 10, ['pain']), set(day(6), 'Cable Curl', 45, 10, ['light'])];
    expect(steps(log).prs.map((s) => s.date)).toEqual([day(2)]);
  });
  it('three lifts up: the third-best lift’s gain on its own first two weeks, after 6 sessions', () => {
    const lift = (name: string, w0: number, pct: number) => Array.from({ length: 6 }, (_, i) => set(day(i * 7), name, i < 2 ? w0 : Math.round(w0 * (1 + pct / 100)), 10));
    const two = [...lift('Cable Curl', 50, 30), ...lift('Cable Pushdown', 50, 30)];
    expect(steps(two).stronger).toEqual([]); // two lifts are not three
    const three = [...two, ...lift('Leg Press', 200, 12)];
    expect(steps(three).stronger.at(-1)!.value).toBe(12);
    expect(reached(three, 'stronger').map((u) => u.tier)).toEqual(['bronze']);
  });
  it('a bodyweight lift has no e1RM and never counts toward three lifts up', () => {
    const pull = Array.from({ length: 8 }, (_, i) => set(day(i * 4), 'Pull-up', 0, 3 + i, ['bodyweight']));
    expect(steps(pull).stronger).toEqual([]);
  });
  it('moved up: the working weight (median) beats the last 12 weeks; back to an old weight is not a step', () => {
    const at = (d: number, w: number) => [set(day(d), 'Bench Press', w, 8), set(day(d), 'Bench Press', w, 8), set(day(d), 'Bench Press', w - 20, 12)];
    expect(steps([...at(0, 100), ...at(3, 105), ...at(6, 95), ...at(9, 105)])['moved-up'].map((s) => s.date)).toEqual([day(3)]);
    expect(steps([...at(0, 100), ...at(100, 100)])['moved-up']).toEqual([]); // nothing in the 12 weeks before to beat
  });
  it('moved up never counts a pain-flagged session', () => {
    const at = (d: number, w: number, f: Flag[] = []) => [set(day(d), 'Bench Press', w, 8, f), set(day(d), 'Bench Press', w, 8, f)];
    expect(steps([...at(0, 100), ...at(3, 110, ['pain'])])['moved-up']).toEqual([]);
    expect(steps([...at(0, 100), ...at(3, 110)])['moved-up']).toHaveLength(1);
  });
});

describe('building muscle', () => {
  const p1Biceps = (): Profile => ({ ...defaultProfile(), weeklyGoal: 2, tiers: { ...defaultProfile().tiers, Biceps: 1 } });
  /** 100-set sessions: a budget that fits every default range whole (Biceps at P1: 12–20). */
  const roomy = { key: 'program', days: [], perSession: 100, createdAt: '' } as Program;
  it('on target: the day the week’s top-priority muscles all reach the low end; one set short is not', () => {
    const curls = (n: number) => Array.from({ length: n }, (_, i) => set(day(i < 6 ? 0 : 2), 'Cable Curl', 30, 10));
    expect(steps(curls(12), ctx({ profile: p1Biceps(), program: roomy }))['on-target'].map((s) => s.date)).toEqual([day(2)]);
    expect(steps(curls(11), ctx({ profile: p1Biceps(), program: roomy }))['on-target']).toEqual([]);
  });
  it('every muscle: the week every muscle with a target reaches its low, not just the top priority', () => {
    // Biceps at P1 (12–20), Triceps at P3 (4–6), the rest left out (P4).
    const tiers = Object.fromEntries(Object.keys(defaultProfile().tiers).map((m) => [m, 4])) as Profile['tiers'];
    const profile = { ...defaultProfile(), weeklyGoal: 2, tiers: { ...tiers, Biceps: 1 as const, Triceps: 3 as const } };
    const curls = Array.from({ length: 12 }, (_, i) => set(day(i < 6 ? 0 : 2), 'Cable Curl', 30, 10));
    const c = ctx({ profile, program: roomy });
    expect(steps(curls, c)['on-target'].map((s) => s.date)).toEqual([day(2)]);
    expect(steps(curls, c)['every-muscle']).toEqual([]);
    const push = Array.from({ length: 4 }, () => set(day(4), 'Cable Pushdown', 40, 10));
    expect(steps([...curls, ...push], c)['every-muscle'].map((s) => s.date)).toEqual([day(4)]);
  });
  it('sets that counted stop at the top of the range: 25 curl sets in a week count 20 for a 12–20 muscle', () => {
    const log = Array.from({ length: 25 }, (_, i) => set(day(Math.floor(i / 5)), 'Cable Curl', 30, 10));
    expect(steps(log, ctx({ profile: p1Biceps(), program: roomy }))['useful-sets'].at(-1)!.value).toBe(20);
  });
  it('the ranges are the ones fitted to the week, as Stats shows them: 5-set sessions shrink Biceps’ range', () => {
    const log = Array.from({ length: 25 }, (_, i) => set(day(Math.floor(i / 5)), 'Cable Curl', 30, 10));
    const n = steps(log, ctx({ profile: p1Biceps() }))['useful-sets'].at(-1)!.value;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(20);
  });
  it('each week is judged by the targets Stats showed that day: training more later never takes a week back', () => {
    // Four short sessions (2 sets): the fit is small, so a light week reaches its low. Then weeks of 20-set sessions refit
    // today's targets to the full defaults, where that early week would fall short. It keeps its week.
    const light = [0, 2, 7, 9].flatMap((d) => [set(day(d), 'Cable Curl', 30, 10), set(day(d), 'Cable Curl', 30, 10)]);
    const week3 = [14, 16].flatMap((d) => Array.from({ length: 3 }, () => set(day(d), 'Cable Curl', 30, 10)));
    const heavy = [21, 23, 28, 30, 35, 37, 42, 44].flatMap((d) => Array.from({ length: 20 }, (_, i) => set(day(d), i % 2 ? 'Cable Curl' : 'Bench Press', 100, 10)));
    const c = ctx({ profile: p1Biceps(), today: day(45) });
    const early = steps([...light, ...week3], { ...c, today: day(20) })['on-target'].map((s) => s.date);
    expect(early).toContain(day(14));
    expect(steps([...light, ...week3, ...heavy], c)['on-target'].map((s) => s.date)).toEqual(expect.arrayContaining(early));
  });
});

describe('milestones', () => {
  it('plates: from the first set that counts, the next plate dated; pain never counts', () => {
    const log = [set(day(0), 'Bench Press', 135, 5), set(day(3), 'Bench Press', 185, 5), set(day(6), 'Bench Press', 225, 2, ['pain']), set(day(9), 'Bench Press', 225, 1)];
    expect(steps(log).plates).toEqual([{ date: day(0), value: 1, lift: 'Bench Press' }, { date: day(9), value: 2, lift: 'Bench Press' }]);
  });
  it('plates a side on a 45 lb bar', () => {
    expect([134, 135, 224, 225, 315, 404, 405, 495].map(platesAt)).toEqual([0, 1, 1, 2, 3, 3, 4, 5]);
  });
  it('plates only on barbell compounds', () => {
    expect(steps([set(day(0), 'Leg Press', 100, 5), set(day(3), 'Leg Press', 450, 5)]).plates).toEqual([]);
  });
  it('bodyweight: new rep bests at bodyweight; assisted sets and added weight are not bodyweight; the two dips are one', () => {
    const log = [set(day(0), 'Bench Press', 135, 5), set(day(30), 'Pull-up', -30, 8), set(day(31), 'Pull-up', 0, 1, ['bodyweight']),
      set(day(33), 'Pull-up', 0, 5, ['bodyweight']), set(day(35), 'Pull-up', 25, 6), set(day(40), 'Upright Dips', 0, 6, ['bodyweight']), set(day(42), 'Forward-Lean Dips', 0, 10, ['bodyweight'])];
    const s = steps(log).bodyweight;
    expect(s.filter((x) => x.lift === 'Pull-up').map((x) => [x.date, x.value])).toEqual([[day(31), 1], [day(33), 5]]);
    expect(s.filter((x) => x.lift === 'Dips').map((x) => x.value)).toEqual([6, 10]);
  });
  it('one track per lift for plates and bodyweight, best first', () => {
    const log = [set(day(0), 'Bench Press', 135, 5), set(day(1), 'Barbell Squat', 225, 5), set(day(2), 'Pull-up', 0, 6, ['bodyweight'])];
    const t = achievements(log, ctx()).tracks;
    expect(t.filter((x) => x.id === 'plates').map((x) => [x.lift, x.value, x.next])).toEqual([['Barbell Squat', 2, 3], ['Bench Press', 1, 2]]);
    expect(t.filter((x) => x.id === 'bodyweight').map((x) => [x.lift, x.level])).toEqual([['Pull-up', 1]]);
  });
});

describe('exploring', () => {
  it('lifts tried: one lift by any of its names', () => {
    expect(steps([set(day(0), 'Bench Press', 135, 5), set(day(1), 'Barbell Bench Press', 135, 5), set(day(2), 'Cable Curl', 30, 10)])['new-lifts'].at(-1)!.value).toBe(2);
  });
  it('all six patterns: dated by the last one in that week', () => {
    const log = ['Bench Press', 'Barbell Row', 'Overhead Press', 'Lat Pulldown', 'Barbell Squat'].map((n, i) => set(day(i % 3), n, 100, 8));
    expect(steps(log).patterns).toEqual([]);
    expect(steps([...log, set(day(4), 'Deadlift', 135, 5)]).patterns.map((s) => s.date)).toEqual([day(4)]);
  });
  it('cardio minutes add up', () => {
    const log = [0, 1].map((i) => set(day(i), 'Treadmill', 0, null, ['cardio'], { cardio: { seconds: 1830 } }));
    expect(reached(log, 'cardio').map((u) => [u.tier, u.date])).toEqual([['bronze', day(1)]]);
  });
});

// Owner, 2026-10-21 (plan Q1: no): everyone starts from 0. Only sets logged on or after `since` count.
describe('counting starts at `since`', () => {
  const log = synthLog();
  const today = '2026-10-20', since = '2025-11-03';
  const before = log.filter((e) => e.date < since), after = log.filter((e) => e.date >= since);
  /** Families that measure against your past by definition (the bar), or fit targets from the 8 weeks before a day. */
  const PAST = ['prs', 'moved-up', 'comeback', 'on-target', 'every-muscle', 'useful-sets'];

  it('nothing logged before the start ever unlocks: a log all before it earns nothing, every track at 0', () => {
    expect(before.length).toBeGreaterThan(1000);
    const a = achievements(before, ctx({ today, since }));
    expect(a.unlocks).toEqual([]);
    expect(a.tracks.length).toBeGreaterThanOrEqual(DEFS.length);
    for (const t of a.tracks) expect(t.value).toBe(0);
    for (const n of Object.values(a.counts)) expect(n).toBe(0);
    // The same log with counting from its first day earns plenty: the zero above is the start rule, not an empty log.
    expect(achievements(before, ctx({ today, since: WHOLE })).unlocks.length).toBeGreaterThan(20);
  });
  it('every unlock is dated on or after the start', () => {
    const us = achievements(log, ctx({ today, since })).unlocks;
    expect(us.length).toBeGreaterThan(20);
    for (const u of us) expect(u.date >= since, `${unlockKey(u)} on ${u.date}`).toBe(true);
  });
  it('families not measured against the past are exactly what the sets since the start earn', () => {
    const full = familySteps(log, ctx({ today, since })), fresh = familySteps(after, ctx({ today, since: WHOLE }));
    for (const d of DEFS) if (!PAST.includes(d.id)) expect(full[d.id], d.id).toEqual(fresh[d.id]);
  });
  it('sets before the start can move a bar, never count: changing or removing them never adds to a family that has no bar', () => {
    const heavier = before.map((e) => ({ ...e, weight: e.weight * 2, reps: e.reps == null ? null : e.reps + 3 }));
    const base = familySteps(log, ctx({ today, since }));
    for (const variant of [after, [...heavier, ...after]]) {
      const v = familySteps(variant, ctx({ today, since }));
      for (const d of DEFS) if (!PAST.includes(d.id)) expect(v[d.id], d.id).toEqual(base[d.id]);
      for (const u of achievements(variant, ctx({ today, since })).unlocks) expect(u.date >= since).toBe(true);
    }
  });
  it('the start day’s own sets count', () => {
    const one = [set(day(0), 'Cable Curl', 30, 10), set(day(3), 'Cable Curl', 30, 10)];
    expect(reached(one, 'sessions', ctx({ since: day(3) })).map((u) => u.date)).toEqual([day(3)]);
    expect(reached(one, 'sessions', ctx({ since: day(4) }))).toEqual([]);
  });
  it('a PR counts after the start, judged against everything before it', () => {
    const l = [set(day(0), 'Cable Curl', 30, 10), set(day(2), 'Cable Curl', 40, 10), set(day(4), 'Cable Curl', 35, 10), set(day(6), 'Cable Curl', 45, 10)];
    expect(steps(l, ctx({ since: day(3) })).prs.map((s) => s.date)).toEqual([day(6)]); // day 4's 35 is no PR: day 2 had 40
  });
  it('back at it: the days away before the start count; the session before the start does not', () => {
    const l = [set(day(0), 'Cable Curl', 30, 10), set(day(20), 'Cable Curl', 30, 10)];
    expect(steps(l, ctx({ since: day(10) })).comeback.map((s) => s.date)).toEqual([day(20)]);
    expect(steps(l, ctx({ since: day(21) })).comeback).toEqual([]);
  });
  it('moved up: the first session after the start beats the 12 weeks before it; one before the start is no step', () => {
    const at = (d: number, w: number) => [set(day(d), 'Bench Press', w, 8), set(day(d), 'Bench Press', w, 8)];
    const l = [...at(0, 100), ...at(3, 105), ...at(6, 110)];
    expect(steps(l, ctx({ since: day(5) }))['moved-up'].map((s) => s.date)).toEqual([day(6)]);
  });
  it('plates and bodyweight count a set after the start at its load, whatever came before', () => {
    const l = [set(day(0), 'Bench Press', 225, 5), set(day(10), 'Bench Press', 225, 3), set(day(11), 'Pull-up', 0, 6, ['bodyweight'])];
    const a = achievements(l, ctx({ since: day(5) }));
    expect(a.unlocks.filter((u) => u.id === 'plates').map((u) => [u.tier, u.date])).toEqual([['bronze', day(10)], ['silver', day(10)]]);
    expect(a.unlocks.filter((u) => u.id === 'bodyweight').map((u) => [u.tier, u.date])).toEqual([['bronze', day(11)], ['silver', day(11)]]);
  });
  it('a goal week needs its goal in sessions from the start on', () => {
    const l = [set(day(0), 'Cable Curl', 30, 10), set(day(2), 'Cable Curl', 30, 10), set(day(7), 'Cable Curl', 30, 10), set(day(9), 'Cable Curl', 30, 10)];
    expect(steps(l, ctx({ since: day(1) }))['goal-weeks'].map((s) => s.date)).toEqual([day(9)]);
  });
});

describe('rules that hold for any log (synthetic, 2 years)', () => {
  const log = synthLog();
  const full = achievements(log, ctx({ today: '2026-10-20' }));
  const keys = (a: typeof full) => a.unlocks.map((u) => `${unlockKey(u)}@${u.date}`);
  it('nothing goes down with time: an earlier day’s unlocks are all still there, dates unchanged', () => {
    for (const t of ['2025-01-01', '2025-06-30', '2026-01-15']) {
      const early = achievements(log, ctx({ today: t }));
      expect(early.unlocks.length).toBeGreaterThan(5);
      expect(keys(full)).toEqual(expect.arrayContaining(keys(early)));
      const best = (a: typeof full, id: string, lift?: string) => Math.max(0, ...a.tracks.filter((x) => x.id === id && (!lift || x.lift === lift)).map((x) => x.value));
      for (const tr of early.tracks) expect(best(full, tr.id, tr.lift)).toBeGreaterThanOrEqual(tr.value);
    }
  });
  it('resting costs nothing: today moving on with nothing logged changes nothing', () => {
    expect(keys(achievements(log, ctx({ today: '2027-06-01' })))).toEqual(keys(full));
  });
  it('the order sets arrive in changes nothing', () => {
    const shuffled = [...log].sort((a, b) => (a.id.length * 31 + b.seq) % 7 - 3);
    expect(keys(achievements(shuffled, ctx({ today: '2026-10-20' })))).toEqual(keys(full));
  });
  it('flagging pain never earns more, and never costs a session or a goal week', () => {
    const flagged = log.map((e, i) => (i % 9 === 0 && !e.cardio ? { ...e, flags: [...e.flags, 'pain' as Flag] } : e));
    const a = achievements(flagged, ctx({ today: '2026-10-20' }));
    for (const id of ['sessions', 'goal-weeks', 'best-run', 'useful-sets', 'on-target']) expect(a.tracks.find((t) => t.id === id)!.value).toBe(full.tracks.find((t) => t.id === id)!.value);
    for (const tr of a.tracks) expect(tr.value).toBeLessThanOrEqual(Math.max(0, ...full.tracks.filter((x) => x.id === tr.id && (!tr.lift || x.lift === tr.lift)).map((x) => x.value)));
    // And it does cost the strength families something: the flag is read.
    expect(STRENGTH.some((id) => a.tracks.find((t) => t.id === id)!.value < full.tracks.find((t) => t.id === id)!.value)).toBe(true);
  });
  it('every family earns something on two years of training (no family is dead)', () => {
    // Priorities this full-body split can meet (about 6 sets a week each): what it trains at P3, the rest left out (P4).
    const tiers = Object.fromEntries(Object.keys(defaultProfile().tiers).map((m) => [m, 4])) as Profile['tiers'];
    Object.assign(tiers, { Chest: 3, Quads: 3, Lats: 3, Triceps: 3, Biceps: 3, Hamstrings: 3 });
    const a = achievements(log, ctx({ today: '2026-10-20', profile: { ...defaultProfile(), weeklyGoal: 3, tiers } }));
    const none = DEFS.filter((d) => d.id !== 'plan-days' && !a.unlocks.some((u) => u.id === d.id)).map((d) => d.id);
    expect(none).toEqual([]);
  });
  it('fast enough after a set: 2 years under 150 ms here', () => {
    const t = performance.now(); achievements(log, ctx({ today: '2026-10-20' })); expect(performance.now() - t).toBeLessThan(150);
  });
});

describe('reading it', () => {
  const log = synthLog();
  it('achievementsOf: the same answer for the same log and context, worked out again when either changes', () => {
    const c = ctx({ today: '2026-10-20' });
    const a = achievementsOf(log, c);
    expect(achievementsOf(log, c)).toBe(a);
    expect(achievementsOf(log, { ...c, since: '2026-01-01' })).not.toBe(a);
    expect(achievementsOf([...log], c)).not.toBe(a);
  });
  it('gained: what a set just saved unlocked, and nothing else', () => {
    const c = ctx({ today: day(30) });
    const l = Array.from({ length: 9 }, (_, i) => set(day(i * 2), 'Cable Curl', 30, 10));
    const tenth = set(day(20), 'Bench Press', 135, 5);
    const g = gained(achievements(l, c), achievements([...l, tenth], c));
    expect(g.map((u) => [u.id, u.tier])).toEqual([['plates', 'bronze'], ['sessions', 'bronze']]);
    expect(gained(achievements(l, c), achievements(l, c))).toEqual([]);
  });
  it('a day’s unlocks, highest tier first; the next levels, closest first', () => {
    const l = Array.from({ length: 10 }, (_, i) => set(day(i), 'Cable Curl', 30, 10));
    const a = achievements(l, ctx({ today: day(9) }));
    expect(unlockedOn(a, day(9)).map((u) => [u.id, u.tier])).toEqual([['sessions', 'bronze']]);
    expect(unlockedOn(a, day(0)).map((u) => [u.id, u.tier])).toEqual([['sessions', 'starter']]);
    const next = closest(a, 2);
    expect(next.length).toBe(2);
    expect(next[0].value / next[0].next!).toBeGreaterThanOrEqual(next[1].value / next[1].next!);
  });
  it('words', () => {
    expect([amount('plates', 2), amount('stronger', 25), amount('best-run', 4), amount('sessions', 1), amount('useful-sets', 2000)]).toEqual(['225 lb', '25%', '4 weeks in a row', '1 session', '2,000 sets']);
    expect(unlockText({ id: 'plates', level: 1, tier: 'silver', date: day(0), value: 2, lift: 'Bench Press' })).toBe('Bench Press: 225 lb, 2 plates a side');
    expect(unlockText({ id: 'sessions', level: 0, tier: 'starter', date: day(0), value: 1 })).toBe('Your first session');
  });
});
