import { getPref, setPref } from './prefs';

// "Not a superset": the groups (by lift key) the person said weren't one, per day. Kept on this phone for the last 60 days
// they were used, so History agrees with Today about that day.
const NAME = 'notSuperset';
type Saved = Record<string, string[][]>;

export const notSupersets = (owner: string, date: string): string[][] => getPref<Saved>(owner, NAME)?.[date] ?? [];

export function markNotSuperset(owner: string, date: string, keys: string[]) {
  const all: Saved = { ...getPref<Saved>(owner, NAME), [date]: [...notSupersets(owner, date), keys] };
  setPref(owner, NAME, Object.fromEntries(Object.entries(all).sort(([a], [b]) => b.localeCompare(a)).slice(0, 60)));
}
