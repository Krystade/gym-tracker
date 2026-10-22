import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isOwner, OWNERS } from './owner';

describe('owners', () => {
  it('the app and firestore.rules name the same owners', () => {
    const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
    const m = rules.match(/function OWNERS\(\) \{ return \[([^\]]*)\]; \}/);
    expect(m, 'firestore.rules OWNERS()').not.toBeNull();
    const inRules = m![1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    expect(inRules).toEqual([...OWNERS]);
    expect(OWNERS.length).toBeGreaterThan(0);
  });
  it('isOwner: an owner’s uid, nobody else, never no one', () => {
    expect(isOwner(OWNERS[0])).toBe(true);
    expect(isOwner('someone-else')).toBe(false);
    expect(isOwner(null)).toBe(false);
    expect(isOwner('')).toBe(false);
  });
});
