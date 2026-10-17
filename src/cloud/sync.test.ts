import { describe, expect, it } from 'vitest';
import { deleteCloudData } from './sync';
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
