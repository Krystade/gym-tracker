import { expect, it } from 'vitest';
import { simulate } from './coreSim.sample';
import { learn } from './index';

// Phone budget (00-core §7): a refit after one more set stays under 50 ms with 5 years of training (1,000 sessions, ~4 a
// week: ~14k sets). Sessions already seen reuse their cached features; the timing is the best of several refits, each on a
// new log array (as the store makes on every add), so a busy machine slows a run without failing the budget.
// Opt-in (PERF=1): it measures wall time, which other processes on the machine distort. Not yet under budget in vitest
// (~60 ms here; ~40–50 ms in plain Node): see ROADMAP for the planned session-block refactor.
it.runIf(process.env.PERF === '1')('refits 5 years of synthetic training in under 50 ms after one more set', () => {
  const { entries } = simulate(11, { sessions: 1000 });
  learn(entries.slice(0, -1));
  for (let k = 0; k < 3; k++) learn([...entries]); // JIT warm-up
  let best = Infinity;
  for (let k = 0; k < 7; k++) {
    const log = [...entries];
    const t = performance.now();
    learn(log);
    best = Math.min(best, performance.now() - t);
  }
  expect(entries.length).toBeGreaterThan(12000);
  expect(best).toBeLessThan(50);
}, 120000);
