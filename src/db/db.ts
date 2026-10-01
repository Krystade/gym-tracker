import { deleteDB, openDB, type IDBPDatabase } from 'idb';
import type { SetEntry } from '../domain/types';
import type { ExerciseSettings } from '../domain/progression';
import type { Profile } from '../domain/profile';
import type { DayPlan, Program } from '../domain/program';
import type { BodyDay } from '../domain/body';
import type { PhotoMeta } from '../domain/photos';
import type { SyncConfig } from '../domain/sync';
import type { Gym } from '../domain/equipment';

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
let onBlocked: (() => void) | null = null;
/** Called when an upgrade waits on another open copy of the app (e.g. a Safari tab beside the installed app). */
export const setBlockedHandler = (fn: (() => void) | null) => { onBlocked = fn; };

function db(id = current): Promise<IDBPDatabase> {
  const open = conns.get(id);
  if (open) return open;
  const p: Promise<IDBPDatabase> = openDB(dbName(id), 7, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) d.createObjectStore(STORE, { keyPath: 'id' }).createIndex('date', 'date');
      if (oldVersion < 2) d.createObjectStore('settings', { keyPath: 'key' });
      if (oldVersion < 3) d.createObjectStore('profile', { keyPath: 'key' });
      if (oldVersion < 4) d.createObjectStore('program', { keyPath: 'key' });
      if (oldVersion < 5) d.createObjectStore('body', { keyPath: 'date' });
      // Metadata apart from the image blobs, so listing the timeline never reads the images.
      if (oldVersion < 6) { d.createObjectStore('photos', { keyPath: 'id' }).createIndex('date', 'date'); d.createObjectStore('photoBlobs'); }
      if (oldVersion < 7) d.createObjectStore('config', { keyPath: 'key' });
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

export async function getPeople(): Promise<{ people: Person[]; active: string }> {
  const x: { people: Person[]; active: string } | undefined = await (await shared()).get('kv', 'people');
  return { people: x?.people ?? [{ id: MAIN, name: 'Me', slug: 'me' }], active: x?.active ?? MAIN };
}
export const putPeople = async (people: Person[], active: string): Promise<void> => { await (await shared()).put('kv', { key: 'people', people, active }); };
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
export const deleteSet = async (id: string): Promise<void> => { await (await db()).delete(STORE, id); };

export const getAllSettings = async (): Promise<ExerciseSettings[]> => (await db()).getAll('settings');
export const putSettings = async (s: ExerciseSettings): Promise<void> => { await (await db()).put('settings', s); };

export const getProfile = async (): Promise<Profile | undefined> => (await db()).get('profile', 'profile');
export const putProfile = async (p: Profile): Promise<void> => { await (await db()).put('profile', p); };

export const getProgram = async (): Promise<Program | undefined> => (await db()).get('program', 'program');
export const putProgram = async (p: Program): Promise<void> => { await (await db()).put('program', p); };
/** Day plans share the program store under 'day:YYYY-MM-DD' keys. */
export const getDayPlans = async (): Promise<DayPlan[]> =>
  (await (await db()).getAll('program', IDBKeyRange.bound('day:', 'day:￿'))) as DayPlan[];
export const putDayPlan = async (p: DayPlan): Promise<void> => { await (await db()).put('program', p); };

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

export const getBody = async (): Promise<BodyDay[]> => (await db()).getAll('body');
export const putBody = async (d: BodyDay): Promise<void> => { await (await db()).put('body', d); };
export async function putBodyMany(days: BodyDay[]): Promise<void> {
  const tx = (await db()).transaction('body', 'readwrite');
  await Promise.all([...days.map((d) => tx.store.put(d)), tx.done]);
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
/** Ids of sets deleted on this phone, so sync never brings them back. */
export async function getTombstones(): Promise<Set<string>> {
  const x: { ids: string[] } | undefined = await (await db()).get('config', 'deleted');
  return new Set(x?.ids ?? []);
}
export async function addTombstone(id: string): Promise<void> {
  const tx = (await db()).transaction('config', 'readwrite');
  const cur: { ids: string[] } | undefined = await tx.store.get('deleted');
  const ids = new Set(cur?.ids ?? []).add(id);
  await Promise.all([tx.store.put({ key: 'deleted', ids: [...ids] }), tx.done]);
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
