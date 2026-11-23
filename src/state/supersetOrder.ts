import { getPref, setPref } from './prefs';

// A suggested superset's order as he swapped it (owner, 2026-11-22: "Swap order"), per day: pair id → the lift key to go first.
// Kept on this phone for the last 60 days it was used, like "Not a superset" (state/notSuperset).
const NAME = 'supersetOrder';
type Saved = Record<string, Record<string, string>>;

export const supersetOrder = (owner: string, date: string): Record<string, string> => getPref<Saved>(owner, NAME)?.[date] ?? {};

export function setSupersetOrder(owner: string, date: string, id: string, first: string) {
  const all: Saved = { ...getPref<Saved>(owner, NAME), [date]: { ...supersetOrder(owner, date), [id]: first } };
  setPref(owner, NAME, Object.fromEntries(Object.entries(all).sort(([a], [b]) => b.localeCompare(a)).slice(0, 60)));
}
