import { describe, expect, it } from 'vitest';
import type { SetEntry } from '../types';
import { addDays } from '../analytics';
import { fitPain, painRisk } from './pain';
import { painLog } from './painSim.sample';

// Synthetic logs only. Round 20: the next morning's answer feeds item 08's learned risk of pain (b), as one more look at the
// lift that hurt, on the day after (c: the weight of one look).
const SK = 'Skullcrusher';
let seq = 0;
const one = (date: string, over: Partial<SetEntry> = {}): SetEntry => ({ id: `m${seq}`, date, seq: seq++, exercise: SK, setNo: 1, weight: 40, reps: 10, flags: [], source: 't', ...over });

describe('the next morning in the learned risk of pain', () => {
  const { entries } = painLog(5, { sessions: 150, truth: { base: 0.03, own: 0.5, region: 0.2, h: 28 } });
  const last = entries.reduce((a, e) => (e.date > a ? e.date : a), '');
  /** Four skullcrusher sessions that hurt (moderate), each answered `morning` the next day. */
  const run = (morning?: SetEntry['morning']) => [0, 4, 8, 12].map((k) => one(addDays(last, k), { flags: ['pain'], painSeverity: 2, ...(morning && { morning }) }));
  const day = addDays(last, 16);

  it('pain that lingered keeps the risk up; pain that settled every time brings it down; unanswered sits between', () => {
    const sore = painRisk([...entries, ...run('sore')], SK, day).p;
    const none = painRisk([...entries, ...run()], SK, day).p;
    const settled = painRisk([...entries, ...run('settled')], SK, day).p;
    expect(sore).toBeGreaterThan(none);
    expect(none).toBeGreaterThan(settled);
    // Worse counts as not settled, like still sore; skipped is no answer.
    expect(painRisk([...entries, ...run('worse')], SK, day).p).toBeCloseTo(sore, 10);
    expect(painRisk([...entries, ...run('skipped')], SK, day).p).toBeCloseTo(none, 10);
  });

  it('an answer counts from its morning on: the risk on the day of the pain is the same whatever was answered', () => {
    const lastPain = addDays(last, 12);
    const a = painRisk([...entries, ...run('sore')], SK, lastPain), b = painRisk([...entries, ...run('settled')], SK, lastPain);
    // Earlier sessions' answers count by then (their mornings are past); the last one's doesn't.
    const earlier = (m: SetEntry['morning']) => [...run(m).slice(0, 3), one(lastPain, { flags: ['pain'], painSeverity: 2, morning: m })];
    expect(painRisk([...entries, ...earlier('sore')], SK, lastPain).p).toBeCloseTo(painRisk([...entries, ...run('sore').slice(0, 3), one(lastPain, { flags: ['pain'], painSeverity: 2 })], SK, lastPain).p, 10);
    expect(a.p).toBeGreaterThan(b.p); // the three earlier mornings differ
    // The day after, the last answer counts too.
    expect(painRisk([...entries, ...earlier('sore')], SK, addDays(lastPain, 1)).p).toBeGreaterThan(painRisk([...entries, ...earlier('settled')], SK, addDays(lastPain, 1)).p);
  });

  it('an answer on a set that isn’t a pain set is nothing; a log with no answers fits as before', () => {
    const odd = run().map((e) => ({ ...e, flags: [] as SetEntry['flags'], morning: 'sore' as const }));
    expect(painRisk([...entries, ...odd], SK, day).p).toBeCloseTo(painRisk([...entries, ...run().map((e) => ({ ...e, flags: [] as SetEntry['flags'] }))], SK, day).p, 10);
    const plain = [...entries, ...run()];
    expect(fitPain(plain).sessions).toBe(fitPain(plain, 0).sessions);
    expect(fitPain([...entries, ...run('sore')]).sessions).toBe(fitPain(plain).sessions + 4);
  });
});
