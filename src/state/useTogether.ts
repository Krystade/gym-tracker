import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeLedger, encodeLedger, hasNew, mergeLedgers, NO_LEDGER, windowPairs, type FriendSide, type Ledger, type TogetherCtx } from '../domain/together';
import type { SetEntry } from '../domain/types';
import { useFriendCacheSelect, type CachedSummary, type CachedWindow, type FriendCache } from './friendCache';
import { useDb } from './profileDb';

// Together (domain/together) for the person whose account this phone is signed in to: their friends as Friends already keeps
// them (state/friendCache: each one's Crew window, read in the background at most every 5 minutes, and their Compare summary
// where Compare, the feed or their page read it), and the ledger of what those windows showed. Nothing here reads Firestore:
// the ledger goes up and comes down with the sync (cloud/together).

const listeners = new Set<() => void>();
/** The sync brought the account's ledger in: every screen reads it again. */
export const togetherChanged = () => { for (const l of listeners) l(); };

/** What a friend's line is said as: "@ana_lifts"; a friend no longer on your list, "a former friend" (owner Q8). */
export interface TogetherNames { name: (uid: string) => string; handle: (uid: string) => string }
export interface Together { ctx: TogetherCtx; names: TogetherNames }

interface Picked { friends: { uid: string; name: string; dn?: string }[] | null; windows: (CachedWindow | undefined)[]; sums: (CachedSummary | undefined)[] }
const NONE: Picked = { friends: null, windows: [], sums: [] };
const pick = (c: FriendCache | undefined): Picked => {
  const fs = c?.lists?.friends;
  if (!fs) return NONE;
  return { friends: fs.map((f) => ({ uid: f.uid, name: f.name, ...(f.dn && { dn: f.dn }) })), windows: fs.map((f) => c.windows[f.uid]), sums: fs.map((f) => c.summaries?.[f.uid]) };
};
const same = (a: Picked, b: Picked) => a === b || (JSON.stringify(a.friends) === JSON.stringify(b.friends)
  && a.windows.length === b.windows.length && a.windows.every((w, i) => w === b.windows[i]) && a.sums.every((s, i) => s === b.sums[i]));

/** A friend's window as Together reads it: their sets, goal and start, and their summary's 52 weeks. */
export function sideOf(uid: string, w: CachedWindow, s?: CachedSummary): FriendSide {
  const d = s?.doc;
  return { uid, start: w.win.start ?? null, goal: w.win.goal ?? 2, sets: w.win.sets, from: w.from, met: d ? { day: d.day, met: d.r['1y'].met } : null };
}

/**
 * Together for the signed-in account (`uid`; none: signed out, or another person's screens). What the windows show that the
 * ledger hasn't is added to it on this phone, off the render, and goes up with the next sync.
 */
export function useTogether(uid: string | null | undefined, entries: readonly SetEntry[], today: string, since: string | null, goal: number): Together | undefined {
  const db = useDb();
  const picked = useFriendCacheSelect(uid, pick, same);
  const [ledger, setLedger] = useState<{ uid: string; l: Ledger } | null>(null);
  const kept = useRef<Ledger>(NO_LEDGER);
  // Read from the phone on signing in and when a sync brought something; set from a timer, never inside an event (a render
  // there can drop a keystroke being typed: state/useAchievements).
  const reload = useCallback(() => {
    if (!uid) return;
    void db.getTogether(uid).then((r) => setTimeout(() => { const l = decodeLedger(r.ledger); kept.current = l; setLedger({ uid, l }); })).catch(() => {});
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps -- the db is bound once per person
  useEffect(() => { reload(); listeners.add(reload); return () => { listeners.delete(reload); }; }, [reload]);

  const sides = useMemo(() => (picked.friends ?? []).flatMap((f, i) => { const w = picked.windows[i]; return w ? [sideOf(f.uid, w, picked.sums[i])] : []; }), [picked]);
  const l = ledger && ledger.uid === uid ? ledger.l : NO_LEDGER;
  const ctx = useMemo<TogetherCtx>(() => ({ friends: sides, ledger: l }), [sides, l]);
  const names = useMemo<TogetherNames>(() => {
    const by = new Map((picked.friends ?? []).map((f) => [f.uid, f]));
    const known = picked.friends != null;
    return {
      name: (u) => { const f = by.get(u); return f ? `@${f.name}` : known ? 'a former friend' : 'a friend'; },
      handle: (u) => { const f = by.get(u); return f ? f.dn || f.name : '?'; },
    };
  }, [picked.friends]);

  // What the windows show now, into the ledger when it's new: a moment after a window or the log changes.
  useEffect(() => {
    if (!uid || !since || !sides.length || ledger?.uid !== uid) return;
    const t = setTimeout(() => {
      const seen = windowPairs(entries, since, goal, sides, today).pairs;
      if (!hasNew(kept.current, seen)) return;
      kept.current = mergeLedgers(kept.current, seen);
      void db.addTogether(uid, encodeLedger(seen)).then((changed) => { if (changed) reload(); }).catch(() => {});
    }, 50);
    return () => clearTimeout(t);
  }, [uid, since, goal, sides, entries, today, ledger?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => (uid ? { ctx, names } : undefined), [uid, ctx, names]);
}
