import { describe, expect, it } from 'vitest';
import { deleteCloudData, syncCloud, type SyncApply } from './sync';
import type { SetEntry } from '../domain/types';
import { replacements, type Replaced } from '../domain/replaced';
import type { Cloud } from './firebase';

/** A stand-in for Firestore: documents by path, collections listed by prefix, and every deleted path. */
function fakeCloud(paths: string[], refuse: Record<string, unknown> = {}) {
  const deleted: string[] = [];
  const ref = (path: string) => ({ path, id: path.split('/').at(-1)! });
  const F = {
    doc: (_db: unknown, path: string) => ref(path),
    collection: (_db: unknown, path: string) => ({ path }),
    getDoc: async (r: { path: string }) => ({ exists: () => paths.includes(r.path), data: () => (paths.includes(r.path) ? {} : undefined) }),
    getDocs: async (c: { path: string }) => {
      if (refuse[c.path]) throw refuse[c.path];
      return { docs: paths.filter((p) => p.startsWith(`${c.path}/`) && !p.slice(c.path.length + 1).includes('/')).map((p) => ({ id: ref(p).id, ref: ref(p) })) };
    },
    writeBatch: () => {
      const batch: string[] = [];
      return { delete: (r: { path: string }) => { batch.push(r.path); }, commit: async () => { deleted.push(...batch); } };
    },
  };
  return { cloud: { F, db: {} } as unknown as Cloud, deleted };
}
const DOCS = ['users/u1', 'users/u1/meta/settings', 'users/u1/private/cycle'];

describe('deleteCloudData', () => {
  it('deletes the private cycle document with the rest of the account', async () => {
    const { cloud, deleted } = fakeCloud(DOCS);
    await deleteCloudData(cloud, 'u1');
    expect(deleted).toContain('users/u1/private/cycle');
    expect(deleted).toContain('users/u1/meta/settings');
    expect(deleted).toContain('users/u1');
  });
  it('goes on when listing private is refused (rules not deployed yet): nothing there to delete', async () => {
    const { cloud, deleted } = fakeCloud(DOCS, { 'users/u1/private': Object.assign(new Error('refused'), { code: 'permission-denied' }) });
    await deleteCloudData(cloud, 'u1');
    expect(deleted).toContain('users/u1');
  });
  it('stops on any other failure listing private, so cycle days are never left behind a deleted account', async () => {
    const { cloud, deleted } = fakeCloud(DOCS, { 'users/u1/private': Object.assign(new Error('offline'), { code: 'unavailable' }) });
    await expect(deleteCloudData(cloud, 'u1')).rejects.toMatchObject({ code: 'unavailable' });
    expect(deleted).toEqual([]);
  });
});

describe('syncCloud: this phone’s copies a sync replaces (round 10)', () => {
  const NOW = Date.parse('2026-10-07T12:00:00Z');
  const mine: SetEntry = { id: 'app|2026-10-01|bench press|1', date: '2026-10-01', seq: 1, exercise: 'Bench Press', setNo: 1, weight: 185, reps: 8, flags: [], source: 'app' };
  /** Firestore documents by path, with transactions that read and write them. */
  function fakeStore(docs: Record<string, Record<string, unknown>>) {
    const snap = (path: string) => ({ exists: () => path in docs, data: () => (path in docs ? structuredClone(docs[path]) : undefined) });
    const set = (r: { path: string }, data: Record<string, unknown>, o?: { merge?: boolean }) => {
      docs[r.path] = o?.merge ? { ...docs[r.path], ...data, months: { ...(docs[r.path]?.months as object), ...(data.months as object) } } : structuredClone(data);
    };
    const F = { doc: (_db: unknown, path: string) => ({ path }), getDoc: async (r: { path: string }) => snap(r.path),
      // The day-plan archive (meta/plans-YYYY), read on a phone's first sync with the build that ages plans out.
      collection: (_db: unknown, path: string) => ({ path }), documentId: () => '__name__', where: () => null, query: (c: { path: string }) => c,
      getDocs: async (q: { path: string }) => ({ docs: Object.keys(docs).filter((p) => p.startsWith(`${q.path}/plans-`)).map(snap) }),
      runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ get: async (r: { path: string }) => snap(r.path), set }) };
    return { F, db: {} } as unknown as Cloud;
  }
  const run = (cloud: Cloud, applyMonth: SyncApply['applyMonth']) => syncCloud(cloud, 'u1',
    { sets: [mine], body: [], tombstones: new Set(), seen: {}, meta: {}, metaSeen: { items: {}, at: 0 } },
    { applyMonth, applyMeta: async () => ({ pulled: 0, removed: 0, skipped: 0 }) }, NOW);
  const withCloudCopy = () => fakeStore({ 'users/u1/meta/index': { months: { '2026-10': 5 } }, 'users/u1/months/2026-10': { sets: [{ ...mine, reps: 10 }], body: [], deleted: {}, updatedAt: 5 } });

  it('hands the phone’s side the month as it read it and what it takes, and counts what that kept', async () => {
    const calls: [unknown, unknown][] = [];
    const r = await run(withCloudCopy(), async (base, taken, now) => {
      calls.push([base.sets, taken.importSets]);
      return { taken, replaced: replacements(base, taken, now), skipped: 0 };
    });
    expect(calls).toEqual([[[mine], [{ ...mine, reps: 10 }]]]);
    expect(r).toMatchObject({ replaced: 1, replacedSets: 1, pulled: 1, skipped: 0 });
  });
  it('counts only what the phone’s side took, and what it left for the next sync', async () => {
    const r = await run(withCloudCopy(), async (_base, taken) => ({ taken: { ...taken, importSets: [] }, replaced: [] as Replaced[], skipped: 1 }));
    expect(r).toMatchObject({ replaced: 0, pulled: 0, skipped: 1 });
  });
  it('stops when the phone couldn’t save', async () => {
    await expect(run(withCloudCopy(), async () => { throw new Error('disk full'); })).rejects.toThrow(/Saving the synced log on this phone failed: disk full/);
  });
});
