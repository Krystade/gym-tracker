import { describe, expect, it } from 'vitest';
import { lastSupersets, nextAfter, supersets } from './superset';
import { paces, restAfter } from './timing';
import type { SetEntry } from './types';

const D = '2026-10-16';
const A = 'Cable Curl', B = 'Cable Pushdown', C = 'Lateral Raise', E = 'Face Pull', X = 'Hammer Curl';
let n = 0;
/**
 * Sets one after another on day D: a lift, then the seconds to the next, and so on. A lift ending in `*` is a warm-up;
 * one ending in `?` has no time (entered without one).
 */
const run = (...steps: (string | number)[]): SetEntry[] => runOn(D, ...steps);
/** The same on another day. */
function runOn(D: string, ...steps: (string | number)[]): SetEntry[] {
  let t = 0;
  const out: SetEntry[] = [];
  for (const s of steps) {
    if (typeof s === 'number') { t += s; continue; }
    const warm = s.endsWith('*'), untimed = s.endsWith('?');
    n++;
    out.push({
      id: `s${n}`, date: D, seq: n, exercise: s.replace(/[*?]$/, ''), setNo: n, weight: 50, reps: 10, flags: warm ? ['warmup'] : [], source: 'app',
      ...(!untimed && { loggedAt: new Date(Date.parse(`${D}T18:00:00`) + t * 1000).toISOString() }),
    });
  }
  return out;
}
/** No pace learned yet: 2:00 rest plus the set. */
const usual = () => 160;
const afters = (day: SetEntry[], i = 0) => day.map((s) => supersets(day, D, usual)[i]?.after.get(s.id));

describe('supersets', () => {
  it('finds a pair from A B A: the switch well inside the usual rest, the full rest after the second lift', () => {
    const day = run(A, 60, B, 150, A, 60, B, 150, A, 60, B);
    const groups = supersets(day, D, usual);
    expect(groups.map((g) => [g.lifts, g.live])).toEqual([[[A, B], true]]);
    expect(afters(day)).toEqual([B, null, B, null, B, null]);
  });

  it('needs the first lift back: A then B alone is not one yet', () => {
    expect(supersets(run(A, 60, B), D, usual)).toEqual([]);
    expect(supersets(run(A, 60, B, 150, A), D, usual).map((g) => g.lifts)).toEqual([[A, B]]);
  });

  it('finds a tri-set: a switch after each of the first two lifts, the full rest after the third', () => {
    const day = run(A, 60, B, 60, C, 150, A, 60, B, 60, C);
    expect(supersets(day, D, usual).map((g) => g.lifts)).toEqual([[A, B, C]]);
    expect(afters(day)).toEqual([B, C, null, B, C, null]);
    // A round in another order: after the first lift, the one next in order; after the second, the one still to go.
    const mixed = run(A, 60, B, 60, C, 150, A, 60, C, 60, B);
    expect(afters(mixed)).toEqual([B, C, null, B, B, null]);
  });

  it('finds a circuit of four, rested once a round or not at all', () => {
    const day = run(A, 50, B, 50, C, 50, E, 150, A, 50, B, 50, C, 50, E);
    expect(supersets(day, D, usual).map((g) => g.lifts)).toEqual([[A, B, C, E]]);
    expect(afters(day)).toEqual([B, C, E, null, B, C, E, null]);
    const flat = run(A, 50, B, 50, C, 50, A, 50, B, 50, C);
    expect(supersets(flat, D, usual).map((g) => g.lifts)).toEqual([[A, B, C]]);
  });

  it('starts the round after its rest, wherever the day picked it up', () => {
    // A once, a full rest, then B and A back to back: the round is B then A.
    const day = run(A, 150, B, 60, A, 150, B, 60, A);
    expect(supersets(day, D, usual).map((g) => g.lifts)).toEqual([[B, A]]);
    expect(afters(day)).toEqual([undefined, A, null, A, null]);
  });

  it('is not moving on to the next lift, however quickly, nor going back to one', () => {
    expect(supersets(run(A, 150, A, 150, A, 180, B, 150, B, 150, B, 180, C, 150, C), D, usual)).toEqual([]);
    expect(supersets(run(A, 150, A, 150, A, 45, B, 150, B, 150, B), D, usual)).toEqual([]);
    // Back for a forgotten set after moving on.
    expect(supersets(run(A, 150, A, 150, A, 180, B, 150, B, 150, B, 150, A), D, usual)).toEqual([]);
    // One set of B and back to A, a full rest each way.
    expect(supersets(run(A, 150, A, 180, B, 150, A, 150, A), D, usual)).toEqual([]);
    // Two sets of B in between: not going round.
    expect(supersets(run(A, 60, B, 60, B, 150, A), D, usual)).toEqual([]);
  });

  it('is not alternating two lifts with a full rest each way', () => {
    expect(supersets(run(A, 150, B, 150, A, 150, B, 150, A), D, usual)).toEqual([]);
    // A quick switch, then a 15-minute break before A again: a break, not a round's rest.
    expect(supersets(run(A, 60, B, 900, A, 60, B), D, usual)).toEqual([]);
  });

  it('ignores warm-ups: they neither break a superset nor make one', () => {
    const day = run(`${A}*`, 40, `${A}*`, 60, A, 30, `${B}*`, 40, B, 150, A, 60, B);
    const [g, ...more] = supersets(day, D, usual);
    expect(more).toEqual([]);
    expect(g.lifts).toEqual([A, B]);
    expect(day.filter((s) => s.flags.includes('warmup')).some((s) => g.after.has(s.id))).toBe(false);
    // B's warm-ups slipped in between A's sets.
    expect(supersets(run(A, 50, `${B}*`, 60, A, 50, `${B}*`, 60, A), D, usual)).toEqual([]);
  });

  it('keeps a round done the other way round, switching after the first lift of it', () => {
    const day = run(A, 60, B, 150, A, 60, B, 150, B, 60, A, 150, A, 60, B);
    expect(supersets(day, D, usual).map((g) => g.lifts)).toEqual([[A, B]]);
    expect(afters(day)).toEqual([B, null, B, null, A, null, B, null]);
  });

  it('follows a lift swapped in partway: the new pair takes over', () => {
    const day = run(A, 60, B, 150, A, 60, B, 150, A, 60, X, 150, A, 60, X);
    const groups = supersets(day, D, usual);
    expect(groups.map((g) => [g.lifts, g.live])).toEqual([[[A, B], false], [[A, X], true]]);
    expect(day.map((s) => nextAfter(groups, s.id))).toEqual([B, null, B, null, X, null, X, null]);
  });

  it('judges "well inside the rest" by the lift’s own usual time between sets', () => {
    const day = run(A, 70, B, 150, A, 70, B);
    expect(supersets(day, D, () => 160)).toHaveLength(1); // 70 s against 2:40
    expect(supersets(day, D, (ex) => (ex === A ? 100 : 160))).toEqual([]); // 70 s against A's 1:40 is a normal rest
  });

  it('stays for the rest of the day once found, through other lifts and straight sets', () => {
    const day = run(A, 60, B, 150, A, 60, B, 150, A, 60, B, 300, C, 150, C, 150, A, 150, A);
    expect(supersets(day, D, usual).map((g) => [g.lifts, g.live])).toEqual([[[A, B], true]]);
  });

  it('rests after a lift once the other’s planned sets are done, or once it comes twice running', () => {
    const day = run(A, 60, B, 150, A, 60, B, 150, A, 60, B, 150, A);
    const last = day.at(-1)!.id;
    expect(supersets(day, D, usual, { planned: (ex) => (ex === B ? 3 : 4) })[0].after.get(last)).toBeNull();
    // No plan to go by: B is next until A comes again with no B between.
    expect(supersets(day, D, usual)[0].after.get(last)).toBe(B);
    const more = [...day, ...run(A).map((s) => ({ ...s, loggedAt: new Date(Date.parse(day.at(-1)!.loggedAt!) + 150_000).toISOString() }))];
    expect(supersets(more, D, usual)[0].after.get(more.at(-1)!.id)).toBeNull();
  });

  it('takes a lift left out of a round back into it once it’s done again', () => {
    // A tri-set; a round goes A B A (Face Pull's turn skipped), and Face Pull comes back later.
    const day = run(A, 60, B, 60, C, 150, A, 60, B, 150, A, 60, B, 150, C, 60, A, 60, B, 150, A, 60, B, 60, C);
    expect(afters(day)).toEqual([B, C, null, B, C, B, null, A, B, null, B, C, null]);
  });

  it('leaves out a group marked “not a superset” that day, and any part of it', () => {
    expect(supersets(run(A, 60, B, 150, A), D, usual, { dismissed: [['cable curl', 'cable pushdown']] })).toEqual([]);
    expect(supersets(run(A, 60, B, 150, A), D, usual, { dismissed: [['cable pushdown', 'cable curl', 'lateral raise']] })).toEqual([]);
    expect(supersets(run(A, 60, C, 150, A), D, usual, { dismissed: [['cable curl', 'cable pushdown']] }).map((g) => g.lifts)).toEqual([[A, C]]);
  });

  it('is not sets entered back to back, seconds apart', () => {
    expect(supersets(run(A, 5, B, 8, A, 5, B), D, usual)).toEqual([]);
  });

  it('reads only sets with a time, on that day', () => {
    expect(supersets(run(`${A}?`, 60, `${B}?`, 150, `${A}?`), D, usual)).toEqual([]);
    expect(supersets(run(A, 60, B, 150, A), '2026-10-17', usual)).toEqual([]);
  });

  it('times each position of a round: a switch after every lift with another to go, the lift’s full rest after the last', () => {
    const timers = (day: SetEntry[], p = paces([])) => {
      const groups = supersets(day, D, usual);
      return day.map((s) => restAfter(p, s.exercise, nextAfter(groups, s.id)).seconds);
    };
    // Nothing learned: 0:20 switches, 2:00 rests. A pair, a tri-set, a circuit of four.
    expect(timers(run(A, 60, B, 150, A, 60, B))).toEqual([20, 120, 20, 120]);
    expect(timers(run(A, 60, B, 60, C, 150, A, 60, B, 60, C))).toEqual([20, 20, 120, 20, 20, 120]);
    expect(timers(run(A, 50, B, 50, C, 50, E, 150, A, 50, B, 50, C, 50, E))).toEqual([20, 20, 20, 120, 20, 20, 20, 120]);
    // Not a superset: every set gets the full rest.
    expect(timers(run(A, 150, A, 150, A, 180, B, 150, B))).toEqual([120, 120, 120, 120, 120]);
    // A learned switch of 1:15 (less the set), and the research default's 2:00 after the round whatever the pace.
    const p = { perSet: new Map([['cable pushdown', 140]]), transition: 120, superSwitch: 75 };
    expect(timers(run(A, 60, B, 150, A, 60, B), p)).toEqual([35, 120, 35, 120]);
  });
});

describe('supersets carried over from last session', () => {
  const LAST = '2026-10-09', BEFORE = '2026-10-02';
  /** Last week's pair, alternated: curls and pushdowns. */
  const pair = () => runOn(LAST, A, 60, B, 150, A, 60, B);
  const lastFor = (entries: SetEntry[], lifts: string[], dismissedOn?: (date: string) => string[][]) =>
    lastSupersets(entries, D, usual, { lifts, dismissedOn }).map((g) => g.lifts);
  /** Today's groups, with what last session carries for today's lifts. */
  const today = (past: SetEntry[], day: SetEntry[], lifts: string[], o: { dismissed?: string[][]; planned?: (ex: string) => number | null } = {}) =>
    supersets([...past, ...day], D, usual, { ...o, carried: lastSupersets([...past, ...day], D, usual, { lifts }) });
  const after = (past: SetEntry[], day: SetEntry[], lifts: string[]) => {
    const groups = today(past, day, lifts);
    return day.map((s) => nextAfter(groups, s.id));
  };

  it('finds last session’s groups for a session with all of their lifts', () => {
    expect(lastFor(pair(), [A, B])).toEqual([[A, B]]);
    expect(lastFor(pair(), [B, C, A])).toEqual([[A, B]]);
    expect(lastFor(pair(), [A])).toEqual([]); // the pushdown isn't in today's session
    expect(lastFor(pair(), [])).toEqual([]);
    // Today's names as typed: case and spacing don't matter.
    expect(lastFor(pair(), ['cable curl', ' Cable  Pushdown'])).toEqual([[A, B]]);
    // A tri-set comes in its round order.
    expect(lastFor(runOn(LAST, A, 60, B, 60, C, 150, A, 60, B, 60, C), [C, B, A])).toEqual([[A, B, C]]);
  });

  it('only from the last session of those lifts: one since that did them separately carries nothing', () => {
    const apart = runOn('2026-10-12', A, 150, A, 150, A, 180, B, 150, B);
    expect(lastFor([...pair(), ...apart], [A, B])).toEqual([]);
    // Untimed, it can't say: still the last session of them.
    expect(lastFor([...pair(), ...runOn('2026-10-12', `${A}?`, 60, `${B}?`)], [A, B])).toEqual([]);
    // Only warm-ups of one of them: not a session of both.
    expect(lastFor([...pair(), ...runOn('2026-10-12', A, 150, A, 150, `${B}*`)], [A, B])).toEqual([[A, B]]);
    // A session since with only one of them leaves the pair's last session as it was.
    expect(lastFor([...pair(), ...runOn('2026-10-12', A, 150, A, 150, A)], [A, B])).toEqual([[A, B]]);
    // An older pair, then a session of them done separately: nothing to carry.
    expect(lastFor([...runOn(BEFORE, A, 60, B, 150, A, 60, B), ...runOn(LAST, A, 150, A, 180, B, 150, B)], [A, B])).toEqual([]);
  });

  it('carries the group a session ended with, not one a lift swapped in took over from', () => {
    const swapped = runOn(LAST, A, 60, B, 150, A, 60, B, 150, A, 60, X, 150, A, 60, X);
    expect(lastFor(swapped, [A, B, X])).toEqual([[A, X]]);
  });

  it('leaves out a group marked “not a superset” that day', () => {
    expect(lastFor(pair(), [A, B], (d) => (d === LAST ? [['cable curl', 'cable pushdown']] : []))).toEqual([]);
    expect(lastFor(pair(), [A, B], (d) => (d === BEFORE ? [['cable curl', 'cable pushdown']] : []))).toEqual([[A, B]]);
  });

  it('looks back 8 weeks at most, and never at the day itself or after it', () => {
    expect(lastFor(runOn('2026-08-21', A, 60, B, 150, A, 60, B), [A, B])).toEqual([[A, B]]);
    expect(lastFor(runOn('2026-08-20', A, 60, B, 150, A, 60, B), [A, B])).toEqual([]);
    expect(lastFor(run(A, 60, B, 150, A, 60, B), [A, B])).toEqual([]);
    expect(lastFor(runOn('2026-10-17', A, 60, B, 150, A, 60, B), [A, B])).toEqual([]);
  });

  it('newest first, each from its own last session', () => {
    const older = runOn(BEFORE, A, 60, B, 150, A, 60, B), newer = runOn(LAST, A, 60, C, 150, A, 60, C);
    expect(lastFor([...older, ...newer], [A, B, C])).toEqual([[A, C], [A, B]]);
  });

  it('switches from the very first set today, the full rest after the round', () => {
    expect(after(pair(), run(A), [A, B])).toEqual([B]);
    expect(after(pair(), run(A, 60, B), [A, B])).toEqual([B, null]);
    expect(today(pair(), run(A), [A, B]).map((g) => [g.lifts, g.live])).toEqual([[[A, B], true]]);
    // In force before any set: the cards can say so.
    expect(today(pair(), [], [A, B]).map((g) => g.lifts)).toEqual([[A, B]]);
    // Not without last session's.
    expect(after([], run(A), [A, B])).toEqual([undefined]);
    // A tri-set; and a round begun on another lift of it.
    const tri = runOn(LAST, A, 60, B, 60, C, 150, A, 60, B, 60, C);
    expect(after(tri, run(A, 60, B, 60, C), [A, B, C])).toEqual([B, C, null]);
    expect(after(pair(), run(B, 60, A), [A, B])).toEqual([A, null]);
    // Other lifts before it neither start nor stop it.
    expect(after(pair(), run(C, 150, C, 180, A), [A, B, C])).toEqual([undefined, undefined, B]);
    // Warm-ups on the way to the next lift don't stop it.
    expect(after(pair(), run(A, 20, `${B}*`, 40, B), [A, B])).toEqual([B, undefined, null]);
  });

  it('times the first round as the switch and the full rest', () => {
    const day = run(A, 60, B);
    const g = today(pair(), day, [A, B]);
    expect(day.map((s) => restAfter(paces([]), s.exercise, nextAfter(g, s.id)).seconds)).toEqual([20, 120]);
  });

  it('goes by today’s plan: a lift whose planned sets are done is out of the round', () => {
    const day = run(A, 60, B, 150, A);
    const g = today(pair(), day, [A, B], { planned: (ex) => (ex === B ? 1 : 3) });
    expect(day.map((s) => nextAfter(g, s.id))).toEqual([B, null, null]);
  });

  it('gives way to today’s own sets: the same lift again, another lift, or a full rest where the switch was due', () => {
    // Straight sets of curls: after the second, the group is gone, and the pushdowns get their own rest.
    expect(after(pair(), run(A, 150, A), [A, B])).toEqual([undefined, undefined]);
    expect(today(pair(), run(A, 150, A, 150, A, 180, B), [A, B])).toEqual([]);
    // On to another lift where the switch was due.
    expect(after(pair(), run(A, 60, C), [A, B, C])).toEqual([undefined, undefined]);
    // The switch taken as a full rest.
    expect(after(pair(), run(A, 150, B), [A, B])).toEqual([undefined, undefined]);
    // The same lift after the round's rest is a new round, not straight sets.
    expect(after(pair(), run(A, 60, B, 150, B), [A, B])).toEqual([B, null, A]);
  });

  it('gives way to a group today’s own alternation finds', () => {
    const day = run(A, 60, X, 150, A, 60, X);
    expect(today(pair(), day, [A, B, X]).map((g) => g.lifts)).toEqual([[A, X]]);
    // The same group found again today is one group, not two.
    expect(today(pair(), run(A, 60, B, 150, A, 60, B), [A, B]).map((g) => g.lifts)).toEqual([[A, B]]);
  });

  it('stays out once marked “not a superset” today, and the next one back takes its place', () => {
    expect(today(pair(), run(A), [A, B], { dismissed: [['cable curl', 'cable pushdown']] })).toEqual([]);
    expect(today(pair(), run(A), [A, B], { dismissed: [['cable curl', 'cable pushdown', 'lateral raise']] })).toEqual([]);
    const past = [...runOn(BEFORE, A, 60, B, 150, A, 60, B), ...runOn(LAST, A, 60, C, 150, A, 60, C)];
    expect(today(past, run(A), [A, B, C]).map((g) => g.lifts)).toEqual([[A, C]]);
    expect(today(past, run(A), [A, B, C], { dismissed: [['cable curl', 'lateral raise']] }).map((g) => g.lifts)).toEqual([[A, B]]);
  });
});
