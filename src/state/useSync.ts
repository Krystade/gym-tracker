import { useCallback, useEffect, useState } from 'react';
import { deleteSyncConfig, getSyncConfig, getTombstones, MAIN, putSyncConfig, type Person } from '../db/db';
import { pathsFor, repoClient, sync, SyncError, type SyncConfig } from '../domain/sync';
import type { SetsStore } from './useSets';
import type { BodyStore } from './useBody';

export type SyncStatus = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; text: string } | { kind: 'error'; text: string };

/** The repo and token are shared; where in the repo this profile's files go depends on `person`. */
export function useSync(store: SetsStore, body: BodyStore, person: Person) {
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });
  useEffect(() => { void getSyncConfig().then((c) => setConfig(c ?? null)).catch(() => setConfig(null)); }, []);

  const saveConfig = useCallback(async (c: SyncConfig): Promise<boolean> => {
    try { await putSyncConfig(c); setConfig(c); return true; }
    catch (e) { setStatus({ kind: 'error', text: `Saving the settings failed: ${String(e)}` }); return false; }
  }, []);
  const forget = useCallback(async () => { await deleteSyncConfig(); setConfig(null); setStatus({ kind: 'idle' }); }, []);

  const run = useCallback(async () => {
    if (!config) return;
    setStatus({ kind: 'running' });
    try {
      const r = await sync({
        client: repoClient(config, (u, i) => fetch(u, i)), sets: store.entries, body: body.days, deleted: await getTombstones(),
        importSets: (e) => store.importEntries(e), importBody: (d) => body.importDays(d), now: new Date(),
        paths: pathsFor(person.id === MAIN ? null : person.slug),
      });
      const next = { ...config, lastSync: new Date().toISOString() };
      await putSyncConfig(next); setConfig(next);
      setStatus({ kind: 'done', text: `Synced: ${r.pulledSets} sets and ${r.pulledBody} body days pulled in; backup holds ${r.pushedSets} sets and ${r.pushedBody} body days.` });
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof SyncError ? e.message : `Sync failed: ${String(e)}` });
    }
  }, [config, store, body, person]);

  return { config, status, saveConfig, forget, run };
}
export type SyncStore = ReturnType<typeof useSync>;
