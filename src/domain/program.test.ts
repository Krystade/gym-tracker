process.env.TZ = 'America/New_York'; // before any Date: CI runs in UTC, where a UTC 'today' bug can't show
import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { CATALOG, PROGRAM_LIFTS } from './catalog';
import { MUSCLES, muscleVector, type Muscle } from './muscles';
import { defaultProfile, LEGACY_TARGETS, type Profile, type Tier } from './profile';
import { PREFERENCE, addSlot, adherence, buildProgram, programBlock, rebuildLike, volumeDiffers, candidates, cardioSlot, cycleDone, DEFAULT_PICK, nextDay, planToRecord, primaryExercise, programVolume, type DayPlan, type Program } from './program';

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

  // Readiness S3: "the first day not yet done this cycle", not "the day after the last one" (they differ only out of order).
  const P4: Program = { ...PROG, days: ['A', 'B', 'C', 'D'].map((name) => ({ name, slots: [{ exercise: 'Cable Curl', sets: 3, repMin: 10, repMax: 15 }] })) };
  const run = (ds: number[], extra: SetEntry[] = []) => {
    const dates = ds.map((_, i) => `2026-09-${String(1 + 2 * i).padStart(2, '0')}`);
    return nextDay(P4, dates.map((d, i) => plan(d, ds[i])), [...dates.map((d) => s(d, 'Cable Curl')), ...extra], '2026-10-01');
  };
  it('the first day not yet done this cycle: a day skipped or done out of order comes up next', () => {
    expect(run([0, 2])).toBe(1); // A, C done: B (the day after the last would be D)
    expect(run([1])).toBe(0); // B first: A (the day after would be C)
    expect(run([0, 1, 3])).toBe(2);
    expect(run([3, 2, 1])).toBe(0);
  });
  it('a cycle closes once every day is done, or when a day comes round again before it is', () => {
    expect(run([0, 1, 2, 3])).toBe(0);
    expect(run([0, 1, 2, 3, 1])).toBe(0); // a new cycle with B done
    expect(run([0, 1, 2, 3, 0, 1])).toBe(2);
    expect(run([0, 2, 0])).toBe(1); // A again before B and D: a new cycle with A done, so B
    expect(run([1, 3, 1, 0])).toBe(2);
  });
  it('a plan with nothing logged, a warm-up only day or a quick day doesn’t count', () => {
    const plans = [plan('2026-09-01', 0), plan('2026-09-03', 1), plan('2026-09-05', 2, { quick: 20, slots: [] })];
    expect(nextDay(P4, plans, [s('2026-09-01', 'Cable Curl'), s('2026-09-03', 'Cable Curl', 10, { flags: ['warmup'] }), s('2026-09-05', 'Cable Curl')], '2026-10-01')).toBe(1);
    // Today's own plan doesn't count until tomorrow.
    expect(nextDay(P4, [...plans, plan('2026-10-01', 1)], [s('2026-09-01', 'Cable Curl'), s('2026-10-01', 'Cable Curl')], '2026-10-01')).toBe(1);
    expect(nextDay(P4, [...plans, plan('2026-10-01', 1)], [s('2026-09-01', 'Cable Curl'), s('2026-10-01', 'Cable Curl')], '2026-10-02')).toBe(2);
  });
  // Readiness S4 (decision 4): a rebuilt program starts its cycle fresh; days trained before it was built are the old program's.
  it('a program rebuilt starts the cycle fresh: days before its createdAt don’t count; days from it on do (both sides)', () => {
    const dates = ['2026-09-01', '2026-09-03', '2026-09-05'];
    const plans = dates.map((d, i) => plan(d, i)); // A, B, C done
    const logged = dates.map((d) => s(d, 'Cable Curl'));
    expect(nextDay(P4, plans, logged, '2026-09-08')).toBe(3); // the old program's cycle: D next
    // Built on the 6th (local; createdAt is stored as the UTC instant): A.
    const rebuilt: Program = { ...P4, createdAt: new Date(2026, 8, 6, 9, 0).toISOString() };
    expect(nextDay(rebuilt, plans, logged, '2026-09-08')).toBe(0);
    expect([...cycleDone(rebuilt, plans, logged, '2026-09-08')]).toEqual([]);
    // From its build day on: counted. A trained on the 6th itself, B on the 7th: C next.
    const after = [...plans, plan('2026-09-06', 0), plan('2026-09-07', 1)];
    const more = [...logged, s('2026-09-06', 'Cable Curl'), s('2026-09-07', 'Cable Curl')];
    expect(nextDay(rebuilt, after, more, '2026-09-08')).toBe(2);
    expect([...cycleDone(rebuilt, after, more, '2026-09-08')].sort()).toEqual([0, 1]);
    // Built the day after the last of them: nothing done yet.
    expect(nextDay({ ...P4, createdAt: new Date(2026, 8, 8, 9, 0).toISOString() }, after, more, '2026-09-09')).toBe(0);
  });
  it('a program built late in the evening counts that day’s session: its local day, not the UTC one', () => {
    // 23:30 local: the next day in UTC west of Greenwich (California's 18:00 already is). The day's plan, made after it, counts.
    const late: Program = { ...P4, createdAt: new Date(2026, 8, 6, 23, 30).toISOString() };
    const d = '2026-09-06';
    expect(nextDay(late, [plan(d, 0)], [s(d, 'Cable Curl')], '2026-09-07')).toBe(1);
    expect([...cycleDone(late, [plan(d, 0)], [s(d, 'Cable Curl')], '2026-09-07')]).toEqual([0]);
    // And the day before it still doesn't (pair).
    expect(nextDay(late, [plan('2026-09-05', 0)], [s('2026-09-05', 'Cable Curl')], '2026-09-07')).toBe(0);
  });
  it('planToRecord records the suggested day (Today’s, from the week’s plan) when none is stored; else nextDay', () => {
    const d = '2026-09-10';
    expect(planToRecord(P4, [], [s(d, 'Cable Curl')], d, 2)).toMatchObject({ day: 2, slots: P4.days[2].slots });
    expect(planToRecord(P4, [], [s(d, 'Cable Curl')], d)).toMatchObject({ day: 0 });
    expect(planToRecord(P4, [], [s(d, 'Cable Curl')], d, null)).toMatchObject({ day: 0 });
    expect(planToRecord(P4, [], [s(d, 'Cable Curl')], d, 9)).toMatchObject({ day: 0 }); // not a day of it
    // A plan stored already (he picked a day) wins over the suggestion.
    expect(planToRecord(P4, [plan(d, 3)], [s(d, 'Cable Curl')], d, 2)).toMatchObject({ day: 3 });
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

describe('Phase 10: gym and priority share', () => {
  // Synthetic tiers: several muscles in every tier.
  const tiers = { Biceps: 1, Triceps: 1, Abs: 1, 'Side Delts': 2, 'Rear Delts': 2, Chest: 3, 'Front Delts': 3, Lats: 3, 'Mid-Back': 3, Traps: 3, Erectors: 3 } as const;
  const prof = withTiers(tiers, 4);
  const lowSets = (p: Program, pr: Profile) => p.days.flatMap((d) => d.slots)
    .filter((sl) => Math.min(...(Object.entries(muscleVector(sl.exercise) ?? {}) as [Muscle, number][]).filter(([, f]) => f === 1).map(([m]) => pr.tiers[m])) >= 3)
    .reduce((a, sl) => a + sl.sets, 0);

  it('keeps priority 3–4 lifts within the low-priority share while priorities still need sets', () => {
    for (let days = 1; days <= 5; days++) for (let per = 8; per <= 20; per++) {
      const p = buildProgram(prof, [], { days, perSession: per }, NOW);
      const v = programVolume(p);
      const prioritiesShort = MUSCLES.some((m) => prof.tiers[m] <= 2 && v[m] < prof.targets[prof.tiers[m]][1]);
      if (prioritiesShort) expect(lowSets(p, prof), `${days}×${per}`).toBeLessThanOrEqual(0.2 * days * Math.floor(per / 2) * 2);
    }
  });
  it('honours a different share', () => {
    const p = buildProgram({ ...prof, lowShare: 0 }, [], { days: 2, perSession: 16 }, NOW);
    expect(lowSets(p, prof)).toBe(0);
  });
  it('gives at most three exercises a week to priority 3–4 muscles at 2×16', () => {
    const p = buildProgram(prof, [], { days: 2, perSession: 16 }, NOW);
    const low = new Set(p.days.flatMap((d) => d.slots).filter((sl) => lowSets({ ...p, days: [{ name: '', slots: [sl] }] }, prof) > 0).map((sl) => sl.exercise));
    expect(low.size).toBeLessThanOrEqual(3);
  });
  it('never programs an exercise the gym can’t do, and falls back to the next candidate', () => {
    const hist = Array.from({ length: 6 }, (_, i) => s(`2026-09-${10 + i}`, 'Bayesian Cable Curl'));
    const all = new Set([...CATALOG, 'Bayesian Cable Curl']);
    const available = new Set([...all].filter((n) => !/cable|machine|pec deck|pulldown|leg press|leg curl|leg extension|calf raise|glute press/i.test(n)));
    const p = buildProgram(prof, hist, { days: 2, perSession: 16 }, NOW, { available });
    const used = p.days.flatMap((d) => d.slots.map((sl) => sl.exercise));
    expect(used.length).toBeGreaterThan(0);
    for (const ex of used) expect(available.has(ex), ex).toBe(true);
    expect(used).toContain('DB Curl');
  });
  it('marks lifts the history doesn’t have as new, and names muscles nothing here trains', () => {
    const hist = Array.from({ length: 6 }, (_, i) => s(`2026-09-${10 + i}`, 'Hammer Curl'));
    const available = new Set(['Hammer Curl', 'Overhead DB Triceps Extension', 'Plank']);
    const p = buildProgram(prof, hist, { days: 2, perSession: 16 }, NOW, { available });
    expect(p.newToYou).toContain('Overhead DB Triceps Extension');
    expect(p.newToYou).not.toContain('Hammer Curl');
    expect(p.unavailable).toContain('Side Delts');
    // Only priority 1–2 muscles are worth a warning; Chest (3) and Quads (4) have no lift here either.
    expect(p.unavailable).toEqual(['Side Delts', 'Rear Delts']);
  });
  it('lists only lifts that train the muscle directly as candidates', () => {
    for (const [m, list] of Object.entries(PREFERENCE) as [Muscle, string[]][]) if (m !== 'Traps') for (const ex of list) expect(muscleVector(ex)?.[m], `${m}: ${ex}`).toBe(1);
  });
});

describe('Phase 10 review fixes', () => {
  const placed = (p: Program) => p.days.reduce((a, d) => a + d.slots.reduce((b, sl) => b + sl.sets, 0), 0);
  it('fills the week: the cap only holds low priorities back while priorities can still use the sets', () => {
    // Ranges pinned (priority 4 still 2–5 here): an excluded priority 4 leaves the week short by design (below).
    const profiles = [withTiers({ Forearms: 1 }, 3), withTiers({ Biceps: 1, Triceps: 1, Abs: 1, 'Side Delts': 2, 'Rear Delts': 2, Chest: 3, Lats: 3 }, 4), withTiers({ Biceps: 2, Triceps: 2 }, 3)]
      .map((p) => ({ ...p, targets: { ...LEGACY_TARGETS } }));
    for (const prof of profiles) for (let days = 1; days <= 6; days++) for (let per = 8; per <= 20; per++) {
      const p = buildProgram(prof, [], { days, perSession: per }, NOW);
      expect(placed(p), `${days}×${per}`).toBeGreaterThanOrEqual(days * Math.floor(per / 2) * 2 * 0.9);
    }
  });
  it('treats a gym’s own additions as known lifts it can choose', () => {
    const available = new Set(['Hammer Curl', 'DB Curl', 'Zercher Squat']);
    const p = buildProgram(withTiers({ Biceps: 1, Quads: 1 }, 4), [], { days: 2, perSession: 8 }, NOW, { available, include: ['Hammer Curl', 'Zercher Squat'] });
    const used = p.days.flatMap((d) => d.slots.map((sl) => sl.exercise));
    expect(used).toContain('Hammer Curl');
    expect(used).toContain('Zercher Squat');
    expect(p.newToYou).not.toContain('Hammer Curl');
    expect(p.unavailable).not.toContain('Quads');
  });
  it('falls back to any catalog lift that trains the muscle directly', () => {
    const p = buildProgram(withTiers({ Glutes: 1, Abs: 1 }, 4), [], { days: 2, perSession: 8 }, NOW, { available: new Set(['Cable Kickback', 'Plank']) });
    expect(p.unavailable).toEqual(expect.not.arrayContaining(['Glutes', 'Abs']));
  });
});

describe('tier order', () => {
  it('meets a priority-1 lower target at the default low-priority share', () => {
    for (let days = 1; days <= 6; days++) {
      const prof = withTiers({ Forearms: 1 }, 4);
      const p = buildProgram(prof, [], { days, perSession: 12 }, NOW);
      const forearms = p.days.flatMap((d) => d.slots).reduce((a, sl) => a + (muscleVector(sl.exercise)?.Forearms ?? 0) * sl.sets, 0);
      expect(forearms, `${days} days`).toBeGreaterThanOrEqual(Math.min(prof.targets[1][0], days * 12 - Math.floor((0.2 * days * 12) / 2) * 2));
    }
  });

  it('takes today in local time: late on Oct 1 a set from Oct 1 last year is still inside the year', () => {
    // One recent-year set (1 point) outranks two older sets (0.5) — unless "today" slips to Oct 2 and the set falls out of the year (0.25).
    const e = [s('2025-10-01', 'Cable Curl'), s('2025-06-01', 'DB Curl'), s('2025-06-02', 'DB Curl')];
    const late = new Date(2026, 9, 1, 23, 30); // Oct 1 local; already Oct 2 in UTC for any zone west of it
    const p = buildProgram(withTiers({ Biceps: 1 }, 4), e, { days: 1, perSession: 8 }, late);
    const curls = p.days[0].slots.map((x) => x.exercise).filter((x) => x === 'Cable Curl' || x === 'DB Curl');
    expect(curls[0]).toBe('Cable Curl');
  });
});

describe('varied days', () => {
  const reps = (ex: string, n: number) => Array.from({ length: n }, (_, i) => s(`2026-09-${10 + i}`, ex));
  const hist = [...reps('Incline DB Curl', 8), ...reps('Bayesian Cable Curl', 6), ...reps('Cable Pushdown', 8), ...reps('Overhead DB Triceps Extension', 6)];
  const prof = () => { const p = defaultProfile(); p.tiers.Biceps = 1; p.tiers.Triceps = 1; return p; };
  const directOn = (p: Program, d: number, m: Muscle) => p.days[d].slots.filter((sl) => muscleVector(sl.exercise)?.[m] === 1);

  it('trains each priority muscle every day, leading each day with a different lift you know', () => {
    const p = buildProgram(prof(), hist, { days: 2, perSession: 14 }, NOW);
    for (const m of ['Biceps', 'Triceps'] as Muscle[]) {
      const [a, b] = [0, 1].map((d) => directOn(p, d, m).sort((x, y) => y.sets - x.sets));
      expect(a.length, `${m} on Day A`).toBeGreaterThan(0);
      expect(b.length, `${m} on Day B`).toBeGreaterThan(0);
      expect(a[0].exercise, `${m}: each day leads with its own lift`).not.toBe(b[0].exercise);
    }
  });
  it('repeats a lift you know before bringing in one you have never done', () => {
    // Two known lifts each for Biceps and Triceps, and one known row: the extra sets go to those, not to catalog lifts.
    const p = buildProgram(prof(), [...hist, ...reps('Seated Cable Row', 6)], { days: 2, perSession: 14 }, NOW);
    const isNew = (ex: string) => p.newToYou?.includes(ex);
    for (const m of ['Biceps', 'Triceps'] as Muscle[]) for (const d of [0, 1]) expect(directOn(p, d, m).filter((sl) => isNew(sl.exercise)).map((sl) => sl.exercise), m).toEqual([]);
    const rows = [0, 1].flatMap((d) => directOn(p, d, 'Mid-Back').map((sl) => sl.exercise));
    expect(rows.filter(isNew), 'Mid-Back').toEqual([]);
  });
  it('repeats a lift across days when the gym has no other for that muscle', () => {
    const available = new Set([...CATALOG].filter((n) => muscleVector(n)?.Biceps !== 1 || n === 'Hammer Curl'));
    const p = buildProgram(prof(), hist, { days: 2, perSession: 14 }, NOW, { available });
    for (const d of [0, 1]) expect(directOn(p, d, 'Biceps').map((sl) => sl.exercise)).toEqual(['Hammer Curl']);
    expect(p.unavailable).toEqual([]);
  });
  it('keeps the weekly volume per muscle', () => {
    // Measured on HEAD 5986f7b (the per-week allocator) for these exact inputs, before this change.
    const before: Partial<Record<Muscle, number>> = { Chest: 2, Triceps: 13, Biceps: 12, 'Front Delts': 1, 'Side Delts': 2 };
    const v = programVolume(buildProgram(prof(), hist, { days: 2, perSession: 14 }, NOW));
    for (const m of MUSCLES) expect(Math.abs(v[m] - (before[m] ?? 0)), m).toBeLessThanOrEqual(2);
  });
});

describe('addSlot', () => {
  const lift = (exercise: string) => ({ exercise, sets: 3, repMin: 8, repMax: 12 });
  it('puts a lift before the day’s cardio, and cardio last', () => {
    const day = { name: 'Day A', slots: [lift('Bench Press'), cardioSlot('Treadmill', 20)] };
    addSlot(day, lift('Cable Curl'));
    expect(day.slots.map((x) => x.exercise)).toEqual(['Bench Press', 'Cable Curl', 'Treadmill']);
    addSlot(day, cardioSlot('Elliptical', 15));
    expect(day.slots.map((x) => x.exercise)).toEqual(['Bench Press', 'Cable Curl', 'Treadmill', 'Elliptical']);
    const empty: Program['days'][number] = { name: 'Day B', slots: [] };
    addSlot(empty, lift('Plank'));
    expect(empty.slots.map((x) => x.exercise)).toEqual(['Plank']);
  });
});

describe('round 13 lifts and pull bias', () => {
  it('the new lifts are fallbacks for their muscle: a dumbbell gym presses overhead with dumbbells', () => {
    expect(PREFERENCE['Front Delts']).toContain('DB Shoulder Press');
    expect(PREFERENCE.Quads).toEqual(expect.arrayContaining(['Front Squat', 'Pendulum Squat']));
    const available = new Set(['DB Shoulder Press', 'Arnold Press', 'Overhead Press']);
    expect(primaryExercise('Front Delts', [])).toBe('Machine Shoulder Press');
    const p = buildProgram(withTiers({ 'Front Delts': 1 }, 4), [], { days: 1, perSession: 4 }, NOW, { available });
    expect(p.days[0].slots.map((sl) => sl.exercise)).toEqual(['DB Shoulder Press']);
  });
  it('a chin-up counts more for the biceps than a pull-up; the lats and the rest the same', () => {
    const prog = (exercise: string): Program => ({ key: 'program', perSession: 4, createdAt: '', days: [{ name: 'Day A', slots: [{ exercise, sets: 4, repMin: 8, repMax: 12 }] }] });
    const pull = programVolume(prog('Pull-up')), chin = programVolume(prog('Chin-up'));
    expect(pull).toMatchObject({ Lats: 4, 'Mid-Back': 2, Biceps: 2, Forearms: 2 });
    expect(chin).toMatchObject({ Lats: 4, 'Mid-Back': 2, Biceps: 3, Forearms: 2 });
    // Short of direct work: a chin-up is never the program's biceps lift.
    expect(candidates('Biceps', [], '2026-09-30')).not.toContain('Chin-up');
  });
});

describe('round 15: a larger catalog, the same program pool', () => {
  it('the builder offers only program lifts unasked, and any lift once logged', () => {
    for (const m of MUSCLES) for (const n of candidates(m, [], '2026-09-30')) expect(PROGRAM_LIFTS, `${m}: ${n}`).toContain(n);
    expect(candidates('Quads', [], '2026-09-30')).not.toContain('Hack Squat');
    const logged = [s('2026-09-20', 'Hack Squat'), s('2026-09-21', 'Hack Squat')];
    expect(candidates('Quads', logged, '2026-09-30')[0]).toBe('Hack Squat');
  });
  it('a lift added to the gym joins too, even one the builder wouldn’t offer', () => {
    const r = candidates('Quads', [], '2026-09-30', { available: new Set([...PROGRAM_LIFTS, 'Belt Squat']), include: ['Belt Squat'] });
    expect(r[0]).toBe('Belt Squat');
  });
  it('traps get a shrug (owner, Q4); Face Pull stays after them', () => {
    expect(DEFAULT_PICK.Traps).toBe('DB Shrug');
    expect(candidates('Traps', [], '2026-09-30').slice(0, 3)).toEqual(['DB Shrug', 'Barbell Shrug', 'Face Pull']);
  });
});

describe('owner decisions 2026-10-20: plan at the aim, P4 excluded, blocks', () => {
  const sets = (p: Program, m: Muscle) => programVolume(p)[m];
  // Round 28 (owner, 2026-10-22): the aims order the fill and no longer cap it; a session only big enough for the aims gets them first.
  it('plans each muscle to its aim first: a session with room for little more than the aims gets each aim', () => {
    const prof = withTiers({ Chest: 1, Lats: 1, Biceps: 2 }, 3);
    const band = buildProgram(prof, [], { days: 3, perSession: 6 }, NOW);
    const aimed = buildProgram(prof, [], { days: 3, perSession: 6, aims: { Chest: [7, 7], Lats: [7, 7], Biceps: [4, 4] } }, NOW);
    expect(sets(aimed, 'Chest')).toBeGreaterThanOrEqual(6);
    expect(sets(aimed, 'Lats')).toBeGreaterThanOrEqual(6);
    expect(sets(aimed, 'Biceps')).toBeGreaterThanOrEqual(4);
    // At its range, priority 1's bigger targets take the sets first.
    expect(sets(band, 'Chest') + sets(band, 'Lats')).toBeGreaterThan(sets(aimed, 'Chest') + sets(aimed, 'Lats') - 2);
    expect(aimed.aims).toMatchObject({ Chest: 7, Lats: 7, Biceps: 4 });
    expect(aimed.block).toBe(NOW.toISOString().slice(0, 10));
    expect(band.aims).toBeUndefined();
  });
  it('gives an excluded priority 4 ([0, 0]) no sets of its own', () => {
    const prof = withTiers({ Chest: 1, Biceps: 2, Quads: 4, Hamstrings: 4, Calves: 4, Glutes: 4 }, 3);
    expect(prof.targets[4]).toEqual([0, 0]);
    const p = buildProgram(prof, [], { days: 3, perSession: 20 }, NOW);
    const direct = p.days.flatMap((d) => d.slots).filter((s) => ['Quads', 'Hamstrings', 'Calves', 'Glutes'].some((m) => muscleVector(s.exercise)?.[m as Muscle] === 1));
    expect(direct).toEqual([]);
  });
  it('counts 3-week blocks from when its aims were read', () => {
    const p = buildProgram(withTiers({}, 3), [], { days: 2, perSession: 12, aims: {} }, NOW);
    const day = (n: number) => new Date(NOW.getTime() + n * 864e5).toISOString().slice(0, 10);
    expect(programBlock(p, day(0))).toBe(0);
    expect(programBlock(p, day(20))).toBe(0);
    expect(programBlock(p, day(21))).toBe(1);
    expect(programBlock(p, day(43))).toBe(2);
    const old = { ...p, block: undefined }; // built before aims: from its build day
    expect(programBlock(old, day(21))).toBe(1);
  });
  it('counts blocks from the LOCAL day a program without aims was built, not the UTC one', () => {
    // Built 22:30 on 1 October in New York: 2 October in UTC. Three weeks on is 22 October, local.
    const late = new Date(2026, 9, 1, 22, 30);
    expect(late.toISOString().slice(0, 10)).toBe('2026-10-02');
    const p = { ...buildProgram(withTiers({}, 3), [], { days: 2, perSession: 12 }, late), block: undefined };
    expect(programBlock(p, '2026-10-21')).toBe(0);
    expect(programBlock(p, '2026-10-22')).toBe(1);
    expect(programBlock(p, '2026-11-12')).toBe(2);
  });
  it('rebuilds like the program it replaces, and tells a real change from none', () => {
    const prof = withTiers({ Chest: 1, Lats: 1 }, 3);
    const a = buildProgram(prof, [], { days: 3, perSession: 14 }, NOW);
    const same = rebuildLike({ days: 3, perSession: 14 }, prof, [], NOW, {}, undefined, () => 0);
    expect(same.days.length).toBe(3);
    expect(volumeDiffers(a, same)).toBe(false);
    // A smaller session at the aims: the aims take what there is.
    const lower = rebuildLike({ days: 3, perSession: 8 }, prof, [], NOW, {}, { Chest: [6, 6], Lats: [6, 6] }, () => 0);
    expect(volumeDiffers(a, lower)).toBe(true);
    const timed = rebuildLike({ days: 2, perSession: 14, minutes: 40 }, prof, [], NOW, {}, undefined, (d) => d.slots.reduce((n, s) => n + s.sets, 0) * 4);
    expect(timed.minutes).toBe(40);
    expect(Math.max(...timed.days.map((d) => d.slots.reduce((n, s) => n + s.sets, 0)))).toBeLessThanOrEqual(10); // 4 min a set
  });
});

describe('round 28: the aim orders the fill, the session size sets the total', () => {
  const placed = (p: Program, d: number) => p.days[d].slots.reduce((a, x) => a + (x.minutes == null ? x.sets : 0), 0);
  // Two priority 1s and three priority 2s planned at a +20 % step well short of their ranges, the rest priority 3.
  const prof = withTiers({ Biceps: 1, Abs: 1, Chest: 2, 'Side Delts': 2, 'Mid-Back': 2 }, 3);
  const aims = { Biceps: [6, 6], Abs: [6, 6], Chest: [4, 4], 'Side Delts': [4, 4], 'Mid-Back': [4, 4] } as Partial<Record<Muscle, [number, number]>>;
  for (const m of MUSCLES) if (!aims[m]) aims[m] = [2, 2];
  it('3 days × 20 sets gives about 20 a day, not the aims’ 8 or so', () => {
    const p = buildProgram({ ...prof, lowShare: 0.1 }, [], { days: 3, perSession: 20, aims }, NOW);
    for (const d of [0, 1, 2]) expect(placed(p, d), `day ${d}`).toBeGreaterThanOrEqual(18);
    expect(p.short).toBeUndefined();
  });
  it('the aims still go first: a session too small for more gets the aims before any range', () => {
    const p = buildProgram({ ...prof, lowShare: 0.1 }, [], { days: 2, perSession: 8, aims }, NOW);
    const v = programVolume(p);
    for (const m of ['Biceps', 'Abs'] as Muscle[]) expect(v[m], m).toBeGreaterThanOrEqual(4);
  });
  it('the extra sets go toward each range by priority, never past a range’s top', () => {
    const p = buildProgram({ ...prof, lowShare: 0.1 }, [], { days: 3, perSession: 20, aims }, NOW);
    const v = programVolume(p);
    expect(v.Biceps).toBeGreaterThan(6);
    expect(v.Biceps).toBeGreaterThan(v.Calves);
    // Direct sets of a muscle never pass its range's top by more than the pair that crossed it.
    for (const m of MUSCLES) {
      const direct = p.days.flatMap((d) => d.slots).filter((sl) => muscleVector(sl.exercise)?.[m] === 1).reduce((a, sl) => a + sl.sets, 0);
      expect(direct, m).toBeLessThanOrEqual(prof.targets[prof.tiers[m]][1] + 2);
    }
  });
  it('stops at the tops and says why when every muscle is full', () => {
    // Only Biceps and Abs trained (everything else excluded): 2 muscles can't take 3 × 20.
    const only = withTiers({ Biceps: 1, Abs: 1 }, 4);
    const p = buildProgram(only, [], { days: 3, perSession: 20, aims: { Biceps: [6, 6], Abs: [6, 6] } }, NOW);
    expect(p.short).toEqual({ why: 'tops' });
  });
  it('by minutes: the days fill toward the minutes, not the aims', () => {
    const p = rebuildLike({ days: 3, perSession: 14, minutes: 60 }, { ...prof, lowShare: 0.1 }, [], NOW, {}, aims, (d) => d.slots.reduce((n, s) => n + s.sets, 0) * 3);
    for (const d of [0, 1, 2]) expect(placed(p, d), `day ${d}`).toBeGreaterThanOrEqual(18); // 3 min a set: 20 sets in 60
  });
});
