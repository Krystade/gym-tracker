import { describe, expect, it } from 'vitest';
import { deleteCloudData, syncCloud, type SyncApply } from './sync';
import type { SetEntry } from '../domain/types';
import { replacements, type Replaced } from '../domain/replaced';
import type { Cloud } from './firebase';
import { monthHash } from '../domain/cloud';

/** A stand-in for Firestore: documents by path, collections listed by prefix, and every deleted path. */
function fakeCloud(paths: string[], refuse: Record<string, unknown> = {}, data: Record<string, Record<string, unknown>> = {}) {
  const deleted: string[] = [];
  const batches: string[][] = [];
  const ref = (path: string) => ({ path, id: path.split('/').at(-1)! });
  const F = {
    doc: (_db: unknown, path: string) => ref(path),
    collection: (_db: unknown, path: string) => ({ path }),
    // The board's own posts, by uid (cloud/sync's one query).
    query: (c: { path: string }, w: { field: string; value: unknown }) => ({ path: c.path, w }),
    where: (field: string, _op: string, value: unknown) => ({ field, value }),
    getDoc: async (r: { path: string }) => ({ exists: () => paths.includes(r.path), data: () => (paths.includes(r.path) ? {} : undefined) }),
    getDocs: async (c: { path: string; w?: { field: string; value: unknown } }) => {
      if (refuse[c.path]) throw refuse[c.path];
      return { docs: paths.filter((p) => p.startsWith(`${c.path}/`) && !p.slice(c.path.length + 1).includes('/'))
        .filter((p) => !c.w || data[p]?.[c.w.field] === c.w.value).map((p) => ({ id: ref(p).id, ref: ref(p) })) };
    },
    writeBatch: () => {
      const batch: string[] = [];
      return { delete: (r: { path: string }) => { batch.push(r.path); }, commit: async () => { deleted.push(...batch); batches.push(batch); } };
    },
  };
  return { cloud: { F, db: {} } as unknown as Cloud, deleted, batches };
}
const DOCS = ['users/u1', 'users/u1/meta/settings', 'users/u1/private/cycle', 'users/u1/summary/compare'];

describe('deleteCloudData', () => {
  it('deletes your board posts, your notice, and your post and report counters (with the profile, as the rules want)', async () => {
    const paths = [...DOCS, 'board/mine', 'board/theirs', 'notices/u1', 'boardRate/u1', 'reportRate/u1'];
    const { cloud, deleted, batches } = fakeCloud(paths, {}, { 'board/mine': { uid: 'u1' }, 'board/theirs': { uid: 'u2' } });
    await deleteCloudData(cloud, 'u1');
    expect(deleted).toEqual(expect.arrayContaining(['board/mine', 'notices/u1', 'boardRate/u1', 'reportRate/u1']));
    expect(deleted).not.toContain('board/theirs');
    expect(batches.at(-1)).toEqual(expect.arrayContaining(['boardRate/u1', 'reportRate/u1', 'users/u1']));
    // None there, or the board's rules not deployed yet: nothing to delete, and the account still goes.
    const none = fakeCloud(DOCS, { board: Object.assign(new Error('refused'), { code: 'permission-denied' }) });
    await deleteCloudData(none.cloud, 'u1');
    expect(none.deleted).toContain('users/u1');
    expect(none.deleted.some((p) => /board|notices|Rate/.test(p))).toBe(false);
  });
  it('deletes the private cycle document with the rest of the account', async () => {
    const { cloud, deleted } = fakeCloud(DOCS);
    await deleteCloudData(cloud, 'u1');
    expect(deleted).toContain('users/u1/private/cycle');
    expect(deleted).toContain('users/u1/meta/settings');
    expect(deleted).toContain('users/u1');
  });
  it('deletes the Compare summary too; before its rules are deployed, listing it is refused and there is nothing to delete', async () => {
    const one = fakeCloud(DOCS);
    await deleteCloudData(one.cloud, 'u1');
    expect(one.deleted).toContain('users/u1/summary/compare');
    const refused = fakeCloud(DOCS, { 'users/u1/summary': Object.assign(new Error('refused'), { code: 'permission-denied' }) });
    await deleteCloudData(refused.cloud, 'u1');
    expect(refused.deleted).toContain('users/u1');
    const offline = fakeCloud(DOCS, { 'users/u1/summary': Object.assign(new Error('offline'), { code: 'unavailable' }) });
    await expect(deleteCloudData(offline.cloud, 'u1')).rejects.toMatchObject({ code: 'unavailable' });
    expect(offline.deleted).toEqual([]);
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

describe('syncCloud: the PR ids a month carries for friends (round 18)', () => {
  const NOW = Date.parse('2026-10-07T12:00:00Z');
  const set = (date: string, weight: number): SetEntry => ({ id: `app|${date}|bench press|1`, date, seq: 1, exercise: 'Bench Press', setNo: 1, weight, reps: 8, flags: [], source: 'app' });
  function store(docs: Record<string, Record<string, unknown>>) {
    const snap = (path: string) => ({ exists: () => path in docs, data: () => (path in docs ? structuredClone(docs[path]) : undefined) });
    const set = (r: { path: string }, data: Record<string, unknown>, o?: { merge?: boolean }) => {
      docs[r.path] = o?.merge ? { ...docs[r.path], ...data, months: { ...(docs[r.path]?.months as object), ...(data.months as object) } } : structuredClone(data);
    };
    const F = { doc: (_db: unknown, path: string) => ({ path }), getDoc: async (r: { path: string }) => snap(r.path),
      collection: (_db: unknown, path: string) => ({ path }), documentId: () => '__name__', where: () => null, query: (c: { path: string }) => c,
      getDocs: async () => ({ docs: [] }),
      runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ get: async (r: { path: string }) => snap(r.path), set }) };
    return { F, db: {} } as unknown as Cloud;
  }
  const sync = (cloud: Cloud, sets: SetEntry[], seen = {}) => syncCloud(cloud, 'u1',
    { sets, body: [], tombstones: new Set(), seen, meta: {}, metaSeen: { items: {}, at: 0 } },
    { applyMonth: async (_b, taken) => ({ taken, replaced: [], skipped: 0 }), applyMeta: async () => ({ pulled: 0, removed: 0, skipped: 0 }) }, NOW);

  it('writes the month’s PRs, worked out from the whole log: October’s 200 beats September’s 185', async () => {
    const docs: Record<string, Record<string, unknown>> = {};
    const log = [set('2026-09-02', 180), set('2026-09-20', 185), set('2026-10-01', 175), set('2026-10-05', 200)];
    await sync(store(docs), log);
    expect(docs['users/u1/months/2026-10'].prs).toEqual(['app|2026-10-05|bench press|1']);
    expect(docs['users/u1/months/2026-09'].prs).toEqual(['app|2026-09-20|bench press|1']);
  });
  it('writes nothing for PRs alone: a month whose sets didn’t change is left as it is (two phones never trade it back and forth)', async () => {
    const docs: Record<string, Record<string, unknown>> = {
      'users/u1/meta/index': { months: { '2026-10': 5 } },
      'users/u1/months/2026-10': { sets: [set('2026-10-05', 200)], body: [], deleted: {}, updatedAt: 5 },
    };
    const r = await sync(store(docs), [set('2026-10-05', 200)]);
    expect(r.pushed).toBe(0);
    expect(docs['users/u1/months/2026-10'].prs).toBeUndefined();
  });
});

describe('syncCloud: body days leave the months friends read (2026-10-29)', () => {
  const NOW = Date.parse('2026-10-29T12:00:00Z');
  const set = (date: string): SetEntry => ({ id: `app|${date}|squat|1`, date, seq: 1, exercise: 'Squat', setNo: 1, weight: 225, reps: 5, flags: [], source: 'app' });
  const day = (date: string, weight: number) => ({ date, weight, at: { weight: 1 } });
  function store(docs: Record<string, Record<string, unknown>>) {
    const reads: string[] = [];
    const snap = (path: string) => ({ exists: () => path in docs, data: () => (path in docs ? structuredClone(docs[path]) : undefined) });
    const set = (r: { path: string }, data: Record<string, unknown>, o?: { merge?: boolean }) => {
      docs[r.path] = o?.merge ? { ...docs[r.path], ...data, months: { ...(docs[r.path]?.months as object), ...(data.months as object) } } : structuredClone(data);
    };
    const F = { doc: (_db: unknown, path: string) => ({ path }), getDoc: async (r: { path: string }) => snap(r.path),
      collection: (_db: unknown, path: string) => ({ path }), documentId: () => '__name__', where: () => null, query: (c: { path: string }) => c,
      getDocs: async () => ({ docs: [] }),
      runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ get: async (r: { path: string }) => { reads.push(r.path); return snap(r.path); }, set }) };
    return { cloud: { F, db: {} } as unknown as Cloud, reads };
  }
  // The phone as an older build left it: both months synced, unchanged since on either side, no `kept` mark.
  const sets = [set('2026-09-10'), set('2026-10-05')], body = [day('2026-09-10', 182), day('2026-10-05', 180)];
  const cloud = () => ({
    'users/u1/meta/index': { months: { '2026-09': 5, '2026-10': 6 } },
    'users/u1/months/2026-09': { sets: [sets[0]], body: [body[0]], deleted: {}, updatedAt: 5 },
    'users/u1/months/2026-10': { sets: [sets[1]], body: [body[1]], deleted: {}, updatedAt: 6 },
  } as Record<string, Record<string, unknown>>);
  const oldSeen = {
    '2026-09': { hash: monthHash({ sets: [sets[0]], body: [body[0]], tombstones: new Set() }), at: 5 },
    '2026-10': { hash: monthHash({ sets: [sets[1]], body: [body[1]], tombstones: new Set() }), at: 6 },
  };
  const sync = (c: Cloud, seen: Record<string, { hash: string; at: number; kept?: true }>, b = body, applyMonth: SyncApply['applyMonth'] = async (_b, taken) => ({ taken, replaced: [], skipped: 0 })) =>
    syncCloud(c, 'u1', { sets, body: b, tombstones: new Set(), seen, meta: {}, metaSeen: { items: {}, at: 0 } },
      { applyMonth, applyMeta: async () => ({ pulled: 0, removed: 0, skipped: 0 }) }, NOW);

  it('the first sync with this build moves every month’s body days to the owner’s documents, though nothing changed', async () => {
    const docs = cloud(), { cloud: c } = store(docs);
    const r = await sync(c, oldSeen);
    for (const [m, d] of [['2026-09', body[0]], ['2026-10', body[1]]] as const) {
      expect(docs[`users/u1/months/${m}`]).toMatchObject({ body: [], sets: [expect.objectContaining({ date: d.date })] });
      expect(docs[`users/u1/private/body-${m}`]).toEqual({ body: [d], updatedAt: NOW });
      expect(r.seen[m]).toMatchObject({ at: NOW, kept: true });
    }
    expect(r).toMatchObject({ pulled: 0, pushed: 2 });
  });
  it('then reads nothing more: the next sync, with what this one left, has no month to do', async () => {
    const docs = cloud(), s = store(docs);
    const r = await sync(s.cloud, oldSeen);
    s.reads.length = 0;
    const again = await sync(s.cloud, r.seen);
    expect(s.reads.filter((p) => /months|private/.test(p))).toEqual([]); // (the settings are read on their own first sync)
    expect(again.pushed).toBe(0);
  });
  it('an older phone writing body days back on a month: the next sync here moves them again, and keeps the newer', async () => {
    const docs = cloud(), s = store(docs);
    const r = await sync(s.cloud, oldSeen);
    docs['users/u1/months/2026-10'] = { sets: [sets[1]], body: [day('2026-10-05', 180), { date: '2026-10-07', weight: 179, at: { weight: 2 } }], deleted: {}, updatedAt: NOW + 5 };
    (docs['users/u1/meta/index'].months as Record<string, number>)['2026-10'] = NOW + 5;
    const again = await sync(s.cloud, r.seen);
    expect(docs['users/u1/months/2026-10'].body).toEqual([]);
    expect(docs['users/u1/private/body-2026-10'].body).toEqual([day('2026-10-05', 180), { date: '2026-10-07', weight: 179, at: { weight: 2 } }]);
    expect(again.pulled).toBe(0); // body days aren't counted as pulled sets
  });
  it('a sync that stops partway loses nothing: each month moved whole, and the next sync finishes the rest', async () => {
    const docs = cloud(), s = store(docs);
    let n = 0;
    await expect(sync(s.cloud, oldSeen, body, async (_b, taken) => { if (n++ === 1) throw new Error('closed'); return { taken, replaced: [], skipped: 0 }; })).rejects.toThrow(/closed/);
    const r = await sync(s.cloud, oldSeen); // what was saved last time: the older build's
    expect(docs['users/u1/private/body-2026-09'].body).toEqual([body[0]]);
    expect(docs['users/u1/private/body-2026-10'].body).toEqual([body[1]]);
    expect(docs['users/u1/months/2026-09'].body).toEqual([]);
    expect(docs['users/u1/months/2026-10'].body).toEqual([]);
    expect(r.seen['2026-10'].kept).toBe(true);
  });
  it('a phone with no body days of its own takes them from the owner’s documents', async () => {
    const docs = cloud(), s = store(docs);
    await sync(s.cloud, oldSeen);
    const imported: unknown[] = [];
    await sync(s.cloud, {}, [], async (_b, taken) => { imported.push(...taken.importBody); return { taken, replaced: [], skipped: 0 }; });
    expect(imported).toEqual(body);
  });
});
