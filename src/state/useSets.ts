import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteSet, getAllSets, putMany, putSet, setBlockedHandler, addTombstone } from '../db/db';
import { buildAppSet, type NewSetInput } from '../domain/buildSet';
import type { SetEntry } from '../domain/types';

export function useSets() {
  const [entries, setEntries] = useState<SetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef(entries);
  ref.current = entries;

  const reload = useCallback(async () => {
    try { setEntries(await getAllSets()); setError(null); }
    catch (e) { setError(`Could not read saved sets: ${String(e)}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    setBlockedHandler(() => setError('Updating the app’s storage — close any other Gym Tracker tabs or windows to finish.'));
    void reload();
    return () => setBlockedHandler(null);
  }, [reload]);

  const fail = (what: string, e: unknown) => { setError(`${what} failed — nothing was lost from the form. ${String(e)}`); };

  const add = useCallback(async (input: NewSetInput): Promise<SetEntry | null> => {
    const e = buildAppSet(ref.current, input, new Date());
    try { await putSet(e); } catch (err) { fail('Saving the set', err); return null; }
    ref.current = [...ref.current.filter((x) => x.id !== e.id), e];
    setEntries(ref.current);
    setError(null);
    return e;
  }, []);

  const update = useCallback(async (e: SetEntry): Promise<boolean> => {
    try { await putSet(e); } catch (err) { fail('Saving the change', err); return false; }
    setEntries((xs) => xs.map((x) => (x.id === e.id ? e : x)));
    return true;
  }, []);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try { await deleteSet(id); await addTombstone(id); } catch (err) { fail('Deleting', err); return false; }
    setEntries((xs) => xs.filter((x) => x.id !== id));
    return true;
  }, []);

  const importEntries = useCallback(async (list: SetEntry[]): Promise<{ added: number; updated: number } | null> => {
    let result;
    try { result = await putMany(list); } catch (err) { setError(`Import failed — your existing sets are unchanged. ${String(err)}`); return null; }
    await reload();
    return result;
  }, [reload]);

  return { entries, loading, error, add, update, remove, importEntries };
}
export type SetsStore = ReturnType<typeof useSets>;
