import { useCallback, useEffect, useRef, useState } from 'react';
import { useDb } from './profileDb';
import { diffBody, mergeBody, type BodyDay } from '../domain/body';

export function useBody() {
  const db = useDb();
  const [days, setDays] = useState<BodyDay[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Several files import back to back within one render; each merge must see the previous one.
  const current = useRef<BodyDay[]>([]);
  const commit = (xs: BodyDay[]) => { current.current = xs; setDays(xs); };
  useEffect(() => {
    void db.getBody().then(commit).catch((e) => setError(`Could not load body weight: ${String(e)}`));
  }, []);
  const save = useCallback(async (d: BodyDay): Promise<boolean> => {
    const merged = mergeBody(current.current, [d]);
    try { await db.putBody(merged.find((x) => x.date === d.date)!); commit(merged); setError(null); return true; }
    catch (e) { setError(`Saving the weigh-in failed: ${String(e)}`); return false; }
  }, []);
  const importDays = useCallback(async (incoming: BodyDay[]): Promise<boolean> => {
    const merged = mergeBody(current.current, incoming);
    const dates = new Set(incoming.map((x) => x.date));
    try { await db.putBodyMany(merged.filter((d) => dates.has(d.date))); commit(merged); setError(null); return true; }
    catch (e) { setError(`Importing body data failed: ${String(e)}`); return false; }
  }, []);
  // Against the days as of the last commit, not the last render: back-to-back files in one pick must see each other.
  const diff = useCallback((incoming: BodyDay[]) => diffBody(current.current, incoming), []);
  return { days, error, save, importDays, diff };
}
export type BodyStore = ReturnType<typeof useBody>;
