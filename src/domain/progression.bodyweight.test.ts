import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { nextTarget } from './progression';
import { ladderOf, nextRung, prevRung } from './learn/ladder';
import { testDue } from './estimators';
import { bodyStrengthOf } from './learn/strength';
import { coreBefore } from './learn';
import { addDays } from './analytics';
import { bodyLog } from './learn/bodySim.sample';
import { fmtAdded, fmtSet } from './format';
import { derivedFlags } from './buildSet';
import { records } from './records';
import { suggest } from './suggest';
import { fmtSession, sessionOn } from './crew';

// Item 14: the next target for a lift whose load is the body. A set's weight is what was added (signed: + weight, 0 bodyweight,
// − help); help an older import kept in its note ("assisted -30 lb") reads the same. Synthetic logs only.
let seq = 0;
const DIPS = 'Forward-Lean Dips';
const set = (date: string, exercise: string, weight: number, reps: number, setNo: number, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `b${seq}`, date, seq: seq++, exercise, setNo, weight, reps, flags: weight <= 0 ? ['bodyweight'] : [], source: 't', gym: 'home', ...over,
});
const sess = (date: string, w: number, reps: number[], over: Partial<SetEntry> = {}, exercise = DIPS) =>
  reps.map((r, i) => set(date, exercise, w, r, i + 1, i === reps.length - 1 ? over : {}));
/** A typed increment (wins over the learned ladder), and the app's default one (the ladder speaks). */
const TYPED = { key: 'forward-lean dips', repMin: 8, repMax: 12, increment: 2.5 };
const DEF = { ...TYPED, increment: 5 };
const sharp: Partial<SetEntry> = { flags: ['bodyweight', 'pain'], painSeverity: 3 };
const NEXT = '2026-09-04';

describe('nextTarget for a bodyweight lift (item 14)', () => {
  it('with help, the range topped: a step less help (typed increment), up to bodyweight and no further', () => {
    expect(nextTarget(sess('2026-09-01', -30, [12, 12, 12]), DIPS, TYPED, NEXT))
      .toMatchObject({ kind: 'increase', weight: -27.5, step: 2.5, text: 'Go up: BW − 27.5 lb × 8+' });
    expect(nextTarget(sess('2026-09-01', -2.5, [12, 12, 12]), DIPS, TYPED, NEXT)).toMatchObject({ kind: 'increase', weight: 0, text: 'Go up: BW × 8+' });
    // Not topped: the reps climb at that help, capped at the range's top like any weight.
    expect(nextTarget(sess('2026-09-01', -30, [10, 9, 9]), DIPS, TYPED, NEXT)).toMatchObject({ kind: 'reps', weight: -30, text: 'BW − 30 lb × 11 · 10 · 10' });
  });

  it('with help, the range topped: the rung below on the help’s own learned stack (item 01), its counterweight steps', () => {
    // Help logged at 10, 20, 30 and 40 lb (a 10 lb stack), at this gym; the dips at bodyweight and a loaded lift beside them don't move it.
    const HELPED = [...sess('2026-08-01', -10, [8, 8]), ...sess('2026-08-05', -40, [12, 12]), ...sess('2026-08-07', -20, [12, 11]), ...sess('2026-08-09', 0, [6, 5])];
    const e = [...HELPED, ...sess('2026-08-09', 55, [10, 10], {}, 'Cable Curl'), ...sess('2026-09-01', -30, [12, 12, 12])];
    const help = ladderOf(e, DIPS, 'home', true)!;
    expect(help).toMatchObject({ step: 10, known: [10, 20, 30, 40] });
    const t = nextTarget(e, DIPS, DEF, NEXT)!;
    expect(t).toMatchObject({ kind: 'increase', weight: -prevRung(help, 30) });
    expect(t.weight).toBe(-20);
    // The lb ladder never sees the help, nor the help ladder the lb.
    expect(ladderOf(e, DIPS, 'home')).toBeNull();
    expect(ladderOf(e, 'Cable Curl', 'home', true)).toBeNull();
  });

  it('reads help an older import kept in its note as help: the same target as the signed weight', () => {
    const note = sess('2026-09-01', 0, [12, 12, 12], {}).map((x) => ({ ...x, note: 'assisted -30 lb' }));
    const signed = sess('2026-09-01', -30, [12, 12, 12]);
    const t = nextTarget(note, DIPS, TYPED, NEXT)!;
    expect(t).toMatchObject({ kind: 'increase', weight: -27.5 });
    expect({ ...t, last: null }).toEqual({ ...nextTarget(signed, DIPS, TYPED, NEXT)!, last: null });
    // A note that isn't help leaves bodyweight bodyweight.
    expect(nextTarget(sess('2026-09-01', 0, [10, 10, 10]).map((x) => ({ ...x, note: 'slow' })), DIPS, TYPED, NEXT)).toMatchObject({ weight: 0 });
  });

  it('sharp pain with help: a step more help, the same reps', () => {
    expect(nextTarget(sess('2026-09-01', -30, [10, 10, 10], sharp), DIPS, TYPED, NEXT))
      .toMatchObject({ kind: 'ease', easeBy: 'help', weight: -32.5, perSet: [10, 10, 10], why: 'Sharp pain last time: a step more help', text: 'BW − 32.5 lb × 10 · 10 · 10' });
    const e = [...sess('2026-08-01', -10, [8, 8]), ...sess('2026-08-05', -40, [12, 12]), ...sess('2026-08-07', -20, [12, 11]), ...sess('2026-09-01', -30, [10, 10, 10], sharp)];
    expect(nextTarget(e, DIPS, DEF, NEXT)).toMatchObject({ kind: 'ease', easeBy: 'help', weight: -nextRung(ladderOf(e, DIPS, 'home', true)!, 30) });
    expect(nextTarget(e, DIPS, DEF, NEXT)!.weight).toBe(-40);
  });

  it('sharp pain at bodyweight: the first rung of help when he has used help here, else a rep off each set (never below 1)', () => {
    const helped = [...sess('2026-08-01', -10, [8, 8]), ...sess('2026-08-05', -40, [12, 12]), ...sess('2026-08-07', -20, [12, 11]), ...sess('2026-09-01', 0, [10, 10, 10], sharp)];
    const first = nextRung(ladderOf(helped, DIPS, 'home', true)!, 0);
    expect(first).toBe(10);
    expect(nextTarget(helped, DIPS, DEF, NEXT)).toMatchObject({ kind: 'ease', easeBy: 'help', weight: -first, perSet: [10, 10, 10] });
    // Help used at another gym isn't help here.
    const elsewhere = helped.map((x) => (x.weight < 0 ? { ...x, gym: 'away' } : x));
    expect(nextTarget(elsewhere, DIPS, DEF, NEXT)).toMatchObject({ kind: 'ease', easeBy: 'reps', weight: 0 });
    expect(nextTarget(sess('2026-09-01', 0, [10, 1, 5], sharp), DIPS, DEF, NEXT))
      .toMatchObject({ kind: 'ease', easeBy: 'reps', weight: 0, perSet: [9, 1, 4], reps: 1, why: 'Sharp pain last time: one rep fewer a set', text: 'BW × 9 · 1 · 4' });
    // Nothing left to take off: held.
    expect(nextTarget(sess('2026-09-01', 0, [1, 1], sharp), DIPS, DEF, NEXT)).toMatchObject({ kind: 'hold', weight: 0, perSet: [1, 1] });
    // Moderate pain holds, as for any lift.
    expect(nextTarget(sess('2026-09-01', 0, [10, 10], { ...sharp, painSeverity: 2 }), DIPS, DEF, NEXT)).toMatchObject({ kind: 'hold', weight: 0, perSet: [10, 10] });
  });

  it('sharp pain with weight added: one step lighter, down to bodyweight and not past it', () => {
    expect(nextTarget(sess('2026-09-01', 25, [10, 10], { ...sharp, flags: ['pain'] }), DIPS, TYPED, NEXT))
      .toMatchObject({ kind: 'ease', easeBy: 'load', weight: 22.5, why: 'Sharp pain last time: one step lighter' });
    expect(nextTarget(sess('2026-09-01', 2.5, [10, 10], { ...sharp, flags: ['pain'] }), DIPS, TYPED, NEXT))
      .toMatchObject({ kind: 'ease', easeBy: 'load', weight: 0, text: 'BW × 10 · 10' });
  });

  it('at bodyweight with the range topped: the reps keep climbing, and it says the range is done', () => {
    const t = nextTarget(sess('2026-09-01', 0, [12, 12, 12]), DIPS, DEF, NEXT)!;
    expect(t).toMatchObject({ kind: 'reps', weight: 0, perSet: [13, 13, 13] });
    expect(t.why).toMatch(/ · range topped at bodyweight: add weight or a harder variation$/);
    expect(nextTarget(sess('2026-09-01', 0, [10, 9, 9]), DIPS, DEF, NEXT)!.why).not.toMatch(/range topped/);
  });

  it('a lift with no known share of the body is as before: weight 0 holds after sharp pain, and a topped range says nothing new', () => {
    const row = 'Inverted Row';
    const ST = { key: 'inverted row', repMin: 8, repMax: 12, increment: 5 };
    expect(nextTarget(sess('2026-09-01', 0, [10, 10], sharp, row), row, ST, NEXT)).toMatchObject({ kind: 'hold', weight: 0, perSet: [10, 10] });
    expect(nextTarget(sess('2026-09-01', 0, [12, 12], {}, row), row, ST, NEXT)!.why).not.toMatch(/range topped/);
    // Its help stays a note: a set at 0 is bodyweight.
    expect(nextTarget(sess('2026-09-01', 0, [12, 12], {}, row).map((x) => ({ ...x, note: 'assisted -30 lb' })), row, ST, NEXT)).toMatchObject({ weight: 0 });
  });
});

describe('testDue for a bodyweight lift (item 14)', () => {
  it('is a set at bodyweight to failure, at about the reps its level leaves fresh, in reps uncertainty, once its level is stale', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const sim = bodyLog(seed, { sessions: 30, order: 'mixed' });
      const today = addDays(sim.entries.at(-1)!.date, 3);
      // Sets near failure at bodyweight every session: the level is known better than a test would read it.
      expect(testDue(sim.entries, DIPS, today), `seed ${seed}`).toBeNull();
      // Weight added from the fifth session on: nothing reads the bodyweight level since, so it drifts out of date.
      const cut = [...new Set(sim.entries.map((e) => e.date))][4];
      const entries = sim.entries.map((e) => (e.exercise === DIPS && e.date >= cut ? { ...e, weight: 25, flags: [], reps: Math.max(1, (e.reps as number) - 6) } : e));
      const d = testDue(entries, DIPS, today)!;
      expect(d, `seed ${seed}`).not.toBeNull();
      const b = bodyStrengthOf(coreBefore(entries, addDays(today, 1))!, DIPS, today)!;
      expect(d).toMatchObject({ weight: 0, reps: Math.round(b.reps), u: b.u, jump: false });
      expect(d.reps).toBeGreaterThanOrEqual(1);
      expect(d.after).toBeLessThan(d.u / Math.SQRT2 + 1e-12); // at least halves the variance
      expect(d.body!.u).toBeCloseTo(b.repsSd, 9);
      expect(d.body!.after / d.body!.u).toBeCloseTo(d.after / d.u, 9);
    }
  });
});

describe('a set with help, everywhere else (item 14)', () => {
  it('reads BW−N wherever a set is written', () => {
    expect([fmtAdded(0), fmtAdded(-30), fmtAdded(25), fmtAdded(-12.5)]).toEqual(['BW', 'BW−30', '25', 'BW−12.5']);
    expect(fmtSet(set('2026-09-01', DIPS, -30, 10, 1))).toBe('BW−30 × 10');
    expect(fmtSession(sessionOn(sess('2026-09-01', -30, [10, 9]), '2026-09-01')!)).toBe(`${DIPS} 2×BW−30×10`);
  });
  it('is a bodyweight set: nothing in it is external load, so no e1RM', () => {
    expect(derivedFlags([], -30, 10)).toEqual(['bodyweight']);
    expect(derivedFlags([], 25, 10)).toEqual([]);
  });
  it('sets no rep record at bodyweight: reps with help aren’t reps at bodyweight, signed or kept in a note', () => {
    const bw = sess('2026-09-01', 0, [10, 9]);
    const helped = [...sess('2026-09-04', -30, [15, 14]), ...sess('2026-09-08', 0, [16, 15]).map((x) => ({ ...x, note: 'assisted -45 lb' }))];
    const r = records([...bw, ...helped], DIPS);
    expect(r.get('mostReps')).toMatchObject({ value: 10, set: bw[0] });
    expect(r.get('sessionReps')).toMatchObject({ value: 19, date: '2026-09-01' });
  });
  it('with weight added, sets the weight records on what’s added, but no e1RM or volume (the body’s share needs his body weight)', () => {
    const e = [...sess('2026-09-01', 25, [8, 8]), ...sess('2026-09-04', 35, [6, 5])];
    const r = records(e, DIPS);
    expect(r.get('heaviest')).toMatchObject({ value: 35 });
    expect(r.get('rm5')).toMatchObject({ value: 35 });
    for (const k of ['e1rm', 'setVolume', 'sessionVolume'] as const) expect(r.has(k), k).toBe(false);
    // A loaded lift keeps them all.
    expect(records(e.map((x) => ({ ...x, exercise: 'Bench Press' })), 'Bench Press').has('e1rm')).toBe(true);
  });
  it('says what moved: less help on the way up, the same load when the reps come down', () => {
    expect(suggest(sess('2026-09-01', -30, [12, 12, 12]), DIPS, TYPED, NEXT, null).reason).toMatch(/so 2\.5 lb less help\.$/);
    expect(suggest(sess('2026-09-01', 0, [10, 10, 10], sharp), DIPS, DEF, NEXT, null).reason)
      .toBe('Sharp pain last time: one rep fewer a set, the same load. Once it’s mild or gone, it builds back up from here.');
    expect(suggest(sess('2026-09-01', -30, [10, 10, 10], sharp), DIPS, TYPED, NEXT, null).reason).toMatch(/a step more help, the same reps\./);
  });
});
