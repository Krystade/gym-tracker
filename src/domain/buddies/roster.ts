import { BUDDY_ROWS, ITEM_ROWS } from './rosterData';

// Gym Buddies' roster (.superpowers/gym-buddies/plan-draft.md §16, owner 2026-10-28): the Tiny sprite packs, all CC0. Jack's
// picks (tiny-sprites/picks.json, generated into rosterData): the Tiny Creatures and Tiny Dungeon characters he kept are
// buddies, and the kept Tiny Dungeon and Tiny Town items (weapons, tools, the beehive…) are held accessories, beside auras,
// plinths and backdrops drawn in CSS. No count is fixed anywhere: everything reads the lengths here.
// Ids are stable: an owned buddy is kept by id, so a new set only adds rows (or swaps art behind the same ids).

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type Rarity = 0 | 1 | 2 | 3 | 4;
export const STATS = ['power', 'size', 'grit', 'stamina'] as const;
export type Stat = (typeof STATS)[number];
export type Slot = 'held' | 'aura' | 'plinth' | 'backdrop';
export const SLOTS: readonly Slot[] = ['held', 'aura', 'plinth', 'backdrop'];

export interface BuddyDef {
  id: string; rarity: Rarity;
  /** The stat it grows faster in (×1.1 common … ×1.5 legendary): domain/buddies/stats. */ trait: Stat;
  /** Its sprite's poses, cycled; one for most. Each is a file `public/buddies/<pose>.png`. */ poses: readonly string[];
}
export interface AccDef {
  id: string; rarity: Rarity; slot: Slot;
  /** A held item's sprite (`public/buddies/<id>.png`); the CSS ones have none. */ sprite?: true;
}

export const BUDDIES: readonly BuddyDef[] = BUDDY_ROWS.map(([id, r, t, ...more]) => ({ id, rarity: r as Rarity, trait: t as Stat, poses: [id, ...more] }));

/** The CSS accessories: auras, plinths and backdrops, worn by any buddy (they need no anchor). */
const CSS_ACC: readonly [string, Rarity, Slot][] = [
  ['aura-mint', 0, 'aura'], ['aura-sky', 0, 'aura'], ['aura-peach', 0, 'aura'], ['aura-lilac', 0, 'aura'], ['aura-ember', 0, 'aura'], ['aura-gold', 2, 'aura'],
  ['plinth-wood', 0, 'plinth'], ['plinth-stone', 0, 'plinth'], ['plinth-rubber', 0, 'plinth'], ['plinth-plate', 0, 'plinth'], ['plinth-grass', 0, 'plinth'], ['plinth-podium', 1, 'plinth'],
  ['bg-dawn', 0, 'backdrop'], ['bg-dusk', 0, 'backdrop'], ['bg-gym', 0, 'backdrop'], ['bg-park', 0, 'backdrop'], ['bg-stage', 1, 'backdrop'], ['bg-stars', 2, 'backdrop'],
];
export const ACCESSORIES: readonly AccDef[] = [
  ...ITEM_ROWS.map(([id, r]): AccDef => ({ id, rarity: r as Rarity, slot: 'held', sprite: true })),
  ...CSS_ACC.map(([id, rarity, slot]): AccDef => ({ id, rarity, slot })),
];

export const BUDDY: ReadonlyMap<string, BuddyDef> = new Map(BUDDIES.map((b) => [b.id, b]));
export const ACCESSORY: ReadonlyMap<string, AccDef> = new Map(ACCESSORIES.map((a) => [a.id, a]));

export type Banner = 'buddy' | 'acc';
/** Each banner's pool: what a pull can land on. */
export const POOL: Record<Banner, readonly { id: string; rarity: Rarity }[]> = { buddy: BUDDIES, acc: ACCESSORIES };

/** The credits line (owner: credit Clint Bellanger and Kenney). Both packs are CC0: credit is a courtesy, not a condition. */
export const CREDITS = 'Buddies and items: Tiny Creatures by Clint Bellanger, Tiny Dungeon and Tiny Town by Kenney (kenney.nl). All CC0.';
