import { openDB, type IDBPDatabase } from 'idb';
import type { SetEntry } from '../domain/types';
import type { ExerciseSettings } from '../domain/progression';
import type { Profile } from '../domain/profile';
import type { DayPlan, Program } from '../domain/program';
import type { BodyDay } from '../domain/body';
import type { PhotoMeta } from '../domain/photos';

const STORE = 'sets';
let dbp: Promise<IDBPDatabase> | null = null;
let onBlocked: (() => void) | null = null;
/** Called when an upgrade waits on another open copy of the app (e.g. a Safari tab beside the installed app). */
export const setBlockedHandler = (fn: (() => void) | null) => { onBlocked = fn; };

function db(): Promise<IDBPDatabase> {
  return (dbp ??= openDB('gym-tracker', 6, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) d.createObjectStore(STORE, { keyPath: 'id' }).createIndex('date', 'date');
      if (oldVersion < 2) d.createObjectStore('settings', { keyPath: 'key' });
      if (oldVersion < 3) d.createObjectStore('profile', { keyPath: 'key' });
      if (oldVersion < 4) d.createObjectStore('program', { keyPath: 'key' });
      if (oldVersion < 5) d.createObjectStore('body', { keyPath: 'date' });
      // Metadata apart from the image blobs, so listing the timeline never reads the images.
      if (oldVersion < 6) { d.createObjectStore('photos', { keyPath: 'id' }).createIndex('date', 'date'); d.createObjectStore('photoBlobs'); }
    },
    blocked() { onBlocked?.(); },
    // A newer version of the app is upgrading the database: step aside, and reload to pick up the new code.
    blocking() {
      void dbp?.then((d) => d.close());
      dbp = null;
      if (typeof location !== 'undefined') location.reload();
    },
    terminated() { dbp = null; },
  }));
}

export const resetDbForTests = () => { dbp = null; };
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
  const [f, t]: StoredImage[] = await Promise.all([full, thumb].map(async (b) => ({ type: b.type, data: await b.arrayBuffer() })));
  const tx = (await db()).transaction(['photos', 'photoBlobs'], 'readwrite');
  await Promise.all([tx.objectStore('photos').put(meta), tx.objectStore('photoBlobs').put(f, `${meta.id}:full`), tx.objectStore('photoBlobs').put(t, `${meta.id}:thumb`), tx.done]);
}
export async function deletePhoto(id: string): Promise<void> {
  const tx = (await db()).transaction(['photos', 'photoBlobs'], 'readwrite');
  await Promise.all([tx.objectStore('photos').delete(id), tx.objectStore('photoBlobs').delete(`${id}:full`), tx.objectStore('photoBlobs').delete(`${id}:thumb`), tx.done]);
}
