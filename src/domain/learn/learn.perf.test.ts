import { expect, it } from 'vitest';
import type { SetEntry } from '../types';
import { simulate } from './coreSim.sample';
import { learn } from './index';

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
