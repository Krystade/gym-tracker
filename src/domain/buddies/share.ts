import { withoutPrivate, type Achievements } from '../achievements';
import { ledgerOf, type Spend } from './gacha';
import type { BuddyPrefsMap, Lead } from './kept';
import { earned } from './points';
import { ACCESSORY, BUDDY, SLOTS, STATS, type BuddyDef, type Stat } from './roster';
import { statsOf, type Training } from './stats';

// What friends see of your buddies (plan §16.8, stage 6): the `bud` field of your Compare summary (domain/compare), which a
// friend already reads once on their page, so it costs no read of its own. Your lead, your lifetime points earned (owner Q5: it
// only rises with training, never the balance after pulls; the private groups' rewards left out) and up to 40 buddies, each its Lv, its four stat numbers and what it
// wears. No name you gave it, no spends, no tickets. The rules check its shape (firestore.rules budOk); parseBud reads it again
// as untrusted.

export const MAX_SHARED_BUDDIES = 40;
/** The bounds the rules hold it to: no real log comes near them. */
export const PTS_MAX = 100_000_000, LV_MAX = 100_000;

/** One buddy as shared: its id, Lv, the four stat numbers (Power, Size, Grit, Stamina) and what it wears, by slot (null: none). */
export interface SharedBuddy { i: string; l: number; s: number[]; e: (string | null)[] }
export interface SharedBud { lead: string; pts: number; r: SharedBuddy[] }

export interface BuddiesKeptLike { start: string; prefs: BuddyPrefsMap; lead?: Lead; spends: readonly Spend[] }

/** Your `bud`, from what's kept and the training since buddies started; none before the first buddy is picked. */
export function budOf(kept: BuddiesKeptLike, t: Training, ach: Achievements | null): SharedBud | undefined {
  const l = ledgerOf(kept.spends);
  const owned = [...l.owned].filter(([id]) => BUDDY.has(id)).map(([id, day]) => ({ def: BUDDY.get(id)!, day }));
  if (!owned.length) return undefined;
  const lead = owned.find((o) => o.def.id === kept.lead?.id) ?? owned[0];
  // As the Buddies tab lists them: the lead, then rarest first, then the first to join.
  const rest = owned.filter((o) => o !== lead).sort((a, b) => b.def.rarity - a.def.rarity || a.day.localeCompare(b.day) || a.def.id.localeCompare(b.def.id));
  const r = [lead, ...rest].slice(0, MAX_SHARED_BUDDIES).map(({ def, day }): SharedBuddy => {
    const st = statsOf(def, day, t);
    const eq = kept.prefs[def.id]?.equip ?? {};
    return {
      i: def.id, l: Math.min(LV_MAX, st.lv), s: STATS.map((s) => Math.min(LV_MAX, st.level[s])),
      // Only what's owned, in the slot it belongs to: a worn id no spend landed on isn't shown (as on the card).
      e: SLOTS.map((s) => { const a = eq[s]; return a && l.owned.has(a) && ACCESSORY.get(a)?.slot === s ? a : null; }),
    };
  });
  return { lead: lead.def.id, pts: Math.min(PTS_MAX, earned(t, ach && withoutPrivate(ach)).points), r };
}

const isInt = (x: unknown, hi: number): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= hi;

/**
 * A friend's `bud` as read, or undefined: not one this app can read. Untrusted: a buddy this roster doesn't have (a newer app's),
 * or one off shape, is dropped; an accessory that isn't one, or not of its slot, is shown as none. Their lead must be one kept.
 */
export function parseBud(x: unknown): SharedBud | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  if (typeof o.lead !== 'string' || !isInt(o.pts, PTS_MAX) || !Array.isArray(o.r)) return undefined;
  const seen = new Set<string>();
  const r = o.r.slice(0, MAX_SHARED_BUDDIES).flatMap((b): SharedBuddy[] => {
    const q = b as Record<string, unknown> | null;
    if (!q || typeof q !== 'object' || typeof q.i !== 'string' || !BUDDY.has(q.i) || seen.has(q.i) || !isInt(q.l, LV_MAX)) return [];
    if (!Array.isArray(q.s) || q.s.length !== STATS.length || !q.s.every((v) => isInt(v, LV_MAX))) return [];
    seen.add(q.i);
    const e = SLOTS.map((s, k) => { const a = Array.isArray(q.e) ? q.e[k] : null; return typeof a === 'string' && ACCESSORY.get(a)?.slot === s ? a : null; });
    return [{ i: q.i, l: q.l, s: [...q.s] as number[], e }];
  });
  if (!seen.has(o.lead)) return undefined;
  return { lead: o.lead, pts: o.pts, r };
}

/** The lead as shared. */
export const leadOf = (b: SharedBud): { buddy: SharedBuddy; def: BuddyDef } => {
  const buddy = b.r.find((x) => x.i === b.lead)!;
  return { buddy, def: BUDDY.get(buddy.i)! };
};

/** The stat a shared buddy is best at, by its numbers (ties: its trait, then Power, Size, Grit, Stamina). Side by side names it. */
export function bestShared(s: readonly number[], trait: Stat): Stat {
  return STATS.map((st, k) => ({ st, v: s[k] ?? 0 })).sort((a, b) => b.v - a.v || (b.st === trait ? 1 : 0) - (a.st === trait ? 1 : 0))[0].st;
}
