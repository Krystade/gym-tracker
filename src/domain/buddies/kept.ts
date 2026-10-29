import { parseSpend } from './gacha';
import { SLOTS, type Slot } from './roster';
import { asDay } from './start';

// What Gym Buddies keeps (plan §16.10 stage 2): everything else is worked out from the log and these. Each is a settings item
// (db applySyncedMeta, cloud/meta readMeta) that the account sync and the GitHub backup both carry:
// - `buddies`: each owned buddy's name and what it wears, per buddy with the time it last changed, so two phones changing
//   different buddies both keep their change (the later wins per buddy, not per item).
// - `buddy-lead`: the lead's id, with when it was picked (the later pick wins).
// - `buddy-start`: the day buddies count from (domain/buddies/start), the earliest of the phones'.
// - `spend:<id>`: one per spend, each with its stored roll (domain/buddies/gacha). Never changed and never deleted, so two
//   phones' spends add up and a sync never re-rolls one (rule 6).
// Every one is read as untrusted: a malformed value is dropped, never counted.

export interface BuddyPrefs {
  /** Its own name (none: the roster's). */ name?: string;
  /** Accessory ids by slot (accessories are shared: any buddy may wear any owned one). */ equip?: Partial<Record<Slot, string>>;
  /** When this buddy's prefs last changed (epoch ms). */ at: number;
}
export type BuddyPrefsMap = Record<string, BuddyPrefs>;
export interface Lead { id: string; at: number }

export const NAME_MAX = 20;
const ID = /^[\w-]{1,64}$/;
const time = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/** The settings items that are Gym Buddies'. */
export const isBuddyKey = (k: string): boolean => k === 'buddies' || k === 'buddy-lead' || k === 'buddy-start' || /^spend:./.test(k);

/** A buddy's prefs, read as untrusted: an unknown slot or a bad id is left out, a name trimmed and cut to NAME_MAX. */
export function parsePrefs(x: unknown): BuddyPrefs | null {
  const p = x as Partial<BuddyPrefs> | null;
  if (!p || typeof p !== 'object' || !time(p.at)) return null;
  const name = typeof p.name === 'string' ? p.name.trim().slice(0, NAME_MAX) : '';
  const equip: Partial<Record<Slot, string>> = {};
  if (p.equip && typeof p.equip === 'object') for (const s of SLOTS) { const v = (p.equip as Record<string, unknown>)[s]; if (typeof v === 'string' && ID.test(v)) equip[s] = v; }
  return { ...(name && { name }), ...(Object.keys(equip).length && { equip }), at: p.at };
}
export function parseBuddies(x: unknown): BuddyPrefsMap {
  const out: BuddyPrefsMap = {};
  if (x && typeof x === 'object' && !Array.isArray(x)) for (const [id, v] of Object.entries(x)) { const p = ID.test(id) && parsePrefs(v); if (p) out[id] = p; }
  return out;
}
export function parseLead(x: unknown): Lead | null {
  const l = x as Partial<Lead> | null;
  return l && typeof l === 'object' && typeof l.id === 'string' && ID.test(l.id) && time(l.at) ? { id: l.id, at: l.at } : null;
}

/** The later of two, by `at`; a tie goes to the larger JSON, so every phone picks the same one. */
const later = <T extends { at: number }>(a: T, b: T): T => (a.at !== b.at ? (a.at > b.at ? a : b) : JSON.stringify(a) >= JSON.stringify(b) ? a : b);

/** One buddies item as two sides have it (`a` this phone's): each kind's own rule. A side that doesn't read loses to one that does. */
export function mergeBuddyItem(k: string, a: unknown, b: unknown): unknown {
  if (k === 'buddy-start') { const x = asDay(a), y = asDay(b); return x && y ? (x < y ? x : y) : x ?? y ?? a; }
  if (k === 'buddy-lead') { const x = parseLead(a), y = parseLead(b); return x && y ? later(x, y) : x ?? y ?? a; }
  if (k === 'buddies') {
    const x = parseBuddies(a), y = parseBuddies(b), out: BuddyPrefsMap = { ...y, ...x };
    for (const id of Object.keys(x)) if (y[id]) out[id] = later(x[id], y[id]);
    return Object.fromEntries(Object.entries(out).sort(([p], [q]) => (p < q ? -1 : 1)));
  }
  if (k.startsWith('spend:')) return parseSpend(a) ? a : parseSpend(b) ? b : a;
  return a;
}

/** Whether a buddies item reads (one that doesn't is never saved or passed on). */
const keptOk = (k: string, v: unknown): boolean => k === 'buddy-start' ? !!asDay(v) : k === 'buddy-lead' ? !!parseLead(v)
  : k === 'buddies' ? Object.keys(parseBuddies(v)).length > 0 : !!parseSpend(v) && (parseSpend(v)!.id === k.slice(6));

/** All of the buddies items from two sides (the GitHub backup, which keeps no record of the last sync): a union, merged per item. */
export function mergeBuddyMeta(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(isBuddyKey).sort()) {
    const v = mergeBuddyItem(k, a[k] ?? b[k], b[k] ?? a[k]);
    if (keptOk(k, v)) out[k] = v;
  }
  return out;
}
