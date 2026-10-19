import { useCallback, useEffect, useRef, useState } from 'react';
import { setBlockedHandler } from '../db/db';
import { useDb, useProfileId } from './profileDb';
import { buildNamedSet, type NewSetInput } from '../domain/buildSet';
import { canonicalName } from '../domain/stats';
import { diffSets } from '../domain/csv';
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
    // The name as already logged, from the log in memory; the save reads only the day's stored sets, for the set number.
    const exercise = canonicalName(ref.current, input.exercise);
    try { e = await db.addSet(input.date, (sameDay) => buildNamedSet(sameDay, { ...input, exercise }, now)); } catch (err) { fail('Saving the set', err); return null; }
    ref.current = [...ref.current.filter((x) => x.id !== e.id), e];
    setEntries(ref.current);
    setError(null);
    announce();
    return e;
  }, []);

  // Stamped, so between two phones that both changed this set the newer change wins in sync.
  const update = useCallback(async (changed: SetEntry): Promise<boolean> => {
    const e = { ...changed, editedAt: Date.now() };
    try { await db.putSet(e); } catch (err) { fail('Saving the change', err); return false; }
    setEntries((xs) => xs.map((x) => (x.id === e.id ? e : x)));
    announce();
    return true;
  }, []);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try { await db.deleteSetWithTombstone(id); } catch (err) { fail('Deleting', err); return false; }
    setEntries((xs) => xs.filter((x) => x.id !== id));
    announce();
    return true;
  }, []);

  /** A sync saved sets straight to the database (db applySynced): re-read, and tell the other open copies. */
  const synced = useCallback(async () => { await reload(); announce(); }, [reload]);

  const restore = useCallback(async (gone: SetEntry): Promise<boolean> => {
    // Stamped, so the delete it undoes can't win again in the next sync if that delete already went up.
    const e = { ...gone, restoredAt: Date.now() };
    try { await db.restoreSet(e); } catch (err) { fail('Undoing the delete', err); return false; }
    ref.current = [...ref.current.filter((x) => x.id !== e.id), e];
    setEntries(ref.current);
    announce();
    return true;
  }, []);

  /** A copy a sync replaced, put back as a new edit (stamped now, so it wins on every phone), deleted or not. */
  const reapply = useCallback(async (copy: SetEntry): Promise<boolean> => {
    const e = { ...copy, editedAt: Date.now() };
    try { await db.restoreSet(e); } catch (err) { fail('Keeping this phone’s copy', err); return false; }
    ref.current = [...ref.current.filter((x) => x.id !== e.id), e];
    setEntries(ref.current);
    announce();
    return true;
  }, []);

  /** Renames a lift, or merges it into another: see db.renameLift. */
  const rename = useCallback(async (from: string, to: string): Promise<boolean> => {
    try { await db.renameLift(from, to); } catch (err) { setError(`Renaming failed — nothing was changed. ${String(err)}`); return false; }
    await reload();
    announce();
    return true;
  }, [reload]);

  const importEntries = useCallback(async (list: SetEntry[]): Promise<{ added: number; updated: number } | null> => {
    let result;
    try { result = await db.putMany(list); } catch (err) { setError(`Import failed — your existing sets are unchanged. ${String(err)}`); return null; }
    await reload();
    announce();
    return result;
  }, [reload]);

  // Reads the database, not state: back-to-back files in one pick must see each other's rows.
  const diff = useCallback(async (list: SetEntry[]) => diffSets(await db.getAllSets(), list), [db]);

  return { entries, loading, error, add, update, remove, synced, restore, reapply, rename, importEntries, diff };
}
export type SetsStore = ReturnType<typeof useSets>;
