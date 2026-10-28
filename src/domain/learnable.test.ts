process.env.TZ = 'America/New_York';
import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { learnable, e1rmSeries, sessionsByDate } from './stats';
import { prIds, prKinds, prToast, records } from './records';
import { calibratedE1rm, strength, strengthSeries } from './estimators';
import { defaultSettings, learnedFor, nextTarget, priorE1rm, rirOffset } from './progression';
import { setDrop, suggest } from './suggest';
import { bestSetPoints } from './statsCore';
import { liftGains } from './achievements';
import { coreBefore, learn } from './learn';
import { ladderOf } from './learn/ladder';

// Sets marked not used (SetEntry.excluded: an old machine's sets, More → Bar sets logged per side) are kept and shown, and
// every learner and record reads the log as if they weren't there. Each reader: the same answer with the set marked as
// without it, and a different one with it unmarked (so the case can tell).
let seq = 0;
const s = (date: string, weight: number, reps: number, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `t${seq}`, date, seq: seq++, exercise: 'Bench Press', setNo: 1, weight, reps, flags: [], source: 'app', loggedAt: `${date}T18:0${seq % 10}:00`, ...over,
});
const base: SetEntry[] = [];
for (const [i, d] of ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'].entries())
  base.push(s(d, 135 + 5 * i, 10, { rir: 2 }), s(d, 135 + 5 * i, 9), s(d, 135 + 5 * i, 8));
// The marked sets long before (an old spreadsheet's) or as the latest session: either way, nothing reads them.
const odd = (date: string) => [s(date, 300, 10, { source: 'xlsx', rir: 1 }), s(date, 280, 12, { source: 'xlsx' }), s(date, 280, 12, { source: 'xlsx' })];
const scenarios = ['2026-08-10', '2026-09-28'].map((d) => { const x = odd(d); return { marked: [...x.map((e) => ({ ...e, excluded: true as const })), ...base], unmarked: [...x, ...base] }; });
const marked = scenarios[0].marked;
const isEqual = (a: unknown, b: unknown) => { try { expect(a).toEqual(b); return true; } catch { return false; } };
const TODAY = '2026-10-01', EX = 'Bench Press', ST = defaultSettings(EX);

const readers: [string, (log: SetEntry[]) => unknown][] = [
  ['records', (log) => records(log, EX)],
  ['prKinds', (log) => prKinds(log)],
  ['prIds', (log) => [...prIds(log)].sort()],
  ['prToast', (log) => prToast(log, log[log.length - 1])],
  ['strength', (log) => strength(log, EX, TODAY)],
  ['strengthSeries', (log) => strengthSeries(log, EX, TODAY)],
  ['calibratedE1rm', (log) => calibratedE1rm(log, EX)],
  ['priorE1rm', (log) => priorE1rm(log, EX, TODAY)],
  ['rirOffset', (log) => rirOffset(log, EX)],
  ['nextTarget', (log) => nextTarget(log, EX, ST, TODAY)],
  ['suggest', (log) => suggest(log, EX, ST, TODAY, null)],
  ['setDrop', (log) => setDrop(log, EX, TODAY, 2)],
  ['learnedFor', (log) => learnedFor(log, EX, TODAY)],
  ['learn', (log) => learn(log).core.lifts.get('bench press')],
  ['coreBefore', (log) => coreBefore(log, TODAY)?.lifts.get('bench press')],
  ['ladderOf', (log) => ladderOf(log, EX)],
  ['e1rmSeries', (log) => e1rmSeries(log, EX)],
  ['bestSetPoints', (log) => bestSetPoints(log, EX, '2026-01-01', TODAY)],
  ['liftGains', (log) => liftGains(log, TODAY)],
];

describe('sets marked not used: every learner and record reads the log without them', () => {
  for (const [name, read] of readers) {
    it(name, () => {
      const without = read([...base]);
      for (const x of scenarios) expect(read(x.marked)).toEqual(without);
      // Unmarked, the same sets change what it reads in at least one place: the case can tell.
      expect(scenarios.some((x) => !isEqual(read(x.unmarked), without)), `${name} can't tell the sets apart`).toBe(true);
    });
  }
  it('History still has them', () => {
    expect(sessionsByDate(marked).flatMap((x) => x.sets).filter((e) => e.excluded)).toHaveLength(3);
  });
  it('learnable: the same array when nothing is marked, the log without the marked ones else', () => {
    expect(learnable(base)).toBe(base);
    expect(learnable(marked)).toEqual(base);
    expect(learnable(marked)).toBe(learnable(marked));
  });
});
