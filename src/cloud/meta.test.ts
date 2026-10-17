import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { boundDb, resetDbForTests } from '../db/db';
import { readMeta, removeMeta, writeMeta } from './meta';
import type { TagPrefs } from '../domain/tags';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetDbForTests(); });

describe('tags in the synced settings', () => {
  const prefs: TagPrefs = { key: 'tags', hidden: ['test'], custom: ['paused', 'band'] };
  it('go up with the rest of the settings, per profile', async () => {
    expect(await readMeta(boundDb('main'))).not.toHaveProperty('tags');
    await boundDb('main').putTags(prefs);
    expect((await readMeta(boundDb('main'))).tags).toEqual(prefs);
    expect(await readMeta(boundDb('p2'))).not.toHaveProperty('tags');
  });
  it('come down onto the phone', async () => {
    await writeMeta(boundDb('main'), { tags: prefs });
    expect(await boundDb('main').getTags()).toEqual(prefs);
  });
});

describe('the Orbit status phrase in the synced settings', () => {
  it('goes up once set, cleared as an empty phrase, per profile', async () => {
    expect(await readMeta(boundDb('main'))).not.toHaveProperty('status');
    await boundDb('main').putStatus('deload week');
    expect((await readMeta(boundDb('main'))).status).toBe('deload week');
    await boundDb('main').putStatus('');
    expect((await readMeta(boundDb('main'))).status).toBe('');
    expect(await readMeta(boundDb('p2'))).not.toHaveProperty('status');
  });
  it('comes down onto the phone cleaned: trimmed and cut to 24 characters', async () => {
    await writeMeta(boundDb('main'), { status: `  ${'z'.repeat(30)} ` });
    expect(await boundDb('main').getStatus()).toBe('z'.repeat(24));
  });
});

describe('settings deleted on another phone (round 10)', () => {
  it('a lift’s settings, a day plan, a name mapping and the last gym go from this phone; the rest stay', async () => {
    const db = boundDb('main');
    await db.putSettings({ key: 'bench press', repMin: 6, repMax: 10, increment: 5 });
    await db.putSettings({ key: 'squat', repMin: 5, repMax: 8, increment: 10 });
    await db.putDayPlan({ key: 'day:2026-10-01', date: '2026-10-01', day: 0, skips: [], swaps: {} });
    await db.putAliases({ pushdowns: 'Cable Pushdown', rows: 'Cable Row' });
    await writeMeta(db, { gyms: { gyms: [{ id: 'g1', name: 'Home', include: [] }], active: 'g1' } });
    await removeMeta(db, ['settings:bench press', 'day:2026-10-01', 'alias:pushdowns', 'gyms']);
    const after = await readMeta(db);
    expect(Object.keys(after).sort()).toEqual(['alias:rows', 'settings:squat']);
  });
});
