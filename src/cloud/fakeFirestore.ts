import type { Cloud } from './firebase';

// For tests only (nothing in the app imports it): firestore/lite as the app uses it, over documents kept by path, counting
// reads as Firestore bills them: a document read is 1, a query max(1, documents it returns).

type Doc = Record<string, unknown>;
interface Filter { field: string; op: string; value: unknown }
interface Q { path: string; filters: Filter[] }
const ID = '__name__';
const ms = (v: unknown) => (v && typeof v === 'object' && 'toMillis' in v ? (v as { toMillis(): number }).toMillis() : v);
const test = (a: unknown, op: string, b: unknown) => {
  const x = ms(a) as number | string, y = ms(b) as number | string;
  return op === '==' ? x === y : op === '>' ? x > y : op === '>=' ? x >= y : op === '<' ? x < y : op === '<=' ? x <= y : false;
};
const isObj = (x: unknown): x is Doc => !!x && typeof x === 'object' && !Array.isArray(x) && !('toMillis' in (x as object));
const deepMerge = (a: Doc, b: Doc): Doc => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])]
  .map((k) => [k, k in b ? (isObj(a[k]) && isObj(b[k]) ? deepMerge(a[k] as Doc, b[k] as Doc) : b[k]) : a[k]]));

export const ts = (t: number) => ({ toMillis: () => t });

export function fakeFirestore(docs: Record<string, Doc> = {}) {
  let reads = 0;
  /** Each read: the path, and how many reads it cost. */
  const log: { path: string; n: number; filters?: string }[] = [];
  const bill = (path: string, n: number, filters?: Filter[]) => {
    reads += n;
    log.push({ path, n, ...(filters?.length && { filters: filters.map((f) => `${f.field}${f.op}${String(ms(f.value))}`).join(',') }) });
  };
  const ref = (path: string) => ({ path, id: path.split('/').at(-1)! });
  const snap = (path: string) => ({ id: ref(path).id, ref: ref(path), exists: () => path in docs, data: () => docs[path] });
  const set = (r: { path: string }, data: Doc, o?: { merge?: boolean }) => { docs[r.path] = o?.merge ? deepMerge(docs[r.path] ?? {}, data) : data; };
  const F = {
    doc: (_db: unknown, path: string) => ref(path),
    collection: (_db: unknown, path: string): Q => ({ path, filters: [] }),
    query: (c: Q, ...w: Filter[]): Q => ({ path: c.path, filters: [...c.filters, ...w] }),
    where: (field: string, op: string, value: unknown): Filter => ({ field, op, value }),
    documentId: () => ID,
    Timestamp: { fromMillis: ts },
    serverTimestamp: () => ts(Date.now()),
    getDoc: async (r: { path: string }) => { bill(r.path, 1); return snap(r.path); },
    getDocs: async (q: Q) => {
      const hits = Object.keys(docs).filter((p) => p.startsWith(`${q.path}/`) && !p.slice(q.path.length + 1).includes('/'))
        .filter((p) => q.filters.every((f) => test(f.field === ID ? p.slice(q.path.length + 1) : docs[p][f.field], f.op, f.value))).sort();
      bill(q.path, Math.max(1, hits.length), q.filters);
      const out = hits.map(snap);
      return { docs: out, size: out.length, empty: !out.length };
    },
    setDoc: async (r: { path: string }, data: Doc, o?: { merge?: boolean }) => set(r, data, o),
    updateDoc: async (r: { path: string }, data: Doc) => { docs[r.path] = { ...docs[r.path], ...data }; },
    deleteDoc: async (r: { path: string }) => { delete docs[r.path]; },
    writeBatch: () => {
      const ops: (() => void)[] = [];
      const b = {
        set: (r: { path: string }, data: Doc, o?: { merge?: boolean }) => { ops.push(() => set(r, data, o)); return b; },
        update: (r: { path: string }, data: Doc) => { ops.push(() => { docs[r.path] = { ...docs[r.path], ...data }; }); return b; },
        delete: (r: { path: string }) => { ops.push(() => { delete docs[r.path]; }); return b; },
        commit: async () => { ops.forEach((o) => o()); },
      };
      return b;
    },
    runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ get: async (r: { path: string }) => { bill(r.path, 1); return snap(r.path); }, set, update: (r: { path: string }, data: Doc) => { docs[r.path] = { ...docs[r.path], ...data }; }, delete: (r: { path: string }) => { delete docs[r.path]; } }),
  };
  return {
    cloud: { F, db: {} } as unknown as Cloud, docs, log,
    reads: () => reads,
    /** Reads since the last call. */
    take: () => { const n = reads; reads = 0; log.length = 0; return n; },
  };
}
