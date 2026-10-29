import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { boundDb, getGyms, putGyms, resetDbForTests, type ProfileDb } from '../db/db';
import { readBuddyMeta, readMeta } from './meta';
import { BUDDIES } from '../domain/buddies/roster';
import { choose, starter } from '../domain/buddies/gacha';
import { isBuddyKey } from '../domain/buddies/kept';
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

describe('the Crew status phrase in the synced settings', () => {
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

describe('the day achievements count from (owner 2026-10-21: everyone starts from 0)', () => {
  it('is kept once per profile: the first run’s day, never moved by a later run', async () => {
    expect(await boundDb('main').getAchStart()).toBeUndefined();
    expect(await readMeta(boundDb('main'))).not.toHaveProperty('achievements');
    expect(await boundDb('main').startAchievements('2026-10-22')).toBe('2026-10-22');
    expect(await boundDb('main').startAchievements('2026-10-23')).toBe('2026-10-22');
    expect(await boundDb('p2').getAchStart()).toBeUndefined();
    expect((await readMeta(boundDb('main'))).achievements).toBe('2026-10-22');
  });
  it('comes down onto the phone', async () => {
    await boundDb('main').startAchievements('2026-10-25');
    await pull(boundDb('main'), { achievements: '2026-10-22' });
    expect(await boundDb('main').getAchStart()).toBe('2026-10-22');
  });
  it('a start that isn’t a day reads as none, and the next run starts again', async () => {
    await pull(boundDb('main'), { achievements: 'soon' });
    expect(await boundDb('main').getAchStart()).toBeUndefined();
    expect(await boundDb('main').startAchievements('2026-10-24')).toBe('2026-10-24');
    expect(await boundDb('main').getAchStart()).toBe('2026-10-24');
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
    [k, k === 'achievements' ? '2026-10-20' : typeof v === 'string' ? `${v}x` : k === 'gyms' ? { ...(v as object), active: 'g9' } : { ...(v as object), extra: 1 }]));
  it('reads every kind the way readMeta does: an unchanged item is saved over, not left', async () => {
    const db = boundDb('main');
    await everyKind(db);
    await db.startAchievements('2026-10-22');
    const base = await readMeta(db);
    expect(Object.keys(base).sort()).toEqual(['achievements', 'alias:pushdowns', 'day:2026-10-01', 'gyms', 'profile', 'program', 'settings:bench press', 'status', 'tags']);
    const changed = theirsOf(base);
    expect(await db.applySyncedMeta(base, changed, [])).toEqual({ pulled: 9, removed: 0, skipped: 0 });
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

describe('Gym Buddies in the synced settings (plan §16 stage 2)', () => {
  const [b0, b1] = BUDDIES.filter((b) => b.rarity === 0).map((b) => b.id);
  const s1 = starter(b0, 1000, '2026-10-28', 's1'), s2 = choose('buddy', b1, 2000, '2026-10-29', 's2');
  it('each kind goes up per profile: prefs per buddy, the lead, the start (kept once), every spend', async () => {
    const db = boundDb('main');
    expect(Object.keys(await readMeta(db)).filter(isBuddyKey)).toEqual([]);
    await db.putBuddyPrefs(b0, { name: ' Rex ', equip: { aura: 'aura-mint' } }, 5);
    await db.putBuddyPrefs(b1, {}, 6);
    await db.putBuddyLead(b0, 7);
    expect(await db.startBuddies('2026-10-28')).toBe('2026-10-28');
    expect(await db.startBuddies('2026-10-29')).toBe('2026-10-28');
    expect(await db.addSpend(s1)).toBe(true);
    expect(await db.addSpend({ ...s1, got: b1 })).toBe(false); // never re-rolled
    const m = await readMeta(db);
    expect(m.buddies).toEqual({ [b0]: { name: 'Rex', equip: { aura: 'aura-mint' }, at: 5 }, [b1]: { at: 6 } });
    expect(m['buddy-lead']).toEqual({ id: b0, at: 7 });
    expect(m['buddy-start']).toBe('2026-10-28');
    expect(m['spend:s1']).toEqual(s1);
    expect(await readBuddyMeta(db)).toEqual(Object.fromEntries(Object.entries(m).filter(([k]) => isBuddyKey(k))));
    expect(await readMeta(boundDb('p2'))).toEqual({});
  });
  it('come down onto the phone, a spend beside the ones kept; an item that doesn’t read is skipped, never saved', async () => {
    const db = boundDb('p2');
    await db.addSpend(s1);
    const r = await pull(db, { [`spend:${s2.id}`]: s2, 'buddy-lead': { id: b1, at: 9 }, 'buddy-start': '2026-10-20', buddies: { [b1]: { name: 'Bee', at: 3 } },
      'spend:s3': { ...s2, id: 's3', cost: -5 }, 'spend:s4': { ...s2 } });
    expect(r).toEqual({ pulled: 4, removed: 0, skipped: 2 });
    expect((await db.getSpends()).map((s) => s.id).sort()).toEqual(['s1', 's2']);
    expect(await db.getBuddyLead()).toEqual({ id: b1, at: 9 });
    expect(await db.getBuddyStart()).toBe('2026-10-20');
    expect(await db.getBuddyPrefs()).toEqual({ [b1]: { name: 'Bee', at: 3 } });
    expect(await boundDb('main').getSpends()).toEqual([]);
  });
  it('one changed here while the sync was out stays', async () => {
    const db = boundDb('main');
    await db.putBuddyPrefs(b0, { name: 'A' }, 1);
    const base = await readMeta(db);
    await db.putBuddyPrefs(b0, { name: 'B' }, 2);
    expect(await db.applySyncedMeta(base, { buddies: { [b0]: { name: 'C', at: 3 } } }, [])).toEqual({ pulled: 0, removed: 0, skipped: 1 });
    expect((await db.getBuddyPrefs())[b0].name).toBe('B');
  });
});
