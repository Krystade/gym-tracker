import { useCallback, useMemo } from 'react';
import type { Profile, Tier } from '../domain/profile';
import type { Program } from '../domain/program';
import type { SetEntry } from '../domain/types';
import { customTiers, fitTargets, setYield, weeklyBudget } from '../domain/targets';
import type { ProfileStore } from './useProfile';

/**
 * The profile as the screens should read it: weekly targets fitted to your week (hand-set tiers kept). Saves go to the stored
 * profile with its own targets, so a fitted range is never written back as if you had set it.
 */
export function useFittedProfile(raw: ProfileStore, program: Program | null, entries: SetEntry[], today: string) {
  const budget = useMemo(() => weeklyBudget(raw.profile, program, entries, today), [raw.profile, program, entries, today]);
  const yieldPerSet = useMemo(() => setYield(entries, today), [entries, today]);
  const fit = useMemo(() => fitTargets(raw.profile, budget, yieldPerSet), [raw.profile, budget, yieldPerSet]);
  const profile = useMemo<Profile>(() => ({ ...raw.profile, targets: fit.targets }), [raw.profile, fit]);
  const save = useCallback((p: Profile) => raw.save({ ...p, targets: raw.profile.targets, custom: customTiers(raw.profile) }), [raw]);
  /** A hand-set range for one priority, or null to let it fit the week again. */
  const setTarget = useCallback((t: Tier, range: [number, number] | null) => {
    const custom = customTiers(raw.profile).filter((x) => x !== t);
    return raw.save({ ...raw.profile, targets: { ...raw.profile.targets, ...(range && { [t]: range }) }, custom: range ? [...custom, t] : custom });
  }, [raw]);
  return { profile, save, setTarget, budget, fit };
}
export type FittedProfileStore = ReturnType<typeof useFittedProfile>;
