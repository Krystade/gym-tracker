import { addDays } from '../domain/analytics';
import { LIGHT_DAYS, lightWeek } from '../domain/learn/deload';
import type { SetEntry } from '../domain/types';
import { getPref, setPref } from './prefs';

// Item 06's two taps, kept per profile on this phone (state/prefs): the light week he started (and its early end), and "Not now"
// on the deload suggestion. Another phone learns of a light week from its light sets in the log (learn/deload lightWeek).

export interface Tapped { from: string; end?: string }
const LIGHT = 'deload:light', SNOOZE = 'deload:snooze';

export const tappedLight = (owner: string): Tapped | null => getPref<Tapped>(owner, LIGHT) ?? null;
export const startLight = (owner: string, today: string) => setPref<Tapped>(owner, LIGHT, { from: today });
/** Ends the light week now: today's targets are his normal ones again. */
export function endLight(owner: string, entries: readonly SetEntry[], today: string) {
  const on = lightWeek(entries, today, tappedLight(owner));
  if (on) setPref<Tapped>(owner, LIGHT, { from: on.from, end: today });
}
/** The light week on today, if any (tapped here, or read from the log). */
export const lightOn = (owner: string, entries: readonly SetEntry[], today: string) => lightWeek(entries, today, tappedLight(owner));

/** "Not now": the suggestion stays away for as long as a light week would have lasted (a: a deload's length, learn/deload). */
export const snoozeDeload = (owner: string, today: string) => setPref(owner, SNOOZE, addDays(today, LIGHT_DAYS));
export const deloadSnoozed = (owner: string, today: string): boolean => (getPref<string>(owner, SNOOZE) ?? '') > today;
