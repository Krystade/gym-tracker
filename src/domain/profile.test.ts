import { describe, expect, it } from 'vitest';
import { defaultProfile, parseProfileJson, status, targetFor } from './profile';

describe('profile', () => {
  it('defaults to neutral tier 3 everywhere', () => {
    const p = defaultProfile();
    expect(new Set(Object.values(p.tiers))).toEqual(new Set([3]));
    expect(targetFor(p, 'Biceps')).toEqual([5, 8]);
    expect(p.weeklyGoal).toBe(2);
  });
  it('parses a profile file and keeps unspecified muscles at tier 3', () => {
    const r = parseProfileJson(JSON.stringify({ type: 'gym-tracker-profile', tiers: { Biceps: 1, 'Side Delts': 2, Quads: 4 }, weeklyGoal: 3 }));
    if (!('profile' in r)) throw new Error(r.error);
    expect(r.profile.tiers.Biceps).toBe(1);
    expect(r.profile.tiers.Chest).toBe(3);
    expect(r.profile.weeklyGoal).toBe(3);
    expect(targetFor(r.profile, 'Biceps')).toEqual([12, 16]);
  });
  it('rejects the wrong type, unknown muscles and bad tiers', () => {
    expect(parseProfileJson('{"type":"other"}')).toHaveProperty('error');
    expect(parseProfileJson('{"type":"gym-tracker-profile","tiers":{"Wings":1}}')).toHaveProperty('error');
    expect(parseProfileJson('{"type":"gym-tracker-profile","tiers":{"Biceps":7}}')).toHaveProperty('error');
    expect(parseProfileJson('not json')).toHaveProperty('error');
  });
  it('grades weekly sets against a target range', () => {
    expect(status(4, [5, 8])).toBe('under');
    expect(status(5, [5, 8])).toBe('on');
    expect(status(9, [5, 8])).toBe('over');
  });
});
