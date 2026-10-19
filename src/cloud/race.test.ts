import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { boundDb, resetDbForTests, type ProfileDb } from '../db/db';
import { phoneApply, syncCloud, type MetaSeen } from './sync';
import { readMeta } from './meta';
import { metaHash, type Seen } from '../domain/cloud';
import type { BodyDay } from '../domain/body';
import type { SetEntry } from '../domain/types';
import type { Cloud } from './firebase';
import { fromB64, parseDeletedCsv, repoClient, sync as backup, toB64, toDeletedCsv } from '../domain/sync';
import { parseCsv, toCsv } from '../domain/csv';

// An edit made on the phone while a sync is in flight (round 10): the sync's imports and deletes were worked out from what the
// phone had when it started, so they must not land on anything changed since. Synthetic data only.

const NOW = Date.parse('2026-10-07T12:00:00Z');
const S: SetEntry = { id: 'app|2026-10-01|bench press|1', date: '2026-10-01', seq: 1, exercise: 'Bench Press', setNo: 1, weight: 135, reps: 8, flags: [], source: 'app' };
const MONTH = 'users/u1/months/2026-10', INDEX = 'users/u1/meta/index', META = 'users/u1/meta/profile';

/** Firestore documents by path. The transaction numbered `hold` (0-based) waits after its read and write, as a slow commit would. */
function fakeStore(docs: Record<string, Record<string, unknown>>, hold = -1) {
  let n = 0, release!: () => void, reached!: () => void;
  const gate = new Promise<void>((r) => { release = r; }), held = new Promise<void>((r) => { reached = r; });
  const snap = (path: string) => ({ exists: () => path in docs, data: () => (path in docs ? structuredClone(docs[path]) : undefined) });
  const set = (r: { path: string }, data: Record<string, unknown>, o?: { merge?: boolean }) => {
    docs[r.path] = o?.merge ? { ...docs[r.path], ...data, months: { ...(docs[r.path]?.months as object), ...(data.months as object) } } : structuredClone(data);
  };
  const F = {
    doc: (_db: unknown, path: string) => ({ path }), getDoc: async (r: { path: string }) => snap(r.path),
    // The day-plan archive (meta/plans-YYYY), read on a phone's first sync with the build that ages plans out.
    collection: (_db: unknown, path: string) => ({ path }), documentId: () => '__name__', where: () => null, query: (c: { path: string }) => c,
    getDocs: async (q: { path: string }) => ({ docs: Object.keys(docs).filter((p) => p.startsWith(`${q.path}/plans-`)).map(snap) }),
    runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      const out = await fn({ get: async (r: { path: string }) => snap(r.path), set });
      if (n++ === hold) { reached(); await gate; }
      return out;
    },
  };
  return { cloud: { F, db: {} } as unknown as Cloud, docs, held, release };
}


interface Prev { seen: Seen; metaSeen: MetaSeen }
/** One sync, reading and saving to the phone as useCloud does. */
async function sync(cloud: Cloud, prev: Prev = { seen: {}, metaSeen: { items: {}, at: 0 } }) {
  const db = boundDb('main');
  return syncCloud(cloud, 'u1', { ...(await db.getSyncSnapshot()), seen: prev.seen, meta: await readMeta(db), metaSeen: prev.metaSeen }, phoneApply(db), NOW);
}
/** A sync that, while its transaction `hold` is out, lets `edit` land on the phone. */
async function syncAround(store: ReturnType<typeof fakeStore>, edit: (db: ProfileDb) => Promise<unknown>, prev?: Prev) {
  const running = sync(store.cloud, prev);
  await store.held;
  await edit(boundDb('main'));
  store.release();
  return running;
}
const cloudSets = (docs: Record<string, Record<string, unknown>>) => (docs[MONTH]?.sets as SetEntry[]).map((s) => ({ weight: s.weight, reps: s.reps }));

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetDbForTests(); });

describe('a set edited on this phone while a sync is out', () => {
  it('survives the sync bringing another phone’s older edit of it, and goes up at the next sync', async () => {
    const db = boundDb('main');
    await db.putSet(S);
    const store = fakeStore({ [INDEX]: { months: { '2026-10': 5 } }, [MONTH]: { sets: [{ ...S, reps: 10, editedAt: 100 }], body: [], deleted: {}, updatedAt: 5 } }, 0);
    const r = await syncAround(store, (db) => db.putSet({ ...S, weight: 150, editedAt: 200 }));
    expect(r.skipped).toBe(1);
    expect((await db.getAllSets()).map((s) => s.weight)).toEqual([150]);
    expect(await db.getReplaced()).toEqual([]); // the sync replaced nothing: the edit was the phone's own, after it read
    expect((await sync(store.cloud, r)).skipped).toBe(0);
    expect(cloudSets(store.docs)).toEqual([{ weight: 150, reps: 8 }]);
    expect((await db.getAllSets()).map((s) => s.weight)).toEqual([150]);
  });

  it('survives another phone’s older delete of it, and comes back in the cloud at the next sync', async () => {
    const db = boundDb('main');
    await db.putSet(S);
    const store = fakeStore({ [INDEX]: { months: { '2026-10': 5 } }, [MONTH]: { sets: [], body: [], deleted: { [S.id]: 100 }, updatedAt: 5 } }, 0);
    const r = await syncAround(store, (db) => db.putSet({ ...S, weight: 150, editedAt: 200 }));
    expect(r.skipped).toBe(1);
    expect((await db.getAllSets()).map((s) => s.weight)).toEqual([150]);
    expect(await db.getTombstones()).toEqual(new Set());
    expect((await sync(store.cloud, r)).skipped).toBe(0);
    expect(cloudSets(store.docs)).toEqual([{ weight: 150, reps: 8 }]);
  });

  it('deleted while the sync is out, stays deleted, and the delete goes up at the next sync', async () => {
    const db = boundDb('main');
    await db.putSet(S);
    const store = fakeStore({ [INDEX]: { months: { '2026-10': 5 } }, [MONTH]: { sets: [{ ...S, reps: 10, editedAt: 100 }], body: [], deleted: {}, updatedAt: 5 } }, 0);
    const r = await syncAround(store, (db) => db.deleteSetWithTombstone(S.id));
    expect(r.skipped).toBe(1);
    expect(await db.getAllSets()).toEqual([]);
    expect((await sync(store.cloud, r)).skipped).toBe(0);
    expect(cloudSets(store.docs)).toEqual([]);
    expect(await db.getAllSets()).toEqual([]);
  });

  it('logged under the id of a set the sync brings, is kept: on the phone, then as a copy the next sync replaced', async () => {
    const db = boundDb('main');
    const store = fakeStore({ [INDEX]: { months: { '2026-10': 5 } }, [MONTH]: { sets: [{ ...S, weight: 225 }], body: [], deleted: {}, updatedAt: 5 } }, 0);
    const r = await syncAround(store, (db) => db.putSet({ ...S, weight: 95 }));
    expect(r.skipped).toBe(1);
    expect((await db.getAllSets()).map((s) => s.weight)).toEqual([95]);
    expect((await sync(store.cloud, r)).skipped).toBe(0);
    // Two phones logged set 1 of the same lift that day: the cloud's copy wins the tie, and this phone's is kept to put back.
    expect((await db.getAllSets()).map((s) => s.weight)).toEqual([225]);
    expect((await db.getReplaced()).map((x) => x.kind === 'set' && x.mine.weight)).toEqual([95]);
  });
});

describe('what a sync takes, around edits to something else', () => {
  it('still lands, with this phone’s copy kept, when the edit made meanwhile was to another set and another field', async () => {
    const db = boundDb('main'), other = { ...S, id: 'app|2026-10-01|bench press|2', setNo: 2, seq: 2 }, gone = { ...S, id: 'app|2026-10-01|bench press|3', setNo: 3, seq: 3 };
    await db.putSet(S); await db.putSet(other); await db.putSet(gone);
    await db.putBody({ date: '2026-10-01', weight: 180, at: { weight: 50 } });
    const store = fakeStore({ [INDEX]: { months: { '2026-10': 5 } }, [MONTH]: {
      sets: [{ ...S, reps: 10, editedAt: 100 }, other], body: [{ date: '2026-10-01', weight: 181, at: { weight: 100 } }], deleted: { [gone.id]: 100 }, updatedAt: 5 } }, 0);
    const r = await syncAround(store, async (db) => { await db.putSet({ ...other, weight: 150, editedAt: 200 }); await db.putBody({ date: '2026-10-01', weight: 180, protein: 140, at: { weight: 50, protein: 200 } }); });
    expect(r).toMatchObject({ skipped: 0, pulled: 1, removed: 1, replaced: 3 });
    expect(await db.getTombstones()).toEqual(new Set([gone.id]));
    expect(await db.getTombstoneTimes()).toEqual({}); // another phone's delete: the cloud has its time
    expect((await db.getAllSets()).map((s) => [s.setNo, s.weight, s.reps])).toEqual([[1, 135, 10], [2, 150, 8]]);
    expect(await db.getBody()).toEqual([{ date: '2026-10-01', weight: 181, protein: 140, at: { weight: 100, protein: 200 } }]);
    expect((await db.getReplaced()).map((x) => x.kind === 'set' ? [x.mine.setNo, x.theirs?.reps ?? null] : x.mine)).toEqual([{ weight: 180 }, [1, 10], [3, null]]);
  });
});

describe('a body field entered on this phone while a sync is out', () => {
  it('survives the sync bringing another phone’s older value, and goes up at the next sync', async () => {
    const db = boundDb('main');
    await db.putBody({ date: '2026-10-01', weight: 180, at: { weight: 50 } });
    const store = fakeStore({ [INDEX]: { months: { '2026-10': 5 } }, [MONTH]: { sets: [], body: [{ date: '2026-10-01', weight: 181, protein: 150, at: { weight: 100 } }], deleted: {}, updatedAt: 5 } }, 0);
    const r = await syncAround(store, (db) => db.putBody({ date: '2026-10-01', weight: 182, at: { weight: 200 } }));
    expect(r.skipped).toBe(1);
    // The weight entered during the sync stays; protein, which the phone didn't touch, still comes in.
    expect(await db.getBody()).toEqual([{ date: '2026-10-01', weight: 182, protein: 150, at: { weight: 200 } }]);
    expect((await sync(store.cloud, r)).skipped).toBe(0);
    expect((store.docs[MONTH].body as BodyDay[]).map((d) => [d.weight, d.protein])).toEqual([[182, 150]]);
  });
});

describe('a setting changed on this phone while a sync is out', () => {
  const X1 = { key: 'bench press', repMin: 6, repMax: 10, increment: 5 }, X2 = { ...X1, repMax: 12 }, X3 = { ...X1, increment: 10 };
  const seenX1: Prev = { seen: {}, metaSeen: { items: { 'settings:bench press': metaHash(X1) }, at: 6 } };
  const cloudItems = (docs: Record<string, Record<string, unknown>>) => Object.fromEntries(Object.entries(docs[META].items as Record<string, string>).map(([k, v]) => [k, JSON.parse(v) as unknown]));

  it('survives the sync bringing another phone’s change, and goes up at the next sync', async () => {
    const db = boundDb('main');
    await db.putSettings(X1);
    const store = fakeStore({ [INDEX]: { meta: 7 }, [META]: { items: { 'settings:bench press': JSON.stringify(X2) }, updatedAt: 7 } }, 0);
    const r = await syncAround(store, (db) => db.putSettings(X3), seenX1);
    expect(r.skipped).toBe(1);
    expect(await db.getAllSettings()).toEqual([X3]);
    expect((await sync(store.cloud, r)).skipped).toBe(0);
    expect(cloudItems(store.docs)).toEqual({ 'settings:bench press': X3 });
  });

  it('survives the sync bringing another phone’s delete of it, and goes back up at the next sync', async () => {
    const db = boundDb('main');
    await db.putSettings(X1);
    const store = fakeStore({ [INDEX]: { meta: 7 }, [META]: { items: {}, updatedAt: 7 } }, 0);
    const r = await syncAround(store, (db) => db.putSettings(X3), seenX1);
    expect(r.skipped).toBe(1);
    expect(await db.getAllSettings()).toEqual([X3]);
    expect((await sync(store.cloud, r)).skipped).toBe(0);
    expect(cloudItems(store.docs)).toEqual({ 'settings:bench press': X3 });
  });
});

describe('a set edited on this phone while the private backup is pulled (domain/sync)', () => {
  it('survives the backup’s older edit of it; the backup gets the phone’s at the next sync', async () => {
    const db = boundDb('main');
    const mine = { ...S, id: 'backup|2026-10-01|bench press|1', source: 'backup' };
    await db.putSet(mine);
    const files = new Map([['app/sets.csv', { text: toCsv([{ ...mine, reps: 10, editedAt: 100 }]), sha: 'a' }]]);
    let release!: () => void, reached!: () => void, holding = true;
    const gate = new Promise<void>((r) => { release = r; }), held = new Promise<void>((r) => { reached = r; });
    const fetchFn = async (url: string, init: RequestInit = {}): Promise<Response> => {
      const path = decodeURIComponent(new URL(url).pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''));
      if ((init.method ?? 'GET') === 'GET') {
        if (path === 'app/body.csv' && holding) { holding = false; reached(); await gate; } // the last read before the pull lands
        const f = files.get(path);
        return f ? Response.json({ encoding: 'base64', content: toB64(f.text), sha: f.sha }) : new Response('{}', { status: 404 });
      }
      const body = JSON.parse(String(init.body)) as { content: string };
      files.set(path, { text: fromB64(body.content), sha: `${path}-${files.size}` });
      return Response.json({}, { status: 201 });
    };
    const run = async () => {
      const log = await db.getSyncSnapshot();
      return backup({ client: repoClient({ key: 'sync', repo: 'someone/data', token: 't', branch: 'main' }, fetchFn), sets: log.sets, body: log.body, deleted: log.tombstones,
        now: new Date(NOW), apply: phoneApply(db).applyMonth });
    };
    const first = run();
    await held;
    await db.putSet({ ...mine, weight: 150, editedAt: 200 });
    release();
    expect(await first).toMatchObject({ pulledSets: 0 });
    expect((await db.getAllSets()).map((s) => s.weight)).toEqual([150]);
    expect(await db.getReplaced()).toEqual([]);
    await run();
    expect(parseCsv(files.get('app/sets.csv')!.text).entries.map((s) => s.weight)).toEqual([150]);
  });
});

describe('deletes and the private backup, through this phone’s database (round 10, 2b)', () => {
  const H: SetEntry = { ...S, id: 'notes|2026-10-01|bench press|1', source: 'notes' };
  /** A repo in memory; a GET of `hold` waits once, as a slow read would, until released. */
  function repo(init: Record<string, string>, hold?: string) {
    const files = new Map(Object.entries(init).map(([p, t]) => [p, { text: t, sha: `${p}-0` }]));
    let release!: () => void, reached!: () => void;
    const gate = new Promise<void>((r) => { release = r; }), held = new Promise<void>((r) => { reached = r; });
    const fetchFn = async (url: string, init: RequestInit = {}): Promise<Response> => {
      const path = decodeURIComponent(new URL(url).pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''));
      if ((init.method ?? 'GET') === 'GET') {
        if (path === hold) { hold = undefined; reached(); await gate; }
        const f = files.get(path);
        return f ? Response.json({ encoding: 'base64', content: toB64(f.text), sha: f.sha }) : new Response('{}', { status: 404 });
      }
      const body = JSON.parse(String(init.body)) as { content: string };
      files.set(path, { text: fromB64(body.content), sha: `${path}-${files.size}-${Math.random()}` });
      return Response.json({}, { status: 201 });
    };
    return { files, fetchFn, held, release };
  }
  /** One backup sync, reading and saving to the phone as useSync does. */
  const backupSync = async (db: ProfileDb, fetchFn: (u: string, i?: RequestInit) => Promise<Response>) => {
    const log = await db.getSyncSnapshot();
    return backup({ client: repoClient({ key: 'sync', repo: 'someone/data', token: 't', branch: 'main' }, fetchFn), sets: log.sets, body: log.body,
      deleted: log.tombstones, tombAt: log.tombAt, now: new Date(NOW), apply: phoneApply(db).applyMonth });
  };

  it('a set deleted here goes into deleted.csv at its delete time, and a fresh phone restoring the backup leaves it out', async () => {
    const r = repo({ 'history.csv': toCsv([H, { ...H, id: 'notes|2026-10-01|bench press|2', setNo: 2 }]) });
    const db = boundDb('main');
    await backupSync(db, r.fetchFn);
    expect(await db.getAllSets()).toHaveLength(2);
    await db.deleteSetWithTombstone(H.id, NOW - 1000);
    await backupSync(db, r.fetchFn);
    expect(parseDeletedCsv(r.files.get('app/deleted.csv')!.text).deleted).toEqual({ [H.id]: NOW - 1000 });

    globalThis.indexedDB = new IDBFactory(); resetDbForTests(); // a new phone
    const fresh = boundDb('main');
    await backupSync(fresh, r.fetchFn);
    expect((await fresh.getAllSets()).map((s) => s.id)).toEqual(['notes|2026-10-01|bench press|2']);
  });

  it('a set another device deleted goes from this phone with a tombstone, its copy kept under Replaced by sync', async () => {
    const db = boundDb('main');
    await db.putSet(S);
    const r = repo({ 'app/sets.csv': toCsv([S]), 'app/deleted.csv': toDeletedCsv({ [S.id]: NOW - 1000 }) });
    expect(await backupSync(db, r.fetchFn)).toMatchObject({ removedSets: 1, pushedSets: 0 });
    expect(await db.getAllSets()).toEqual([]);
    expect(await db.getTombstones()).toEqual(new Set([S.id]));
    expect((await db.getReplaced()).map((x) => [x.kind, x.kind === 'set' && x.mine.id, x.kind === 'set' && x.theirs])).toEqual([['set', S.id, null]]);
    expect(parseCsv(r.files.get('app/sets.csv')!.text).entries).toEqual([]);
  });

  it('a set edited here while the pull is out survives another device’s earlier delete, and goes back up at the next sync', async () => {
    const db = boundDb('main');
    await db.putSet(S);
    const r = repo({ 'app/sets.csv': toCsv([S]), 'app/deleted.csv': toDeletedCsv({ [S.id]: NOW - 1000 }) }, 'app/body.csv');
    const first = backupSync(db, r.fetchFn);
    await r.held;
    await db.putSet({ ...S, weight: 150, editedAt: NOW });
    r.release();
    expect(await first).toMatchObject({ removedSets: 0 });
    expect((await db.getAllSets()).map((s) => s.weight)).toEqual([150]);
    expect(await db.getReplaced()).toEqual([]);
    await backupSync(db, r.fetchFn);
    expect((await db.getAllSets()).map((s) => s.weight)).toEqual([150]);
    expect(parseCsv(r.files.get('app/sets.csv')!.text).entries.map((s) => s.weight)).toEqual([150]);
  });
});
