import { useCallback, useEffect, useState } from 'react';
import { getDayPlans, getProgram, putDayPlan, putProgram } from '../db/db';
import type { DayPlan, Program } from '../domain/program';

export function useProgram() {
  const [program, setProgram] = useState<Program | null>(null);
  const [plans, setPlans] = useState<DayPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void Promise.all([getProgram(), getDayPlans()])
      .then(([p, d]) => { setProgram(p ?? null); setPlans(d); })
      .catch((e) => setError(`Could not load the program: ${String(e)}`));
  }, []);
  const save = useCallback(async (p: Program) => {
    try { await putProgram(p); setProgram(p); setError(null); } catch (e) { setError(`Saving the program failed: ${String(e)}`); }
  }, []);
  const savePlan = useCallback(async (d: DayPlan) => {
    try { await putDayPlan(d); setPlans((xs) => [...xs.filter((x) => x.key !== d.key), d]); setError(null); }
    catch (e) { setError(`Saving today's plan failed: ${String(e)}`); }
  }, []);
  return { program, plans, error, save, savePlan };
}
export type ProgramStore = ReturnType<typeof useProgram>;
