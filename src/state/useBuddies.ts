import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ledgerOf, starter, type Ledger, type Spend } from '../domain/buddies/gacha';
import type { BuddyPrefsMap, Lead } from '../domain/buddies/kept';
import { BUDDY, type BuddyDef, type Slot } from '../domain/buddies/roster';
import { useDb } from './profileDb';

// Gym Buddies for the person whose screens these are (plan §16.10 stage 4): what's kept (db: the start day, each buddy's name
// and wear, the lead, the spends), read on open and again after a sync, and the few taps that change it (the first pick, the
// lead, a name). What the buddies have earned is worked out from the log on the screen that shows it (ui/BuddiesScreen).

export interface BuddiesKept { start: string; prefs: BuddyPrefsMap; lead?: Lead; spends: Spend[] }

export function useBuddies(today: string) {
  const db = useDb();
  const [kept, setKept] = useState<BuddiesKept | null>(null);
  const was = useRef('');
  // The db is bound once per person (a new object each render of its provider, the same database): not a dependency. What's
  // read lands from a timer, never inside an event (an update there can drop a keystroke being typed), and only when it moved:
  // a sync's reload mostly reads the same.
  const reload = useCallback(() => Promise.all([db.startBuddies(today), db.getBuddyPrefs(), db.getBuddyLead(), db.getSpends()])
    .then(([start, prefs, lead, spends]) => {
      const next: BuddiesKept = { start, prefs, ...(lead && { lead }), spends };
      const key = JSON.stringify(next);
      if (key !== was.current) setTimeout(() => { if (key !== was.current) { was.current = key; setKept(next); } });
    }).catch(() => {}), [today]);
  useEffect(() => { void reload(); }, [reload]);

  const ledger: Ledger | null = useMemo(() => (kept ? ledgerOf(kept.spends) : null), [kept]);
  /** The buddies you have, in the order they joined, each with the day it joined. */
  const owned = useMemo(() => (ledger ? [...ledger.owned].filter(([id]) => BUDDY.has(id)).map(([id, day]) => ({ def: BUDDY.get(id)!, day })) : []), [ledger]);
  /** The lead: the one picked, else the first to join. */
  const lead: BuddyDef | null = useMemo(() => {
    const id = kept?.lead?.id;
    return owned.find((o) => o.def.id === id)?.def ?? owned[0]?.def ?? null;
  }, [kept, owned]);

  /** The first buddy, from the three commons offered: kept as the starter spend, and made the lead. */
  const pickFirst = useCallback(async (id: string) => {
    const at = Date.now();
    await db.addSpend(starter(id, at, today));
    await db.putBuddyLead(id, at);
    await reload();
  }, [today, reload]);
  const makeLead = useCallback(async (id: string) => { await db.putBuddyLead(id); await reload(); }, [reload]);
  /** A buddy's own name; empty goes back to its roster name. What it wears stays. */
  const rename = useCallback(async (id: string, name: string) => {
    const equip = kept?.prefs[id]?.equip;
    await db.putBuddyPrefs(id, { ...(name.trim() && { name: name.trim() }), ...(equip && { equip }) });
    await reload();
  }, [kept, reload]);

  /** A pull, a ticket or a choice (domain/buddies/gacha, rolled by the caller once): kept as is, never rolled again. */
  const spend = useCallback(async (s: Spend) => { await db.addSpend(s); await reload(); }, [reload]);
  /** Puts an accessory on a buddy (null takes that slot's off). Accessories are shared: any buddy may wear any you own. */
  const equip = useCallback(async (id: string, slot: Slot, acc: string | null) => {
    const p = kept?.prefs[id];
    const next = { ...p?.equip };
    if (acc) next[slot] = acc; else delete next[slot];
    await db.putBuddyPrefs(id, { ...(p?.name && { name: p.name }), ...(Object.keys(next).length && { equip: next }) });
    await reload();
  }, [kept, reload]);

  return { kept, ledger, owned, lead, reload, pickFirst, makeLead, rename, spend, equip };
}
export type BuddiesStore = ReturnType<typeof useBuddies>;
