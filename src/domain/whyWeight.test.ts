import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { nextTarget, resolveSettings, type ExerciseSettings, type TargetInput } from './progression';
import { suggest } from './suggest';
import type { TrainingGoal } from './profile';

// "Why this weight" (the target's "?"): its lines are the inputs the decision path used, pushed by the branch that used them.
// Two checks that each go red when a line is dropped or made up. (1) Each scenario's lines are exactly the inputs its branch
// reads. (2) Counterfactuals: an input with a line moves the target when it changes, and one without a line doesn't. Synthetic
// logs only.

let seq = 0;
const s = (date: string, exercise: string, weight: number, reps: number, over: Partial<SetEntry> = {}): SetEntry =>
  ({ id: `w${seq}`, date, seq: seq++, exercise, setNo: 1, weight, reps, flags: weight <= 0 ? ['bodyweight'] : [], source: 't', ...over });
/** A session: one set per rep count, numbered; `over` on every set, `last` on the last one. */
const sess = (date: string, exercise: string, w: number, reps: number[], over: Partial<SetEntry> = {}, last: Partial<SetEntry> = {}) =>
  reps.map((r, i) => s(date, exercise, w, r, { setNo: i + 1, ...over, ...(i === reps.length - 1 ? last : {}) }));
const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10);
const aimed = (w: number, reps: number, sets = 3) => ({ target: { weight: w, reps, sets } });

/** A cable lifter whose increases cost about 2 reps (learn/jump learns it), as in progression.test. */
function cable(exercise: string, from: number, start: number): SetEntry[] {
  const out: SetEntry[] = [];
  let d = start, w = from;
  for (let i = 0; i < 6; i++) {
    out.push(...sess(day(d), exercise, w, [15, 15, 14])); d += 4; w += 2.5;
    out.push(...sess(day(d), exercise, w, [13, 13, 12])); d += 4;
  }
  return out;
}

interface Scenario { log: SetEntry[]; exercise: string; date: string; saved?: ExerciseSettings; goal?: TrainingGoal; hold?: boolean; planned?: number | null; light?: boolean }
const B = 'Bench Press', C = 'Cable Curl', PD = 'Cable Pushdown', PU = 'Pull-Up';
const NEXT = day(120);
const SC: Record<string, Scenario> = {
  // No RIR logged: last time's reps again (owner, 2026-10-28), and targets hit say nothing.
  normal: { exercise: B, date: NEXT, log: [...sess(day(100), B, 135, [9, 9, 8]), ...sess(day(104), B, 135, [10, 10, 9], aimed(135, 9))] },
  // Missed three times running: targets no longer move the reps (owner, 2026-10-28), so no line for them.
  stall: { exercise: B, date: NEXT, log: [...sess(day(96), B, 135, [10, 9, 8], aimed(135, 10)), ...sess(day(100), B, 135, [10, 10, 9], aimed(135, 10)), ...sess(day(104), B, 135, [10, 9, 9], aimed(135, 10))] },
  // Range topped two sessions running: up a learned rung (cable steps), each set less the learned drop.
  jump: { exercise: C, date: NEXT, log: [...cable(C, 40, 0), ...cable('Face Pull', 20, 1), ...cable(PD, 50, 2), ...sess(day(100), C, 60, [15, 15, 14]), ...sess(day(104), C, 60, [15, 15, 14])] },
  // Moderate pain last time: held.
  hold: { exercise: PD, date: NEXT, log: [...sess(day(100), PD, 100, [12, 11, 10]), ...sess(day(104), PD, 105, [12, 12, 11], {}, { flags: ['pain'], painSeverity: 2 })] },
  // Sharp pain last time: one learned rung down.
  ease: { exercise: PD, date: NEXT, log: [...cable(PD, 50, 2), ...sess(day(104), PD, 80, [12, 12, 11], {}, { flags: ['pain'], painSeverity: 3 })] },
  // Nothing logged.
  fresh: { exercise: 'Hack Squat', date: NEXT, log: sess(day(104), B, 135, [10, 10, 9]) },
  // A test set newer than the last session: its e1RM sets the weight.
  test: { exercise: B, date: NEXT, log: [...sess(day(100), B, 135, [10, 10, 9]), ...sess(day(104), B, 185, [8], { flags: ['test'], rir: 1 })] },
  // Rotated in: the carried-over estimate.
  carry: { exercise: 'Incline Bench Press', date: NEXT, log: sess(day(104), B, 135, [10, 10, 9]),
    saved: { key: 'incline bench press', repMin: 8, repMax: 12, increment: 5, seed: { weight: 105, reps: 8, from: B, date: day(110), e1rm: 160, basis: 'catalog' } } },
  // A light week on: lighter, half the sets.
  light: { exercise: B, date: NEXT, light: true, log: [...sess(day(96), B, 125, [12, 12, 11]), ...sess(day(100), B, 135, [12, 12, 11]), ...sess(day(104), B, 135, [10, 10, 9], aimed(135, 9))] },
  // A logged RIR 2 on a set: that set gets +1, the rest repeat.
  rir: { exercise: C, date: NEXT, log: [...sess(day(100), C, 40, [11, 11, 10]), ...sess(day(104), C, 40, [12, 12, 11], {}, { rir: 2 })] },
  // Four sets planned after three: the fourth aims at the third's number.
  plan: { exercise: C, date: NEXT, planned: 4, log: [...sess(day(100), C, 40, [11, 11, 10]), ...sess(day(104), C, 40, [12, 12, 11])] },
  // Pull-ups at bodyweight: reps not capped by the range.
  body: { exercise: PU, date: NEXT, log: [...sess(day(100), PU, 0, [8, 7, 6]), ...sess(day(104), PU, 0, [9, 8, 7])] },
  // The strength goal: a barbell compound's 5–8, topped two sessions running.
  strength: { exercise: B, date: NEXT, goal: 'strength', log: [...sess(day(100), B, 185, [8, 7, 7]), ...sess(day(104), B, 185, [8, 8, 7])] },
};

const settingsOf = (x: Scenario, goal = x.goal ?? 'size') => resolveSettings(x.saved, x.exercise, x.hold, goal);
const sug = (x: Scenario, o: { st?: ExerciseSettings; log?: SetEntry[]; planned?: number | null; light?: boolean } = {}) =>
  suggest(o.log ?? x.log, x.exercise, o.st ?? settingsOf(x), x.date, o.planned !== undefined ? o.planned : x.planned ?? null, o.light ?? x.light ?? false);
const keys = (x: Scenario) => sug(x).parts.map((p) => p.key);
/** The number the card shows: kind, weight, reps a set, sets. */
const shown = (r: ReturnType<typeof sug>) => JSON.stringify([r.kind, r.weight, r.reps, r.perSet, r.sets]);

describe('Why this weight: each target’s lines are the inputs its branch read', () => {
  const want: Record<string, TargetInput[]> = {
    normal: ['last', 'progress', 'goal', 'sets'],
    stall: ['last', 'progress', 'goal', 'sets'],
    jump: ['last', 'progress', 'range', 'step', 'drop', 'sets'],
    hold: ['last', 'pain', 'sets'],
    ease: ['last', 'pain', 'step', 'sets'],
    fresh: ['new', 'range', 'sets'],
    test: ['test', 'goal', 'step', 'sets'],
    carry: ['seed', 'sets'],
    light: ['light', 'step', 'last', 'progress', 'goal'],
    rir: ['last', 'progress', 'range', 'rir', 'sets'],
    plan: ['last', 'progress', 'range', 'plan', 'sets'],
    body: ['last', 'bodyweight', 'sets'],
    strength: ['last', 'progress', 'goal', 'step', 'sets'],
  };
  for (const [name, x] of Object.entries(SC)) it(name, () => expect(keys(x)).toEqual(want[name]));

  it('says what each line is and where it comes from: (a) a citation, (b) a method, (c) what it stands in for', () => {
    for (const x of Object.values(SC)) for (const p of sug(x).parts) {
      expect(p.what.length, p.key).toBeGreaterThan(1);
      expect(p.value.length, p.key).toBeGreaterThan(0);
      const e = p.evidence;
      if (e.ev === 'a') expect(e.cite, p.key).toMatch(/\d{4}/); // an author and year
      else expect((e.ev === 'b' ? e.method : e.note).length, p.key).toBeGreaterThan(5);
    }
    expect(sug(SC.strength).parts.find((p) => p.key === 'goal')).toMatchObject({ what: 'Strength goal', value: '5–8 reps', evidence: { ev: 'a' } });
    expect(sug(SC.normal).parts.find((p) => p.key === 'goal')).toMatchObject({ what: 'Size goal', value: '8–12 reps', evidence: { ev: 'c' } });
    expect(sug(SC.jump).parts.find((p) => p.key === 'step')).toMatchObject({ value: '60 lb → 62.5 lb', evidence: { ev: 'b' } });
    expect(sug(SC.jump).parts.find((p) => p.key === 'drop')!.evidence).toMatchObject({ ev: 'b', method: expect.stringContaining('fatigue-adjusted') });
    expect(sug(SC.carry).parts[0]).toMatchObject({ value: 'e1RM 160 lb → 105 lb × 8+', evidence: { ev: 'b', method: expect.stringContaining('fatigue-adjusted e1RM') } });
    expect(sug(SC.hold).parts.find((p) => p.key === 'pain')).toMatchObject({ value: 'hold 105 lb and last time’s reps', evidence: { ev: 'a', cite: expect.stringContaining('Silbernagel') } });
    expect(sug(SC.rir).parts.find((p) => p.key === 'rir')).toMatchObject({ value: '2+ on set 3: +1 there, the rest as last time', evidence: { ev: 'b' } });
    expect(sug(SC.normal).parts[0]).toMatchObject({ what: 'Last time', date: day(104), value: '135 lb × 10 · 10 · 9' });
  });

  it('comes from the target itself: suggest passes nextTarget’s lines on, and adds only its sets', () => {
    for (const [name, x] of Object.entries(SC)) {
      const t = nextTarget(x.log, x.exercise, settingsOf(x), x.date, x.planned ?? null, x.light ?? false);
      const p = sug(x).parts;
      expect(p.slice(0, t?.parts.length ?? 0), name).toEqual(t?.parts ?? []);
    }
  });
});

/** The lift's latest session before the day that isn't a test, as the target reads it. */
const lastDayOf = (x: Scenario) => x.log.filter((e) => e.exercise === x.exercise && !e.flags.includes('test') && e.date < x.date).reduce((a, e) => (e.date > a ? e.date : a), '');
/**
 * Each input, changed so that it would decide: does the number move? Where it has a line it must, and where it has none it mustn't. `when`: the
 * scenarios where the change touches only that input (stripping RIR or targets also moves what the core learns, and so a drop).
 */
const CHANGES: { name: string; lines: (k: TargetInput[], x: Scenario) => boolean; change: (x: Scenario) => ReturnType<typeof sug>; when?: (x: Scenario) => boolean }[] = [
  { name: 'the training goal', lines: (k) => k.includes('goal'), change: (x) => sug(x, { st: settingsOf(x, x.goal === 'strength' ? 'size' : 'strength') }) },
  // Topped: 5 more at the top, so it isn't. Otherwise a range last time's sets top (so it is), from 1.
  { name: 'the rep range', lines: (k) => k.includes('range') || k.includes('goal'),
    change: (x) => {
      const st = settingsOf(x), d = lastDayOf(x);
      const low = Math.min(...x.log.filter((e) => e.date === d && e.exercise === x.exercise).map((e) => e.reps ?? 1), 40);
      const range = sug(x).kind === 'increase' ? { repMin: st.repMin, repMax: st.repMax + 5 } : { repMin: 1, repMax: Math.max(2, low) };
      return sug(x, { st: { ...st, ...range, ownRange: true, rangeFrom: 'own' } });
    } },
  { name: 'the step', lines: (k) => k.includes('step'), change: (x) => sug(x, { st: { ...settingsOf(x), increment: 7 } }) },
  { name: 'pain', lines: (k) => k.includes('pain'), change: (x) => sug(x, { log: x.log.map((e) => ({ ...e, flags: e.flags.filter((f) => f !== 'pain') })) }) },
  { name: 'the plan', lines: (k, x) => k.includes('plan') || (k.includes('sets') && x.planned != null) || (k.includes('light') && x.planned != null),
    change: (x) => sug(x, { planned: x.planned == null ? 5 : null }), when: (x) => x.planned != null },
  { name: 'a light week', lines: (k) => k.includes('light'), change: (x) => sug(x, { light: false }), when: (x) => !!x.light },
  { name: 'last session', lines: (k) => k.includes('last'),
    // 4 reps a set fewer after a topped range (so it isn't), else 4 more (so it is, or a held set aims higher).
    change: (x) => { const d = lastDayOf(x), by = sug(x).kind === 'increase' ? -4 : 4;
      return sug(x, { log: x.log.map((e) => (e.date === d && e.exercise === x.exercise ? { ...e, reps: (e.reps ?? 0) + by } : e)) }); } },
  // A test's own RIR is on its line (its e1RM counts it).
  { name: 'logged RIR', lines: (k, x) => k.includes('rir') || (k.includes('test') && x.log.some((e) => e.flags.includes('test') && e.rir != null)), change: (x) => sug(x, { log: x.log.map(({ rir: _, ...e }) => e) }), when: (x) => !sug(x).parts.some((p) => p.key === 'drop') },
  { name: 'targets hit or missed', lines: (k) => k.includes('hits'), change: (x) => sug(x, { log: x.log.map(({ target: _, ...e }) => e) }), when: (x) => !sug(x).parts.some((p) => p.key === 'drop') },
];

describe('Why this weight: a line is there exactly when its input moved the number', () => {
  for (const c of CHANGES) it(c.name, () => {
    const wrong: string[] = [];
    for (const [name, x] of Object.entries(SC)) {
      if (c.when && !c.when(x)) continue;
      const lined = c.lines(keys(x), x), moved = shown(c.change(x)) !== shown(sug(x));
      if (lined !== moved) wrong.push(`${name}: ${lined ? 'has a line, but changing it moved nothing' : 'has no line, but changing it moved the target'}`);
    }
    expect(wrong).toEqual([]);
  });
});

