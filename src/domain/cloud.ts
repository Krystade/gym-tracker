import { BODY_FIELDS, mergeDay, type BodyDay } from './body';
import type { SetEntry } from './types';
import { isBuddyKey, mergeBuddyItem } from './buddies/kept';

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

  const { body, importBody } = mergeBodyDays(local.body, remote?.body ?? []);
  const doc = clean<CloudMonth>({ sets: live.sort(byTime), body, deleted, updatedAt: now });
  const changed = !remote || contentKey(doc) !== contentKey(clean(remote));
  return { doc, importSets: clean(importSets), deleteIds, importBody, changed };
}

/** Body days, per field: the newer edit wins, `theirs` winning a tie; a field only one side has fills in. `importBody`: what `mine` lacked. */
function mergeBodyDays(mine: BodyDay[], theirs: BodyDay[]): { body: BodyDay[]; importBody: BodyDay[] } {
  const have = new Map(mine.map((d) => [d.date, d]));
  const body = new Map(mine.map((d) => [d.date, { ...d }]));
  const importBody: BodyDay[] = [];
  for (const d of theirs) {
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
  return { body: [...body.values()].sort((a, b) => (a.date < b.date ? -1 : 1)), importBody };
}

/**
 * A month's body days (weight, food, energy) in the cloud, apart from the month: users/{uid}/private/body-YYYY-MM, which only
 * the owner reads (firestore.rules, match /private). Friends read the month, so it carries none (owner, 2026-10-29).
 */
export interface KeptBody { body: BodyDay[]; updatedAt: number }
export const keptId = (month: string) => `body-${month}`;
/** What a sync writes: the month friends read, with no body days, and the owner's body document; null leaves it as it is. */
export interface MergedKept extends Merged { write: { month: CloudMonth | null; kept: KeptBody | null } }

/**
 * mergeMonth, with the body days kept apart. The cloud's body days are the owner's document's, with any the month still carries
 * merged in (written before this build, or since by a phone still on an older one), the owner's document winning a tie. A month
 * that carries some is written without them, in the same transaction that puts them in the owner's document, so they're never
 * in neither. Its `body` stays as an empty list: an older build's sync reads it as one. `changed`: anything to write; the month
 * is written with any change (its time is the one the index and every phone's last sync go by), the body document when its days do.
 */
export function mergeMonthKept(local: LocalMonth, shared: CloudMonth | null, kept: KeptBody | null, now: number): MergedKept {
  const legacy = Array.isArray(shared?.body) ? shared.body : [];
  const keptBody = Array.isArray(kept?.body) ? kept.body : [];
  const remote: CloudMonth | null = shared || kept
    ? { sets: shared?.sets ?? [], deleted: shared?.deleted ?? {}, updatedAt: shared?.updatedAt ?? 0, body: legacy.length ? mergeBodyDays(legacy, keptBody).body : keptBody }
    : null;
  const merged = mergeMonth(local, remote, now);
  const keptChanged = bodyKey(merged.doc.body) !== bodyKey(keptBody);
  const changed = merged.changed || legacy.length > 0 || keptChanged;
  return {
    ...merged, changed,
    write: { month: changed ? { ...merged.doc, body: [] } : null, kept: keptChanged ? { body: merged.doc.body, updatedAt: now } : null },
  };
}

/** The cloud's copy wins with the newer edit, or with an equal one (none at all, before edit times) when the two differ. */
const cloudWins = (mine: number, theirs: number, differ: boolean) => theirs > mine || (theirs === mine && differ);

// Sorted keys at every level: a body day's edit times, or a set's target, read back from Firestore in another order are no change.
const contentKey = (m: Pick<CloudMonth, 'sets' | 'body' | 'deleted'>) =>
  JSON.stringify(deep([[...m.sets].sort(byTime), [...m.body].sort((a, b) => (a.date < b.date ? -1 : 1)), m.deleted]));
const bodyKey = (body: BodyDay[]) => JSON.stringify(deep([...body].sort((a, b) => (a.date < b.date ? -1 : 1))));
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

/** `kept`: synced by a build that keeps body days apart (mergeMonthKept); a month the last sync left without it is synced again. */
export type Seen = Record<string, { hash: string; at: number; kept?: true }>;

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
 * `gyms`, `tags`, `status`, `achievements`, and Gym Buddies' `buddies`, `buddy-lead`, `buddy-start`, `spend:<id>`), so two phones merge as a union. `seen` holds each item's fingerprint as the last sync left it.
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
      // Gym Buddies' items merge by their own rules (domain/buddies/kept): per buddy, the later lead, the earliest start.
      : isBuddyKey(k) && l !== undefined && r !== undefined ? mergeBuddyItem(k, l, r)
      : l !== undefined && (lh !== seen[k] || r === undefined) ? l : r;
    if (v === undefined) continue;
    items[k] = v;
    next[k] = metaHash(v);
    if (next[k] !== lh) pull[k] = v;
  }
  const changed = metaHash(items) !== metaHash(remote ?? {});
  return { items: clean(items), pull: clean(pull), remove, changed, seen: next };
}
