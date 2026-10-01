import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { boundDb, deletePersonData, getAllSets, getGyms, getPeople, getPhotoMetas, getSyncConfig, MAIN, putPeople, putPhoto, putSet, putSyncConfig, resetDbForTests, setProfileDb } from './db';
import { parseCsv } from '../domain/csv';

const CSV = 'date,exercise,set,weight_lb,reps,note,source\n2026-01-05,Cable Curl,1,52.5,12,,s\n';
const [SET] = parseCsv(CSV).entries;
const SYNC = { key: 'sync' as const, repo: 'someone/backup', token: 'test-token', branch: 'main' };

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetDbForTests(); });

/** A phone that ran the Phase 10 app: one gym-tracker v7 database with sync and gyms in config. */
async function oldPhone() {
  await putSet(SET);
  const d = await openDB('gym-tracker', 7);
  await d.put('config', SYNC);
  await d.put('config', { key: 'gyms', gyms: [{ id: 'g1', name: 'Downtown', equipment: ['dumbbells'], exclude: [], include: [] }], active: 'g1' });
  d.close();
  resetDbForTests();
}

describe('profiles', () => {
  it('starts with one profile on the existing database, and a second profile starts empty', async () => {
    await oldPhone();
    expect(await getPeople()).toEqual({ people: [{ id: MAIN, name: 'Me', slug: 'me' }], active: MAIN, retired: [] });
    expect(await getAllSets()).toHaveLength(1);
    await putPeople([{ id: MAIN, name: 'Me', slug: 'me' }, { id: 'b', name: 'Sam', slug: 'sam' }], 'b');
    setProfileDb('b');
    expect(await getAllSets()).toEqual([]);
    setProfileDb(MAIN);
    expect(await getAllSets()).toHaveLength(1);
    expect((await getPeople()).active).toBe('b');
  });

  it('lands a write started before a switch in the database it started in', async () => {
    setProfileDb(MAIN);
    const p = putSet(SET);
    const photo = putPhoto({ id: 'p1', date: '2026-01-05', pose: 'front' } as never, new Blob(['x'], { type: 'image/jpeg' }), new Blob(['y'], { type: 'image/jpeg' }));
    setProfileDb('b');
    await Promise.all([p, photo]);
    expect(await getAllSets()).toEqual([]);
    expect(await getPhotoMetas()).toEqual([]);
    setProfileDb(MAIN);
    expect(await getAllSets()).toHaveLength(1);
    expect(await getPhotoMetas()).toHaveLength(1);
  });

  it('moves sync settings and gyms to the shared database once, then deletes the old copies', async () => {
    await oldPhone();
    expect(await getSyncConfig()).toEqual(SYNC);
    expect((await getGyms()).active).toBe('g1');
    const d = await openDB('gym-tracker', 7);
    expect(await d.get('config', 'sync')).toBeUndefined();
    expect(await d.get('config', 'gyms')).toBeUndefined();
    d.close();
    await putSyncConfig({ ...SYNC, branch: 'other' });
    resetDbForTests();
    expect((await getSyncConfig())?.branch).toBe('other');
    setProfileDb('b');
    expect((await getSyncConfig())?.branch).toBe('other'); // shared, whoever is active
    expect((await getGyms()).gyms).toHaveLength(1);
  });

  it('deletes one profile’s data and nothing else', async () => {
    setProfileDb('b'); await putSet(SET);
    setProfileDb(MAIN); await putSet(SET);
    await deletePersonData('b');
    setProfileDb('b');
    expect(await getAllSets()).toEqual([]);
    setProfileDb(MAIN);
    expect(await getAllSets()).toHaveLength(1);
    await expect(deletePersonData(MAIN)).rejects.toThrow();
  });
});

describe('Phase 11 review fixes', () => {
  it('pins a profile’s calls to it even when they start after a switch (a sync pulling, a photo encoding)', async () => {
    const a = boundDb(MAIN);
    expect(boundDb(MAIN)).toBe(a); // stable, so hooks can depend on it
    setProfileDb('b');
    await a.putMany([SET]);
    await a.addTombstone('x');
    await a.putPhoto({ id: 'p1', date: '2026-01-05', pose: 'front' } as never, new Blob(['x']), new Blob(['y']));
    expect(await getAllSets()).toEqual([]);
    expect(await getPhotoMetas()).toEqual([]);
    expect(await boundDb('b').getTombstones()).toEqual(new Set());
    expect(await a.getAllSets()).toHaveLength(1);
    expect(await a.getTombstones()).toEqual(new Set(['x']));
  });
});
