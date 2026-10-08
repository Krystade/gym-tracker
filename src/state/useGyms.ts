import { useCallback, useEffect, useRef, useState } from 'react';
import { getGyms, putGyms } from '../db/db';
import type { Gym } from '../domain/equipment';

export function useGyms() {
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => getGyms().then((x) => { current.current = x; setGyms(x.gyms); setActiveId(x.active); }).catch((e) => setError(`Could not load gyms: ${String(e)}`)), []);
  useEffect(() => { void reload(); }, [reload]);
  const current = useRef<{ gyms: Gym[]; active?: string }>({ gyms: [] });
  // Shown at once (a checkbox must follow the tap); put back if the write fails.
  const save = useCallback(async (next: Gym[], active: string | undefined): Promise<boolean> => {
    const before = current.current;
    current.current = { gyms: next, active };
    setGyms(next); setActiveId(active);
    try { await putGyms({ gyms: next, active }); setError(null); return true; }
    catch (e) {
      current.current = before; setGyms(before.gyms); setActiveId(before.active);
      setError(`Saving gyms failed: ${String(e)}`); return false;
    }
  }, []);
  const active = gyms.find((g) => g.id === activeId) ?? null;
  return { gyms, active, error, save, reload };
}
export type GymsStore = ReturnType<typeof useGyms>;
