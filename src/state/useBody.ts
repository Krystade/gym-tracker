import { useCallback, useEffect, useState } from 'react';
import { getBody, putBody, putBodyMany } from '../db/db';
import { mergeBody, type BodyDay } from '../domain/body';

export function useBody() {
  const [days, setDays] = useState<BodyDay[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void getBody().then(setDays).catch((e) => setError(`Could not load body weight: ${String(e)}`));
  }, []);
  const save = useCallback(async (d: BodyDay): Promise<boolean> => {
    const next = mergeBody(days, [d]).find((x) => x.date === d.date)!;
    try { await putBody(next); setDays((xs) => mergeBody(xs, [next])); setError(null); return true; }
    catch (e) { setError(`Saving the weigh-in failed: ${String(e)}`); return false; }
  }, [days]);
  const importDays = useCallback(async (incoming: BodyDay[]): Promise<boolean> => {
    const merged = mergeBody(days, incoming);
    const touched = merged.filter((d) => incoming.some((x) => x.date === d.date));
    try { await putBodyMany(touched); setDays(merged); setError(null); return true; }
    catch (e) { setError(`Importing body data failed: ${String(e)}`); return false; }
  }, [days]);
  return { days, error, save, importDays };
}
export type BodyStore = ReturnType<typeof useBody>;
