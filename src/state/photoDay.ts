import { addDays } from '../domain/analytics';
import { PHOTO_EVERY, PHOTO_EVERY_DEFAULT, PHOTO_SNOOZE, type PhotoEvery } from '../domain/photos';
import { getPref, setPref } from './prefs';

// The photo-day line on Today (plan S6, domain/photos photoDayDue), kept per profile on this phone (state/prefs): how often, picked
// on Photos, and "Not now". No push: it's a line he sees when he opens the app.

const EVERY = 'photos:every', SNOOZE = 'photos:snooze';

export function photoEvery(owner: string): PhotoEvery {
  const v = getPref<number>(owner, EVERY);
  return (PHOTO_EVERY as readonly number[]).includes(v ?? -1) ? (v as PhotoEvery) : PHOTO_EVERY_DEFAULT;
}
export const setPhotoEvery = (owner: string, every: PhotoEvery) => setPref(owner, EVERY, every === PHOTO_EVERY_DEFAULT ? undefined : every);
/** "Not now": the line stays away PHOTO_SNOOZE days, or till today's photos are in (then it's not due anyway). */
export const snoozePhotoDay = (owner: string, today: string) => setPref(owner, SNOOZE, addDays(today, PHOTO_SNOOZE));
export const photoDaySnoozed = (owner: string): string | undefined => getPref<string>(owner, SNOOZE);
