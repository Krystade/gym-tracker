import { useCallback, useEffect, useState } from 'react';
import { useDb } from './profileDb';
import { cycleMap, type CyclePhase } from '../domain/cycle';

// Today and the Data screen each read the cycle store; a sync tells them when it brought days in, and they tell the sync
// when there's something to send. Kept apart from the body store on purpose: friends read body days, never these.
type Change = 'local' | 'pulled';
const listeners = new Set<(c: Change) => void>();
export const cycleChanged = (c: Change) => { for (const f of listeners) f(c); };
export const onCycleChange = (f: (c: Change) => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

export function useCycle() {
  const db = useDb();
  const [days, setDays] = useState<Record<string, CyclePhase>>({});
  const [tracking, setTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => db.getCycle().then(({ days: d, cfg }) => { setDays(cycleMap(d)); setTracking(!!cfg.tracking); }).catch((e) => setError(`Could not load cycle data: ${String(e)}`)), [db]);
  useEffect(() => { void load(); return onCycleChange((c) => { if (c === 'pulled') void load(); }); }, [load]);
  // Shown once saved, like Energy, so what's on screen is what a reload finds.
  const write = useCallback(async (f: () => Promise<void>, what: string, then: () => void) => {
    try { await f(); then(); setError(null); cycleChanged('local'); } catch (e) { setError(`${what} failed: ${String(e)}`); }
  }, []);
  /** One tap saves the phase; `null` clears it. */
  const setPhase = useCallback((date: string, phase: CyclePhase | null) => write(() => db.putCycleDay({ date, phase }), 'Saving the cycle phase',
    () => setDays((d) => { const n = { ...d }; if (phase) n[date] = phase; else delete n[date]; return n; })), [db, write]);
  const setOn = useCallback((on: boolean) => write(() => db.putCycleTracking(on), 'Saving the setting', () => setTracking(on)), [db, write]);
  const wipe = useCallback(() => write(() => db.clearCycle(), 'Deleting cycle data', () => setDays({})), [db, write]);
  return { days, tracking, error, setPhase, setOn, wipe };
}
export type CycleStore = ReturnType<typeof useCycle>;
