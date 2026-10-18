import { useCallback, useEffect, useState } from 'react';
import { useDb } from './profileDb';
import { cleanStatus } from '../domain/crew';

/** Your Crew status phrase: optional, set from your own row, synced with your settings so friends see it. */
export function useStatus() {
  const db = useDb();
  const [status, setStatus] = useState('');
  const reload = useCallback(() => db.getStatus().then((s) => setStatus(s ?? '')).catch(() => {}), []);
  useEffect(() => { void reload(); }, [reload]);
  const save = useCallback(async (s: string) => { const t = cleanStatus(s); setStatus(t); await db.putStatus(t); }, []);
  return { status, save, reload };
}
export type StatusStore = ReturnType<typeof useStatus>;
