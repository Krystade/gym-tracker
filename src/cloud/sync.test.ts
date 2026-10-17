import { describe, expect, it } from 'vitest';
import { deleteCloudData, syncCloud } from './sync';
import type { SetEntry } from '../domain/types';
import type { Replaced } from '../domain/replaced';
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
      runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ get: async (r: { path: string }) => snap(r.path), set }) };
    return { F, db: {} } as unknown as Cloud;
  }
  const run = (cloud: Cloud, recordReplaced: (xs: Replaced[]) => Promise<boolean>, log: string[]) => syncCloud(cloud, 'u1',
    { sets: [mine], body: [], tombstones: new Set(), seen: {}, meta: {}, metaSeen: { items: {}, at: 0 } }, {
      recordReplaced, importSets: async (xs) => { log.push(`import ${xs.length}`); return {}; }, importBody: async () => true, removeSets: async () => true,
      importMeta: async () => {}, removeMeta: async () => {},
    }, NOW);
  const withCloudCopy = () => fakeStore({ 'users/u1/meta/index': { months: { '2026-10': 5 } }, 'users/u1/months/2026-10': { sets: [{ ...mine, reps: 10 }], body: [], deleted: {}, updatedAt: 5 } });

  it('hands this phone’s copy over to be kept before it takes the cloud’s, and counts it', async () => {
    const log: string[] = [], kept: Replaced[] = [];
    const r = await run(withCloudCopy(), async (xs) => { log.push(`keep ${xs.length}`); kept.push(...xs); return true; }, log);
    expect(log).toEqual(['keep 1', 'import 1']);
    expect(kept[0]).toMatchObject({ kind: 'set', mine, theirs: { ...mine, reps: 10 } });
    expect(r).toMatchObject({ replaced: 1, replacedSets: 1, pulled: 1 });
  });
  it('takes nothing when this phone’s copy couldn’t be kept', async () => {
    const log: string[] = [];
    await expect(run(withCloudCopy(), async () => false, log)).rejects.toThrow(/replaced/);
    expect(log).toEqual([]);
  });
});
