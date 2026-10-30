import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { addSet, getReplaced, putReplaced, deleteReplaced, pruneReplaced, getGyms, putGyms, getAliases, putAliases, addTombstone, deletePhoto, deleteSet, deleteSetWithTombstone, restoreSet, renameLift, getBackupMark, putBackupMark, getTombstones, getTombstoneTimes, deleteSettings, deleteDayPlan, getAllSets, getBody, getPhotoBlob, getPhotoMetas, putPhoto, putBody, putBodyMany, getAllSettings, getDayPlans, getProfile, getProgram, putDayPlan, putMany, putProfile, putProgram, putSet, putSettings, resetDbForTests, getCycle, putCycleDay, putCycleTracking, clearCycle, finishCycleSync } from './db';
import { defaultProfile } from '../domain/profile';
import { parseCsv } from '../domain/csv';
import { buildAppSet, buildNamedSet } from '../domain/buildSet';
import { KEEP_MS, type Replaced } from '../domain/replaced';

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

describe('renameLift', () => {
  it('moves sets (tombstoning the old ids), program slots, day plans, settings and name mappings in one go', async () => {
    const mk = (exercise: string, setNo: number) => buildAppSet([], { date: '2026-09-01', exercise, weight: 50, reps: 10, flags: [] }, new Date(2026, 8, 1, 18, setNo));
    const a = { ...mk('Pushdown', 1), setNo: 1 }, b = { ...mk('Pushdown', 2), setNo: 2 };
    a.id = 'app|2026-09-01|pushdown|1'; b.id = 'app|2026-09-01|pushdown|2';
    await putSet(a); await putSet(b);
    await putProgram({ key: 'program', perSession: 4, createdAt: 'x', days: [{ name: 'Day A', slots: [{ exercise: 'Pushdown', sets: 2, repMin: 8, repMax: 12 }] }] });
    await putDayPlan({ key: 'day:2026-09-01', date: '2026-09-01', day: 0, skips: [], swaps: { Pushdown: 'Rope Pushdown' } });
    await putSettings({ key: 'pushdown', repMin: 10, repMax: 15, increment: 5 });
    await putAliases({ pushdowns: 'Pushdown' });
    expect(await renameLift('Pushdown', 'Cable Pushdown')).toBe(2);
    const sets = await getAllSets();
    expect(sets.map((e) => [e.exercise, e.id]).sort()).toEqual([['Cable Pushdown', 'app|2026-09-01|cable pushdown|1'], ['Cable Pushdown', 'app|2026-09-01|cable pushdown|2']]);
    expect(await getTombstones()).toEqual(new Set([a.id, b.id]));
    expect((await getProgram())!.days[0].slots[0].exercise).toBe('Cable Pushdown');
    expect((await getDayPlans())[0].swaps).toEqual({ 'Cable Pushdown': 'Rope Pushdown' });
    expect((await getAllSettings()).map((x) => [x.key, x.repMin])).toEqual([['cable pushdown', 10]]);
    expect(await getAliases()).toEqual({ pushdowns: 'Cable Pushdown', pushdown: 'Cable Pushdown' });
  });
  it('keeps the target lift’s own settings on a merge', async () => {
    await putSettings({ key: 'pushdown', repMin: 10, repMax: 15, increment: 5 });
    await putSettings({ key: 'cable pushdown', repMin: 6, repMax: 8, increment: 10 });
    await renameLift('Pushdown', 'Cable Pushdown');
    expect((await getAllSettings()).map((x) => [x.key, x.repMin])).toEqual([['cable pushdown', 6]]);
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
    const second = await addSet(input.date, (stored) => buildAppSet(stored, { ...input, weight: 200, reps: 3 }, new Date('2026-10-02T18:01:00')));
    expect(second.setNo).toBe(2);
    expect((await getAllSets()).map((e) => [e.setNo, e.weight]).sort()).toEqual([[1, 100], [2, 200]]);
  });
  it('reads only the day’s stored sets, not the whole log', async () => {
    const input = { date: '2026-10-02', exercise: 'Bench Press', weight: 100, reps: 8, flags: [] };
    await putMany([buildAppSet([], { ...input, date: '2026-10-01' }, new Date('2026-10-01T18:00:00')), buildAppSet([], input, new Date('2026-10-02T18:00:00')),
      buildAppSet([], { ...input, date: '2026-10-03' }, new Date('2026-10-03T18:00:00'))]);
    let read: string[] = [];
    const e = await addSet(input.date, (sameDay) => { read = sameDay.map((x) => x.date); return buildNamedSet(sameDay, input, new Date('2026-10-02T18:05:00')); });
    expect(read).toEqual(['2026-10-02']);
    expect([e.date, e.setNo, e.id]).toEqual(['2026-10-02', 2, 'app|2026-10-02|bench press|2']);
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
  const meta = (date: string) => ({ id: `${date}:front:relaxed`, date, pose: 'front' as const, variant: 'relaxed' as const, width: 2, height: 3, addedAt: 'x' });
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
    expect(metas.map((x) => x.id).sort()).toEqual(['2026-09-01:front:relaxed', '2026-09-02:front:relaxed']);
    expect(Object.keys(metas[0]).sort()).toEqual(['addedAt', 'date', 'height', 'id', 'pose', 'variant', 'width']);
    expect(await (await getPhotoBlob('2026-09-01:front:relaxed', 'full'))!.text()).toBe('full-2');
    expect(await (await getPhotoBlob('2026-09-01:front:relaxed', 'thumb'))!.text()).toBe('t-2');
    await deletePhoto('2026-09-01:front:relaxed');
    expect((await getPhotoMetas()).map((x) => x.id)).toEqual(['2026-09-02:front:relaxed']);
    expect(await getPhotoBlob('2026-09-01:front:relaxed', 'full')).toBeUndefined();
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
    expect(await getBackupMark()).toBeUndefined();
    expect(await getTombstones()).toEqual(new Set());
  });
  it('stores the last backup and deleted-set ids', async () => {
    await putBackupMark({ at: '2026-10-29T12:00:00.000Z', photos: 4 });
    expect(await getBackupMark()).toEqual({ at: '2026-10-29T12:00:00.000Z', photos: 4 });
    await addTombstone('x'); await addTombstone('y'); await addTombstone('x');
    expect(await getTombstones()).toEqual(new Set(['x', 'y']));
  });
});

describe('db v10: photos relaxed and flexed', () => {
  it('upgrades v9 moving each photo, meta and both images, to `date:pose:relaxed`; nothing is left under the old id', async () => {
    const v9 = await openDB('gym-tracker', 9, { upgrade(d) {
      d.createObjectStore('sets', { keyPath: 'id' }).createIndex('date', 'date');
      for (const [s, k] of [['settings', 'key'], ['profile', 'key'], ['program', 'key'], ['body', 'date'], ['config', 'key'], ['cycle', 'date'], ['replaced', 'key']]) d.createObjectStore(s, { keyPath: k });
      d.createObjectStore('photos', { keyPath: 'id' }).createIndex('date', 'date');
      d.createObjectStore('photoBlobs');
    } });
    const old = (date: string, pose: string) => ({ id: `${date}:${pose}`, date, pose, width: 3, height: 4, addedAt: 'x' });
    const image = (s: string) => ({ type: 'image/jpeg', data: new TextEncoder().encode(s).buffer });
    for (const [date, pose] of [['2026-09-01', 'front'], ['2026-09-01', 'back'], ['2026-09-20', 'front']]) {
      await v9.put('photos', old(date, pose));
      await v9.put('photoBlobs', image(`full ${date} ${pose}`), `${date}:${pose}:full`);
      await v9.put('photoBlobs', image(`thumb ${date} ${pose}`), `${date}:${pose}:thumb`);
    }
    v9.close();
    const metas = (await getPhotoMetas()).sort((a, b) => a.id.localeCompare(b.id));
    expect(metas).toEqual([
      { ...old('2026-09-01', 'back'), id: '2026-09-01:back:relaxed', variant: 'relaxed' },
      { ...old('2026-09-01', 'front'), id: '2026-09-01:front:relaxed', variant: 'relaxed' },
      { ...old('2026-09-20', 'front'), id: '2026-09-20:front:relaxed', variant: 'relaxed' },
    ]);
    expect(await (await getPhotoBlob('2026-09-01:back:relaxed', 'full'))!.text()).toBe('full 2026-09-01 back');
    expect(await (await getPhotoBlob('2026-09-20:front:relaxed', 'thumb'))!.text()).toBe('thumb 2026-09-20 front');
    expect(await getPhotoBlob('2026-09-01:front', 'full')).toBeUndefined();
    resetDbForTests();
    const raw = await openDB('gym-tracker', 10);
    expect((await raw.getAllKeys('photoBlobs')).sort()).toEqual(metas.flatMap((m) => [`${m.id}:full`, `${m.id}:thumb`]).sort());
    raw.close();
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

describe('cycle days', () => {
  it('live in their own store, never with body days, and each change is marked for sync', async () => {
    await putCycleTracking(true);
    await putCycleDay({ date: '2026-01-02', phase: 'period' });
    expect(await getBody()).toEqual([]);
    const { days, cfg } = await getCycle();
    expect(days).toEqual([{ date: '2026-01-02', phase: 'period' }]);
    expect(cfg).toMatchObject({ tracking: true, rev: 2 });
  });
  it('a finished sync drops cleared-day marks, keeps the phone’s days, and adds the cloud’s', async () => {
    await putCycleDay({ date: '2026-01-02', phase: 'period' });
    await putCycleDay({ date: '2026-01-03', phase: null });
    await finishCycleSync('u1', 2, [{ date: '2026-01-02', phase: 'luteal' }, { date: '2026-01-04', phase: 'period' }], true);
    const { days, cfg } = await getCycle();
    expect(days).toEqual([{ date: '2026-01-02', phase: 'period' }, { date: '2026-01-04', phase: 'period' }]);
    expect(cfg).toMatchObject({ tracking: true, synced: { uid: 'u1', rev: 2 } });
  });
  it('a change made while a sync ran stays marked, so the next sync takes it', async () => {
    await putCycleDay({ date: '2026-01-02', phase: 'period' }); // rev 1, read by the sync
    await putCycleDay({ date: '2026-01-02', phase: null }); // rev 2, cleared mid-sync
    await finishCycleSync('u1', 1, [], undefined);
    const { days, cfg } = await getCycle();
    expect(days).toEqual([{ date: '2026-01-02', phase: null }]);
    expect(cfg.synced).toBeUndefined();
  });
  it('the setting chosen on this phone beats the account’s', async () => {
    await putCycleTracking(false);
    await finishCycleSync('u1', 1, [], true);
    expect((await getCycle()).cfg.tracking).toBe(false);
  });
  it('delete clears the days and marks the cloud copy for deleting', async () => {
    await putCycleDay({ date: '2026-01-02', phase: 'period' });
    await clearCycle();
    const { days, cfg } = await getCycle();
    expect(days).toEqual([]);
    expect(cfg.wiped).toBe(true);
    await finishCycleSync('u1', cfg.rev, [], undefined);
    expect((await getCycle()).cfg.wiped).toBe(false);
  });
});
describe('round 10: delete times and edit times', () => {
  it('a delete made here records when it went; one a sync brings records none (the cloud has its time); Undo drops it', async () => {
    const [a, b] = parseCsv(CSV).entries;
    await putSet(a); await putSet(b);
    const before = Date.now();
    await deleteSetWithTombstone(a.id);
    await deleteSetWithTombstone(b.id, null);
    expect(await getTombstones()).toEqual(new Set([a.id, b.id]));
    expect(Object.keys(await getTombstoneTimes())).toEqual([a.id]);
    expect((await getTombstoneTimes())[a.id]).toBeGreaterThanOrEqual(before);
    await restoreSet(a);
    expect(await getTombstoneTimes()).toEqual({});
  });
  it('renaming a lift times the old ids’ tombstones and stamps the moved sets as edited', async () => {
    const [a] = parseCsv(CSV).entries;
    await putSet(a);
    const before = Date.now();
    await renameLift('Cable Curl', 'Cable Biceps Curl');
    expect(Object.values(await getTombstoneTimes())[0]).toBeGreaterThanOrEqual(before);
    expect((await getAllSets())[0].editedAt).toBeGreaterThanOrEqual(before);
  });
  it('deletes one lift’s settings and one day plan', async () => {
    await putSettings({ key: 'pushdown', repMin: 10, repMax: 15, increment: 5 });
    await putSettings({ key: 'curl', repMin: 8, repMax: 12, increment: 5 });
    await putDayPlan({ key: 'day:2026-09-01', date: '2026-09-01', day: 0, skips: [], swaps: {} });
    await deleteSettings('pushdown');
    await deleteDayPlan('day:2026-09-01');
    expect((await getAllSettings()).map((x) => x.key)).toEqual(['curl']);
    expect(await getDayPlans()).toEqual([]);
  });
});

describe('db v9: copies a sync replaced', () => {
  const rec = (key: string, at: number): Replaced => ({ key, kind: 'body', at, date: '2026-10-01', mine: { weight: 180 }, theirs: { weight: 182 } });
  it('upgrades v8 keeping every store, with nothing replaced yet', async () => {
    const v8 = await openDB('gym-tracker', 8, { upgrade(d) {
      d.createObjectStore('sets', { keyPath: 'id' }).createIndex('date', 'date');
      for (const [s, k] of [['settings', 'key'], ['profile', 'key'], ['program', 'key'], ['body', 'date'], ['config', 'key'], ['cycle', 'date']]) d.createObjectStore(s, { keyPath: k });
      d.createObjectStore('photos', { keyPath: 'id' }).createIndex('date', 'date');
      d.createObjectStore('photoBlobs');
    } });
    await v8.put('sets', { id: 'a', date: '2026-01-01', seq: 0, exercise: 'Curl', setNo: 1, weight: 30, reps: 10, flags: [], source: 's' });
    await v8.put('body', { date: '2026-09-01', weight: 180 });
    await v8.put('cycle', { date: '2026-09-01', phase: 'period' });
    v8.close();
    expect(await getAllSets()).toHaveLength(1);
    expect(await getBody()).toHaveLength(1);
    expect((await getCycle()).days).toHaveLength(1);
    expect(await getReplaced()).toEqual([]);
  });
  it('keeps each by key: the same key again replaces it; dismissing one deletes only it', async () => {
    await putReplaced([rec('a', 1), rec('b', 2)]);
    await putReplaced([rec('a', 3)]);
    expect((await getReplaced()).map((r) => [r.key, r.at])).toEqual([['a', 3], ['b', 2]]);
    await deleteReplaced('a');
    expect((await getReplaced()).map((r) => r.key)).toEqual(['b']);
  });
  it('prunes copies older than the cutoff (30 days, at startup) and keeps the rest', async () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    await putReplaced([rec('old', now - KEEP_MS - 1), rec('edge', now - KEEP_MS + 1), rec('new', now - 1000)]);
    expect(await pruneReplaced(now - KEEP_MS)).toBe(1);
    expect((await getReplaced()).map((r) => r.key).sort()).toEqual(['edge', 'new']);
  });
});
