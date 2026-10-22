import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { achievementsOf, type Achievements } from '../domain/achievements';
import type { Profile } from '../domain/profile';
import type { DayPlan, Program } from '../domain/program';
import type { SetEntry } from '../domain/types';
import { useDb } from './profileDb';

// Achievements for the person whose screens these are (domain/achievements). The day they count from is kept once, the first time
// this build opens a profile (owner 2026-10-21: everyone starts from 0), and synced as the earliest of the phones'. Everything
// else is worked out from the log on the screen that shows it, with the stored profile (not the fitted one: each day is fitted
// there), the program and the day plans.

/** The day this profile's achievements count from: kept on first open; `reload` after a sync may bring an earlier one. */
export function useAchStart(today: string) {
  const db = useDb();
  const [since, setSince] = useState<string | null>(null);
  const kept = useRef<string | null>(null);
  // The db is bound once per person (a new object each render of its provider, the same database): not a dependency. The day
  // read lands from a timer, never inside an event (an update there renders at once and can drop a keystroke being typed:
  // the Data screen's old bug), and only when it differs: a sync's reload mostly reads the same day.
  const reload = useCallback(() => db.startAchievements(today).then((v) => {
    if (v !== kept.current) setTimeout(() => { if (v !== kept.current) { kept.current = v; setSince(v); } });
  }).catch(() => {}), [today]);
  useEffect(() => { void reload(); }, [reload]);
  return { since, reload };
}
export type AchStart = ReturnType<typeof useAchStart>;

interface Ctx { since: string | null; profile: Profile; program: Program | null; plans: readonly DayPlan[] }
const AchCtx = createContext<Ctx | null>(null);

export function AchProvider({ since, profile, program, plans, children }: Ctx & { children: ReactNode }) {
  const v = useMemo(() => ({ since, profile, program, plans }), [since, profile, program, plans]);
  return <AchCtx.Provider value={v}>{children}</AchCtx.Provider>;
}

/** The start day, or null before it is read (and outside a person's screens). */
export const useAchSince = (): string | null => useContext(AchCtx)?.since ?? null;

/** Achievements for this log on `today`; null until the start day is read, and outside a person's screens. */
export function useAchievements(entries: readonly SetEntry[], today: string): Achievements | null {
  const c = useContext(AchCtx);
  return useMemo(() => (c?.since ? achievementsOf(entries, { profile: c.profile, today, since: c.since, program: c.program, plans: c.plans }) : null),
    [c, entries, today]);
}

/** The context as a function: for working out achievements off the render (a set just saved). */
export function useAchContext(): ((entries: readonly SetEntry[], today: string) => Achievements) | null {
  const c = useContext(AchCtx);
  return useMemo(() => (c?.since ? (entries: readonly SetEntry[], today: string) => achievementsOf(entries, { profile: c.profile, today, since: c.since!, program: c.program, plans: c.plans }) : null), [c]);
}
