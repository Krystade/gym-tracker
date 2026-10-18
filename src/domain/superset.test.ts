import { describe, expect, it } from 'vitest';
import { supersets } from './superset';
import type { SetEntry } from './types';

const D = '2026-10-16';
const A = 'Cable Curl', B = 'Cable Pushdown', C = 'Lateral Raise', E = 'Face Pull', X = 'Hammer Curl';
let n = 0;
/**
 * Sets one after another on day D: a lift, then the seconds to the next, and so on. A lift ending in `*` is a warm-up;
 * one ending in `?` has no time (entered without one).
 */
function run(...steps: (string | number)[]): SetEntry[] {
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
    expect(day.map((s) => groups.find((g) => g.after.has(s.id))?.after.get(s.id))).toEqual([B, null, B, null, X, null, X, null]);
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
});
