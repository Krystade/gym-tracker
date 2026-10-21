import { getPref, setPref } from './prefs';

// Finishing a workout (domain/finish), per profile on this phone (state/prefs), by session day: when Finish was tapped (`done`),
// when "Add more" brought the plan back (`more`), and that the day's summary has been on screen (`seen`), so the summary of a
// session that closed by itself waits for the next time the app is opened. Kept for the last 30 days used.
export interface Finished { done?: number; more?: number; seen?: true }
const NAME = 'session:finish';
type Saved = Record<string, Finished>;

export const finishedOn = (owner: string, date: string): Finished => getPref<Saved>(owner, NAME)?.[date] ?? {};

export function markFinished(owner: string, date: string, patch: Finished) {
  const all: Saved = { ...getPref<Saved>(owner, NAME), [date]: { ...finishedOn(owner, date), ...patch } };
  setPref(owner, NAME, Object.fromEntries(Object.entries(all).sort(([a], [b]) => b.localeCompare(a)).slice(0, 30)));
}
