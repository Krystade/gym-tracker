import { useCallback, useEffect, useState } from 'react';
import { useDb } from './profileDb';
import { combine, expired, type Replaced } from '../domain/replaced';
import type { SetsStore } from './useSets';
import type { BodyStore } from './useBody';

// A sync keeps this phone's replaced values in the database and says so here; the list on More reads them again.
const listeners = new Set<() => void>();
export const replacedChanged = () => { for (const f of listeners) f(); };
/** Saves this phone's values a sync is about to replace, for the list on More; false if they couldn't be saved. */
export async function keepReplaced(db: { putReplaced: (x: Replaced[]) => Promise<void> }, x: Replaced[]): Promise<boolean> {
  try { await db.putReplaced(x); } catch { return false; }
  replacedChanged();
  return true;
}

/** This person's copies a sync replaced, newest first, and putting one back (or combining it with the synced copy). */
export function useReplaced(store: SetsStore, body: BodyStore) {
  const db = useDb();
  const [list, setList] = useState<Replaced[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Expired ones are pruned at startup; one that ran out since then doesn't show either.
  const load = useCallback(() => db.getReplaced().then((xs) => setList(xs.filter((r) => !expired(r, Date.now())).sort((a, b) => b.at - a.at || (a.date < b.date ? 1 : -1))),
    (e) => setError(`Could not read what sync replaced: ${String(e)}`)), [db]);
  useEffect(() => { void load(); listeners.add(load); return () => { listeners.delete(load); }; }, [load]);

  const dismiss = useCallback(async (r: Replaced) => {
    try { await db.deleteReplaced(r.key); setError(null); } catch (e) { setError(`Dismissing failed: ${String(e)}`); }
    await load();
  }, [db, load]);
  /**
   * Puts this phone's copy back as a new edit, stamped now, so it wins on every phone at the next sync; `both` takes the synced
   * copy with what only this phone's had added in. The record goes once the set or day is saved.
   */
  const keep = useCallback(async (r: Replaced, both = false) => {
    const ok = r.kind === 'body' ? await body.save({ date: r.date, ...r.mine })
      : await store.reapply(both && r.theirs ? combine(r.mine, r.theirs) ?? r.mine : r.mine);
    if (ok) await dismiss(r);
  }, [store, body, dismiss]);
  return { list, error, keep, dismiss };
}
export type ReplacedStore = ReturnType<typeof useReplaced>;
