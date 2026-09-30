import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { deleteSet, getAllSets, getAllSettings, getProfile, putMany, putProfile, putSet, putSettings, resetDbForTests } from './db';
import { defaultProfile } from '../domain/profile';
import { parseCsv } from '../domain/csv';

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
