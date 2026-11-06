import { BUDDY_ROWS, ITEM_ROWS } from './rosterData';

// Gym Buddies' roster (.superpowers/gym-buddies/plan-draft.md §16, owner 2026-10-28): the Tiny sprite packs, all CC0. Jack's
// picks (tiny-sprites/picks.json, generated into rosterData): the Tiny Creatures and Tiny Dungeon characters he kept are
// buddies, and the kept Tiny Dungeon and Tiny Town items (weapons, tools, the beehive…) are held accessories, beside auras,
// plinths and backdrops drawn in CSS. Beside them, the older characters he kept (OLD, owner 2026-11-06): goats, critters, dinos,
// the Froglet, Kenney's vehicles and the Dudes, at their own sizes and pixel densities on purpose (the joke: no shrinking them
// to match). No count is fixed anywhere: everything reads the lengths here.
// Ids are stable: an owned buddy is kept by id, so a new set only adds rows (or swaps art behind the same ids). One taken out
// goes in RETIRED, never reused.

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type Rarity = 0 | 1 | 2 | 3 | 4;
export const STATS = ['power', 'size', 'grit', 'stamina'] as const;
export type Stat = (typeof STATS)[number];
export type Slot = 'held' | 'aura' | 'plinth' | 'backdrop';
export const SLOTS: readonly Slot[] = ['held', 'aura', 'plinth', 'backdrop'];

/** An older character's art, `public/buddies/<id>.png`: a strip of `n` frames of w × h of its own pixels (n 1: a still picture),
 *  each shown `ms`. The part drawn (its pixels' box over every frame) and a head anchor a frame are worked out from it (anchors). */
export interface Art { w: number; h: number; n: number; ms: number }
export interface BuddyDef {
  id: string; rarity: Rarity;
  /** The stat it grows faster in (×1.1 common … ×1.5 legendary): domain/buddies/stats. */ trait: Stat;
  /** Its sprite's poses, cycled; one for most. Each is a file `public/buddies/<pose>.png`. */ poses: readonly string[];
  /** An older character's: its strip (a Tiny sprite is 16 × 16 a pose) and its roster name. */ art?: Art; name?: string;
}
export interface AccDef {
  id: string; rarity: Rarity; slot: Slot;
  /** A held item's sprite (`public/buddies/<id>.png`); the CSS ones have none. */ sprite?: true;
}

/** Buddies taken out of the roster (owner's ranking 2026-10-31: c117). A spend that landed one is as if never made: its points
 *  or ticket come back and a starter can be picked again (domain/buddies/gacha ledgerOf). What's kept for it stays, unused. */
export const RETIRED: ReadonlySet<string> = new Set(['c117']);

/** The older characters kept (the owner's ranking, 2026-10-31; plan §16.3's packs), by pack: id, rarity, trait, name, then a
 *  frame's w × h, frames and ms a frame of the strip it idles on (the run, hop and spin strips were left out). Names are two
 *  syllables like the Tiny ones'; the Dudes keep theirs, the only titles in the roster, as they are the only fine pixels. */
const OLD: readonly (readonly [string, Rarity, Stat, string, number, number, number, number])[] = [
  ['ckbrown', 1, 'grit', 'Moko', 15, 19, 4, 140], ['ckwhite', 1, 'stamina', 'Lumi', 15, 19, 4, 140], // Goat Characters
  ['ckblack', 1, 'power', 'Nuro', 15, 19, 4, 140], ['ckgold', 1, 'grit', 'Gado', 15, 19, 4, 140], ['ckred', 2, 'power', 'Roro', 15, 19, 4, 140],
  ['ckpig', 1, 'size', 'Boba', 11, 17, 4, 140], ['cksheep', 1, 'size', 'Lufu', 14, 17, 4, 140], // Animal Characters
  ['ckfrog', 2, 'stamina', 'Kiri', 10, 17, 4, 140], ['ckbirb', 2, 'stamina', 'Tupip', 14, 16, 4, 140],
  ['dinodoux', 2, 'grit', 'Dodo', 15, 17, 4, 140], ['dinomort', 2, 'power', 'Moro', 15, 17, 4, 140], // Dino Characters
  ['dinotard', 2, 'size', 'Tado', 15, 17, 4, 140], ['dinovita', 2, 'stamina', 'Wity', 15, 17, 4, 140],
  ['froglet', 4, 'power', 'Ropip', 16, 16, 8, 120], // Froglet
  ['sedan_blue', 1, 'stamina', 'Sudo', 29, 13, 1, 0], ['tractor', 1, 'power', 'Turo', 24, 18, 1, 0], // Pixel Vehicle Pack
  ['ambulance', 2, 'stamina', 'Wiwi', 38, 21, 1, 0], ['truck', 2, 'size', 'Tubo', 59, 24, 1, 0], ['bus_school', 2, 'size', 'Susy', 46, 21, 1, 0],
  ['firetruck', 3, 'power', 'Fenro', 44, 21, 1, 0], ['hotdog', 3, 'size', 'Domo', 40, 29, 1, 0],
  ['dudemr', 3, 'grit', 'Mr. Dude', 90, 102, 14, 100], ['dudemrs', 4, 'power', 'Mrs. Dude', 90, 102, 14, 100], // Mr. & Mrs. Dude
];

export const BUDDIES: readonly BuddyDef[] = [
  ...BUDDY_ROWS.map(([id, r, t, ...more]): BuddyDef => ({ id, rarity: r as Rarity, trait: t as Stat, poses: [id, ...more] })),
  ...OLD.map(([id, rarity, trait, name, w, h, n, ms]): BuddyDef => ({ id, rarity, trait, poses: [id], art: { w, h, n, ms }, name })),
];

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

const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';
/** The packs, for Buddies › Collection's credits, each with its own licence as its page states it (checked 2026-11-06). The
 *  CC BY 4.0 ones need the credit, the licence and its link shown; their sprites ship as published (renamed, not edited). */
export const CREDIT_ROWS: readonly { what: string; by: string; url: string; licence: string; licenceUrl?: string }[] = [
  { what: 'Tiny Creatures', by: 'Clint Bellanger', url: 'https://opengameart.org/content/tiny-creatures', licence: 'CC0' },
  { what: 'Tiny Dungeon and Tiny Town', by: 'Kenney', url: 'https://kenney.nl/assets/tiny-dungeon', licence: 'CC0' },
  { what: 'Goat Characters', by: 'ChaosWitchNikol', url: 'https://chaoswitchnikol.itch.io/goat-characters', licence: 'CC BY 4.0', licenceUrl: CC_BY },
  { what: 'Animal Characters', by: 'ChaosWitchNikol', url: 'https://chaoswitchnikol.itch.io/animal-characters', licence: 'CC BY 4.0', licenceUrl: CC_BY },
  { what: 'Dino Characters', by: 'Arks (@ArksDigital)', url: 'https://arks.itch.io/dino-characters', licence: 'CC BY 4.0', licenceUrl: CC_BY },
  { what: 'Froglet', by: 'Lukas Lundin', url: 'https://phewcumber.itch.io/froglet', licence: 'free to use, not to be resold on its own' },
  { what: 'Pixel Vehicle Pack', by: 'Kenney', url: 'https://kenney.nl/assets/pixel-vehicle-pack', licence: 'CC0' },
  { what: 'Mr. & Mrs. Dude', by: 'toadgirl', url: 'https://toadgirl.itch.io/mr-and-mrs-dude', licence: 'free to use for anything' },
];

// A buddy's name until it's given its own (kept prefs' `name`): an older character's from OLD, else two syllables picked by its
// number, so no two are the same (creatures 1–180 and dungeon 181–312, of 18 × 18 = 324; OLD's are of the ones left) and a
// buddy's name never changes when the roster grows.
const NAME_A = ['Bo', 'Pip', 'Mo', 'Tu', 'Ki', 'Lu', 'Za', 'Fen', 'Ro', 'Bi', 'Nu', 'Wi', 'Ga', 'Do', 'Su', 'Ta', 'Mi', 'Ju'];
const NAME_B = ['bo', 'pip', 'lo', 'mi', 'ko', 'ba', 'ri', 'zo', 'nu', 'gle', 'fu', 'ty', 'mo', 'wi', 'by', 'sy', 'ro', 'do'];
export function defaultName(id: string): string {
  const own = BUDDY.get(id)?.name;
  if (own) return own;
  const n = Number(id.slice(1)) + (id[0] === 'd' ? 180 : 0);
  return NAME_A[n % NAME_A.length] + NAME_B[Math.floor(n / NAME_A.length) % NAME_B.length];
}

export const BUDDY: ReadonlyMap<string, BuddyDef> = new Map(BUDDIES.map((b) => [b.id, b]));
export const ACCESSORY: ReadonlyMap<string, AccDef> = new Map(ACCESSORIES.map((a) => [a.id, a]));

export type Banner = 'buddy' | 'acc';
/** Each banner's pool: what a pull can land on. */
export const POOL: Record<Banner, readonly { id: string; rarity: Rarity }[]> = { buddy: BUDDIES, acc: ACCESSORIES };

/** The credits line: every pack, its maker and its licence (CREDIT_ROWS). */
export const CREDITS = `Buddies and items: ${CREDIT_ROWS.map((c) => `${c.what} by ${c.by} (${c.licence})`).join(', ')}.`;
