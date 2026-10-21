import { describe, expect, it } from 'vitest';
import { addDays } from '../analytics';
import { supersets } from '../superset';
import type { SetEntry } from '../types';
import { rng } from './num';
import { coldGaps, gapModel, switchPrior, TRIAL_PAIR_REST } from './switch';
import { A, B, C, PROFILES, session, simulate, type Kind, type Profile } from './switchSim.sample';

// Item 15 on synthetic sessions with known truth (switchSim.sample). Every bar here is the test's own number.

const FROM = '2026-01-05';
const mixed = (_: number, r: ReturnType<typeof rng>): Kind => (r.next() < 0.5 ? 'superset' : r.next() < 0.5 ? 'alternate' : 'straight');
const only = (k: Kind) => () => k;
const pair = (gs: ReturnType<typeof supersets>) => gs.some((g) => g.keys.includes('cable curl') && g.keys.includes('cable pushdown'));
/** How often a day of `kind` is called a superset, `n` days, after `hist` days of his drawn by `kind0`. */
function rate(p: Profile, kind: Kind, n: number, hist: number, seed: number, kind0 = mixed): number {
  const log = hist ? simulate(p, FROM, hist, seed, kind0) : [];
  const T = addDays(FROM, 2 * hist), r = rng(seed + 1);
  let hits = 0;
  for (let k = 0; k < n; k++) {
    const all = [...log, ...session(p, kind, T, r)];
    hits += +pair(supersets(all, T, gapModel(all, T)));
  }
  return hits / n;
}

describe('the trials’ switch (cold start)', () => {
  it('is Zhang 2025’s 19 trials, the set included: about 0:45, SD about 0.24 in logs', () => {
    expect(TRIAL_PAIR_REST).toHaveLength(19);
    const { mu, sd } = switchPrior();
    expect(Math.exp(mu)).toBeGreaterThan(43);
    expect(Math.exp(mu)).toBeLessThan(47);
    expect(sd).toBeGreaterThan(0.2);
    expect(sd).toBeLessThan(0.3);
    // No log: research alone, every group at even odds.
    expect(coldGaps().prior(['a', 'b'])).toBe(0.5);
  });
});

describe('over the research sim’s 27 lifters', () => {
  it('finds his supersets and leaves his alternated sets alone, once 12 sessions are learned', () => {
    let sup = 0, alt = 0, str = 0;
    PROFILES.forEach((p, i) => {
      sup += rate(p, 'superset', 8, 12, 100 + i);
      alt += rate(p, 'alternate', 8, 12, 100 + i);
      str += rate(p, 'straight', 4, 12, 100 + i);
    });
    const n = PROFILES.length;
    // Measured at 0.74 / 0.03 / 0 (the rule it replaced: 0.79 / 0.17 / 0).
    expect(sup / n).toBeGreaterThan(0.65);
    expect(alt / n).toBeLessThan(0.06);
    expect(str).toBe(0);
  });

  it('cold, calls few alternated days supersets', () => {
    let alt = 0;
    PROFILES.forEach((p, i) => { alt += rate(p, 'alternate', 6, 0, 200 + i); });
    expect(alt / PROFILES.length).toBeLessThan(0.06); // measured 0.02 (the rule it replaced: 0.23)
  });

  it('learns a slow switcher the trials miss', () => {
    const p = { walk: 35, set: 45, rest: 120 }; // 80 s a switch with the set, 165 s a rest
    expect(rate(p, 'superset', 10, 0, 7)).toBeLessThan(0.5);
    expect(rate(p, 'superset', 10, 12, 7, only('superset'))).toBeGreaterThan(0.9);
  });
});

describe('what it learns', () => {
  it('his rest per lift and his switch, from known truth', () => {
    const p = { walk: 20, set: 40, rest: 120 };
    const m = gapModel(simulate(p, FROM, 20, 3, only('superset')), addDays(FROM, 40));
    // The pair's switch: walk and set, 60 s (a little toward the trials' 45).
    expect(m.switchSeconds(A, B)).toBeGreaterThan(52);
    expect(m.switchSeconds(A, B)).toBeLessThan(66);
    expect(m.switchSeconds(B, A)).toBe(m.switchSeconds(A, B)); // either way round
    // The bench's rest: 120 and the set, 160 s.
    const bench = Math.exp(m.rest(C).mean);
    expect(bench).toBeGreaterThan(140);
    expect(bench).toBeLessThan(180);
    expect(m.rate).toBeGreaterThan(0.65); // measured 0.75: late logging leaves some of his rounds unclear
    // A lifter who only ever alternates them, a full rest each way: under even odds, and none of his days a superset.
    expect(gapModel(simulate(p, FROM, 20, 3, only('alternate')), addDays(FROM, 40)).rate).toBeLessThan(0.5);
    expect(rate(p, 'alternate', 10, 20, 3, only('alternate'))).toBe(0);
    // Lifts never alternated offer no group: his rate stays at even odds (Jeffreys), and no group is ever judged by it.
    expect(gapModel(simulate(p, FROM, 20, 3, only('straight')), addDays(FROM, 40)).rate).toBe(0.5);
  });

  it('a slow day reads slow: its switch is longer', () => {
    const p = { walk: 20, set: 40, rest: 120 };
    const m = gapModel(simulate(p, FROM, 30, 4, mixed, 0.3), addDays(FROM, 60));
    expect(m.tau).toBeGreaterThan(0.1);
    const rests = (s: number) => [{ from: C, to: C, seconds: s }, { from: C, to: C, seconds: s }];
    expect(m.switchSeconds(A, B, { rests: rests(260) })).toBeGreaterThan(m.switchSeconds(A, B) * 1.1);
    expect(m.switchSeconds(A, B, { rests: rests(110) })).toBeLessThan(m.switchSeconds(A, B));
    // Today's own switches of the pair move it: a lot with none learned, a little against 30 sessions of his.
    const today = { switches: [{ from: A, to: B, seconds: 120 }, { from: B, to: A, seconds: 120 }] };
    expect(coldGaps().switchSeconds(A, B, today)).toBeGreaterThan(90);
    expect(m.switchSeconds(A, B, today)).toBeGreaterThan(m.switchSeconds(A, B));
    expect(m.switchSeconds(A, B, today) - m.switchSeconds(A, B)).toBeLessThan(coldGaps().switchSeconds(A, B, today) - coldGaps().switchSeconds(A, B));
  });

  it('a layoff widens it: the same sessions, read a season later', () => {
    const log = simulate({ walk: 20, set: 40, rest: 120 }, FROM, 20, 5, mixed);
    const soon = gapModel(log, addDays(FROM, 40)), late = gapModel(log, addDays(FROM, 160));
    expect(late.rest(C).sd).toBeGreaterThan(soon.rest(C).sd);
    expect(late.switch(A, B).sd).toBeGreaterThan(soon.switch(A, B).sd);
  });

  it('learns no switch from a group marked “Not a superset”, which counts against his rate', () => {
    const log = simulate({ walk: 20, set: 40, rest: 120 }, FROM, 6, 6, only('superset'));
    const T = addDays(FROM, 12), dates = [...new Set(log.map((e) => e.date))];
    const all = Object.fromEntries(dates.map((d) => [d, [['cable curl', 'cable pushdown']]]));
    const m = gapModel(log, T, all);
    expect(m.switches).toBe(0);
    expect(m.switchSeconds(A, B)).toBeCloseTo(coldGaps().switchSeconds(A, B), 6);
    expect(m.rate).toBeLessThan(gapModel(log, T).rate);
    expect(m.prior(['cable curl', 'cable pushdown'])).toBeLessThan(0.2);
  });
});

describe('what a gap can say', () => {
  const p = { walk: 20, set: 40, rest: 120 };
  const learned = () => simulate(p, FROM, 12, 8, only('straight'));
  const at = (D: string, ...steps: (string | number)[]): SetEntry[] => {
    let t = 0, n = 0;
    const out: SetEntry[] = [];
    for (const s of steps) {
      if (typeof s === 'number') { t += s; continue; }
      out.push({ id: `g|${D}|${n}`, date: D, seq: n, exercise: s, setNo: ++n, weight: 50, reps: 10, flags: [], source: 'app', loggedAt: new Date(Date.parse(`${D}T18:00:00Z`) + t * 1000).toISOString() });
    }
    return out;
  };
  const T = addDays(FROM, 24);

  it('one quick switch among full rests is not a superset: the rounds add up', () => {
    const log = learned(), day = at(T, A, 160, B, 160, A, 50, B, 160, A, 160, B);
    expect(supersets([...log, ...day], T, gapModel(log, T))).toEqual([]);
    // Every switch quick: one.
    const sup = at(T, A, 60, B, 160, A, 60, B, 160, A, 60, B);
    expect(supersets([...log, ...sup], T, gapModel(log, T)).map((g) => g.keys)).toEqual([['cable curl', 'cable pushdown']]);
  });

  it('says nothing where a time is a guess (entered late or edited)', () => {
    const day = at(T, A, 60, B, 160, A, 60, B, 160, A, 60, B).map((e) => ({ ...e, enteredAt: '2026-02-01T00:00:00.000Z' }));
    expect(supersets(day, T, coldGaps())).toEqual([]);
  });

  it('two lifts only ever alternated, quicker than research’s rest: read as a superset until he says it isn’t one', () => {
    // No rest of either lift to tell his switch from: the gaps teach the switch. "Not a superset" undoes it.
    const days = Array.from({ length: 8 }, (_, i) => addDays(FROM, 2 * i));
    const log = days.flatMap((d) => at(d, A, 100, B, 100, A, 100, B, 100, A, 100, B));
    const day = at(T, A, 100, B, 100, A, 100, B);
    expect(supersets([...log, ...day], T, gapModel(log, T))).toHaveLength(1);
    const no = Object.fromEntries(days.map((d) => [d, [['cable curl', 'cable pushdown']]]));
    expect(supersets([...log, ...day], T, gapModel(log, T, no))).toEqual([]);
  });

  it('a gap past his rest is never evidence for a switch', () => {
    const m = gapModel(learned(), T), d = m.day([]);
    for (const s of [200, 300, 500]) expect(d.llr(A, B, s)).toBeLessThanOrEqual(0);
    expect(d.llr(A, B, 60)).toBeGreaterThan(0);
  });
});

describe('fitting', () => {
  it('reads only the days before today, and reuses the fit while today’s sets are logged', () => {
    const log = simulate({ walk: 20, set: 40, rest: 120 }, FROM, 12, 9, mixed), T = addDays(FROM, 24);
    const m = gapModel(log, T);
    const today = session({ walk: 20, set: 40, rest: 120 }, 'superset', T, rng(1));
    expect(gapModel([...log, ...today.slice(0, 4)], T)).toBe(m);
    expect(gapModel([...log, ...today], T)).toBe(m);
    // A past day edited: a new fit.
    const edited = log.map((e, i) => (i === 3 ? { ...e, loggedAt: new Date(Date.parse(e.loggedAt!) + 30_000).toISOString() } : e));
    expect(gapModel(edited, T)).not.toBe(m);
  });
});
