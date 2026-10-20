import { expect, it } from 'vitest';
import type { SetEntry } from '../types';
import { simulate } from './coreSim.sample';
import { learn } from './index';
import { painFit } from './pain';
import { paceFit, sessionLengths } from './session';
import { paceLog, PACE_TRUTH } from './sessionSim.sample';

// Phone budget (00-core §1.3): with 5 years of training (1,000 sessions, ~4 a week: ~14k sets) a refit after one more set stays
// under 50 ms on an iPhone 13 mini. The new set rebuilds only today's session block and copies only its rows (learn/capacity);
// the rest is the solve. Desktop Node does it in ~15–25 ms, so the gate is the phone's own 50 ms: a wide margin for a slow or
// busy CI runner. The timing is the best of several refits, each on a new log array with one more set (as the store makes on
// every add), so a moment of load slows a run without failing it.
it('refits 5 years of synthetic training in under 50 ms after one more set', () => {
  const { entries } = simulate(11, { sessions: 1000 });
  const last = entries.at(-1)!;
  const log = entries.slice(0, -1);
  learn(log);
  let n = 0;
  const addSet = (): SetEntry[] => {
    n++;
    log.push({ ...last, id: `${last.id}+${n}`, seq: last.seq + n, setNo: last.setNo + n, loggedAt: new Date(Date.parse(last.loggedAt!) + n * 150_000).toISOString() });
    return [...log];
  };
  for (let k = 0; k < 10; k++) learn(addSet()); // JIT warm-up (the first few refits after a cold start run partly unoptimised)
  const times: number[] = [];
  for (let k = 0; k < 9; k++) {
    const next = addSet();
    const t = performance.now();
    learn(next);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  expect(log.length).toBeGreaterThan(12000);
  expect(times[0], `refits (ms): ${times.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(50);
}, 120000);

// Item 08's pain fit (learn/pain) refits the whole log too, on each change: 5 years (~4,600 lift-sessions) in ~10 ms on desktop
// Node. Gated at 25 ms, half the phone's refit budget, timed as above (best of several, each on a new log array).
it('fits 5 years of pain history in under 25 ms', () => {
  const { entries } = simulate(11, { sessions: 1000 });
  const log = entries.map((x, i) => (i % 97 === 0 ? { ...x, flags: [...x.flags, 'pain' as const] } : x));
  for (let k = 0; k < 5; k++) painFit([...log]);
  const times: number[] = [];
  for (let k = 0; k < 9; k++) {
    const next = [...log];
    const t = performance.now();
    painFit(next).risk('Bench Press', '2031-01-01');
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  expect(painFit(log).sessions).toBeGreaterThan(4000);
  expect(times[0], `fits (ms): ${times.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(25);
}, 120000);

// Item 11's pace fit (learn/session) refits only when the days before today change (a new day, an edit to a past one): a set
// logged today reuses it (the next test). 5 years of timed sessions (1,000 sessions of 13 sets, ~12k gaps) take ~12 ms on
// desktop Node alone, ~25 ms with the whole suite running beside it. Off the per-set path, so gated at the phone's 50 ms refit
// budget (best of several, each on a new log array).
it('fits 5 years of timed sessions in under 50 ms', () => {
  const { entries } = paceLog(3, { sessions: 1000, breaks: 0.02 });
  for (let k = 0; k < 5; k++) paceFit([...entries]);
  const times: number[] = [];
  for (let k = 0; k < 9; k++) {
    const next = [...entries];
    const t = performance.now();
    paceFit(next)!.forecast([{ exercise: 'Bench Press' }, { exercise: 'Bench Press' }], { date: '2031-01-01' });
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  expect(paceFit(entries)!.gaps).toBeGreaterThan(11000);
  expect(times[0], `fits (ms): ${times.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(50);
}, 120000);

// A set logged today makes a new log, but the days before are the same: the plan header's length and pace reuse the fit and
// only read today. Gated at 5 ms a set (desktop ~1 ms).
it('a set logged today re-reads only today for the plan’s length and his pace', () => {
  const { entries } = paceLog(3, { sessions: 1000 });
  const date = '2031-01-01';
  const slots = [{ exercise: 'Bench Press', sets: 3 }, { exercise: 'Lat Pulldown', sets: 3 }, { exercise: 'Cable Curl', sets: 3 }];
  const log = [...entries];
  let t0 = Date.parse(`${date}T17:00:00Z`);
  const addSet = (i: number): SetEntry[] => {
    t0 += Math.exp(PACE_TRUTH.base) * 1000;
    log.push({ id: `today${i}`, date, seq: 1e6 + i, exercise: slots[Math.min(2, Math.floor(i / 3))].exercise, setNo: i + 1, weight: 100, reps: 10, flags: [], source: 'app', loggedAt: new Date(t0).toISOString() });
    return [...log];
  };
  sessionLengths(addSet(0), date, slots);
  const times: number[] = [];
  for (let i = 1; i < 9; i++) {
    const next = addSet(i);
    const t = performance.now();
    sessionLengths(next, date, slots);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  expect(sessionLengths(log, date, slots).pace).not.toBeNull();
  expect(times[0], `per set (ms): ${times.map((t) => t.toFixed(1)).join(', ')}`).toBeLessThan(5);
}, 120000);
