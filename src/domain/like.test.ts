import { afterEach, describe, expect, it } from 'vitest';
import { liftFactsVersion, resolveLift, setWorksLike } from './lifts';
import { muscleVector } from './muscles';
import { perLog } from './stats';
import { settingsKey } from './progression';
import type { SetEntry } from './types';

afterEach(() => setWorksLike([]));

describe('"Works like…": a lift counts as the catalog lift chosen for it', () => {
  it('takes that lift’s muscles, pattern, gear and rep range, and says how', () => {
    expect(resolveLift('Zercher Wobble').how).toBe('none');
    setWorksLike([[settingsKey('Zercher Wobble'), 'Front Squat']]);
    expect(resolveLift('Zercher Wobble')).toMatchObject({ how: 'like', lift: { name: 'Front Squat' }, p: 'Squat', needs: [['barbell', 'squat rack']] });
    expect(resolveLift('zercher  wobble').how).toBe('like');
    expect(muscleVector('Zercher Wobble')).toEqual(muscleVector('Front Squat'));
  });
  it('beats what the words say, and Automatic (no choice) gives it back', () => {
    expect(resolveLift('Kroc Row').m).toMatchObject({ 'Mid-Back': 1 });
    setWorksLike([['Kroc Row', 'Lat Pulldown']]);
    expect(resolveLift('Kroc Row').m).toMatchObject({ Lats: 1 });
    setWorksLike([]);
    expect(resolveLift('Kroc Row')).toMatchObject({ how: 'built', m: { 'Mid-Back': 1 } });
  });
  it('a choice that names no catalog lift is ignored', () => {
    setWorksLike([['Kroc Row', 'Some Other Custom Lift']]);
    expect(resolveLift('Kroc Row').how).toBe('built');
  });
  it('caches built from names are rebuilt when a choice changes, and only then', () => {
    let builds = 0;
    const count = perLog((es) => { builds++; return es.filter((e) => muscleVector(e.exercise)?.Lats === 1).length; });
    const log = [{ exercise: 'Kroc Row' }] as SetEntry[];
    expect(count(log)).toBe(0);
    const v = liftFactsVersion();
    setWorksLike([['Kroc Row', 'Lat Pulldown']]);
    expect(liftFactsVersion()).toBe(v + 1);
    expect(count(log)).toBe(1);
    setWorksLike([['Kroc Row', 'Lat Pulldown']]);
    expect(liftFactsVersion()).toBe(v + 1);
    expect(count(log)).toBe(1);
    expect(builds).toBe(2);
  });
});

describe('the lift page for a "Works like…" lift', () => {
  it('says which lift it works like', async () => {
    const { worksLine } = await import('./muscles');
    setWorksLike([['Kroc Row', 'Lat Pulldown']]);
    expect(worksLine('Kroc Row')).toBe('Works like Lat Pulldown: lats · mid-back ½ · biceps ½ · forearms ½ · vertical pull · cable');
  });
  it('offers the five nearest catalog lifts, the one its words name first', async () => {
    const { nearestLifts } = await import('./search');
    const near = nearestLifts('Kroc Row');
    expect(near).toHaveLength(5);
    for (const n of near) expect(resolveLift(n).m?.['Mid-Back'] ?? resolveLift(n).m?.Lats, n).toBeDefined();
    expect(nearestLifts('Zercher Front Squat')[0]).toBe('Front Squat');
  });
});
