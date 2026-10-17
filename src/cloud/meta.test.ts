import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { boundDb, getGyms, putGyms, resetDbForTests, type ProfileDb } from '../db/db';
import { readMeta } from './meta';
import type { MetaItems } from '../domain/cloud';
import type { TagPrefs } from '../domain/tags';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetDbForTests(); });
/** A sync saving settings onto a phone that hasn't changed them since it read them. */
const pull = async (db: ProfileDb, items: MetaItems, remove: string[] = []) => db.applySyncedMeta(await readMeta(db), items, remove);

describe('tags in the synced settings', () => {
  const prefs: TagPrefs = { key: 'tags', hidden: ['test'], custom: ['paused', 'band'] };
  it('go up with the rest of the settings, per profile', async () => {
    expect(await readMeta(boundDb('main'))).not.toHaveProperty('tags');
    await boundDb('main').putTags(prefs);
    expect((await readMeta(boundDb('main'))).tags).toEqual(prefs);
    expect(await readMeta(boundDb('p2'))).not.toHaveProperty('tags');
  });
  it('come down onto the phone', async () => {
    await pull(boundDb('main'), { tags: prefs });
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
    await pull(boundDb('main'), { status: `  ${'z'.repeat(30)} ` });
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
    await pull(db, { gyms: { gyms: [{ id: 'g1', name: 'Home', include: [] }], active: 'g1' } });
    expect(await pull(db, {}, ['settings:bench press', 'day:2026-10-01', 'alias:pushdowns', 'gyms'])).toEqual({ pulled: 0, removed: 4, skipped: 0 });
    const after = await readMeta(db);
    expect(Object.keys(after).sort()).toEqual(['alias:rows', 'settings:squat']);
  });
});

describe('settings a sync saves onto this phone (round 10)', () => {
  /** One of every kind of item, as readMeta reads them. */
  async function everyKind(db: ProfileDb) {
    await db.putProfile({ ...(await import('../domain/profile')).defaultProfile(), key: 'profile' } as never);
    await db.putProgram({ key: 'program', perSession: 4, createdAt: 'x', days: [] });
    await db.putDayPlan({ key: 'day:2026-10-01', date: '2026-10-01', day: 0, skips: [], swaps: {} });
    await db.putSettings({ key: 'bench press', repMin: 6, repMax: 10, increment: 5 });
    await db.putAliases({ pushdowns: 'Cable Pushdown' });
    await putGyms({ gyms: [{ id: 'g1', name: 'Home', equipment: [], exclude: [], include: [] }], active: 'g1' });
    await db.putTags({ key: 'tags', hidden: [], custom: ['band'] });
    await db.putStatus('deload');
  }
  /** Another phone's copy of each: a string retyped, the active gym switched, a field added to the rest. */
  const theirsOf = (base: MetaItems) => Object.fromEntries(Object.entries(base).map(([k, v]) =>
    [k, typeof v === 'string' ? `${v}x` : k === 'gyms' ? { ...(v as object), active: 'g9' } : { ...(v as object), extra: 1 }]));
  it('reads every kind the way readMeta does: an unchanged item is saved over, not left', async () => {
    const db = boundDb('main');
    await everyKind(db);
    const base = await readMeta(db);
    expect(Object.keys(base).sort()).toEqual(['alias:pushdowns', 'day:2026-10-01', 'gyms', 'profile', 'program', 'settings:bench press', 'status', 'tags']);
    const changed = theirsOf(base);
    expect(await db.applySyncedMeta(base, changed, [])).toEqual({ pulled: 8, removed: 0, skipped: 0 });
    expect(await readMeta(db)).toEqual(changed);
  });
  it('leaves every kind changed on this phone since the sync read it, saved over or deleted', async () => {
    const db = boundDb('main');
    await everyKind(db);
    const base = await readMeta(db);
    // Each changed here after the read (a gym added, a mapping retargeted, the status retyped …).
    await db.putProfile({ ...(base.profile as object), edited: 1 } as never);
    await db.putProgram({ ...(base.program as object), perSession: 5 } as never);
    await db.putDayPlan({ ...(base['day:2026-10-01'] as object), skips: ['x'] } as never);
    await db.putSettings({ key: 'bench press', repMin: 6, repMax: 12, increment: 5 });
    await db.putAliases({ pushdowns: 'Rope Pushdown' });
    await putGyms({ gyms: [{ id: 'g1', name: 'Home', equipment: [], exclude: [], include: [] }, { id: 'g2', name: 'Work', equipment: [], exclude: [], include: [] }], active: 'g1' });
    await db.putTags({ key: 'tags', hidden: ['test'], custom: ['band'] });
    await db.putStatus('peaking');
    const now = await readMeta(db);
    const theirs = theirsOf(base);
    expect(await db.applySyncedMeta(base, theirs, [])).toEqual({ pulled: 0, removed: 0, skipped: 8 });
    expect(await readMeta(db)).toEqual(now);
    expect(await db.applySyncedMeta(base, {}, ['settings:bench press', 'day:2026-10-01', 'alias:pushdowns', 'gyms'])).toEqual({ pulled: 0, removed: 0, skipped: 4 });
    expect(await readMeta(db)).toEqual(now);
    expect((await getGyms()).gyms).toHaveLength(2);
  });
  it('saves a mapping alongside another changed meanwhile: per item, not per row', async () => {
    const db = boundDb('main');
    await db.putAliases({ pushdowns: 'Cable Pushdown', rows: 'Cable Row' });
    const base = await readMeta(db);
    await db.putAliases({ pushdowns: 'Rope Pushdown', rows: 'Cable Row' });
    expect(await db.applySyncedMeta(base, { 'alias:pushdowns': 'Cable Pushdown 2', 'alias:rows': 'Seated Row' }, [])).toEqual({ pulled: 1, removed: 0, skipped: 1 });
    expect(await db.getAliases()).toEqual({ pushdowns: 'Rope Pushdown', rows: 'Seated Row' });
  });
});
