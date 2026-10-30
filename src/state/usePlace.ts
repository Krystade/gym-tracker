import { useEffect, useRef } from 'react';
import { isPlaceKey, placeCodes } from '../domain/place';
import { placeDue } from '../domain/together';
import type { SetEntry } from '../domain/types';
import { hydrateFriendCache, type FriendCache } from './friendCache';
import type { SetsStore } from './useSets';

// Location for Together (domain/place), for the person whose account this phone is signed in to: with it on, the first set of
// each visit takes one rough fix, silently (the phone asked once, when the switch was turned on), and gets the visit's codes.
// Nothing else ever reads the location; the fix goes no further than placeCodes.

/** One fix as iOS gives a page: Wi-Fi or cell (no GPS), up to 10 minutes old, within 10 seconds; or the error's code (1: not allowed). */
export function roughFix(geo: Pick<Geolocation, 'getCurrentPosition'>): Promise<{ lat: number; lng: number } | { error: number }> {
  return new Promise((done) => {
    try {
      geo.getCurrentPosition((p) => done({ lat: p.coords.latitude, lng: p.coords.longitude }), (e) => done({ error: e.code }),
        { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 10_000 });
    } catch { done({ error: 2 }); }
  });
}

/** Friends' keys, from their Crew windows as Friends keeps them (cloud/friends readFriendWindow): those with it on. */
export const friendKeys = (c: FriendCache): string[] =>
  (c.lists?.friends ?? []).flatMap((f) => { const k = c.windows[f.uid]?.win.loc; return isPlaceKey(k) ? [k] : []; });

/** A set's visit codes from one fix: null with no friend to make them for (no fix taken), or no fix. */
export async function placeFor(set: SetEntry, key: string, theirs: readonly string[], geo: Pick<Geolocation, 'getCurrentPosition'>): Promise<string | null> {
  if (!theirs.length) return null;
  const f = await roughFix(geo);
  return 'lat' in f ? placeCodes(f.lat, f.lng, set.date, key, theirs) : null;
}

/**
 * Takes each visit's fix as its first set is logged (domain/together placeDue), once a visit, and saves the codes on that set as an
 * edit (stamped, so it wins in sync). `key`: the profile's placeKey; none, off. Signed out, nothing.
 */
export function usePlace(uid: string | null | undefined, store: Pick<SetsStore, 'entries' | 'update'>, key: string | undefined) {
  const tried = useRef(new Set<string>());
  const now = useRef(store);
  now.current = store;
  useEffect(() => {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!uid || !isPlaceKey(key) || !geo) return;
    const due = placeDue(store.entries, Date.now());
    if (!due || tried.current.has(due.visit)) return;
    tried.current.add(due.visit);
    void (async () => {
      const theirs = friendKeys(await hydrateFriendCache(uid));
      // No friend with it on: no fix taken, and the next set looks again (a friend's key may have come in since).
      if (!theirs.length) { tried.current.delete(due.visit); return; }
      const loc = await placeFor(due.set, key, theirs, geo);
      const e = now.current.entries.find((x) => x.id === due.set.id);
      if (loc && e && e.loc === undefined) await now.current.update({ ...e, loc });
    })().catch(() => {});
  }, [uid, key, store.entries]);
}
