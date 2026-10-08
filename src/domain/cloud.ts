import type { BodyDay } from './body';
import type { SetEntry } from './types';

/**
 * One month of a log in the cloud. `deleted` maps a deleted set's id to when it went (epoch ms), so a delete on one phone
 * reaches the others, while a set logged again later under the same id (ids are reused) survives it.
 */
export interface CloudMonth { sets: SetEntry[]; body: BodyDay[]; deleted: Record<string, number>; updatedAt: number }
export interface LocalMonth { sets: SetEntry[]; body: BodyDay[]; tombstones: Set<string> }
export interface Merged { doc: CloudMonth; importSets: SetEntry[]; deleteIds: string[]; importBody: BodyDay[]; changed: boolean }

export const monthOf = (date: string) => date.slice(0, 7);
/** A set id carries its date (`source|YYYY-MM-DD|exercise|setNo`). */
const monthOfId = (id: string) => /\|(\d{4}-\d{2})-\d{2}\|/.exec(id)?.[1] ?? null;
/** Firestore rejects undefined fields. */
const clean = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const byTime = (a: SetEntry, b: SetEntry) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq);
const BODY_KEYS = ['weight', 'calories', 'protein', 'energy'] as const;

/** Merges one month: the union of sets by id, the phone winning where both have one; deletes either way; body days filled in. */
export function mergeMonth(local: LocalMonth, remote: CloudMonth | null, now: number): Merged {
  const live = new Map(local.sets.map((s) => [s.id, s]));
  const deleted: Record<string, number> = { ...remote?.deleted };
  // A tombstone under a set that's on the phone is an old delete of a reused id: the set is live.
  for (const id of local.tombstones) if (!live.has(id) && !(id in deleted)) deleted[id] = now;
  const deleteIds: string[] = [];
  for (const [id, at] of Object.entries(deleted)) {
    const s = live.get(id);
    if (!s) continue;
    if (s.seq > at) delete deleted[id]; // logged again after the delete
    else { deleteIds.push(id); live.delete(id); }
  }
  const importSets = (remote?.sets ?? []).filter((s) => !live.has(s.id) && !(s.id in deleted) && !local.tombstones.has(s.id));

  const mine = new Map(local.body.map((d) => [d.date, d]));
  const body = new Map(local.body.map((d) => [d.date, { ...d }]));
  const importBody: BodyDay[] = [];
  for (const d of remote?.body ?? []) {
    const have = mine.get(d.date), fill: BodyDay = { date: d.date };
    for (const k of BODY_KEYS) if (d[k] != null && have?.[k] == null) Object.assign(fill, { [k]: d[k] });
    if (Object.keys(fill).length > 1) { importBody.push(fill); body.set(d.date, { ...body.get(d.date), ...fill }); }
  }

  const doc = clean<CloudMonth>({
    sets: [...live.values(), ...importSets].sort(byTime),
    body: [...body.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    deleted, updatedAt: now,
  });
  const changed = !remote || contentKey(doc) !== contentKey(clean(remote));
  return { doc, importSets: clean(importSets), deleteIds, importBody, changed };
}

const contentKey = (m: Pick<CloudMonth, 'sets' | 'body' | 'deleted'>) =>
  JSON.stringify([[...m.sets].sort(byTime).map(stable), [...m.body].sort((a, b) => (a.date < b.date ? -1 : 1)).map(stable), stable(m.deleted)]);
const stable = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)));

/** The phone's log, grouped by month (tombstones by the date in their id). */
export function splitByMonth(sets: SetEntry[], body: BodyDay[], tombstones: Set<string>): Map<string, LocalMonth> {
  const out = new Map<string, LocalMonth>();
  const at = (m: string) => { let x = out.get(m); if (!x) out.set(m, (x = { sets: [], body: [], tombstones: new Set() })); return x; };
  for (const s of sets) at(monthOf(s.date)).sets.push(s);
  for (const d of body) at(monthOf(d.date)).body.push(d);
  for (const id of tombstones) { const m = monthOfId(id); if (m) at(m).tombstones.add(id); }
  return out;
}

/** A short fingerprint of a month on the phone, to tell whether it changed since the last sync. */
export function monthHash(m: LocalMonth): string {
  return hash(JSON.stringify([[...m.sets].sort(byTime).map(stable), [...m.body].sort((a, b) => (a.date < b.date ? -1 : 1)).map(stable), [...m.tombstones].sort()]));
}
function hash(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export type Seen = Record<string, { hash: string; at: number }>;

/** Months to sync: changed on the phone since the last sync, changed in the cloud since then, or new on either side. */
export function monthsToSync(local: Map<string, LocalMonth>, remoteIndex: Record<string, number>, seen: Seen): string[] {
  const all = new Set([...local.keys(), ...Object.keys(remoteIndex)]);
  return [...all].filter((m) => {
    const s = seen[m], l = local.get(m);
    return (l ? monthHash(l) : '') !== (s?.hash ?? '') || (remoteIndex[m] ?? 0) !== (s?.at ?? 0);
  });
}

/**
 * Everything else that's yours, flattened to one item per key (`profile`, `program`, `day:<date>`, `settings:<lift>`, `alias:<name>`,
 * `gyms`), so two phones merge as a union. `seen` holds each item's fingerprint as the last sync left it.
 */
export type MetaItems = Record<string, unknown>;
export interface MergedMeta { items: MetaItems; pull: MetaItems; changed: boolean; seen: Record<string, string> }

const deep = (x: unknown): unknown => Array.isArray(x) ? x.map(deep)
  : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, deep(v)])) : x;
/** A fingerprint that ignores key order and undefined fields. */
export const metaHash = (x: unknown): string => hash(JSON.stringify(deep(x)));

/** Per item: one the phone changed since the last sync wins (so a first sync keeps the phone's own); otherwise the cloud's. */
export function mergeMeta(local: MetaItems, remote: MetaItems | null, seen: Record<string, string>): MergedMeta {
  const items: MetaItems = {}, pull: MetaItems = {}, next: Record<string, string> = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote ?? {})])) {
    const l = local[k], r = remote?.[k];
    const lh = l === undefined ? '' : metaHash(l);
    const v = l !== undefined && (lh !== seen[k] || r === undefined) ? l : r;
    if (v === undefined) continue;
    items[k] = v;
    next[k] = metaHash(v);
    if (next[k] !== lh) pull[k] = v;
  }
  const changed = metaHash(items) !== metaHash(remote ?? {});
  return { items: clean(items), pull: clean(pull), changed, seen: next };
}
