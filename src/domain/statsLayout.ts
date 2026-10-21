import { addDays } from './analytics';

// Stats v2 (plan .superpowers/redesign/stats-v2, owner answers 2026-10-20): the page as tiles in sections. This is the part that
// decides where each tile goes; what a tile says is worked out by the screen. Nothing here reads a profile: the screen passes in
// what it kept (pins, hidden tiles, the day's order) and stores what comes back.

/** One range for every tile below the week (owner, 2026-10-20): 4 weeks, 12 (the default) or a year. */
export type Range = '4w' | '12w' | '1y' | typeof WINDOW_RANGE;
export const RANGES: readonly { id: Range; label: string; weeks: number }[] = [
  { id: '4w', label: '4 wk', weeks: 4 },
  { id: '12w', label: '12 wk', weeks: 12 },
  { id: '1y', label: '1 yr', weeks: 52 },
];
/** A friend's page: the 8 weeks Friends keeps of them (state/friendCache CREW_SPAN), its only range; never offered on your own. */
export const WINDOW_RANGE = '8w';
const ALL: readonly { id: Range; label: string; weeks: number }[] = [...RANGES, { id: WINDOW_RANGE, label: '8 wk', weeks: 8 }];
export const DEFAULT_RANGE: Range = '12w';
export const isRange = (x: unknown): x is Range => RANGES.some((r) => r.id === x);
export const rangeWeeks = (r: Range): number => ALL.find((x) => x.id === r)!.weeks;
export const rangeLabel = (r: Range): string => ALL.find((x) => x.id === r)!.label;
/** The range in days, today included. */
export const rangeDays = (r: Range): number => rangeWeeks(r) * 7;
/** The range's first day. */
export const rangeFrom = (r: Range, today: string): string => addDays(today, -(rangeDays(r) - 1));
/** "12 weeks", "4 weeks", "a year": a range said in words. */
export const rangeWords = (r: Range): string => (r === '1y' ? 'a year' : `${rangeWeeks(r)} weeks`);

/**
 * Tiles only the owner ever sees: energy and weight come from his own body log, which no friend reads (owner, 2026-10-21: friends
 * never see a friend's body weight).
 */
export const OWNER_ONLY: readonly string[] = ['energy', 'weight'];
/**
 * Tiles a friend's 8-week line (their sets, goal and PR ids, as Friends keeps it) can't fill without reading more: Muscles needs
 * their priorities, Rest between sets their timers, Lifts in rotation what they did before the 8 weeks (new and dropped).
 */
export const NOT_FROM_WINDOW: readonly string[] = ['muscles', 'rest', 'lifts'];
/** The tiles a viewer gets: anyone but the owner, none of OWNER_ONLY; on a friend's page (`window`), none of NOT_FROM_WINDOW. */
export function forViewer<T extends { id: string }>(tiles: readonly T[], v: { owner: boolean; window?: boolean }): T[] {
  return tiles.filter((t) => (v.owner || !OWNER_ONLY.includes(t.id)) && !(v.window && NOT_FROM_WINDOW.includes(t.id)));
}

/** A tile as far as placing it goes. A wide tile takes a row of its own. */
export interface Placed { id: string; wide?: boolean }

/** Tiles into rows of two, in order; a wide tile is a row of its own (and the tile before it keeps its row half empty). */
export function rows<T extends Placed>(tiles: readonly T[]): T[][] {
  const out: T[][] = [];
  for (const t of tiles) {
    const last = out.at(-1);
    if (t.wide || !last || last.length === 2 || last[0].wide) out.push([t]);
    else last.push(t);
  }
  return out;
}

/** What edit mode keeps, per profile: pinned tiles in the order pinned, and hidden ones. A tile is never both. */
export interface LayoutPrefs { pins: string[]; hidden: string[] }
export const NO_LAYOUT: LayoutPrefs = { pins: [], hidden: [] };

/** Reads kept prefs that may be missing or from an older shape. */
export function layoutOf(x: unknown): LayoutPrefs {
  const o = (x ?? {}) as Partial<LayoutPrefs>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
  const pins = [...new Set(list(o.pins))];
  return { pins, hidden: [...new Set(list(o.hidden))].filter((id) => !pins.includes(id)) };
}

/** Pins a tile (to the end of Pinned, and shown again if it was hidden), or unpins it. */
export const togglePin = (p: LayoutPrefs, id: string): LayoutPrefs => (p.pins.includes(id)
  ? { ...p, pins: p.pins.filter((x) => x !== id) }
  : { pins: [...p.pins, id], hidden: p.hidden.filter((x) => x !== id) });

/** Hides a tile (unpinning it), or shows it again. */
export const toggleHide = (p: LayoutPrefs, id: string): LayoutPrefs => (p.hidden.includes(id)
  ? { ...p, hidden: p.hidden.filter((x) => x !== id) }
  : { pins: p.pins.filter((x) => x !== id), hidden: [...p.hidden, id] });

/**
 * The day's order: the tiles that had news (a new PR, a new stall, a muscle behind, pain rising) at the day's first open of
 * Stats. They go to the front of their section until the next day's first open, so nothing moves while he's looking.
 */
export interface DayOrder { day: string; front: string[] }

/** The order kept from today's first open; on the first open of a day, the tiles with news now. */
export function dayOrder(kept: unknown, today: string, news: () => string[]): DayOrder {
  const k = kept as Partial<DayOrder> | undefined;
  if (k && k.day === today && Array.isArray(k.front)) return { day: today, front: k.front.filter((s): s is string => typeof s === 'string') };
  return { day: today, front: news() };
}

export interface Section<T> { id: string; tiles: T[] }
export interface Arranged<T> {
  /** Pinned tiles, in the order pinned. */ pinned: T[];
  /** Each section's tiles left after pins: shown ones (news first) and hidden ones, in the section's own order. */
  sections: { id: string; shown: T[]; hidden: T[] }[];
}

/**
 * Where every tile goes. Pinned tiles move (not copy) to Pinned, in pin order. Hidden tiles leave their section's grid for its
 * "hidden" row. Within a section, the tiles in `front` come first, each group keeping the section's own order.
 */
export function arrange<T extends Placed>(sections: readonly Section<T>[], prefs: LayoutPrefs, front: readonly string[]): Arranged<T> {
  const all = new Map(sections.flatMap((s) => s.tiles.map((t) => [t.id, t] as const)));
  const pinned = prefs.pins.flatMap((id) => all.get(id) ?? []);
  const pins = new Set(pinned.map((t) => t.id)), hidden = new Set(prefs.hidden), first = new Set(front);
  return {
    pinned,
    sections: sections.map((s) => {
      const left = s.tiles.filter((t) => !pins.has(t.id));
      const shown = left.filter((t) => !hidden.has(t.id));
      return { id: s.id, shown: [...shown.filter((t) => first.has(t.id)), ...shown.filter((t) => !first.has(t.id))], hidden: left.filter((t) => hidden.has(t.id)) };
    }),
  };
}
