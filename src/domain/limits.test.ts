import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayEnds, dayId, GLOBAL_PER_DAY, SOCIAL_PER_DAY } from './limits';

describe('limits', () => {
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  it('the app and firestore.rules hold the same numbers', () => {
    expect(rules).toContain(`request.resource.data.n <= ${GLOBAL_PER_DAY} && ownMoved()`);
    expect(rules).toContain(`rateNext(request.resource.data, resource.data, duration.value(0, 's'), ${SOCIAL_PER_DAY})`);
    expect(rules).toContain("function dayId() { return string(int(request.time.toMillis() / 86400000)); }");
  });
  it('a day is a UTC day: its id, and when it ends', () => {
    const t = Date.parse('2026-10-22T23:59:59.999Z');
    expect(dayId(t)).toBe('20748');
    expect(dayId(t + 1)).toBe('20749');
    expect(dayEnds(t)).toBe(t + 1);
    expect(dayEnds(t + 1)).toBe(t + 1 + 86_400_000);
  });
});
