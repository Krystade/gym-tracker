import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { boundDb, resetDbForTests } from '../db/db';
import { decodeLedger, encodeLedger, type Ledger } from '../domain/together';
import { readMeta } from './meta';
import { syncTogether, TOGETHER_READ_MS, togetherPath } from './together';
import type { Cloud } from './firebase';

// Synthetic uids and days only.
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetDbForTests(); });

function fakeCloud(docs: Record<string, unknown> = {}) {
  const log: string[] = [];
  const F = {
    doc: (_db: unknown, path: string) => ({ path }),
    getDoc: async (r: { path: string }) => { log.push(`get ${r.path}`); const v = docs[r.path]; return { exists: () => v != null, data: () => v }; },
    setDoc: async (r: { path: string }, v: unknown) => { log.push(`set ${r.path}`); docs[r.path] = v; },
  };
  return { cloud: { F, db: {} } as unknown as Pick<Cloud, 'F' | 'db'>, docs, log };
}
const P = togetherPath('u1');
const db = () => boundDb('main');
const L = (days: string[], tog: string[] = [], week: [string, string][] = []): Ledger => ({ ana: { day: new Set(days), tog: new Set(tog), week: new Map(week) } });
const days = async () => [...(decodeLedger((await db().getTogether('u1')).ledger).ana?.day ?? [])].sort();

describe('Together’s ledger on the account', () => {
  it('goes only to the private document, never into the settings friends read', async () => {
    expect(await db().addTogether('u1', encodeLedger(L(['2026-11-02'], ['2026-11-02'])))).toBe(true);
    const { cloud, docs, log } = fakeCloud();
    await syncTogether(cloud, 'u1', db(), 5);
    expect(log).toEqual([`get ${P}`, `set ${P}`]);
    expect(P).toBe('users/u1/private/together');
    expect([...decodeLedger(docs[P]).ana.tog]).toEqual(['2026-11-02']);
    expect(JSON.stringify(await readMeta(db()))).not.toMatch(/together|ana/i);
  });
  it('a union both ways: another phone’s days come in, this phone’s go up, nothing is lost', async () => {
    await db().addTogether('u1', encodeLedger(L(['2026-11-02'])));
    const { cloud, docs } = fakeCloud({ [P]: encodeLedger(L(['2026-11-04'])) });
    expect(await syncTogether(cloud, 'u1', db(), 5)).toBe(true);
    expect(await days()).toEqual(['2026-11-02', '2026-11-04']);
    expect([...decodeLedger(docs[P]).ana.day].sort()).toEqual(['2026-11-02', '2026-11-04']);
  });
  it('reads only when something changed here or a day has passed; writes only what the account lacks', async () => {
    const { cloud, log } = fakeCloud({ [P]: encodeLedger(L(['2026-11-04'])) });
    await syncTogether(cloud, 'u1', db(), 1000);
    log.length = 0;
    await syncTogether(cloud, 'u1', db(), 2000);
    expect(log).toEqual([]); // nothing new here, read a moment ago
    await db().addTogether('u1', encodeLedger(L(['2026-11-04']))); // what it already has: no change
    await syncTogether(cloud, 'u1', db(), 3000);
    expect(log).toEqual([]);
    await db().addTogether('u1', encodeLedger(L(['2026-11-06'])));
    await syncTogether(cloud, 'u1', db(), 4000);
    expect(log).toEqual([`get ${P}`, `set ${P}`]);
    log.length = 0;
    await syncTogether(cloud, 'u1', db(), 4000 + TOGETHER_READ_MS);
    expect(log).toEqual([`get ${P}`]); // a day on: read, nothing to write
  });
  it('another account signed in on this profile starts with none of the first one’s', async () => {
    await db().addTogether('u1', encodeLedger(L(['2026-11-02'])));
    expect(Object.keys(decodeLedger((await db().getTogether('u2')).ledger))).toEqual([]);
    const { cloud, docs } = fakeCloud();
    await syncTogether(cloud, 'u2', db(), 5);
    expect(docs[togetherPath('u2')]).toBeUndefined();
  });
  it('signed out, it goes from the phone', async () => {
    await db().addTogether('u1', encodeLedger(L(['2026-11-02'])));
    await db().clearTogether();
    expect(await days()).toEqual([]);
  });
  it('an account copy not in shape is read as nothing, and this phone’s goes up over it', async () => {
    await db().addTogether('u1', encodeLedger(L(['2026-11-02'])));
    const { cloud, docs } = fakeCloud({ [P]: { f: 'garbage' } });
    await syncTogether(cloud, 'u1', db(), 5);
    expect([...decodeLedger(docs[P]).ana.day]).toEqual(['2026-11-02']);
  });
});
