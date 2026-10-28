import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { painGate, regionRising } from './painPlan';
import { nextTarget } from './progression';

// Synthetic logs only. Round 20: the 24-hour response (a: Silbernagel 2007; Silbernagel & Crossley 2015, rules 3–4) and the
// trend of pain across sessions at the held load, on top of item 08's gate.
let seq = 0;
const s = (date: string, exercise: string, weight: number, reps: number, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `t${seq}`, date, seq: seq++, exercise, setNo: 1, weight, reps, flags: [], source: 't', ...over,
});
const sess = (date: string, exercise: string, w: number, reps: number[], over: Partial<SetEntry> = {}) =>
  reps.map((r, i) => s(date, exercise, w, r, { setNo: i + 1, ...(i === reps.length - 1 ? over : {}) }));
const m = (sev: 1 | 2 | 3 | undefined, morning?: SetEntry['morning'], region: SetEntry['painRegion'] = 'elbow'): Partial<SetEntry> =>
  ({ flags: ['pain'], painRegion: region, ...(sev && { painSeverity: sev }), ...(morning && { morning }) });
const PD = 'Cable Pushdown';
const OH = 'Overhead DB Triceps Extension';
const ST = { key: 'cable pushdown', repMin: 10, repMax: 15, increment: 5 };
const at = (date: string, over: Partial<SetEntry>, w = 110) => sess(date, PD, w, [15, 15, 15], over);
const next = (e: SetEntry[], date = '2026-09-20') => nextTarget(e, PD, ST, date)!;

describe('one session: the next morning decides', () => {
  it('moderate: settled holds, still sore holds, worse eases a step', () => {
    expect(next(at('2026-09-10', m(2, 'settled')))).toMatchObject({ kind: 'hold', weight: 110, why: 'Pain settled overnight: holding 110 lb' });
    expect(next(at('2026-09-10', m(2, 'sore')))).toMatchObject({ kind: 'hold', weight: 110, why: 'Still sore next morning: holding 110 lb' });
    expect(next(at('2026-09-10', m(2, 'worse')))).toMatchObject({ kind: 'ease', weight: 105, why: 'Worse next morning: one step lighter' });
  });
  it('mild: settled or unasked progresses, still sore holds, worse eases', () => {
    // The range topped the session before as well (owner, 2026-10-28: two sessions running).
    expect(next([...at('2026-09-06', {}), ...at('2026-09-10', m(1, 'settled'))])).toMatchObject({ kind: 'increase', weight: 115 });
    expect(next([...at('2026-09-06', {}), ...at('2026-09-10', m(1))])).toMatchObject({ kind: 'increase', weight: 115 });
    expect(next(at('2026-09-10', m(1, 'sore')))).toMatchObject({ kind: 'hold', weight: 110, why: 'Still sore next morning: holding 110 lb' });
    expect(next(at('2026-09-10', m(1, 'worse')))).toMatchObject({ kind: 'ease', weight: 105 });
  });
  it('sharp during is past the acceptable zone, settled or not', () => {
    expect(next(at('2026-09-10', m(3, 'settled')))).toMatchObject({ kind: 'ease', weight: 105, why: 'Sharp pain last time: one step lighter' });
  });
  it('a dismissed question is no answer: the same target as never asked (c)', () => {
    const history = (over: Partial<SetEntry>) => [...at('2026-09-06', m(2, over.morning)), ...at('2026-09-10', { ...m(2), ...over })];
    for (const sev of [1, 2, 3] as const) {
      const a = next(at('2026-09-10', m(sev, 'skipped'))), b = next(at('2026-09-10', m(sev)));
      expect({ ...a, last: [], pain: undefined }).toEqual({ ...b, last: [], pain: undefined });
    }
    const a = next(history({ morning: 'skipped' })), b = next(history({}));
    expect([a.kind, a.weight, a.why]).toEqual([b.kind, b.weight, b.why]);
  });
});

describe('the trend at the held load', () => {
  it('still sore after two sessions at this load eases a step; one sore after a settled one holds', () => {
    expect(next([...at('2026-09-06', m(2, 'sore')), ...at('2026-09-10', m(2, 'sore'))]))
      .toMatchObject({ kind: 'ease', weight: 105, why: 'Still sore next morning, twice: one step lighter' });
    expect(next([...at('2026-09-06', m(2, 'settled')), ...at('2026-09-10', m(2, 'sore'))])).toMatchObject({ kind: 'hold', weight: 110 });
    // The session before was lighter: not this load, so not the trend at it.
    expect(next([...at('2026-09-06', m(2, 'sore'), 100), ...at('2026-09-10', m(2, 'sore'))])).toMatchObject({ kind: 'hold', weight: 110 });
  });
  it('moderate twice with no answers: the same or worse eases; falling resumes progression', () => {
    expect(next(at('2026-09-10', m(2)))).toMatchObject({ kind: 'hold', weight: 110 });
    expect(next([...at('2026-09-06', m(2)), ...at('2026-09-10', m(2))]))
      .toMatchObject({ kind: 'ease', weight: 105, why: 'Moderate pain twice at this weight: one step lighter' });
    expect(next([...at('2026-09-06', m(2)), ...at('2026-09-10', m(2, 'sore'))])).toMatchObject({ kind: 'ease', weight: 105 }); // worse
    expect(next([...at('2026-09-06', m(1)), ...at('2026-09-10', m(2))])).toMatchObject({ kind: 'ease', weight: 105 }); // mild, then moderate: worse
    expect(next([...at('2026-09-06', m(2)), ...at('2026-09-10', m(1))])).toMatchObject({ kind: 'increase', weight: 115 }); // falling
    expect(next([...at('2026-09-06', m(2)), ...at('2026-09-10', {})])).toMatchObject({ kind: 'increase', weight: 115 }); // gone
    // The one before settled: it was tolerated, so this one is a first.
    expect(next([...at('2026-09-06', m(2, 'settled')), ...at('2026-09-10', m(2))])).toMatchObject({ kind: 'hold', weight: 110 });
    // Sharp, then moderate at the eased load: falling, held there.
    expect(next([...at('2026-09-06', m(3)), ...at('2026-09-10', m(2), 105)])).toMatchObject({ kind: 'hold', weight: 105 });
    // Moderate that settled, then moderate still sore: up a level, but the one before was tolerated: hold.
    expect(next([...at('2026-09-06', m(2, 'settled')), ...at('2026-09-10', m(2, 'sore'))])).toMatchObject({ kind: 'hold' });
  });
  it('pain of unknown size (an import) only holds (c), however often; an answer makes it known', () => {
    const imported = [...at('2026-09-06', m(undefined)), ...at('2026-09-10', m(undefined))];
    expect(next(imported)).toMatchObject({ kind: 'hold', weight: 110, why: 'Pain last time: hold until it’s mild or gone', pain: { unknown: true, why: 'unknown' } });
    const answered = [...at('2026-09-06', m(undefined, 'sore')), ...at('2026-09-10', m(undefined, 'sore'))];
    expect(next(answered)).toMatchObject({ kind: 'ease', weight: 105, why: 'Still sore next morning, twice: one step lighter' });
    // A known one after an unknown one: nothing known to compare with, so a hold.
    expect(next([...at('2026-09-06', m(undefined)), ...at('2026-09-10', m(2))])).toMatchObject({ kind: 'hold', weight: 110 });
  });
});

describe('the week-to-week rule (a: Silbernagel & Crossley 2015, rule 4)', () => {
  const ohLastWeek = (morning: SetEntry['morning'], sev: 1 | 2 = 2) => sess('2026-09-08', OH, 40, [12, 12], m(sev, morning)); // 12 days before
  const pdNow = at('2026-09-17', m(2, 'sore')); // 3 days before
  it('the region’s pain up on the week before eases a hold, across lifts', () => {
    expect(regionRising([...ohLastWeek('settled'), ...pdNow], 'elbow', '2026-09-20')).toBe(true);
    expect(next([...ohLastWeek('settled'), ...pdNow])).toMatchObject({ kind: 'ease', weight: 105, why: 'Elbow pain building week to week: one step lighter' });
  });
  it('not rising: no pain the week before, the same level, a lower one, another region, or pain of unknown size', () => {
    expect(regionRising(pdNow, 'elbow', '2026-09-20')).toBe(false);
    expect(next(pdNow)).toMatchObject({ kind: 'hold', weight: 110 });
    expect(regionRising([...ohLastWeek('sore'), ...pdNow], 'elbow', '2026-09-20')).toBe(false);
    expect(regionRising([...ohLastWeek('worse'), ...pdNow], 'elbow', '2026-09-20')).toBe(false);
    expect(regionRising([...sess('2026-09-08', 'Leg Extension', 100, [12], m(1, undefined, 'knee')), ...pdNow], 'elbow', '2026-09-20')).toBe(false);
    expect(regionRising([...sess('2026-09-08', OH, 40, [12], m(undefined)), ...pdNow], 'elbow', '2026-09-20')).toBe(false);
    // 15 days back is outside the two weeks.
    expect(regionRising([...sess('2026-09-05', OH, 40, [12], m(1)), ...pdNow], 'elbow', '2026-09-20')).toBe(false);
    expect(regionRising([...sess('2026-09-06', OH, 40, [12], m(1)), ...pdNow], 'elbow', '2026-09-20')).toBe(true);
  });
});

describe('spill-over and the next morning', () => {
  const base = at('2026-08-20', {});
  it('another lift’s pain that settled overnight holds nothing; still sore or worse holds, never eases', () => {
    expect(painGate([...base, ...sess('2026-09-18', OH, 40, [12], m(2, 'settled'))], PD, '2026-09-20')).toBeNull();
    expect(painGate([...base, ...sess('2026-09-18', OH, 40, [12], m(2, 'sore'))], PD, '2026-09-20')).toMatchObject({ kind: 'hold', spill: true });
    expect(painGate([...base, ...sess('2026-09-18', OH, 40, [12], m(2, 'worse'))], PD, '2026-09-20')).toMatchObject({ kind: 'hold', spill: true });
    expect(painGate([...base, ...sess('2026-09-18', OH, 40, [12], m(2))], PD, '2026-09-20')).toMatchObject({ kind: 'hold', spill: true });
  });
});

describe('bodyweight lifts ease by item 14’s steps', () => {
  it('a rep a set with no help known; a step more help where help is known', () => {
    const PU = 'Pull-up', st = { key: 'pull-up', repMin: 8, repMax: 12, increment: 5 };
    const e = [...sess('2026-09-06', PU, 0, [10, 10, 10], m(2, 'sore')), ...sess('2026-09-10', PU, 0, [10, 10, 10], m(2, 'sore'))];
    expect(nextTarget(e, PU, st, '2026-09-20')).toMatchObject({ kind: 'ease', weight: 0, perSet: [9, 9, 9], easeBy: 'reps', why: 'Still sore next morning, twice: one rep fewer a set' });
    expect(nextTarget(e.slice(3), PU, st, '2026-09-20')).toMatchObject({ kind: 'hold', weight: 0, why: 'Still sore next morning: holding BW' });
    const helped = [...sess('2026-09-06', PU, -30, [10, 10, 10], m(2, 'worse'))];
    expect(nextTarget(helped, PU, st, '2026-09-20')).toMatchObject({ kind: 'ease', weight: -35, easeBy: 'help', why: 'Worse next morning: a step more help' });
  });
});
