import { describe, expect, it } from 'vitest';
import { syncCloud, PLAN_DAYS, type MetaSeen, type SyncApply } from './sync';
import { mergeMeta, metaHash, type MetaItems } from '../domain/cloud';
import type { Cloud } from './firebase';

// Day plans older than PLAN_DAYS leave the settings document (users/{uid}/meta/profile) for a yearly archive
// (meta/plans-YYYY), so the document every sync reads and writes whole stops growing by a plan every training day.
// Synthetic data only.

type Doc = Record<string, unknown>;
const isObj = (x: unknown): x is Doc => !!x && typeof x === 'object' && !Array.isArray(x);
const deepMerge = (a: Doc, b: Doc): Doc => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])]
  .map((k) => [k, k in b ? (isObj(a[k]) && isObj(b[k]) ? deepMerge(a[k] as Doc, b[k] as Doc) : structuredClone(b[k])) : a[k]]));

/** Firestore by path: getDoc, transactions (set, with merge), and collection queries by document id range. */
function fakeCloud(docs: Record<string, Doc> = {}) {
  const listed: string[] = [];
  const snap = (path: string) => ({ id: path.split('/').at(-1)!, exists: () => path in docs, data: () => (path in docs ? structuredClone(docs[path]) : undefined) });
  const set = (r: { path: string }, data: Doc, o?: { merge?: boolean }) => { docs[r.path] = o?.merge ? deepMerge(docs[r.path] ?? {}, data) : structuredClone(data); };
  const F = {
    doc: (_db: unknown, path: string) => ({ path }),
    collection: (_db: unknown, path: string) => ({ path, filters: [] as [string, string, string][] }),
    documentId: () => '__id__',
    where: (field: string, op: string, value: string) => [field, op, value],
    query: (c: { path: string; filters: [string, string, string][] }, ...w: [string, string, string][]) => ({ path: c.path, filters: [...c.filters, ...w] }),
    getDoc: async (r: { path: string }) => snap(r.path),
    getDocs: async (q: { path: string; filters: [string, string, string][] }) => {
      listed.push(q.path);
      const ok = (id: string) => q.filters.every(([f, op, v]) => f !== '__id__' || (op === '>=' ? id >= v : op === '<' ? id < v : op === '<=' ? id <= v : op === '>' ? id > v : id === v));
      const hits = Object.keys(docs).filter((p) => p.startsWith(`${q.path}/`) && !p.slice(q.path.length + 1).includes('/') && ok(p.slice(q.path.length + 1)));
      const out = hits.sort().map(snap);
      return { docs: out, size: out.length, empty: !out.length };
    },
    runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ get: async (r: { path: string }) => snap(r.path), set }),
  };
  return { cloud: { F, db: {} } as unknown as Cloud, docs, listed };
}

/** A phone: its settings as readMeta gives them, and what its last sync left (cloud/sync MetaSeen). */
interface Phone { meta: MetaItems; metaSeen: MetaSeen }
const phone = (meta: MetaItems = {}): Phone => ({ meta: structuredClone(meta), metaSeen: { items: {}, at: 0 } });
/** The phone's side of a sync, in memory: takes what's pulled, drops what's removed (each only if unchanged since the read, as db applySyncedMeta). */
const applyTo = (p: Phone): SyncApply => ({
  applyMonth: async () => { throw new Error('no months here'); },
  applyMeta: async (base, pull, remove) => {
    const out = { pulled: 0, removed: 0, skipped: 0 };
    for (const [k, v] of Object.entries(pull)) { if (metaHash(p.meta[k] ?? null) !== metaHash(base[k] ?? null)) out.skipped++; else { p.meta[k] = v; out.pulled++; } }
    for (const k of remove) { if (metaHash(p.meta[k] ?? null) !== metaHash(base[k] ?? null)) out.skipped++; else { delete p.meta[k]; out.removed++; } }
    return out;
  },
});
async function sync(c: ReturnType<typeof fakeCloud>, p: Phone, now: number) {
  const r = await syncCloud(c.cloud, 'u1', { sets: [], body: [], tombstones: new Set(), seen: {}, meta: structuredClone(p.meta), metaSeen: p.metaSeen }, applyTo(p), now);
  p.metaSeen = r.metaSeen;
  return r;
}

const at = (date: string) => new Date(`${date}T12:00:00`).getTime(); // noon, local
const NOW = at('2026-10-18'); // PLAN_DAYS back: 2026-07-20
const plan = (date: string, day = 0) => ({ key: `day:${date}`, date, day, skips: [], swaps: {} });
const items = (...xs: { key: string }[]): MetaItems => Object.fromEntries(xs.map((x) => [x.key, x]));
const PROGRAM = { key: 'program', perSession: 4, createdAt: 'x', days: [] };
const PROFILE = 'users/u1/meta/profile', INDEX = 'users/u1/meta/index';
const cloudDoc = (c: ReturnType<typeof fakeCloud>, path = PROFILE) =>
  Object.fromEntries(Object.entries((c.docs[path]?.items ?? {}) as Record<string, string>).map(([k, v]) => [k, JSON.parse(v) as unknown]));
const asDoc = (m: MetaItems, updatedAt = 5) => ({ items: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, JSON.stringify(v)])), updatedAt });

describe('old day plans (cloud/sync syncMeta)', () => {
  it('keep the last PLAN_DAYS days in the settings document', () => expect(PLAN_DAYS).toBe(90));

  it('leave the settings document for their year’s archive at a phone’s first sync with this build, and stay on the phone', async () => {
    const all = items(PROGRAM as never, plan('2026-10-01'), plan('2026-07-20'), plan('2026-07-19'), plan('2026-01-05'), plan('2025-06-02'));
    const c = fakeCloud({ [PROFILE]: asDoc(all), [INDEX]: { meta: 5 } });
    const p = phone(all);
    // Synced with an older build: everything as the document has it, nothing changed since.
    p.metaSeen = { items: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, metaHash(v)])), at: 5 };
    const r = await sync(c, p, NOW);
    expect(c.listed).toEqual(['users/u1/meta']); // the archive, read once
    expect(Object.keys(cloudDoc(c)).sort()).toEqual(['day:2026-07-20', 'day:2026-10-01', 'program']);
    expect(cloudDoc(c, 'users/u1/meta/plans-2026')).toEqual(items(plan('2026-07-19'), plan('2026-01-05')));
    expect(cloudDoc(c, 'users/u1/meta/plans-2025')).toEqual(items(plan('2025-06-02')));
    expect(p.meta).toEqual(all); // nothing deleted, nothing pulled
    expect(r.metaPulled).toBe(0);
    expect(c.docs[PROFILE].plansFrom).toBe('2026-07-20');
    expect(c.docs[INDEX].meta).toBe(NOW); // friends and other phones see the settings changed
    expect(p.metaSeen).toMatchObject({ at: NOW, plansFrom: '2026-07-20' });
    expect(Object.keys(p.metaSeen.items).sort()).toEqual(['day:2026-07-20', 'day:2026-10-01', 'program']);
    // Nothing changed since: no transaction, and the archive isn't read again.
    const doc = structuredClone(c.docs[PROFILE]);
    const again = await sync(c, p, NOW + 60_000);
    expect(again.metaPulled).toBe(0);
    expect(c.docs[PROFILE]).toEqual(doc);
    expect(c.listed).toEqual(['users/u1/meta']);
  });

  it('a plan crossing the cutoff between two syncs leaves the document at the next change, deleted nowhere', async () => {
    const c = fakeCloud();
    const p = phone(items(PROGRAM as never, plan('2026-07-21'), plan('2026-10-01')));
    await sync(c, p, NOW);
    expect(Object.keys(cloudDoc(c)).sort()).toEqual(['day:2026-07-21', 'day:2026-10-01', 'program']);
    // Two days on, nothing changed: no transaction, the document keeps it for now.
    const later = at('2026-10-20');
    await sync(c, p, later);
    expect(Object.keys(cloudDoc(c))).toContain('day:2026-07-21');
    // A plan saved today: the old one leaves the document with that write, for the archive; the phone keeps it.
    p.meta['day:2026-10-20'] = plan('2026-10-20');
    const r = await sync(c, p, later);
    expect(Object.keys(cloudDoc(c)).sort()).toEqual(['day:2026-10-01', 'day:2026-10-20', 'program']);
    expect(cloudDoc(c, 'users/u1/meta/plans-2026')).toEqual(items(plan('2026-07-21')));
    expect(p.meta['day:2026-07-21']).toEqual(plan('2026-07-21'));
    expect(r.metaPulled).toBe(0);
  });

  it('another phone with a later date: its cutoff holds for both, so this phone deletes nothing', async () => {
    const c = fakeCloud();
    const a = phone(items(plan('2026-07-20'), plan('2026-10-01')));
    await sync(c, a, NOW); // cutoff 2026-07-20: kept
    const b = phone();
    await sync(c, b, at('2026-10-19')); // b's day is a day on (another time zone): cutoff 2026-07-21
    expect(Object.keys(cloudDoc(c))).toEqual(['day:2026-10-01']);
    a.meta.status = 'deload';
    const r = await sync(c, a, NOW); // a is still on the 18th
    expect(a.meta['day:2026-07-20']).toEqual(plan('2026-07-20')); // not taken as deleted on b
    expect(r.metaPulled).toBe(0);
    expect(a.metaSeen.plansFrom).toBe('2026-07-21');
    expect(Object.keys(cloudDoc(c)).sort()).toEqual(['day:2026-10-01', 'status']);
  });

  it('a phone’s first sync with this build takes the archived plans it lacks, and archives its own the account lacks', async () => {
    const c = fakeCloud({
      [PROFILE]: { ...asDoc(items(plan('2026-10-01'))), plansFrom: '2026-07-20' },
      'users/u1/meta/plans-2025': asDoc(items(plan('2025-03-03'))),
      [INDEX]: { meta: 5 },
    });
    // Signed in on a phone kept since before this account: one old plan of its own, and the account's recent one already.
    const p = phone(items(plan('2024-12-30'), plan('2026-10-01')));
    const r = await sync(c, p, NOW);
    expect(c.listed).toEqual(['users/u1/meta']);
    expect(p.meta).toEqual(items(plan('2024-12-30'), plan('2026-10-01'), plan('2025-03-03')));
    expect(r.metaPulled).toBe(1);
    expect(cloudDoc(c, 'users/u1/meta/plans-2024')).toEqual(items(plan('2024-12-30')));
    expect(cloudDoc(c, 'users/u1/meta/plans-2025')).toEqual(items(plan('2025-03-03')));
    expect(Object.keys(cloudDoc(c))).toEqual(['day:2026-10-01']);
  });

  it('a new phone takes old plans still in a document an older build wrote, as it archives them', async () => {
    const all = items(plan('2026-10-01'), plan('2026-02-02'));
    const c = fakeCloud({ [PROFILE]: asDoc(all), [INDEX]: { meta: 5 } });
    const p = phone();
    await sync(c, p, NOW);
    expect(p.meta).toEqual(all);
    expect(Object.keys(cloudDoc(c))).toEqual(['day:2026-10-01']);
    expect(cloudDoc(c, 'users/u1/meta/plans-2026')).toEqual(items(plan('2026-02-02')));
  });

  it('a phone on an older build, syncing after the document was pruned, drops only old plans; this build brings them back', async () => {
    const all = items(plan('2026-10-01'), plan('2026-02-02'));
    const c = fakeCloud();
    const p = phone(all);
    await sync(c, p, NOW);
    expect(Object.keys(cloudDoc(c))).toEqual(['day:2026-10-01']);
    // The older build merged the whole document with everything it held (cloud/sync before this round): the plan the
    // document no longer has, unchanged since it last synced, it takes as deleted on another phone.
    const seenAll = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, metaHash(v)]));
    const old = mergeMeta(all, cloudDoc(c), seenAll);
    expect(old.remove).toEqual(['day:2026-02-02']);
    expect(old.pull).toEqual({});
    // Updated, its first sync with this build gets it back from the archive.
    const updated: Phone = { meta: items(plan('2026-10-01')), metaSeen: { items: old.seen, at: c.docs[PROFILE].updatedAt as number } };
    await sync(c, updated, NOW + 60_000);
    expect(updated.meta).toEqual(all);
  });

  it('an older build writing an old plan back into the document: it leaves again at this build’s next sync', async () => {
    const c = fakeCloud();
    const p = phone(items(plan('2026-10-01')));
    await sync(c, p, NOW);
    // The older build rewrites the whole document, without plansFrom, with an old plan in it.
    c.docs[PROFILE] = asDoc(items(plan('2026-10-01'), plan('2026-03-03', 2)), NOW + 1);
    c.docs[INDEX] = { ...c.docs[INDEX], meta: NOW + 1 };
    await sync(c, p, NOW + 60_000);
    expect(Object.keys(cloudDoc(c))).toEqual(['day:2026-10-01']);
    expect(cloudDoc(c, 'users/u1/meta/plans-2026')).toEqual(items(plan('2026-03-03', 2)));
    expect(p.meta['day:2026-03-03']).toEqual(plan('2026-03-03', 2)); // this phone lacked it: taken
  });

  it('five years of plans: the document holds only the last PLAN_DAYS days', async () => {
    const all: MetaItems = { program: PROGRAM };
    for (let t = at('2021-10-18'); t <= NOW; t += 2 * 864e5) { const d = new Date(t), date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; all[`day:${date}`] = plan(date); }
    const c = fakeCloud({ [PROFILE]: asDoc(all), [INDEX]: { meta: 5 } });
    const p = phone(all);
    p.metaSeen = { items: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, metaHash(v)])), at: 5 };
    await sync(c, p, NOW);
    const days = Object.keys(cloudDoc(c)).filter((k) => k.startsWith('day:'));
    expect(days.length).toBeLessThanOrEqual(46);
    expect(days.every((k) => k >= 'day:2026-07-20')).toBe(true);
    const archived = ['2021', '2022', '2023', '2024', '2025', '2026'].flatMap((y) => Object.keys(cloudDoc(c, `users/u1/meta/plans-${y}`)));
    expect(archived.length + days.length).toBe(Object.keys(all).length - 1);
    expect(p.meta).toEqual(all);
  });
});
