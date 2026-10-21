import { useCallback, useEffect, useState } from 'react';
import { deleteSyncConfig, getSyncConfig, MAIN, putSyncConfig, type Person } from '../db/db';
import { useDb } from './profileDb';
import { pathsFor, repoClient, sync, SyncError, type SyncConfig } from '../domain/sync';
import type { SetsStore } from './useSets';
import type { BodyStore } from './useBody';
import { replacedChanged } from './useReplaced';
import { phoneApply } from '../cloud/sync';

export type SyncStatus = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; text: string } | { kind: 'error'; text: string };

/** The repo and token are shared; where in the repo this profile's files go depends on `person`. */
export function useSync(store: SetsStore, body: BodyStore, person: Person) {
  const db = useDb();
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
      // The log as the database has it; what the pull takes lands only where it's still that (db applySynced).
      const log = await db.getSyncSnapshot();
      const r = await sync({
        client: repoClient(config, (u, i) => fetch(u, i)), sets: log.sets, body: log.body, deleted: log.tombstones, tombAt: log.tombAt, now: new Date(), historySeen: config.historySha,
        paths: pathsFor(person.id === MAIN ? null : person.slug),
        apply: phoneApply(db, { log: async () => { await store.synced(); await body.reload(); }, replaced: replacedChanged }).applyMonth,
      });
      const next = { ...config, lastSync: new Date().toISOString(), historySha: r.historySha ?? config.historySha };
      await putSyncConfig(next); setConfig(next);
      const removed = r.removedSets ? `; ${r.removedSets} set${r.removedSets === 1 ? '' : 's'} deleted on another device removed` : '';
      const held = r.heldBack ? `; ${r.heldBack} history.csv set${r.heldBack === 1 ? '' : 's'} held back, already in your log from another import (Import CSV can add them anyway)` : '';
      setStatus({ kind: 'done', text: `Synced: ${r.pulledSets} sets and ${r.pulledBody} body days pulled in${removed}${held}; backup holds ${r.pushedSets} sets and ${r.pushedBody} body days.` });
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof SyncError ? e.message : `Sync failed: ${String(e)}` });
    }
  }, [config, store, body, person]);

  return { config, status, saveConfig, forget, run };
}
export type SyncStore = ReturnType<typeof useSync>;
