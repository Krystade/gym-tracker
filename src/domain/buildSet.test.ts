import { describe, expect, it } from 'vitest';
import { buildAppSet } from './buildSet';

describe('late sets', () => {
  const now = new Date('2026-10-02T19:30:00');
  const input = { date: '2026-10-01', exercise: 'Bench Press', weight: 135, reps: 8, flags: [] };
  it('a live set is done when entered', () => {
    const e = buildAppSet([], { ...input, date: '2026-10-02' }, now);
    expect(e).toMatchObject({ loggedAt: now.toISOString(), seq: now.getTime() });
    expect(e).not.toHaveProperty('enteredAt');
  });
  it('a late set with a guessed time is ordered by that time and remembers when it was entered', () => {
    const when = new Date('2026-10-01T18:09:00');
    expect(buildAppSet([], { ...input, at: when }, now)).toMatchObject({ date: '2026-10-01', loggedAt: when.toISOString(), seq: when.getTime(), enteredAt: now.toISOString() });
  });
  it('a late set with no time has none', () => {
    const e = buildAppSet([], { ...input, at: null }, now);
    expect(e).not.toHaveProperty('loggedAt');
    expect(e.enteredAt).toBe(now.toISOString());
  });
});
