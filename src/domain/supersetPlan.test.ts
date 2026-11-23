import { describe, expect, it } from 'vitest';
import { coldGaps } from './learn/switch';
import { lowOverlap, orderEffect, pairHistory, pairId, pairsFor, ORDER_K } from './supersetPlan';
import type { SetEntry } from './types';

// Synthetic only. Two low-overlap lifts (a pull and a push for the arms' other side), done as a superset: 60 s switches, 150 s
// after the round.
const A = 'Cable Pushdown', B = 'Seated Cable Row', P = 'Machine Chest Press';
let n = 0;
/** A superset day: `first` then the other, `rounds` rounds, at `gym`; `vs`: each set's reps against its target. */
function day(date: string, first: string, o: { gym?: string; rounds?: number; vs?: number; timed?: boolean } = {}): SetEntry[] {
  const other = first === A ? B : A, out: SetEntry[] = [];
  let t = 0;
  for (let r = 0; r < (o.rounds ?? 3); r++) for (const [k, ex] of [first, other].entries()) {
    n++;
    out.push({ id: `p${n}`, date, seq: n, exercise: ex, setNo: r + 1, weight: 100, reps: 10 + (o.vs ?? 0), flags: [], source: 'app',
      target: { weight: 100, reps: 10, sets: 3 }, ...(o.gym && { gym: o.gym }),
      ...(o.timed !== false && { loggedAt: new Date(Date.parse(`${date}T18:00:00`) + t * 1000).toISOString() }) });
    t += k === 0 ? 60 : 150;
  }
  return out;
}
const cold = coldGaps();
const plan = (log: SetEntry[], gym?: string, o: Partial<Parameters<typeof pairsFor>[2]> = {}) =>
  pairsFor([A, P, B], pairHistory(log, '2026-11-22', cold, gym), { sets: () => 3, ...o });

describe('suggested supersets (owner, 2026-11-22)', () => {
  it('a low-overlap pair he did together at this gym is suggested, at no other gym', () => {
    expect(lowOverlap(A, B)).toBe(true);
    expect(lowOverlap('Cable Pushdown', 'Overhead Cable Extension')).toBe(false);
    const log = day('2026-11-10', A, { gym: 'Home' });
    expect(plan(log, 'Home')).toMatchObject([{ id: pairId(A, B), lifts: [B, A], lastFirst: A, why: 'alternate', saves: null }]);
    expect(plan(log, 'Work')).toEqual([]);
    // A day with one of its sets at another gym is not this gym's.
    const mixed = day('2026-11-10', A, { gym: 'Home' }).map((e, i) => (i === 3 ? { ...e, gym: 'Work' } : e));
    expect(plan(mixed, 'Home')).toEqual([]);
  });
  it('the order alternates from last time; his swap holds; "Not today" leaves it out', () => {
    const log = [...day('2026-11-03', A), ...day('2026-11-10', B)];
    expect(plan(log)[0]).toMatchObject({ lifts: [A, B], lastFirst: B, why: 'alternate' });
    expect(plan(log, undefined, { swapped: { [pairId(A, B)]: 'seated cable row' } })[0]).toMatchObject({ lifts: [B, A], why: 'swapped' });
    expect(plan(log, undefined, { skip: new Set([pairId(A, B)]) })).toEqual([]);
  });
  it('the order effect is learned, shrunk to 0: a small sample alternates, a clear one picks the better order', () => {
    // Pushdown first went 1 rep a set better, twice each way: shrunk by 1/(1 + K) of the count, under the bar, so it alternates.
    const few = [...day('2026-10-01', A, { vs: 1 }), ...day('2026-10-05', B), ...day('2026-10-09', A, { vs: 1 }), ...day('2026-10-13', B)];
    const h = pairHistory(few, '2026-11-22', cold, undefined).get(pairId(A, B))!;
    const e = orderEffect(h);
    expect(e.effect).toBeCloseTo((h.keys[0] === 'cable pushdown' ? 1 : -1) * (1 / (1 + ORDER_K)), 6);
    expect(plan(few)[0]).toMatchObject({ why: 'alternate', lifts: [A, B] });
    // Eight each way at 2 reps: well past the bar, so pushdown first every time.
    const many: SetEntry[] = [];
    for (let i = 0; i < 16; i++) many.push(...day(`2026-0${1 + (i >> 1) % 9}-${String(10 + (i % 2) * 10).padStart(2, '0')}`, i % 2 ? B : A, { vs: i % 2 ? 0 : 2 }));
    const p = plan(many)[0];
    expect(p).toMatchObject({ why: 'effect', lifts: [A, B] });
    expect(p.effect).toBeGreaterThan(0.5);
  });
  it('"saves ~N min" only once 3 timed sessions back it, from his straight times against his rounds', () => {
    const straight = (name: string) => (name === A ? 240 : 300);
    const two = [...day('2026-11-03', A), ...day('2026-11-10', B)];
    expect(plan(two, undefined, { straight })[0].saves).toBeNull();
    const three = [...two, ...day('2026-11-17', A)];
    // A round is 210 s (60 + 150); straight they take 240 + 300: 330 s saved a round, 3 rounds: about 17 min.
    expect(plan(three, undefined, { straight })[0].saves).toBe(Math.round((3 * (540 - 210)) / 60));
    // No straight time of his own for one of them: unproven.
    expect(plan(three, undefined, { straight: (x) => (x === A ? 240 : null) })[0].saves).toBeNull();
  });
});
