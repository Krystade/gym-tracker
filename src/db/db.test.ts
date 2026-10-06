import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { addSet, getGyms, putGyms, getAliases, putAliases, addTombstone, deletePhoto, deleteSet, deleteSetWithTombstone, restoreSet, deleteSyncConfig, getSyncConfig, getTombstones, putSyncConfig, getAllSets, getBody, getPhotoBlob, getPhotoMetas, putPhoto, putBody, putBodyMany, getAllSettings, getDayPlans, getProfile, getProgram, putDayPlan, putMany, putProfile, putProgram, putSet, putSettings, resetDbForTests } from './db';
import { defaultProfile } from '../domain/profile';
import { parseCsv } from '../domain/csv';
import { buildAppSet } from '../domain/buildSet';

const CSV = 'date,exercise,set,weight_lb,reps,note,source\n2026-01-05,Cable Curl,1,52.5,12,"a, ""b""",s\n2026-01-05,Cable Curl,2,60,,,s\n';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetDbForTests(); });

describe('db', () => {
  it('imports idempotently and preserves values', async () => {
    const { entries } = parseCsv(CSV);
    expect(await putMany(entries)).toEqual({ added: 2, updated: 0 });
    expect(await putMany(entries)).toEqual({ added: 0, updated: 2 });
    const all = await getAllSets();
    expect(all).toHaveLength(2);
    expect(all.find((e) => e.setNo === 1)).toMatchObject({ weight: 52.5, note: 'a, "b"' });
    expect(all.find((e) => e.setNo === 2)?.reps).toBeNull();
  });
  it('puts and deletes single sets', async () => {
    const [e] = parseCsv(CSV).entries;
    await putSet(e);
    await deleteSet(e.id);
    expect(await getAllSets()).toEqual([]);
  });
});

describe('restoreSet', () => {
  it('puts an undone delete back and drops only its tombstone', async () => {
    const [a] = parseCsv(CSV).entries;
    await putSet(a);
    await addTombstone('older');
    await deleteSetWithTombstone(a.id);
    await restoreSet(a);
    expect(await getAllSets()).toEqual([a]);
    expect(await getTombstones()).toEqual(new Set(['older']));
  });
});

describe('deleteSetWithTombstone', () => {
  it('removes the set and records its tombstone together', async () => {
    const [a, b] = parseCsv(CSV).entries;
    await putSet(a); await putSet(b);
    await addTombstone('older');
    await deleteSetWithTombstone(a.id);
    expect((await getAllSets()).map((e) => e.id)).toEqual([b.id]);
    expect(await getTombstones()).toEqual(new Set(['older', a.id]));
  });
  it('keeps the set when the tombstone cannot be written', async () => {
    const [a] = parseCsv(CSV).entries;
    await putSet(a);
    const real = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'config') throw new Error('disk full');
      return real.apply(this, args);
    };
    try { await expect(deleteSetWithTombstone(a.id)).rejects.toThrow('disk full'); }
    finally { IDBObjectStore.prototype.put = real; }
    expect((await getAllSets()).map((e) => e.id)).toEqual([a.id]);
    expect(await getTombstones()).toEqual(new Set());
  });
  it('reports the real error when the failed write already aborted the transaction', async () => {
    const [a] = parseCsv(CSV).entries;
    await putSet(a);
    const real = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'config') { this.transaction.abort(); throw new Error('quota exceeded'); } // as a QuotaExceededError does
      return real.apply(this, args);
    };
    try { await expect(deleteSetWithTombstone(a.id)).rejects.toThrow('quota exceeded'); }
    finally { IDBObjectStore.prototype.put = real; }
    expect((await getAllSets()).map((e) => e.id)).toEqual([a.id]);
  });
});

describe('addSet', () => {
  it('numbers the new set from what is stored, not from a stale copy', async () => {
    const input = { date: '2026-10-02', exercise: 'Bench Press', weight: 100, reps: 8, flags: [] };
    await putSet(buildAppSet([], input, new Date('2026-10-02T18:00:00')));
    const second = await addSet((stored) => buildAppSet(stored, { ...input, weight: 200, reps: 3 }, new Date('2026-10-02T18:01:00')));
    expect(second.setNo).toBe(2);
    expect((await getAllSets()).map((e) => [e.setNo, e.weight]).sort()).toEqual([[1, 100], [2, 200]]);
  });
});

describe('db v2', () => {
  it('upgrades a v1 database without losing sets', async () => {
    const v1 = await openDB('gym-tracker', 1, { upgrade(d) { d.createObjectStore('sets', { keyPath: 'id' }).createIndex('date', 'date'); } });
    await v1.put('sets', { id: 'a', date: '2026-01-01', seq: 0, exercise: 'Curl', setNo: 1, weight: 30, reps: 10, flags: [], source: 's' });
    v1.close();
    expect(await getAllSets()).toHaveLength(1);
    expect(await getAllSettings()).toEqual([]);
  });
  it('stores settings by key', async () => {
    await putSettings({ key: 'curl', repMin: 6, repMax: 10, increment: 2.5 });
    await putSettings({ key: 'curl', repMin: 8, repMax: 12, increment: 2.5 });
    expect(await getAllSettings()).toEqual([{ key: 'curl', repMin: 8, repMax: 12, increment: 2.5 }]);
  });
});

describe('db v3', () => {
  it('upgrades a v2 database keeping sets and settings, with no profile yet', async () => {
    const v2 = await openDB('gym-tracker', 2, { upgrade(d) { d.createObjectStore('sets', { keyPath: 'id' }).createIndex('date', 'date'); d.createObjectStore('settings', { keyPath: 'key' }); } });
    await v2.put('sets', { id: 'a', date: '2026-01-01', seq: 0, exercise: 'Curl', setNo: 1, weight: 30, reps: 10, flags: [], source: 's' });
    await v2.put('settings', { key: 'curl', repMin: 8, repMax: 12, increment: 5 });
    v2.close();
    expect(await getAllSets()).toHaveLength(1);
    expect(await getAllSettings()).toHaveLength(1);
    expect(await getProfile()).toBeUndefined();
  });
  it('stores the profile', async () => {
    const p = defaultProfile();
    p.tiers.Biceps = 1;
    await putProfile(p);
    expect((await getProfile())?.tiers.Biceps).toBe(1);
  });
});

describe('db version changes', () => {
  it('closes its connection when a newer version opens elsewhere, so the upgrade is not blocked', async () => {
    await getAllSets(); // our connection is now open
    const newer = openDB('gym-tracker', 99);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('upgrade blocked')), 500));
    const d = await Promise.race([newer, timeout]) as Awaited<typeof newer>;
    d.close();
  });
});

describe('db v4', () => {
  it('upgrades v3 keeping sets, settings and profile, with no program yet', async () => {
    const v3 = await openDB('gym-tracker', 3, { upgrade(d) {
      d.createObjectStore('sets', { keyPath: 'id' }).createIndex('date', 'date');
      d.createObjectStore('settings', { keyPath: 'key' });
      d.createObjectStore('profile', { keyPath: 'key' });
    } });
    await v3.put('sets', { id: 'a', date: '2026-01-01', seq: 0, exercise: 'Curl', setNo: 1, weight: 30, reps: 10, flags: [], source: 's' });
    await v3.put('settings', { key: 'curl', repMin: 8, repMax: 12, increment: 5 });
    await v3.put('profile', { ...defaultProfile() });
    v3.close();
    expect(await getAllSets()).toHaveLength(1);
    expect(await getAllSettings()).toHaveLength(1);
    expect(await getProfile()).toBeDefined();
    expect(await getProgram()).toBeUndefined();
    expect(await getDayPlans()).toEqual([]);
  });
  it('stores the program and one day plan per date', async () => {
    await putProgram({ key: 'program', perSession: 14, createdAt: 'x', days: [] });
    await putDayPlan({ key: 'day:2026-09-30', date: '2026-09-30', day: 0, skips: [], swaps: {} });
    await putDayPlan({ key: 'day:2026-09-30', date: '2026-09-30', day: 1, skips: ['Cable Curl'], swaps: {} });
    expect((await getProgram())?.perSession).toBe(14);
    const plans = await getDayPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0].day).toBe(1);
  });
});

describe('db v5', () => {
  it('upgrades v4 keeping every store, with no body data yet', async () => {
    const v4 = await openDB('gym-tracker', 4, { upgrade(d) {
      d.createObjectStore('sets', { keyPath: 'id' }).createIndex('date', 'date');
      d.createObjectStore('settings', { keyPath: 'key' });
      d.createObjectStore('profile', { keyPath: 'key' });
      d.createObjectStore('program', { keyPath: 'key' });
    } });
    await v4.put('sets', { id: 'a', date: '2026-01-01', seq: 0, exercise: 'Curl', setNo: 1, weight: 30, reps: 10, flags: [], source: 's' });
    await v4.put('settings', { key: 'curl', repMin: 8, repMax: 12, increment: 5 });
    await v4.put('profile', { ...defaultProfile() });
    await v4.put('program', { key: 'program', perSession: 14, createdAt: 'x', days: [] });
    v4.close();
    expect(await getAllSets()).toHaveLength(1);
    expect(await getAllSettings()).toHaveLength(1);
    expect(await getProfile()).toBeDefined();
    expect(await getProgram()).toBeDefined();
    expect(await getBody()).toEqual([]);
  });
  it('stores one body day per date', async () => {
    await putBody({ date: '2026-09-30', weight: 180 });
    await putBodyMany([{ date: '2026-09-30', weight: 181, protein: 150 }, { date: '2026-09-29', weight: 179 }]);
    expect(await getBody()).toEqual([{ date: '2026-09-29', weight: 179 }, { date: '2026-09-30', weight: 181, protein: 150 }]);
  });
});

describe('db v6', () => {
  const meta = (date: string) => ({ id: `${date}:front`, date, pose: 'front' as const, width: 2, height: 3, addedAt: 'x' });
  it('upgrades v5 keeping every store, with no photos yet', async () => {
    const v5 = await openDB('gym-tracker', 5, { upgrade(d) {
      d.createObjectStore('sets', { keyPath: 'id' }).createIndex('date', 'date');
      for (const [s, k] of [['settings', 'key'], ['profile', 'key'], ['program', 'key'], ['body', 'date']]) d.createObjectStore(s, { keyPath: k });
    } });
    await v5.put('sets', { id: 'a', date: '2026-01-01', seq: 0, exercise: 'Curl', setNo: 1, weight: 30, reps: 10, flags: [], source: 's' });
    await v5.put('program', { key: 'program', perSession: 14, createdAt: 'x', days: [] });
    await v5.put('body', { date: '2026-09-01', weight: 180 });
    v5.close();
    expect(await getAllSets()).toHaveLength(1);
    expect(await getProgram()).toBeDefined();
    expect(await getBody()).toHaveLength(1);
    expect(await getPhotoMetas()).toEqual([]);
  });
  it('keeps one photo per id, returns metas without image data, and deletes both', async () => {
    await putPhoto(meta('2026-09-01'), new Blob(['full-1']), new Blob(['t-1']));
    await putPhoto(meta('2026-09-01'), new Blob(['full-2']), new Blob(['t-2']));
    await putPhoto(meta('2026-09-02'), new Blob(['f']), new Blob(['t']));
    const metas = await getPhotoMetas();
    expect(metas.map((x) => x.id).sort()).toEqual(['2026-09-01:front', '2026-09-02:front']);
    expect(Object.keys(metas[0]).sort()).toEqual(['addedAt', 'date', 'height', 'id', 'pose', 'width']);
    expect(await (await getPhotoBlob('2026-09-01:front', 'full'))!.text()).toBe('full-2');
    expect(await (await getPhotoBlob('2026-09-01:front', 'thumb'))!.text()).toBe('t-2');
    await deletePhoto('2026-09-01:front');
    expect((await getPhotoMetas()).map((x) => x.id)).toEqual(['2026-09-02:front']);
    expect(await getPhotoBlob('2026-09-01:front', 'full')).toBeUndefined();
  });
});

describe('db v7', () => {
  it('upgrades v6 keeping every store', async () => {
    const v6 = await openDB('gym-tracker', 6, { upgrade(d) {
      d.createObjectStore('sets', { keyPath: 'id' }).createIndex('date', 'date');
      for (const [s, k] of [['settings', 'key'], ['profile', 'key'], ['program', 'key'], ['body', 'date']]) d.createObjectStore(s, { keyPath: k });
      d.createObjectStore('photos', { keyPath: 'id' }).createIndex('date', 'date');
      d.createObjectStore('photoBlobs');
    } });
    await v6.put('sets', { id: 'a', date: '2026-01-01', seq: 0, exercise: 'Curl', setNo: 1, weight: 30, reps: 10, flags: [], source: 's' });
    await v6.put('settings', { key: 'curl', repMin: 8, repMax: 12, increment: 5 });
    await v6.put('profile', { ...defaultProfile() });
    await v6.put('body', { date: '2026-09-01', weight: 180 });
    await v6.put('photos', { id: '2026-09-01:front', date: '2026-09-01', pose: 'front', width: 1, height: 1, addedAt: 'x' });
    v6.close();
    expect(await getAllSets()).toHaveLength(1);
    expect(await getAllSettings()).toHaveLength(1);
    expect(await getProfile()).toBeDefined();
    expect(await getBody()).toHaveLength(1);
    expect(await getPhotoMetas()).toHaveLength(1);
    expect(await getSyncConfig()).toBeUndefined();
    expect(await getTombstones()).toEqual(new Set());
  });
  it('stores the sync config and deleted-set ids', async () => {
    await putSyncConfig({ key: 'sync', repo: 'a/b', token: 't', branch: 'main' });
    expect((await getSyncConfig())?.repo).toBe('a/b');
    await deleteSyncConfig();
    expect(await getSyncConfig()).toBeUndefined();
    await addTombstone('x'); await addTombstone('y'); await addTombstone('x');
    expect(await getTombstones()).toEqual(new Set(['x', 'y']));
  });
});

describe('name mappings', () => {
  it('round-trip, and start empty', async () => {
    expect(await getAliases()).toEqual({});
    await putAliases({ 'cable pushdown': 'Cable Pushdown' });
    expect(await getAliases()).toEqual({ 'cable pushdown': 'Cable Pushdown' });
  });
});

describe('gyms', () => {
  it('round-trip with the active gym, and start empty', async () => {
    expect(await getGyms()).toEqual({ gyms: [], active: undefined });
    const g = { id: 'a', name: 'Home', equipment: ['dumbbells' as const], exclude: [], include: ['Zercher Squat'] };
    await putGyms({ gyms: [g], active: 'a' });
    expect(await getGyms()).toEqual({ gyms: [g], active: 'a' });
  });
});
