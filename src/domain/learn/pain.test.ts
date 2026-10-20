import { describe, expect, it } from 'vitest';
import type { SetEntry } from '../types';
import { addDays } from '../analytics';
import { HALF_LIVES, painFit, painRisk, zoneOf } from './pain';
import { painLog, PAIN_LIFTS, type PainTruth } from './painSim.sample';

const set = (over: Partial<SetEntry>): SetEntry => ({ id: `s${Math.random()}`, date: '2026-09-01', seq: 0, exercise: 'Cable Pushdown', setNo: 1, weight: 50, reps: 10, flags: [], source: 't', ...over });
const last = (es: readonly SetEntry[]) => es.reduce((a, e) => (e.date > a ? e.date : a), '');
/** The posterior mean of log2 h. */
const log2h = (entries: readonly SetEntry[]) => painFit(entries).h.reduce((a, [h, w]) => a + w * Math.log2(h), 0);

describe('zoneOf: the pain-monitoring zones (item 08, a: Silbernagel & Crossley 2015)', () => {
  it('no pain, mild, moderate, sharp: the worst set of the day; a pain set without a severity reads as moderate', () => {
    expect(zoneOf([set({})])).toBe(0);
    expect(zoneOf([set({ flags: ['pain'], painSeverity: 1 })])).toBe(1);
    expect(zoneOf([set({ flags: ['pain'], painSeverity: 1 }), set({ flags: ['pain'], painSeverity: 2 })])).toBe(2);
    expect(zoneOf([set({ flags: ['pain'] })])).toBe(2);
    expect(zoneOf([set({ flags: ['pain'], painSeverity: 3 }), set({ flags: ['pain'] })])).toBe(3);
    // A severity left on a set no longer flagged pain is not pain.
    expect(zoneOf([set({ painSeverity: 3 })])).toBe(0);
  });
});

describe('painFit: how likely a lift is to hurt next time (item 08, b: person → region → lift, prequential)', () => {
  const T: PainTruth = { base: 0.03, own: 0.6, region: 0.25, h: 28 };
  it('learns how fast pain fades: a short half-life from a short-lived history, a long one from a long-lived one', () => {
    let right = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const fast = log2h(painLog(seed, { sessions: 300, truth: { ...T, h: 14 } }).entries);
      const slow = log2h(painLog(seed, { sessions: 300, truth: { ...T, h: 112 } }).entries);
      if (fast < slow) right++;
      expect(Math.abs(fast - Math.log2(14)), `seed ${seed} fast`).toBeLessThan(1.5);
      expect(Math.abs(slow - Math.log2(112)), `seed ${seed} slow`).toBeLessThan(1.5);
    }
    expect(right).toBe(6);
  });
  it('predicts pain better than his overall rate when pain recurs, and no worse when it is only chance', () => {
    let gain = 0, loss = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const recur = painFit(painLog(seed, { sessions: 300, truth: T }).entries);
      gain += recur.logScore - recur.flatScore;
      const chance = painFit(painLog(seed, { sessions: 300, truth: { base: 0.08, own: 0, region: 0, h: 28 } }).entries);
      loss += chance.logScore - chance.flatScore;
    }
    expect(gain / 4).toBeGreaterThan(5); // nats per log: recurrence is real and learned
    expect(loss / 4).toBeGreaterThan(-4); // the cost of the extra parameters when there is nothing to learn
  });
  it('its probabilities are calibrated: the predicted pain rate matches the rate seen, in bins', () => {
    // Prequential predictions against outcomes, over several logs: binned by predicted p.
    const bins = [[0, 0.1], [0.1, 0.3], [0.3, 1]] as const;
    const acc = bins.map(() => ({ p: 0, y: 0, n: 0 }));
    for (let seed = 11; seed <= 16; seed++) {
      for (const x of painFit(painLog(seed, { sessions: 300, truth: T }).entries).trace) {
        const b = bins.findIndex(([lo, hi]) => x.p >= lo && x.p < hi);
        acc[b].p += x.p; acc[b].y += x.y; acc[b].n++;
      }
    }
    for (const a of acc) {
      if (a.n < 40) continue;
      const se = Math.sqrt((a.p / a.n) * (1 - a.p / a.n) / a.n);
      expect(Math.abs(a.y / a.n - a.p / a.n), `bin of ${a.n}`).toBeLessThan(3 * se + 0.02);
    }
  });
  it('a lift that just hurt is likelier to hurt than one that never did; less so as the weeks pass without it', () => {
    const { entries } = painLog(3, { sessions: 200, truth: T });
    const day = last(entries);
    const hurt: SetEntry[] = [...entries, set({ id: 'h1', date: day, exercise: 'Leg Extension', flags: ['pain'], painSeverity: 2, seq: 1e9 })];
    const at = (d: number) => painRisk(hurt, 'Leg Extension', addDays(day, d));
    const clean = painRisk(entries, 'Leg Extension', addDays(day, 1)); // its history without that last pain set
    expect(at(1).p).toBeGreaterThan(clean.p);
    expect(at(1).p).toBeGreaterThan(at(60).p);
    // Its own evidence fades with a long layoff: the risk goes back to his long-run rate (the region's fades too), less sure.
    const base = painFit(hurt).base;
    expect(Math.abs(at(400).p - base)).toBeLessThan(0.02);
    expect(Math.abs(at(400).p - base)).toBeLessThan(Math.abs(at(60).p - base));
    expect(at(1).worse).toBeGreaterThan(0.5);
    expect(at(400).worse).toBeLessThan(0.5);
    // Less sure, relative to the risk (a Beta's spread shrinks with its mean): the lift's own sessions no longer pin it.
    expect(at(400).sd / at(400).p).toBeGreaterThan(1.5 * at(1).sd / at(1).p);
  });
  it('pools a region: pain on one elbow lift raises the other elbow lift’s risk, not a knee lift’s', () => {
    const { entries } = painLog(5, { sessions: 200, truth: { ...T, own: 0.4, region: 0.5 } });
    const day = last(entries);
    const plus = (n: number): SetEntry[] => Array.from({ length: n }, (_, k) => set({ id: `pd${k}`, date: addDays(day, -2 * k), exercise: 'Cable Pushdown', flags: ['pain'], seq: 1e9 + k }));
    const a = painRisk([...entries, ...plus(3)], 'Overhead DB Triceps Extension', addDays(day, 1)).p - painRisk(entries, 'Overhead DB Triceps Extension', addDays(day, 1)).p;
    const b = painRisk([...entries, ...plus(3)], 'Leg Extension', addDays(day, 1)).p - painRisk(entries, 'Leg Extension', addDays(day, 1)).p;
    expect(a).toBeGreaterThan(0.01);
    expect(a).toBeGreaterThan(5 * Math.abs(b));
  });
  it('knows where in the session it is: an elbow lift that hurt earlier today raises the next elbow lift’s risk today', () => {
    const { entries } = painLog(7, { sessions: 200, truth: { ...T, own: 0.4, region: 0.5 } });
    const today = addDays(last(entries), 3);
    const first = set({ id: 'early', date: today, exercise: 'Cable Pushdown', flags: ['pain'], painSeverity: 2, seq: 1e9, loggedAt: `${today}T17:00:00Z` });
    expect(painRisk([...entries, first], 'Overhead DB Triceps Extension', today).p).toBeGreaterThan(painRisk(entries, 'Overhead DB Triceps Extension', today).p + 0.01);
  });
  it('a never-done lift gets its region’s risk, and is never worse than its family without pain of its own', () => {
    const { entries } = painLog(9, { sessions: 200, truth: T, lifts: [0, 2, 4] });
    const r = painRisk(entries, 'Skullcrusher', addDays(last(entries), 1));
    expect(r.worse).toBeLessThan(0.5);
    expect(r.p).toBeGreaterThan(0);
  });
  it('a lift is weighed against its family without itself: alone in its region, against his overall rate', () => {
    // Pain only by chance (3 %), one lift per region; then the pushdown hurts on its last three sessions.
    for (let seed = 1; seed <= 4; seed++) {
      const { entries } = painLog(seed, { sessions: 200, truth: { base: 0.03, own: 0, region: 0, h: 28 }, lifts: [0, 2, 4] });
      const ds = [...new Set(entries.filter((e) => e.exercise === 'Cable Pushdown').map((e) => e.date))].sort().slice(-3);
      const sore = entries.map((e) => (e.exercise === 'Cable Pushdown' && ds.includes(e.date) && e.setNo === 3 ? { ...e, flags: ['pain' as const] } : e));
      // Counted in its own family, its pain would raise the bar it is measured against (worse ≈ 0.6–0.7 here).
      expect(painRisk(sore, 'Cable Pushdown', addDays(last(entries), 1)).worse, `seed ${seed}`).toBeGreaterThan(0.8);
    }
  });
  it('the grid of half-lives runs from a week to about seven months (no pain lasts for ever)', () => {
    expect(HALF_LIVES[0]).toBe(7);
    expect(HALF_LIVES.at(-1)).toBe(224);
    expect(PAIN_LIFTS.length).toBe(6);
  });
});
