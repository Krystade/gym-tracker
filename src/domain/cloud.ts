import { BODY_FIELDS, mergeDay, type BodyDay } from './body';
import type { SetEntry } from './types';

/**
 * One month of a log in the cloud. `deleted` maps a deleted set's id to when it went (epoch ms), so a delete on one phone
 * reaches the others, while a set logged again later under the same id (ids are reused) survives it.
 */
export interface CloudMonth {
  sets: SetEntry[]; body: BodyDay[]; deleted: Record<string, number>; updatedAt: number;
  /** The month's PR set ids, worked out by the phone that wrote it from its whole log (cloud/sync), for friends' PR badges. */
  prs?: string[];
}
/** `tombAt`: when this phone deleted a set (epoch ms); a tombstone from before round 10, or one a sync brought, has none. */
export interface LocalMonth { sets: SetEntry[]; body: BodyDay[]; tombstones: Set<string>; tombAt?: Record<string, number> }
export interface Merged { doc: CloudMonth; importSets: SetEntry[]; deleteIds: string[]; importBody: BodyDay[]; changed: boolean }

export const monthOf = (date: string) => date.slice(0, 7);
/** A set id carries its date (`source|YYYY-MM-DD|exercise|setNo`). */
const monthOfId = (id: string) => /\|(\d{4}-\d{2})-\d{2}\|/.exec(id)?.[1] ?? null;
/** Firestore rejects undefined fields. */
const clean = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const byTime = (a: SetEntry, b: SetEntry) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq);
/** When a set was last changed by hand: edited, or put back by Undo. 0 for a set never touched since it was logged. */
export const editStamp = (s: SetEntry) => Math.max(s.editedAt ?? 0, s.restoredAt ?? 0);
/** The newest thing that happened to a set: logged (a live set's seq is its time), edited or put back. A delete must be newer. */
export const lifeStamp = (s: SetEntry) => Math.max(s.seq, editStamp(s));

/**
 * Merges one month. Sets: the union by id; where both sides have a set, the newer edit wins. With nothing to tell two different
 * copies apart (equal edit times, or none from before edit times) the cloud's wins, so two phones settle on one copy instead of
 * writing theirs back on every poll; the phone's copy is kept aside (domain/replaced). Deletes: a delete beats a set only if
 * it's newer than everything done to that set, so an edit made after a delete brings the set back. A delete stays in `deleted`
 * even when a newer set beat it, so a phone still holding its tombstone sees the set is newer and takes it rather than deleting
 * it again. Body days: per field the same, the newer edit winning and the cloud's winning a tie; a field only one side has fills in.
 */
export function mergeMonth(local: LocalMonth, remote: CloudMonth | null, now: number): Merged {
  const mine = new Map(local.sets.map((s) => [s.id, s]));
  const theirs = new Map((remote?.sets ?? []).map((s) => [s.id, s]));
  const deleted: Record<string, number> = { ...remote?.deleted };
  // A tombstone under a set that's on the phone is an old delete of a reused id: the set is live. Otherwise it's a delete made
  // here, at its own time; one without a time is either the cloud's delete (that time) or one never synced (now, as before).
  for (const id of local.tombstones) {
    if (mine.has(id)) continue;
    const at = local.tombAt?.[id] ?? deleted[id] ?? now;
    deleted[id] = Math.max(deleted[id] ?? 0, at);
  }
  const live: SetEntry[] = [], importSets: SetEntry[] = [], deleteIds: string[] = [];
  for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
    const l = mine.get(id), r = theirs.get(id);
    const win = !l ? r! : !r ? l : cloudWins(editStamp(l), editStamp(r), metaHash(l) !== metaHash(r)) ? r : l;
    if (id in deleted && lifeStamp(win) <= deleted[id]) { if (l) deleteIds.push(id); continue; }
    live.push(win);
    if (win !== l) importSets.push(win);
  }

  const have = new Map(local.body.map((d) => [d.date, d]));
  const body = new Map(local.body.map((d) => [d.date, { ...d }]));
  const importBody: BodyDay[] = [];
  for (const d of remote?.body ?? []) {
    const h = have.get(d.date), fill: BodyDay = { date: d.date };
    for (const k of BODY_FIELDS) {
      if (d[k] == null) continue;
      if (h?.[k] == null || cloudWins(h.at?.[k] ?? 0, d.at?.[k] ?? 0, d[k] !== h[k])) {
        Object.assign(fill, { [k]: d[k] });
        if (d.at?.[k] != null) fill.at = { ...fill.at, [k]: d.at[k] };
      }
    }
    if (Object.keys(fill).length > 1) { importBody.push(fill); body.set(d.date, mergeDay(body.get(d.date), fill)); }
  }

  const doc = clean<CloudMonth>({
    sets: live.sort(byTime),
    body: [...body.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    deleted, updatedAt: now,
  });
  const changed = !remote || contentKey(doc) !== contentKey(clean(remote));
  return { doc, importSets: clean(importSets), deleteIds, importBody, changed };
}

/** The cloud's copy wins with the newer edit, or with an equal one (none at all, before edit times) when the two differ. */
const cloudWins = (mine: number, theirs: number, differ: boolean) => theirs > mine || (theirs === mine && differ);

// Sorted keys at every level: a body day's edit times, or a set's target, read back from Firestore in another order are no change.
const contentKey = (m: Pick<CloudMonth, 'sets' | 'body' | 'deleted'>) =>
  JSON.stringify(deep([[...m.sets].sort(byTime), [...m.body].sort((a, b) => (a.date < b.date ? -1 : 1)), m.deleted]));
const stable = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)));

/** The phone's log, grouped by month (tombstones by the date in their id). */
export function splitByMonth(sets: SetEntry[], body: BodyDay[], tombstones: Set<string>, tombAt: Record<string, number> = {}): Map<string, LocalMonth> {
  const out = new Map<string, LocalMonth>();
  const at = (m: string) => { let x = out.get(m); if (!x) out.set(m, (x = { sets: [], body: [], tombstones: new Set(), tombAt })); return x; };
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
 * `gyms`, `tags`, `status`, `achievements`), so two phones merge as a union. `seen` holds each item's fingerprint as the last sync left it.
 */
export type MetaItems = Record<string, unknown>;
/** `remove`: items deleted on another phone, to delete on this one too. */
export interface MergedMeta { items: MetaItems; pull: MetaItems; remove: string[]; changed: boolean; seen: Record<string, string> }

/** Items the app can delete (a renamed lift's settings, a day plan, a name mapping, the last gym); the rest are only ever changed. */
export const metaDeletable = (k: string) => /^(settings|day|alias):/.test(k) || k === 'gyms';

const deep = (x: unknown): unknown => Array.isArray(x) ? x.map(deep)
  : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, deep(v)])) : x;
/** A fingerprint that ignores key order and undefined fields. */
export const metaHash = (x: unknown): string => hash(JSON.stringify(deep(x)));

const isDay = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
/**
 * Per item: one the phone changed since the last sync wins (so a first sync keeps the phone's own); otherwise the cloud's.
 * A deletable item that the last sync saw, now gone from one side while the other still has it exactly as that sync left it,
 * was deleted on that side: it goes from the other too. Changed since, it was edited after the delete, and the edit wins.
 */
export function mergeMeta(local: MetaItems, remote: MetaItems | null, seen: Record<string, string>): MergedMeta {
  const items: MetaItems = {}, pull: MetaItems = {}, next: Record<string, string> = {}, remove: string[] = [];
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote ?? {})])) {
    const l = local[k], r = remote?.[k];
    const lh = l === undefined ? '' : metaHash(l);
    if (k in seen && metaDeletable(k)) {
      if (l === undefined && metaHash(r) === seen[k]) continue; // deleted here: it leaves the cloud
      if (r === undefined && lh === seen[k]) { remove.push(k); continue; } // deleted on another phone: it goes here too
    }
    // The day achievements count from (domain/achievements): the earliest any phone kept, so a new phone's first run can't move
    // it later and take back what was earned before it; otherwise the rule below.
    const v = k === 'achievements' && isDay(l) && isDay(r) ? (l < r ? l : r)
      : l !== undefined && (lh !== seen[k] || r === undefined) ? l : r;
    if (v === undefined) continue;
    items[k] = v;
    next[k] = metaHash(v);
    if (next[k] !== lh) pull[k] = v;
  }
  const changed = metaHash(items) !== metaHash(remote ?? {});
  return { items: clean(items), pull: clean(pull), remove, changed, seen: next };
}
