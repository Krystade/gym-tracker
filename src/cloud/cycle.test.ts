import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { boundDb, resetDbForTests } from '../db/db';
import { readMeta } from './meta';
import { syncCycle, type CloudCycle } from './cycle';
import type { Cloud } from './firebase';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetDbForTests(); });

/** A stand-in for Firestore: one map of paths, and a log of what was asked of it. */
function fakeCloud(docs: Record<string, unknown> = {}) {
  const log: string[] = [];
  const F = {
    doc: (_db: unknown, path: string) => ({ path }),
    getDoc: async (r: { path: string }) => { log.push(`get ${r.path}`); const v = docs[r.path]; return { exists: () => v != null, data: () => v }; },
    setDoc: async (r: { path: string }, v: unknown) => { log.push(`set ${r.path}`); docs[r.path] = v; },
    deleteDoc: async (r: { path: string }) => { log.push(`delete ${r.path}`); delete docs[r.path]; },
  };
  return { cloud: { F, db: {} } as unknown as Pick<Cloud, 'F' | 'db'>, docs, log };
}
const P = 'users/u1/private/cycle';
const db = () => boundDb('main');

describe('cycle sync', () => {
  it('goes only to the private document, never into the settings friends can read', async () => {
    await db().putCycleTracking(true);
    await db().putCycleDay({ date: '2026-01-02', phase: 'period' });
    const { cloud, docs, log } = fakeCloud();
    await syncCycle(cloud, 'u1', db(), 5);
    expect(log.every((l) => l.endsWith(P))).toBe(true);
    expect(docs[P]).toEqual({ days: { '2026-01-02': 'period' }, tracking: true, updatedAt: 5 });
    expect(JSON.stringify(await readMeta(db()))).not.toMatch(/period|cycle/i);
  });
  it('brings the account’s days and setting to a new phone', async () => {
    const { cloud } = fakeCloud({ [P]: { days: { '2026-01-02': 'luteal' }, tracking: true, updatedAt: 1 } satisfies CloudCycle });
    expect(await syncCycle(cloud, 'u1', db())).toEqual({ pulled: 1, trackingAdopted: true });
    const { days, cfg } = await db().getCycle();
    expect(days).toEqual([{ date: '2026-01-02', phase: 'luteal' }]);
    expect(cfg.tracking).toBe(true);
  });
  it('a phone that never set it takes the account’s setting with no days, and says so once', async () => {
    const { cloud } = fakeCloud({ [P]: { days: {}, tracking: true, updatedAt: 1 } satisfies CloudCycle });
    expect(await syncCycle(cloud, 'u1', db())).toEqual({ pulled: 0, trackingAdopted: true });
    expect((await db().getCycle()).cfg.tracking).toBe(true);
    expect(await syncCycle(cloud, 'u1', db())).toEqual({ pulled: 0, trackingAdopted: false });
  });
  it('a phone that set it keeps its own and adopts nothing', async () => {
    await db().putCycleTracking(false);
    const { cloud } = fakeCloud({ [P]: { days: {}, tracking: true, updatedAt: 1 } satisfies CloudCycle });
    expect(await syncCycle(cloud, 'u1', db())).toEqual({ pulled: 0, trackingAdopted: false });
    expect((await db().getCycle()).cfg.tracking).toBe(false);
  });
  it('a day cleared on the phone is cleared in the account', async () => {
    const { cloud, docs } = fakeCloud({ [P]: { days: { '2026-01-02': 'luteal' }, tracking: true, updatedAt: 1 } });
    await syncCycle(cloud, 'u1', db());
    await db().putCycleDay({ date: '2026-01-02', phase: null });
    await syncCycle(cloud, 'u1', db());
    expect((docs[P] as CloudCycle).days).toEqual({});
    expect((await db().getCycle()).days).toEqual([]);
  });
  it('once synced with the setting off and nothing changed, it reads nothing', async () => {
    const { cloud, log } = fakeCloud();
    await syncCycle(cloud, 'u1', db());
    expect(log).toEqual([`get ${P}`]); // a new phone looks once, in case another phone turned it on
    await syncCycle(cloud, 'u1', db());
    expect(log).toHaveLength(1);
    await syncCycle(cloud, 'u2', db()); // another account: look again
    expect(log).toHaveLength(2);
  });
  it('turning the setting off keeps the days and tells the account', async () => {
    const { cloud, docs } = fakeCloud();
    await db().putCycleTracking(true);
    await db().putCycleDay({ date: '2026-01-02', phase: 'period' });
    await syncCycle(cloud, 'u1', db());
    await db().putCycleTracking(false);
    await syncCycle(cloud, 'u1', db());
    expect(docs[P]).toMatchObject({ days: { '2026-01-02': 'period' }, tracking: false });
    expect((await db().getCycle()).days).toHaveLength(1);
  });
  it('Delete cycle data deletes the account’s copy too, and it stays gone', async () => {
    const { cloud, docs } = fakeCloud({ [P]: { days: { '2026-01-02': 'period' }, tracking: false, updatedAt: 1 } });
    await syncCycle(cloud, 'u1', db());
    await db().clearCycle();
    await syncCycle(cloud, 'u1', db());
    expect(docs[P]).toBeUndefined();
    await syncCycle(cloud, 'u1', db());
    expect((await db().getCycle()).days).toEqual([]);
  });
  it('with the setting still on, Delete leaves only the setting in the account', async () => {
    const { cloud, docs } = fakeCloud({ [P]: { days: { '2026-01-02': 'period' }, tracking: true, updatedAt: 1 } });
    await syncCycle(cloud, 'u1', db());
    await db().clearCycle();
    await syncCycle(cloud, 'u1', db());
    expect(docs[P]).toMatchObject({ days: {}, tracking: true });
  });
  it('a phone that never turned it on creates nothing in the account', async () => {
    const { cloud, docs } = fakeCloud();
    await syncCycle(cloud, 'u1', db());
    await db().putCycleTracking(false);
    await syncCycle(cloud, 'u1', db());
    expect(docs[P]).toBeUndefined();
  });
});
