import { openDB, type IDBPDatabase } from 'idb';
import type { SetEntry } from '../domain/types';

const STORE = 'sets';
let dbp: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  return (dbp ??= openDB('gym-tracker', 1, {
    upgrade(d) {
      d.createObjectStore(STORE, { keyPath: 'id' }).createIndex('date', 'date');
    },
  }));
}

export const resetDbForTests = () => { dbp = null; };
export const getAllSets = async (): Promise<SetEntry[]> => (await db()).getAll(STORE);
export const putSet = async (e: SetEntry): Promise<void> => { await (await db()).put(STORE, e); };
export const deleteSet = async (id: string): Promise<void> => { await (await db()).delete(STORE, id); };

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
