import { deleteDB, openDB, type IDBPDatabase, type IDBPObjectStore } from 'idb';
import type { SetEntry } from '../domain/types';
import type { ExerciseSettings } from '../domain/progression';
import type { Profile } from '../domain/profile';
import type { DayPlan, Program } from '../domain/program';
import { mergeDay, type BodyDay } from '../domain/body';
import type { PhotoMeta } from '../domain/photos';
import type { SyncConfig } from '../domain/sync';
import { metaHash, type MetaItems, type Seen } from '../domain/cloud';
import type { Gym } from '../domain/equipment';
import { renameAliases, renameInPlan, renameInProgram, renameSets } from '../domain/rename';
import { settingsKey } from '../domain/progression';
import type { TagPrefs } from '../domain/tags';
import type { CycleDay } from '../domain/cycle';
import { replacements, stillTaken, type Replaced, type Taken } from '../domain/replaced';
import { cleanStatus } from '../domain/crew';

const STORE = 'sets';
/** The first profile: it keeps the original database, so existing data needs no migration. */
export const MAIN = 'main';
export interface Person { id: string; name: string; slug: string }
const dbName = (id: string) => (id === MAIN ? 'gym-tracker' : `gym-tracker~${id}`);
// One connection per profile, kept open: a write started before a switch still finishes in its own database.
const conns = new Map<string, Promise<IDBPDatabase>>();
let current = MAIN;
/** Every db function below calls db() synchronously, before its first await, so it is bound to the profile active at the call. */
export const setProfileDb = (id: string) => { current = id; };
export const activeProfileDb = () => current;
let onBlocked: (() => void) | null = null;
/** Called when an upgrade waits on another open copy of the app (e.g. a Safari tab beside the installed app). */
export const setBlockedHandler = (fn: (() => void) | null) => { onBlocked = fn; };

function db(id = current): Promise<IDBPDatabase> {
  const open = conns.get(id);
  if (open) return open;
  const p: Promise<IDBPDatabase> = openDB(dbName(id), 9, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) d.createObjectStore(STORE, { keyPath: 'id' }).createIndex('date', 'date');
      if (oldVersion < 2) d.createObjectStore('settings', { keyPath: 'key' });
      if (oldVersion < 3) d.createObjectStore('profile', { keyPath: 'key' });
      if (oldVersion < 4) d.createObjectStore('program', { keyPath: 'key' });
      if (oldVersion < 5) d.createObjectStore('body', { keyPath: 'date' });
      // Metadata apart from the image blobs, so listing the timeline never reads the images.
      if (oldVersion < 6) { d.createObjectStore('photos', { keyPath: 'id' }).createIndex('date', 'date'); d.createObjectStore('photoBlobs'); }
      if (oldVersion < 7) d.createObjectStore('config', { keyPath: 'key' });
      // Cycle phase: private, so apart from body days (friends read those). See domain/cycle.
      if (oldVersion < 8) d.createObjectStore('cycle', { keyPath: 'date' });
      // What a sync replaced on this phone, kept 30 days so it can be put back. See domain/replaced.
      if (oldVersion < 9) d.createObjectStore('replaced', { keyPath: 'key' });
    },
    blocked() { onBlocked?.(); },
    // A newer version of the app is upgrading the database: step aside, and reload to pick up the new code.
    blocking() {
      void p.then((d) => d.close());
      conns.delete(id);
      if (typeof location !== 'undefined') location.reload();
    },
    terminated() { conns.delete(id); },
  });
  conns.set(id, p);
  p.catch(() => { if (conns.get(id) === p) conns.delete(id); });
  return p;
}

// Shared by every profile: the profile list, gyms, and the backup settings.
let sharedp: Promise<IDBPDatabase> | null = null;
function shared(): Promise<IDBPDatabase> {
  return (sharedp ??= (async () => {
    const d = await openDB('gym-tracker-shared', 1, {
      upgrade(x) { x.createObjectStore('kv', { keyPath: 'key' }); },
      blocking() { d.close(); sharedp = null; if (typeof location !== 'undefined') location.reload(); },
      terminated() { sharedp = null; },
    });
    // Before profiles, sync settings and gyms lived in the main profile's config: copy them over once, then delete the old copies.
    if (!(await d.get('kv', 'migrated'))) {
      const old = await db(MAIN);
      const moved = (await Promise.all([old.get('config', 'sync'), old.get('config', 'gyms')])).filter(Boolean);
      const tx = d.transaction('kv', 'readwrite');
      await Promise.all([...moved.map((r) => tx.store.put(r)), tx.store.put({ key: 'migrated', at: new Date().toISOString() }), tx.done]);
      const ot = old.transaction('config', 'readwrite');
      await Promise.all([ot.store.delete('sync'), ot.store.delete('gyms'), ot.done]);
    }
    return d;
  })().catch((e) => { sharedp = null; throw e; }));
}

/** `retired`: backup folders of deleted profiles; their files stay in the repo, so no new profile may reuse them. */
export async function getPeople(): Promise<{ people: Person[]; active: string; retired: string[] }> {
  const x: { people: Person[]; active: string; retired?: string[] } | undefined = await (await shared()).get('kv', 'people');
  return { people: x?.people ?? [{ id: MAIN, name: 'Me', slug: 'me' }], active: x?.active ?? MAIN, retired: x?.retired ?? [] };
}
export const putPeople = async (people: Person[], active: string, retired: string[] = []): Promise<void> => { await (await shared()).put('kv', { key: 'people', people, active, retired }); };
/** Deletes everything one profile logged on this phone. The main profile's database is never deleted. */
export async function deletePersonData(id: string): Promise<void> {
  if (id === MAIN) throw new Error('The first profile’s data can’t be deleted here.');
  const p = conns.get(id);
  conns.delete(id);
  if (p) (await p.catch(() => null))?.close();
  await deleteDB(dbName(id));
}

export const resetDbForTests = () => {
  for (const p of [...conns.values(), ...(sharedp ? [sharedp] : [])]) p.then((d) => d.close()).catch(() => {});
  conns.clear(); sharedp = null; current = MAIN;
};
export const getAllSets = async (): Promise<SetEntry[]> => (await db()).getAll(STORE);
export const putSet = async (e: SetEntry): Promise<void> => { await (await db()).put(STORE, e); };
/** Builds a set from what's stored and saves it in one transaction, so two open copies of the app can't take the same set number. */
export async function addSet(make: (stored: SetEntry[]) => SetEntry): Promise<SetEntry> {
  const tx = (await db()).transaction(STORE, 'readwrite');
  const e = make((await tx.store.getAll()) as SetEntry[]);
  await tx.store.put(e);
  await tx.done;
  return e;
}
export const deleteSet = async (id: string): Promise<void> => { await (await db()).delete(STORE, id); };
/**
 * The tombstones row: deleted set ids, and since round 10 when each delete made on this phone went (`at`, epoch ms), so an edit
 * on another phone after it can beat it in sync. Ids from before, and deletes a sync brought (the cloud keeps their time), have none.
 */
interface Tombstones { key: 'deleted'; ids: string[]; at?: Record<string, number> }
const withTombstones = (cur: Tombstones | undefined, ids: string[], at: number | null): Tombstones => {
  const times = { ...cur?.at };
  for (const id of ids) { if (at == null) delete times[id]; else times[id] = at; }
  return { key: 'deleted', ids: [...new Set([...(cur?.ids ?? []), ...ids])], at: times };
};

/**
 * Deletes a set and records its tombstone in one transaction, so a crash can't leave a deleted set that sync brings back.
 * `at`: when it was deleted; null for a delete another phone made, which the cloud has the time of.
 */
export async function deleteSetWithTombstone(id: string, at: number | null = Date.now()): Promise<void> {
  const tx = (await db()).transaction([STORE, 'config'], 'readwrite');
  try {
    tx.objectStore(STORE).delete(id).catch(() => {}); // tx.done carries the failure
    const cfg = tx.objectStore('config');
    await cfg.put(withTombstones(await cfg.get('deleted'), [id], at));
  } catch (e) {
    // Otherwise the delete would still commit without its tombstone. A failed write may have aborted it already.
    try { tx.abort(); } catch { /* already aborted: keep the real error */ }
    await tx.done.catch(() => {});
    throw e;
  }
  await tx.done;
}

/** Undoes a delete: the set goes back and its tombstone goes, in one transaction. */
export async function restoreSet(e: SetEntry): Promise<void> {
  const tx = (await db()).transaction([STORE, 'config'], 'readwrite');
  const cfg = tx.objectStore('config');
  const cur: Tombstones | undefined = await cfg.get('deleted');
  const { [e.id]: _gone, ...at } = cur?.at ?? {};
  await Promise.all([tx.objectStore(STORE).put(e), cfg.put({ key: 'deleted', ids: (cur?.ids ?? []).filter((x) => x !== e.id), at }), tx.done]);
}

/**
 * Renames a lift, or merges it into another, in one transaction: its sets (old ids tombstoned, so sync can't bring them back),
 * program slots, day plans, settings (the target's own win) and name mappings. Returns how many sets moved.
 */
export async function renameLift(from: string, to: string): Promise<number> {
  const tx = (await db()).transaction([STORE, 'config', 'settings', 'program'], 'readwrite');
  try {
    const sets = tx.objectStore(STORE), cfg = tx.objectStore('config'), st = tx.objectStore('settings'), prog = tx.objectStore('program');
    const { put, remove } = renameSets((await sets.getAll()) as SetEntry[], from, to);
    for (const id of remove) sets.delete(id).catch(() => {}); // tx.done carries the failure
    // Stamped as edited: a change of case keeps the id, and the other phone's copy must not win it back.
    const now = Date.now();
    for (const e of put) sets.put({ ...e, editedAt: now }).catch(() => {});
    await cfg.put(withTombstones(await cfg.get('deleted'), remove, now));
    const al: { map: Record<string, string> } | undefined = await cfg.get('aliases');
    await cfg.put({ key: 'aliases', map: renameAliases(al?.map ?? {}, from, to) });
    const [fk, tk] = [settingsKey(from), settingsKey(to)];
    if (fk !== tk) {
      const old: ExerciseSettings | undefined = await st.get(fk);
      if (old && !(await st.get(tk))) await st.put({ ...old, key: tk });
      if (old) await st.delete(fk);
    }
    for (const row of (await prog.getAll()) as (Program | DayPlan)[]) {
      const next = row.key === 'program' ? renameInProgram(row as Program, from, to) : row.key.startsWith('day:') ? renameInPlan(row as DayPlan, from, to) : null;
      if (next) await prog.put(next);
    }
    await tx.done;
    return put.length;
  } catch (e) {
    try { tx.abort(); } catch { /* already aborted */ }
    await tx.done.catch(() => {});
    throw e;
  }
}

export const getAllSettings = async (): Promise<ExerciseSettings[]> => (await db()).getAll('settings');
export const putSettings = async (s: ExerciseSettings): Promise<void> => { await (await db()).put('settings', s); };
/** One lift's settings, by settingsKey: gone when another phone renamed that lift. */
export const deleteSettings = async (key: string): Promise<void> => { await (await db()).delete('settings', key); };
/** The tag row: hidden built-ins and their own tags. Absent until first changed. */
export const getTags = async (): Promise<TagPrefs | undefined> => (await db()).get('config', 'tags');
export const putTags = async (t: TagPrefs): Promise<void> => { await (await db()).put('config', t); };
/** Your Crew status phrase (domain/crew): '' once cleared, absent until first set. */
export const getStatus = async (): Promise<string | undefined> => ((await (await db()).get('config', 'status')) as { text: string } | undefined)?.text;
export const putStatus = async (text: string): Promise<void> => { await (await db()).put('config', { key: 'status', text }); };

export const getProfile = async (): Promise<Profile | undefined> => (await db()).get('profile', 'profile');
export const putProfile = async (p: Profile): Promise<void> => { await (await db()).put('profile', p); };

export const getProgram = async (): Promise<Program | undefined> => (await db()).get('program', 'program');
export const putProgram = async (p: Program): Promise<void> => { await (await db()).put('program', p); };
/** Day plans share the program store under 'day:YYYY-MM-DD' keys. */
export const getDayPlans = async (): Promise<DayPlan[]> =>
  (await (await db()).getAll('program', IDBKeyRange.bound('day:', 'day:￿'))) as DayPlan[];
export const putDayPlan = async (p: DayPlan): Promise<void> => { await (await db()).put('program', p); };
export const deleteDayPlan = async (key: string): Promise<void> => { if (key.startsWith('day:')) await (await db()).delete('program', key); };

export async function putMany(entries: SetEntry[]): Promise<{ added: number; updated: number }> {
  const tx = (await db()).transaction(STORE, 'readwrite');
  const existing = new Set((await tx.store.getAllKeys()) as string[]);
  let added = 0;
  for (const e of entries) { if (!existing.has(e.id)) added++; existing.add(e.id); tx.store.put(e).catch(() => {}); } // tx.done carries the failure
  await tx.done;
  return { added, updated: entries.length - added };
}

export async function requestPersistence(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  return (await navigator.storage.persisted()) || navigator.storage.persist();
}

// Asked once, at launch: the answer is the phone's, not a person's. A Data screen that asked on every mount (and every switch of
// person remounts it) set state as it opened; landing mid-keystroke, that re-render put the field's old value back.
let persistence: Promise<boolean | null> | undefined;
let persistenceAnswer: boolean | null | undefined;
export const storagePersistence = (): Promise<boolean | null> =>
  persistence ??= requestPersistence().then((v) => (persistenceAnswer = v), () => (persistenceAnswer = null));
/** The launch's answer, or undefined while it's still pending. */
export const knownStoragePersistence = (): boolean | null | undefined => persistenceAnswer;

export const getBody = async (): Promise<BodyDay[]> => (await db()).getAll('body');
export const putBody = async (d: BodyDay): Promise<void> => { await (await db()).put('body', d); };
export async function putBodyMany(days: BodyDay[]): Promise<void> {
  const tx = (await db()).transaction('body', 'readwrite');
  await Promise.all([...days.map((d) => tx.store.put(d)), tx.done]);
}

/**
 * The cycle setting and sync state. `tracking` is absent until set on this phone (then the account's copy fills it in).
 * `rev` counts changes here; `synced` is the account and `rev` the cloud last took; `wiped`: deleted here, not yet in the cloud.
 */
export interface CycleConfig { key: 'cycle'; tracking?: boolean; rev: number; synced?: { uid: string; rev: number }; wiped?: boolean }
const NO_CYCLE: CycleConfig = { key: 'cycle', rev: 0 };
export async function getCycle(): Promise<{ days: CycleDay[]; cfg: CycleConfig }> {
  const tx = (await db()).transaction(['cycle', 'config']);
  const [days, cfg] = await Promise.all([tx.objectStore('cycle').getAll() as Promise<CycleDay[]>, tx.objectStore('config').get('cycle') as Promise<CycleConfig | undefined>, tx.done]);
  return { days, cfg: cfg ?? NO_CYCLE };
}
/** A change to the cycle data, and its mark for the next sync, in one transaction. */
async function cycleChange(f: (days: IDBPObjectStore<unknown, string[], 'cycle', 'readwrite'>, cfg: CycleConfig) => Promise<unknown> | void, set: Partial<CycleConfig> = {}): Promise<void> {
  const tx = (await db()).transaction(['cycle', 'config'], 'readwrite');
  const cfg: CycleConfig = (await tx.objectStore('config').get('cycle')) ?? NO_CYCLE;
  await f(tx.objectStore('cycle'), cfg);
  await Promise.all([tx.objectStore('config').put({ ...cfg, ...set, rev: cfg.rev + 1 }), tx.done]);
}
/** A phase for a day, or `null` to clear it (kept as a mark until the cloud has the clearing too). */
export const putCycleDay = (d: CycleDay): Promise<void> => cycleChange((s) => s.put(d));
export const putCycleTracking = (on: boolean): Promise<void> => cycleChange(() => {}, { tracking: on });
/** Every cycle day on this phone; the next sync deletes the account's copy. The setting stays as it is. */
export const clearCycle = (): Promise<void> => cycleChange((s) => s.clear(), { wiped: true });
/**
 * After a cycle sync: saves the account's days this phone lacked and its setting if this phone has none. Only when nothing
 * changed here since `rev` was read does it drop the cleared-day marks and count the cloud as up to date. Returns whether it
 * took the account's setting.
 */
export async function finishCycleSync(uid: string, rev: number, pull: CycleDay[], tracking: boolean | undefined): Promise<boolean> {
  const tx = (await db()).transaction(['cycle', 'config'], 'readwrite');
  const days = tx.objectStore('cycle'), cf = tx.objectStore('config');
  const cfg: CycleConfig = (await cf.get('cycle')) ?? NO_CYCLE;
  for (const d of pull) if (!(await days.getKey(d.date))) await days.put(d);
  const same = cfg.rev === rev;
  if (same) for (const d of (await days.getAll()) as CycleDay[]) if (d.phase == null) await days.delete(d.date);
  const next: CycleConfig = { ...cfg, tracking: cfg.tracking ?? tracking, ...(same ? { synced: { uid, rev }, wiped: false } : {}) };
  await Promise.all([cf.put(next), tx.done]);
  return cfg.tracking == null && tracking != null;
}

export const getPhotoMetas = async (): Promise<PhotoMeta[]> => (await db()).getAll('photos');
// Stored as ArrayBuffers: WebKit rejects Blobs in IndexedDB in ephemeral sessions (private browsing, test browsers).
interface StoredImage { type: string; data: ArrayBuffer }
export async function getPhotoBlob(id: string, kind: 'full' | 'thumb'): Promise<Blob | undefined> {
  const x: StoredImage | undefined = await (await db()).get('photoBlobs', `${id}:${kind}`);
  return x && new Blob([x.data], { type: x.type });
}
export async function putPhoto(meta: PhotoMeta, full: Blob, thumb: Blob): Promise<void> {
  // Read the images before opening the transaction: it would auto-commit while awaiting them.
  const dp = db(); // bound to the profile active now, not after the images are read
  const [f, t]: StoredImage[] = await Promise.all([full, thumb].map(async (b) => ({ type: b.type, data: await b.arrayBuffer() })));
  const tx = (await dp).transaction(['photos', 'photoBlobs'], 'readwrite');
  await Promise.all([tx.objectStore('photos').put(meta), tx.objectStore('photoBlobs').put(f, `${meta.id}:full`), tx.objectStore('photoBlobs').put(t, `${meta.id}:thumb`), tx.done]);
}
export async function deletePhoto(id: string): Promise<void> {
  const tx = (await db()).transaction(['photos', 'photoBlobs'], 'readwrite');
  await Promise.all([tx.objectStore('photos').delete(id), tx.objectStore('photoBlobs').delete(`${id}:full`), tx.objectStore('photoBlobs').delete(`${id}:thumb`), tx.done]);
}

/** The backup settings: one repo and token for every profile on this phone. */
export const getSyncConfig = async (): Promise<SyncConfig | undefined> => (await shared()).get('kv', 'sync');
export const putSyncConfig = async (c: SyncConfig): Promise<void> => { await (await shared()).put('kv', c); };
export const deleteSyncConfig = async (): Promise<void> => { await (await shared()).delete('kv', 'sync'); };
/** The account this phone is signed in to, and which person on the phone it belongs to. */
export interface CloudLink { key: 'cloud'; uid: string; email: string; person: string }
export const getCloudLink = async (): Promise<CloudLink | undefined> => (await shared()).get('kv', 'cloud');
export const putCloudLink = async (c: CloudLink): Promise<void> => { await (await shared()).put('kv', c); };
export const deleteCloudLink = async (): Promise<void> => { await (await shared()).delete('kv', 'cloud'); };
/**
 * Friends as last read for one account (src/state/friendCache.ts): their lists, Crew lines, news and threads, so Friends opens
 * from the phone and refreshes quietly. Only what the account may read anyway; forgotten on sign-out.
 */
export const getFriendCache = async <T>(uid: string): Promise<T | undefined> => {
  const x: (T & { key?: string }) | undefined = await (await shared()).get('kv', `friends:${uid}`);
  if (!x) return undefined;
  const { key: _key, ...rest } = x;
  return rest as T;
};
export const putFriendCache = async (uid: string, v: object): Promise<void> => { await (await shared()).put('kv', { ...v, key: `friends:${uid}` }); };
export async function deleteFriendCaches(): Promise<void> {
  const d = await shared();
  const keys = await d.getAllKeys('kv', IDBKeyRange.bound('friends:', 'friends;', false, true)); // ';' follows ':'
  const tx = d.transaction('kv', 'readwrite');
  await Promise.all([...keys.map((k) => tx.store.delete(k)), tx.done]);
}
/** What this person's last cloud sync left each month as (see domain/cloud monthsToSync), for one account. */
export interface CloudSeen { key: 'cloud-seen'; uid: string; seen: Seen; at?: string; /** Settings, program and the rest: see cloud/sync MetaSeen. */ meta?: { items: Record<string, string>; at: number } }
export async function getCloudSeen(): Promise<CloudSeen | undefined> { return (await db()).get('config', 'cloud-seen'); }
export async function putCloudSeen(c: CloudSeen): Promise<void> { await (await db()).put('config', c); }

/** Ids of sets deleted on this phone, so sync never brings them back. */
export async function getTombstones(): Promise<Set<string>> {
  const x: Tombstones | undefined = await (await db()).get('config', 'deleted');
  return new Set(x?.ids ?? []);
}
/** When each set deleted on this phone went, where known (see Tombstones). */
export async function getTombstoneTimes(): Promise<Record<string, number>> {
  const x: Tombstones | undefined = await (await db()).get('config', 'deleted');
  return x?.at ?? {};
}
export async function addTombstone(id: string, at: number | null = Date.now()): Promise<void> {
  const tx = (await db()).transaction('config', 'readwrite');
  await Promise.all([tx.store.put(withTombstones(await tx.store.get('deleted'), [id], at)), tx.done]);
}

/** The log as a sync reads it: sets, body days and tombstones in one read, so a change can't land between them. */
export async function getSyncSnapshot(): Promise<{ sets: SetEntry[]; body: BodyDay[]; tombstones: Set<string>; tombAt: Record<string, number> }> {
  const tx = (await db()).transaction([STORE, 'body', 'config']);
  const [sets, body, t] = await Promise.all([tx.objectStore(STORE).getAll() as Promise<SetEntry[]>, tx.objectStore('body').getAll() as Promise<BodyDay[]>,
    tx.objectStore('config').get('deleted') as Promise<Tombstones | undefined>, tx.done]);
  return { sets, body, tombstones: new Set(t?.ids ?? []), tombAt: t?.at ?? {} };
}

/**
 * Saves what a sync takes onto this phone, and keeps this phone's values it replaces (domain/replaced), in one transaction: only
 * what's still as the sync read it (`base`), so an edit made here while the sync was out is never overwritten, deleted, or kept
 * as a copy it isn't; the next sync merges it. Sets another phone deleted go with their tombstone (no time: the cloud has it).
 */
export async function applySynced(base: { sets: SetEntry[]; body: BodyDay[] }, taken: Taken, now: number): Promise<{ taken: Taken; replaced: Replaced[]; skipped: number }> {
  const tx = (await db()).transaction([STORE, 'body', 'config', 'replaced'], 'readwrite');
  try {
    const sets = tx.objectStore(STORE), days = tx.objectStore('body'), cfg = tx.objectStore('config');
    const ids = [...new Set([...taken.importSets.map((s) => s.id), ...taken.deleteIds])];
    const cur = {
      sets: new Map(await Promise.all(ids.map(async (id) => [id, (await sets.get(id)) as SetEntry | undefined] as const))),
      body: new Map(await Promise.all(taken.importBody.map(async (d) => [d.date, (await days.get(d.date)) as BodyDay | undefined] as const))),
    };
    const { taken: t, skipped } = stillTaken(base, cur, taken);
    const replaced = replacements(base, t, now);
    const writes: Promise<unknown>[] = [
      ...replaced.map((r) => tx.objectStore('replaced').put(r)), ...t.importSets.map((s) => sets.put(s)), ...t.deleteIds.map((id) => sets.delete(id)),
      ...t.importBody.map((d) => days.put(mergeDay(cur.body.get(d.date), d))),
    ];
    if (t.deleteIds.length) writes.push(cfg.put(withTombstones(await cfg.get('deleted'), t.deleteIds, null)));
    await Promise.all([...writes, tx.done]);
    return { taken: t, replaced, skipped };
  } catch (e) {
    try { tx.abort(); } catch { /* already aborted: keep the real error */ }
    await tx.done.catch(() => {});
    throw e;
  }
}

/** Where one synced settings item (cloud/meta readMeta) lives in a profile's database; null for gyms (shared) or a key this build doesn't know. */
type Row = any; // a stored row, whichever store it's in
function metaRow(k: string): { store: string; key: string; get: (r: Row) => unknown; put: (v: unknown, r: Row) => Row; del: (r: Row) => Row | null } | null {
  const whole = { get: (r: Row) => r, put: (v: unknown) => v, del: () => null };
  if (k === 'profile') return { store: 'profile', key: k, ...whole };
  if (k === 'program' || k.startsWith('day:')) return { store: 'program', key: k, ...whole };
  if (k.startsWith('settings:')) return { store: 'settings', key: k.slice(9), ...whole };
  if (k === 'tags') return { store: 'config', key: k, ...whole };
  if (k === 'status') return { store: 'config', key: k, get: (r) => r?.text, put: (v) => ({ key: 'status', text: cleanStatus(v) }), del: () => null };
  if (k.startsWith('alias:')) {
    const name = k.slice(6);
    return { store: 'config', key: 'aliases', get: (r) => r?.map?.[name], put: (v, r) => ({ key: 'aliases', map: { ...r?.map, [name]: v } }),
      del: (r) => { const { [name]: _gone, ...map } = r?.map ?? {}; return { key: 'aliases', map }; } };
  }
  return null;
}
const itemHash = (v: unknown) => (v === undefined ? '' : metaHash(v));
const gymsItem = (r: Row) => (r?.gyms?.length ? { gyms: r.gyms, active: r.active } : undefined); // as readMeta has it

/**
 * Saves the settings a sync takes onto this phone (`pull`) and deletes those another phone deleted (`remove`), each only if it's
 * still as the sync read it (`base`, from readMeta): one changed here while the sync was out stays, and the next sync sends it up.
 */
export async function applySyncedMeta(base: MetaItems, pull: MetaItems, remove: string[]): Promise<{ pulled: number; removed: number; skipped: number }> {
  const out = { pulled: 0, removed: 0, skipped: 0 };
  const ops = [...Object.entries(pull).map(([k, v]) => ({ k, v, gone: false })), ...remove.map((k) => ({ k, v: undefined as unknown, gone: true }))];
  const count = (o: { gone: boolean }) => { if (o.gone) out.removed++; else out.pulled++; };
  const tx = (await db()).transaction(['profile', 'program', 'settings', 'config'], 'readwrite');
  try {
    for (const o of ops) {
      const at = metaRow(o.k);
      if (!at) continue;
      const s = tx.objectStore(at.store), row = await s.get(at.key);
      if (itemHash(at.get(row)) !== itemHash(base[o.k])) { out.skipped++; continue; }
      const next = o.gone ? at.del(row) : at.put(o.v, row);
      if (next) await s.put(next); else await s.delete(at.key);
      count(o);
    }
    await tx.done;
  } catch (e) {
    try { tx.abort(); } catch { /* already aborted: keep the real error */ }
    await tx.done.catch(() => {});
    throw e;
  }
  const gyms = ops.find((o) => o.k === 'gyms');
  if (gyms) {
    const g = (await shared()).transaction('kv', 'readwrite');
    const row = await g.store.get('gyms');
    if (itemHash(gymsItem(row)) !== itemHash(base.gyms)) out.skipped++;
    else { await g.store.put(gyms.gone ? { key: 'gyms', gyms: [] } : { key: 'gyms', ...(gyms.v as object) }); count(gyms); }
    await g.done;
  }
  return out;
}

/** This phone's copies that a sync replaced (domain/replaced). */
export const getReplaced = async (): Promise<Replaced[]> => (await db()).getAll('replaced');
/** Saved before the sync takes the other copy; the same key again (a sync redone) replaces the record. */
export async function putReplaced(xs: Replaced[]): Promise<void> {
  const tx = (await db()).transaction('replaced', 'readwrite');
  await Promise.all([...xs.map((x) => tx.store.put(x)), tx.done]);
}
export const deleteReplaced = async (key: string): Promise<void> => { await (await db()).delete('replaced', key); };
/** Deletes the copies replaced before `before` (epoch ms); returns how many went. */
export async function pruneReplaced(before: number): Promise<number> {
  const tx = (await db()).transaction('replaced', 'readwrite');
  let n = 0;
  for (let c = await tx.store.openCursor(); c; c = await c.continue()) if ((c.value as Replaced).at < before) { void c.delete(); n++; }
  await tx.done;
  return n;
}

/** Note-name → exercise mappings the user confirmed while pasting notes. On this device only. */
export async function getAliases(): Promise<Record<string, string>> {
  const x: { map: Record<string, string> } | undefined = await (await db()).get('config', 'aliases');
  return x?.map ?? {};
}
export const putAliases = async (map: Record<string, string>): Promise<void> => { await (await db()).put('config', { key: 'aliases', map }); };

/** Gyms and which one is active. Shared by everyone using this phone. */
export async function getGyms(): Promise<{ gyms: Gym[]; active?: string }> {
  const x: { gyms: Gym[]; active?: string } | undefined = await (await shared()).get('kv', 'gyms');
  return { gyms: x?.gyms ?? [], active: x?.active };
}
export const putGyms = async (v: { gyms: Gym[]; active?: string }): Promise<void> => { await (await shared()).put('kv', { key: 'gyms', ...v }); };

// Everything that belongs to one person. A profile's screens use these through boundDb, never the bare functions above.
const PER_PROFILE = {
  getAllSets, putSet, addSet, deleteSet, deleteSetWithTombstone, restoreSet, renameLift, putMany, getAllSettings, putSettings, deleteSettings, getTags, putTags, getStatus, putStatus, getProfile, putProfile, getProgram, putProgram, getDayPlans, putDayPlan, deleteDayPlan,
  getBody, putBody, putBodyMany, getCycle, putCycleDay, putCycleTracking, clearCycle, finishCycleSync, getPhotoMetas, getPhotoBlob, putPhoto, deletePhoto, getTombstones, getTombstoneTimes, addTombstone, getAliases, putAliases, getCloudSeen, putCloudSeen,
  getReplaced, putReplaced, deleteReplaced, pruneReplaced, getSyncSnapshot, applySynced, applySyncedMeta,
};
export type ProfileDb = typeof PER_PROFILE;
const bound = new Map<string, ProfileDb>();
/**
 * The db functions pinned to one profile. Each picks its database synchronously, so setting `current` around the call pins it —
 * including a call made long after a switch, like a sync importing what it pulled or a photo saved after encoding.
 */
export function boundDb(id: string): ProfileDb {
  let b = bound.get(id);
  if (!b) {
    b = Object.fromEntries(Object.entries(PER_PROFILE).map(([k, f]) => [k, (...args: unknown[]) => {
      const prev = current; current = id;
      try { return (f as (...a: unknown[]) => unknown)(...args); } finally { current = prev; }
    }])) as ProfileDb;
    bound.set(id, b);
  }
  return b;
}
