import { useCallback, useEffect, useState } from 'react';
import { useDb } from './profileDb';
import type { DayPlan, Program } from '../domain/program';

export function useProgram() {
  const db = useDb();
  const [program, setProgram] = useState<Program | null>(null);
  const [plans, setPlans] = useState<DayPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => Promise.all([db.getProgram(), db.getDayPlans()])
    .then(([p, d]) => { setProgram(p ?? null); setPlans(d); })
    .catch((e) => setError(`Could not load the program: ${String(e)}`)), []);
  useEffect(() => { void reload(); }, [reload]);
  const save = useCallback(async (p: Program) => {
    try { await db.putProgram(p); setProgram(p); setError(null); } catch (e) { setError(`Saving the program failed: ${String(e)}`); }
  }, []);
  const savePlan = useCallback(async (d: DayPlan) => {
    try { await db.putDayPlan(d); setPlans((xs) => [...xs.filter((x) => x.key !== d.key), d]); setError(null); }
    catch (e) { setError(`Saving today's plan failed: ${String(e)}`); }
  }, []);
  return { program, plans, error, save, savePlan, reload };
}
export type ProgramStore = ReturnType<typeof useProgram>;
