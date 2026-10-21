import { describe, expect, it } from 'vitest';
import { defaultSettings, resolveSettings } from './progression';
import { envelope } from './learn/range';

// Owner decision 4 (2026-10-20): the training goal. Synthetic lifts only.
describe('training goal', () => {
  it('size keeps 8–12 for compounds and 10–15 for isolation', () => {
    expect(defaultSettings('Bench Press')).toMatchObject({ repMin: 8, repMax: 12 });
    expect(defaultSettings('Bench Press', undefined, 'size')).toMatchObject({ repMin: 8, repMax: 12 });
    expect(defaultSettings('Cable Curl', undefined, 'size')).toMatchObject({ repMin: 10, repMax: 15 });
  });
  it('strength moves barbell compounds to 5–8, and nothing else', () => {
    for (const lift of ['Bench Press', 'Barbell Squat', 'Deadlift', 'Overhead Press', 'Barbell Row']) {
      expect(defaultSettings(lift, undefined, 'strength'), lift).toMatchObject({ repMin: 5, repMax: 8 });
      expect(envelope(lift).floor).toBeLessThanOrEqual(5); // the range learner allows it
    }
    expect(defaultSettings('Leg Press', undefined, 'strength')).toMatchObject({ repMin: 8, repMax: 12 }); // machine
    expect(defaultSettings('Flat DB Press', undefined, 'strength')).toMatchObject({ repMin: 8, repMax: 12 }); // dumbbell
    expect(defaultSettings('Cable Curl', undefined, 'strength')).toMatchObject({ repMin: 10, repMax: 15 }); // isolation
    expect(defaultSettings('Bench Press', true, 'strength')).toMatchObject({ repMin: 20, repMax: 40 }); // a hold
  });
  it('a lift’s own range wins; a row saved with a default follows the goal', () => {
    const typed = { ...defaultSettings('Bench Press'), repMin: 6, repMax: 10 };
    expect(resolveSettings(typed, 'Bench Press', undefined, 'strength')).toMatchObject({ repMin: 6, repMax: 10 });
    const marked = { ...defaultSettings('Bench Press'), ownRange: true as const };
    expect(resolveSettings(marked, 'Bench Press', undefined, 'strength')).toMatchObject({ repMin: 8, repMax: 12 });
    // Saved for its rest under size, then under strength: the goal decides, both ways.
    const rest = { ...defaultSettings('Bench Press'), rest: 210 };
    expect(resolveSettings(rest, 'Bench Press', undefined, 'strength')).toMatchObject({ repMin: 5, repMax: 8, rest: 210 });
    const restS = { ...defaultSettings('Bench Press', undefined, 'strength'), rest: 210 };
    expect(resolveSettings(restS, 'Bench Press', undefined, 'size')).toMatchObject({ repMin: 8, repMax: 12, rest: 210 });
    expect(resolveSettings(undefined, 'Bench Press', undefined, 'strength')).toMatchObject({ repMin: 5, repMax: 8 });
  });
});
