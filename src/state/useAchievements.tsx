import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { achievementsOf, gained, highest, togetherOf, type Achievements, type BodyCtx, type Context, type Unlock } from '../domain/achievements';
import type { Profile } from '../domain/profile';
import type { DayPlan, Program } from '../domain/program';
import type { SetEntry } from '../domain/types';
import { useDb } from './profileDb';
import type { Seen } from '../domain/together';
import type { Together, TogetherNames } from './useTogether';

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

interface Ctx {
  since: string | null; profile: Profile; program: Program | null; plans: readonly DayPlan[];
  /** Your friends' windows and the ledger, and how each friend is said (state/useTogether): signed in only. */ together?: Together;
  /** Your weigh-ins and photos, for Your body: only these screens read them, never the recap or the summary. */ body?: BodyCtx;
  /** Opens the Achievements page at a family (a line tapped on Today, the finish card). */ onOpen?: (id: string, lift?: string) => void;
  /** Shows or keeps a group from friends: only for the person whose account publishes the summary. */ onShare?: (group: string, on: boolean) => void;
}
const AchCtx = createContext<Ctx | null>(null);

export function AchProvider({ since, profile, program, plans, together, body, onOpen, onShare, children }: Ctx & { children: ReactNode }) {
  const v = useMemo(() => ({ since, profile, program, plans, together, body, onOpen, onShare }), [since, profile, program, plans, together, body, onOpen, onShare]);
  return <AchCtx.Provider value={v}>{children}</AchCtx.Provider>;
}

/** Opens the Achievements page at a family; undefined outside a person's screens. */
export const useAchOpen = (): ((id: string, lift?: string) => void) | undefined => useContext(AchCtx)?.onOpen;

/** What friends see of your achievements: the groups kept from them, and the switch (none: not this phone's account). */
export function useAchShare(): { hidden: readonly string[]; onShare?: (group: string, on: boolean) => void } {
  const c = useContext(AchCtx);
  return useMemo(() => ({ hidden: c?.profile.achHidden ?? [], onShare: c?.onShare }), [c]);
}

/** The start day, or null before it is read (and outside a person's screens). */
export const useAchSince = (): string | null => useContext(AchCtx)?.since ?? null;

const contextOf = (c: Ctx & { since: string }, today: string): Context =>
  ({ profile: c.profile, today, since: c.since, program: c.program, plans: c.plans, ...(c.together && { together: c.together.ctx }), ...(c.body && { body: c.body }) });

/** Achievements for this log on `today`; null until the start day is read, and outside a person's screens. */
export function useAchievements(entries: readonly SetEntry[], today: string): Achievements | null {
  const c = useContext(AchCtx);
  return useMemo(() => (c?.since ? achievementsOf(entries, contextOf({ ...c, since: c.since }, today)) : null), [c, entries, today]);
}

/** The context as a function: for working out achievements off the render (a set just saved). */
export function useAchContext(): ((entries: readonly SetEntry[], today: string) => Achievements) | null {
  const c = useContext(AchCtx);
  return useMemo(() => (c?.since ? (entries: readonly SetEntry[], today: string) => achievementsOf(entries, contextOf({ ...c, since: c.since! }, today)) : null), [c]);
}

/** How a friend is said in a Together line ("@ana_lifts", "a former friend"); outside a signed-in person's screens, none. */
export const useTogetherNames = (): TogetherNames | undefined => useContext(AchCtx)?.together?.names;

/**
 * What counts toward Together on `today` (domain/together), for a family's "With" list and Full house's rings: null signed
 * out, or before the start day is read. Only ever on your own phone.
 */
export function useTogetherSeen(entries: readonly SetEntry[], today: string): { seen: Seen; together: Together; since: string; goal: number } | null {
  const c = useContext(AchCtx);
  return useMemo(() => {
    if (!c?.since || !c.together) return null;
    const seen = togetherOf(entries, contextOf({ ...c, since: c.since }, today));
    return seen && { seen, together: c.together, since: c.since, goal: c.profile.weeklyGoal };
  }, [c, entries, today]);
}

/** How long a card's lines stay (plan §6: about 30 s), unless the next set clears them first. */
export const LINE_MS = 30_000;

/**
 * What a set just saved unlocked, as lines for its card (AchLines): the highest level of each, worked out off the save (on a
 * timer after it, so saving never waits on it, and the lines never land inside a keystroke). `saved` after each new set,
 * `clear` as the next one starts.
 */
export function useAchLines() {
  const of = useAchContext();
  const [lines, setLines] = useState<Unlock[] | null>(null);
  useEffect(() => { if (!lines) return; const t = setTimeout(() => setLines(null), LINE_MS); return () => clearTimeout(t); }, [lines]);
  const clear = useCallback(() => setLines(null), []);
  const saved = useCallback((before: readonly SetEntry[], e: SetEntry, today: string) => {
    if (!of) return;
    setTimeout(() => {
      const after = [...before.filter((x) => x.id !== e.id), e];
      const g = highest(gained(of(before, today), of(after, today)));
      if (g.length) setLines(g);
    });
  }, [of]);
  return { lines, clear, saved };
}
