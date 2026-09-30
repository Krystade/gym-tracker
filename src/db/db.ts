import { openDB, type IDBPDatabase } from 'idb';
import type { SetEntry } from '../domain/types';
import type { ExerciseSettings } from '../domain/progression';
import type { Profile } from '../domain/profile';
import type { DayPlan, Program } from '../domain/program';

const STORE = 'sets';
let dbp: Promise<IDBPDatabase> | null = null;
let onBlocked: (() => void) | null = null;
/** Called when an upgrade waits on another open copy of the app (e.g. a Safari tab beside the installed app). */
export const setBlockedHandler = (fn: (() => void) | null) => { onBlocked = fn; };

function db(): Promise<IDBPDatabase> {
  return (dbp ??= openDB('gym-tracker', 4, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) d.createObjectStore(STORE, { keyPath: 'id' }).createIndex('date', 'date');
      if (oldVersion < 2) d.createObjectStore('settings', { keyPath: 'key' });
      if (oldVersion < 3) d.createObjectStore('profile', { keyPath: 'key' });
      if (oldVersion < 4) d.createObjectStore('program', { keyPath: 'key' });
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
