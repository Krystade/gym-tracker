import { describe, expect, it } from 'vitest';
import { hurts, type SetEntry } from './types';
import { addTag, asBuiltIns, BUILT_IN, defaultTags, hasTag, withBuiltIns } from './tags';
import { nextTarget } from './progression';
import { nextSet, suggest } from './suggest';
import { painGate, painToday } from './painPlan';
import { zoneOf } from './learn/pain';
import { painReport } from './care';
import { asksFor } from './morning';
import { parseCsv, toCsv } from './csv';
import { buildAppSet } from './buildSet';
import { fitCore, FORM_FAIL_WEIGHT, GOOD_FORM_REPS } from './learn/capacity';
import { SIM_LIFTS, simulate } from './learn/coreSim.sample';
import { earned, earnedOn, INCOME, setPoints } from './buddies/points';
import type { Training } from './buddies/stats';

// Owner, 2026-11-21: the four set-quality tags, a tingle below Mild, and points as they're earned. Synthetic sets only.

let seq = 0;
const s = (date: string, setNo: number, weight: number, reps: number | null, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `q|${date}|curl|${setNo}|${seq}`, date, seq: seq++, exercise: 'Curl', setNo, weight, reps, flags: [], source: 'q', ...over,
});
const S = { key: 'curl', repMin: 8, repMax: 12, increment: 5 };
/** A session topped at 30 lb, twice running: the range done, so the weight would go up. */
const topped = (over: Partial<SetEntry> = {}, last: Partial<SetEntry> = {}) => [
  ...[1, 2, 3].map((n) => s('2025-12-25', n, 30, 12, over)),
  ...[1, 2, 3].map((n) => s('2026-01-01', n, 30, 12, { ...over, ...last, rir: 2 })),
];

describe('built-in tags: Form fail, Extra good form, Full stack, No spot', () => {
  it('are on the tag row, after the old built-ins', () => {
    expect(BUILT_IN.map(([, l]) => l)).toEqual(['Pain', 'Unsure', 'Warm-up', '2× pulley', 'Test', 'Form fail', 'Extra good form', 'Full stack', 'No spot']);
  });
  it('an own tag of that name (any case, spacing or hyphens) reads as the built-in; others stay; nothing matching, the same set', () => {
    const e = s('2026-01-01', 1, 30, 10, { tags: ['FORM FAIL', 'paused', 'no-spot', 'Full  stack', 'extra good form'] });
    const m = asBuiltIns(e);
    expect(m.flags).toEqual(['form_fail', 'no_spot', 'full_stack', 'good_form']);
    expect(m.tags).toEqual(['paused']);
    const only = asBuiltIns(s('2026-01-01', 1, 30, 10, { tags: ['No Spot'], flags: ['no_spot'] }));
    expect(only.flags).toEqual(['no_spot']);
    expect(only).not.toHaveProperty('tags');
    const plain = s('2026-01-01', 1, 30, 10, { tags: ['paused'] });
    expect(asBuiltIns(plain)).toBe(plain);
  });
  it('the tag row drops an own tag the built-in now is, and typing its name shows the built-in', () => {
    const p = withBuiltIns({ ...defaultTags(), custom: ['paused', 'Form Fail', 'no spot'] });
    expect(p.custom).toEqual(['paused']);
    const kept = { ...defaultTags(), custom: ['paused'] };
    expect(withBuiltIns(kept)).toBe(kept);
    const hidden = { ...defaultTags(), hidden: ['good_form' as const] };
    expect(addTag(hidden, 'good form')).toEqual(defaultTags());
    expect(hasTag(defaultTags(), 'Full Stack')).toBe(true);
  });
});

describe('Full stack: no more weight on that lift at that gym', () => {
  it('a topped range goes up as usual; the same with Full stack last time stays at the weight and goes past the range', () => {
    expect(nextTarget(topped(), 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'increase', weight: 35 });
    const t = nextTarget(topped({}, { flags: ['full_stack'] }), 'Curl', S, '2026-01-08')!;
    expect(t).toMatchObject({ kind: 'reps', weight: 30, perSet: [13, 13, 13] });
    expect(t.why).toContain('switch lift');
    expect(t.parts.find((p) => p.key === 'stack')).toMatchObject({ what: 'Full stack last time', value: '30 lb is the stack’s top: reps past the range, or switch lift' });
  });
  it('only at that gym: another gym’s full stack doesn’t hold this one (unknown gym: any does)', () => {
    const e = topped({ gym: 'g1' }, { flags: ['full_stack'] });
    expect(nextTarget(e, 'Curl', S, '2026-01-08', null, false, undefined, 'g2')?.kind).toBe('increase');
    expect(nextTarget(e, 'Curl', S, '2026-01-08', null, false, undefined, 'g1')?.kind).toBe('reps');
    expect(nextTarget(e, 'Curl', S, '2026-01-08')?.kind).toBe('reps');
  });
  it('the next set in the session isn’t held to the range’s top either', () => {
    const e = topped({}, { flags: ['full_stack'] });
    const sug = suggest(e, 'Curl', S, '2026-01-08', null);
    expect(sug.stacked).toBe(true);
    const done = [s('2026-01-08', 1, 30, 13, { rir: 4, loggedAt: '2026-01-08T18:00:00.000Z' })];
    expect(nextSet([...e, ...done], 'Curl', '2026-01-08', sug, done)?.reps).toBe(14); // 13 + 1 for the 4+ in reserve, past the top
  });
  it('a session after it without the tag lets the weight go up again', () => {
    const e = [...topped({}, { flags: ['full_stack'] }), ...[1, 2, 3].map((n) => s('2026-01-08', n, 30, 13, { rir: 1 }))];
    expect(nextTarget(e, 'Curl', S, '2026-01-15')?.kind).toBe('increase');
  });
});

describe('No spot: never read as lower strength', () => {
  const at = (n: number, reps: number, over: Partial<SetEntry> = {}) => s('2026-01-01', n, 30, reps, { target: { weight: 30, reps: 10, sets: 3 }, ...over });
  it('a set short of its target for want of a spotter aims from the target next time, not from its reps', () => {
    expect(nextTarget([at(1, 10), at(2, 10), at(3, 7)], 'Curl', S, '2026-01-08')?.perSet).toEqual([10, 10, 7]);
    expect(nextTarget([at(1, 10), at(2, 10), at(3, 7, { flags: ['no_spot'] })], 'Curl', S, '2026-01-08')?.perSet).toEqual([10, 10, 10]);
  });
});

describe('the learning core: Form fail half weight, Extra good form half a rep, No spot a floor', () => {
  const sim = simulate(3, { sessions: 30 }).entries;
  const L = SIM_LIFTS[0].name;
  const last = sim.filter((e) => e.exercise === L).map((e) => e.date).sort().at(-1)!;
  const mine = (e: SetEntry) => e.exercise === L && e.date === last;
  const level = (entries: SetEntry[]) => [...fitCore(entries).lifts.values()].find((l) => l.name === L)!.level.at(-1)!;
  /** The last session of L, each set 3 reps short of what it did. */
  const weak = (flags: SetEntry['flags']) => sim.map((e) => (mine(e) ? { ...e, reps: Math.max(1, (e.reps as number) - 3), flags: [...e.flags, ...flags] } : e));
  const base = level(sim), bad = level(weak([]));
  it('the constants are the ones stated', () => {
    expect(FORM_FAIL_WEIGHT).toBe(0.5);
    expect(GOOD_FORM_REPS).toBe(0.5);
  });
  it('a weak session tagged Form fail pulls the level down less than untagged', () => {
    expect(bad.x).toBeLessThan(base.x);
    const ff = level(weak(['form_fail']));
    expect(ff.x).toBeGreaterThan(bad.x);
    expect(ff.x).toBeLessThan(base.x);
  });
  it('a weak session tagged No spot reads no lower than leaving it out', () => {
    const without = level(sim.filter((e) => !mine(e)));
    const ns = level(weak(['no_spot']));
    expect(ns.date).toBe(last);
    expect(ns.x).toBeGreaterThan(bad.x);
    expect(ns.x).toBeGreaterThanOrEqual(without.x - 0.002);
  });
  it('Extra good form reads a touch stronger, and only a touch (under 2 % of e1RM)', () => {
    const gf = level(sim.map((e) => (mine(e) ? { ...e, flags: [...e.flags, 'good_form' as const] } : e)));
    expect(gf.x).toBeGreaterThan(base.x);
    expect(gf.x - base.x).toBeLessThan(Math.log(1.02));
  });
});

describe('a tingle: on the pain scale, below Mild, and no pain to any plan', () => {
  const pain = (sev: 0 | 1 | 2 | 3, date = '2026-01-01') => [1, 2, 3].map((n) => s(date, n, 30, 10, { flags: ['pain'], painRegion: 'elbow', painSeverity: sev }));
  it('hurts() is false for a tingle, true for any other pain, an unknown one included', () => {
    expect(hurts(pain(0)[0])).toBe(false);
    expect(hurts(pain(1)[0])).toBe(true);
    expect(hurts(s('d', 1, 30, 10, { flags: ['pain'] }))).toBe(true);
  });
  it('a tingle holds nothing where moderate holds the lift; no zone, nothing today, no morning check', () => {
    expect(painGate(pain(2), 'Curl', '2026-01-08')).toMatchObject({ kind: 'hold' });
    expect(painGate(pain(0), 'Curl', '2026-01-08')).toBeNull();
    expect(zoneOf(pain(0))).toBe(0);
    expect(painToday(pain(0), 'Curl', '2026-01-01')).toBeNull();
    expect(asksFor(pain(2), '2026-01-01').length).toBeGreaterThan(0);
    expect(asksFor(pain(0), '2026-01-01')).toEqual([]);
    expect(nextTarget(topped({ flags: ['pain'], painRegion: 'elbow', painSeverity: 0 }), 'Curl', S, '2026-01-08')?.kind).toBe('increase');
  });
  it('is tracked: the pain report counts it', () => {
    expect(painReport(pain(0), '2026-01-02')[0]).toMatchObject({ region: 'elbow', total: 3 });
  });
  it('is kept as 0 when logged, and round-trips through the CSV (old severities unchanged)', () => {
    const e = buildAppSet([], { date: '2026-01-01', exercise: 'Curl', weight: 30, reps: 10, flags: ['pain'], painRegion: 'elbow', painSeverity: 0 }, new Date('2026-01-01T18:00:00'));
    expect(e.painSeverity).toBe(0);
    const back = parseCsv(toCsv([e, { ...e, id: 'x', setNo: 2, painSeverity: 3 }])).entries;
    expect(back.map((x) => x.painSeverity)).toEqual([0, 3]);
  });
});

describe('points as they’re earned (buddies/points)', () => {
  it('a set earns what earned() counts for it: 1 a lifted set, none for a warm-up or cardio', () => {
    expect(setPoints(s('d', 1, 30, 10))).toBe(INCOME.set);
    expect(setPoints(s('d', 1, 30, 10, { flags: ['warmup'] }))).toBe(0);
    expect(setPoints(s('d', 1, 0, null, { exercise: 'Treadmill', flags: ['cardio'], cardio: { seconds: 600 } }))).toBe(0);
  });
  const t: Training = {
    start: '2026-10-01',
    sets: [...Array(10).fill('2026-10-05'), ...Array(12).fill('2026-10-07')],
    prs: [], steps: [], cardio: [],
    sessions: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-07'],
    goalWeeks: ['2026-10-07'],
  };
  it('a day’s pay is earned() a day apart: sets, session, goal week and its ticket, the 5th session’s ticket', () => {
    const d = earnedOn(t, null, '2026-10-07');
    expect(d.parts).toMatchObject({ sets: 12, sessions: 5, goalWeeks: 20, goalWeekTickets: 1, sessionTickets: 1, awards: 0 });
    expect(d.points).toBe(12 + 5 + 20);
    expect(d.tickets).toBe(2);
    expect(d.toTicket).toBe(5);
    // Every day's pay adds up to the Buddies tab's total.
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'];
    expect(days.reduce((a, x) => a + earnedOn(t, null, x).points, 0)).toBe(earned(t, null).points);
    expect(days.reduce((a, x) => a + earnedOn(t, null, x).tickets, 0)).toBe(earned(t, null).tickets);
    expect(earnedOn(t, null, '2026-10-05')).toMatchObject({ points: 15, tickets: 0, sessions: 4, toTicket: 1 });
  });
});
