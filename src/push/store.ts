import { openDB, type IDBPDatabase } from 'idb';

// A small database of its own, shared by the service worker and the page: the app's database keeps its version.
export interface PushRecords {
  /** The last push the service worker got, for the diagnostics. */
  lastPush: { at: number; kind: string | null };
  /** Where the last notification tap wanted to go, for a page that opened at the root instead (WebKit 263687). */
  route: { route: string; at: number };
  /** Your private tags for friends, by uid (state/friendCache keeps it in step), for a friend's push to show yours. */
  tags: Record<string, string>;
}
type Key = keyof PushRecords;

let db: Promise<IDBPDatabase> | null = null;
const open = () => (db ??= openDB('gym-tracker-push', 1, { upgrade: (d) => { d.createObjectStore('kv'); } }));

export async function record<K extends Key>(key: K, value: PushRecords[K]): Promise<void> {
  await (await open()).put('kv', value, key);
}
export async function read<K extends Key>(key: K): Promise<PushRecords[K] | undefined> {
  return (await open()).get('kv', key);
}
/** Reads and removes, so a stored route is followed once. */
export async function take<K extends Key>(key: K): Promise<PushRecords[K] | undefined> {
  const d = await open();
  const tx = d.transaction('kv', 'readwrite');
  const v = await tx.store.get(key);
  if (v !== undefined) await tx.store.delete(key);
  await tx.done;
  return v;
}
