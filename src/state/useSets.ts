import { useCallback, useEffect, useRef, useState } from 'react';
import { setBlockedHandler } from '../db/db';
import { useDb, useProfileId } from './profileDb';
import { buildAppSet, type NewSetInput } from '../domain/buildSet';
import type { SetEntry } from '../domain/types';

// Other open copies of the app (a Safari tab beside the installed app) hear about each change and re-read.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('gym-tracker-sets') : null;

export function useSets() {
  const db = useDb();
  const profile = useProfileId();
  const [entries, setEntries] = useState<SetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef(entries);
  ref.current = entries;

  const reload = useCallback(async () => {
    try { setEntries(await db.getAllSets()); setError(null); }
    catch (e) { setError(`Could not read saved sets: ${String(e)}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    setBlockedHandler(() => setError('Updating the app’s storage — close any other Gym Tracker tabs or windows to finish.'));
    void reload();
    return () => setBlockedHandler(null);
  }, [reload]);

  useEffect(() => {
    if (!channel) return;
    const heard = (m: MessageEvent<{ profile?: string }>) => { if (m.data?.profile === profile) void reload(); };
    channel.addEventListener('message', heard);
    return () => channel.removeEventListener('message', heard);
  }, [reload, profile]);
  const announce = () => channel?.postMessage({ profile });

  const fail = (what: string, e: unknown) => { setError(`${what} failed — nothing was lost from the form. ${String(e)}`); };

  const add = useCallback(async (input: NewSetInput): Promise<SetEntry | null> => {
    const now = new Date(); // taken at the tap, not after the database answers
    let e: SetEntry;
    try { e = await db.addSet((stored) => buildAppSet(stored, input, now)); } catch (err) { fail('Saving the set', err); return null; }
    ref.current = [...ref.current.filter((x) => x.id !== e.id), e];
    setEntries(ref.current);
    setError(null);
    announce();
    return e;
  }, []);

  const update = useCallback(async (e: SetEntry): Promise<boolean> => {
    try { await db.putSet(e); } catch (err) { fail('Saving the change', err); return false; }
    setEntries((xs) => xs.map((x) => (x.id === e.id ? e : x)));
    announce();
    return true;
  }, []);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try { await db.deleteSet(id); await db.addTombstone(id); } catch (err) { fail('Deleting', err); return false; }
    setEntries((xs) => xs.filter((x) => x.id !== id));
    announce();
    return true;
  }, []);

  const importEntries = useCallback(async (list: SetEntry[]): Promise<{ added: number; updated: number } | null> => {
    let result;
    try { result = await db.putMany(list); } catch (err) { setError(`Import failed — your existing sets are unchanged. ${String(err)}`); return null; }
    await reload();
    announce();
    return result;
  }, [reload]);

  return { entries, loading, error, add, update, remove, importEntries };
}
export type SetsStore = ReturnType<typeof useSets>;
