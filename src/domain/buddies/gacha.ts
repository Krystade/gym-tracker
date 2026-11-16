import { INCOME } from './points';
import { pointsAt } from './rewards';
import { POOL, RETIRED, type Banner, type Rarity } from './roster';

// Pulls, tickets and choosing (plan §16.5, §16.7 with §15.4's odds and pity; owner 2026-10-28: either banner can take a ticket,
// nothing costs money; owner 2026-11-15: the gambling and the tickets up front, owning everything slower is fine).
// - What is stored is only the spends, each with its roll and its price: a sync never re-rolls or re-prices one (rule 6), and
//   one made under older prices or older rules keeps its stored cost, got and refund exactly. Everything else (what you own,
//   how many times each landed, pity, the points spent) is worked out from them, in the order they were made.
// - A pull lands by ODDS on a rarity, then on any one of that rarity, owned or not: a duplicate gives back half the banner's
//   pull price (a ticket's too). Nothing owned is ever taken away.
// - Pity, per banner: a rare or better by the 10th pull, an epic or better by the 40th. A ticket is a pull: it counts too.
// - Prices are written in (owner 2026-11-15): a pull 15 points a buddy, 10 an accessory; choosing one costs ten times what it
//   did against the pull (economy.test simulates how long owning everything takes at TARGET's pace and reports it).

export const ODDS = [0.60, 0.27, 0.09, 0.03, 0.01] as const;
export const PITY_RARE = 10, PITY_EPIC = 40;
/** Share of the banner's pull price back when a pull (points or ticket) lands on something already owned. */
export const DUPE_REFUND = 0.5;
export const STARTERS = 3;
/** Pulls in a multi-pull (pullMany), at least one of them rare or better. */
export const MULTI = 10;

/** The owner's own pace, from his log (2026-10-29: 1.23 sessions a week, about 10 working sets each). A goal week 85% of weeks
 *  and about 15 achievement points a week. Your body's two paying families on top (owner 2026-10-29): weighing in about 4 days
 *  a week, a photo day every 2 weeks, their levels averaged over `weeks`. */
export const TARGET = {
  weeks: 26, sessionsPerWeek: 1.2, setsPerSession: 10, goalWeekShare: 0.85, achievementPointsPerWeek: 15, weighInsPerWeek: 4, photoDaysPerWeek: 0.5,
} as const;
/** Points a week Weigh-ins and Photo days pay at TARGET's pace: the levels they reach in TARGET's weeks, spread over them. */
export const bodyPointsPerWeek = (): number =>
  (pointsAt('weigh-ins', TARGET.weighInsPerWeek * TARGET.weeks) + pointsAt('photo-days', TARGET.photoDaysPerWeek * TARGET.weeks)) / TARGET.weeks;
/** Points a week at TARGET's pace (the income domain/buddies/points pays; no cardio). */
export const targetIncome = (): number =>
  TARGET.sessionsPerWeek * (TARGET.setsPerSession * INCOME.set + INCOME.session) + TARGET.goalWeekShare * INCOME.goalWeek + TARGET.achievementPointsPerWeek
  + bodyPointsPerWeek();
/** Tickets a week at TARGET's pace from goal weeks and sessions (achievements' gold and platinum on top). */
export const targetTickets = (): number => TARGET.goalWeekShare * INCOME.goalWeekTickets + TARGET.sessionsPerWeek / INCOME.sessionsPerTicket;

/** Points for a random pull (owner 2026-11-15; until then about 4 a buddy and 3 an accessory). */
export const PULL: Record<Banner, number> = { buddy: 15, acc: 10 };
/** Points to choose one directly, common → legendary: the old prices (buddy 10, 17, 32, 57, 93 at a pull of 4; accessory
 *  7, 10, 18, 33, 60 at 3) × the new pull over the old × 10, rounded (owner 2026-11-15). */
export const CHOOSE: Record<Banner, readonly number[]> = {
  buddy: [375, 638, 1200, 2138, 3488],
  acc: [233, 333, 600, 1100, 2000],
};
/** Points back for a duplicate on `b`'s banner. */
export const dupeRefund = (b: Banner): number => Math.round(PULL[b] * DUPE_REFUND);

export type SpendKind = 'pull' | 'ticket' | 'choose' | 'starter';
export interface Spend {
  /** Unique, and its meta key (`spend:<id>`). */ id: string;
  /** When it was made (epoch ms): orders the ledger. */ at: number;
  /** The local day it was made: a buddy counts its training from it. */ day: string;
  kind: SpendKind; banner: Banner;
  /** Points paid (0 for a ticket or the starter). */ cost: number;
  /** The roll's seed, kept for the record. */ seed?: number;
  /** What it landed on (null only on a spend from before 2026-11-15 that landed on a complete rarity and refunded). */ got: string | null;
  rarity: Rarity;
  /** Points given back: a duplicate (before 2026-11-15, a complete rarity), as stored. */ refund: number;
}

/** A small seeded generator (mulberry32): the same seed always rolls the same pull. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Pity { rare: number; epic: number }
export interface Ledger {
  spends: Spend[];
  /** Each thing you own and the day it joined (the first spend that landed it). */ owned: Map<string, string>;
  /** How many spends landed each thing (pulls, tickets, a choice, the starter): read it with pulledCount. */ landed: Map<string, number>;
  spent: number; refunds: number; ticketsUsed: number;
  /** Pulls since the last rare-or-better and epic-or-better, per banner. */ pity: Record<Banner, Pity>;
  starter: boolean;
}

const RARE = new Set([0, 1, 2, 3, 4]);
const ITEM = new Map(Object.values(POOL).flat().map((x) => [x.id, x]));
/** A synced spend, read as untrusted: anything malformed is dropped whole. A `got` that's no item is read as none, but a retired
 *  buddy's id is kept as it was (ledgerOf leaves its spend out), so a sync never writes it away. */
export function parseSpend(x: unknown): Spend | null {
  const s = x as Partial<Spend> | null;
  if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !s.id || typeof s.at !== 'number' || !Number.isFinite(s.at)) return null;
  if (typeof s.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.day)) return null;
  if (!['pull', 'ticket', 'choose', 'starter'].includes(s.kind as string) || (s.banner !== 'buddy' && s.banner !== 'acc')) return null;
  if (typeof s.cost !== 'number' || !(s.cost >= 0) || typeof s.refund !== 'number' || !(s.refund >= 0) || !RARE.has(s.rarity as number)) return null;
  const got = typeof s.got === 'string' && (ITEM.has(s.got) || RETIRED.has(s.got)) ? s.got : null;
  return { id: s.id, at: s.at, day: s.day, kind: s.kind!, banner: s.banner, cost: s.cost, ...(typeof s.seed === 'number' && { seed: s.seed }), got, rarity: s.rarity as Rarity, refund: s.refund };
}

const empty = (): Ledger => ({ spends: [], owned: new Map(), landed: new Map(), spent: 0, refunds: 0, ticketsUsed: 0, pity: { buddy: { rare: 0, epic: 0 }, acc: { rare: 0, epic: 0 } }, starter: false });

/** Adds one spend, made after every spend already in `l`, to `l` itself (mutated, and returned): what ledgerOf folds with, and
 *  a long simulation's way not to fold everything again each step. Takes its stored cost, got and refund exactly as they are. */
export function addSpend(l: Ledger, s: Spend): Ledger {
  if (s.kind === 'starter') { if (l.starter || s.banner !== 'buddy') return l; l.starter = true; }
  l.spends.push(s);
  l.spent += s.cost; l.refunds += s.refund;
  if (s.kind === 'ticket') l.ticketsUsed++;
  if (s.kind === 'pull' || s.kind === 'ticket') {
    const p = l.pity[s.banner];
    p.rare = s.rarity >= 2 ? 0 : p.rare + 1;
    p.epic = s.rarity >= 3 ? 0 : p.epic + 1;
  }
  if (s.got) {
    if (!l.owned.has(s.got)) l.owned.set(s.got, s.day);
    l.landed.set(s.got, (l.landed.get(s.got) ?? 0) + 1);
  }
  return l;
}

/** What the spends add up to, made in order (each id once). Never re-rolls: a spend's stored `got` is what it got. One that
 *  landed a buddy since retired (roster RETIRED) is left out, as if never made: its points or ticket come back, and a starter
 *  can be picked again. */
export function ledgerOf(spends: readonly Spend[]): Ledger {
  const seen = new Set<string>();
  const xs = [...spends].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .filter((s) => !seen.has(s.id) && !!seen.add(s.id) && !(s.got && RETIRED.has(s.got)));
  return xs.reduce(addSpend, empty());
}

/** How many times `id` has landed (every pull, ticket, choice or starter that got it, the old spends too): "×3" on its card. */
export const pulledCount = (l: Ledger, id: string): number => l.landed.get(id) ?? 0;

/** Points and tickets left: what training earned (domain/buddies/points), less what was spent, plus refunds. Never below 0. */
export interface Wallet { points: number; tickets: number }
export const walletOf = (earned: Wallet, l: Ledger): Wallet =>
  ({ points: Math.max(0, earned.points + l.refunds - l.spent), tickets: Math.max(0, earned.tickets - l.ticketsUsed) });

/** Pulls left until pity's next guarantee: "rare+ in 3". */
export const pityIn = (l: Ledger, b: Banner): Pity => ({ rare: PITY_RARE - l.pity[b].rare, epic: PITY_EPIC - l.pity[b].epic });

/** The rarity a roll lands on: the odds, then pity, then `floor` (a multi-pull's guaranteed rare). */
export function rollRarity(x: number, pity: Pity, floor: Rarity = 0): Rarity {
  let r = 0, acc = ODDS[0];
  while (r < 4 && x >= acc) acc += ODDS[++r];
  if (pity.epic + 1 >= PITY_EPIC && r < 3) return 3;
  if (pity.rare + 1 >= PITY_RARE && r < 2) return 2;
  return Math.max(r, floor) as Rarity;
}

const ofRarity = new Map((['buddy', 'acc'] as const).flatMap((b) =>
  [0, 1, 2, 3, 4].map((r) => [`${b}${r}`, POOL[b].filter((x) => x.rarity === r).map((x) => x.id).sort()] as const)));

function roll(l: Ledger, banner: Banner, how: 'pull' | 'ticket', seed: number, at: number, day: string, id: string, floor: Rarity): Spend {
  const next = rng(seed);
  const rarity = rollRarity(next(), l.pity[banner], floor);
  const all = ofRarity.get(`${banner}${rarity}`)!;
  const got = all[Math.floor(next() * all.length)];
  return { id, at, day, kind: how, banner, cost: how === 'pull' ? PULL[banner] : 0, seed: seed >>> 0, got, rarity, refund: l.owned.has(got) ? dupeRefund(banner) : 0 };
}

/** A pull (with points, or a ticket): rolled once here from `seed`, then kept as is. */
export const pull = (l: Ledger, banner: Banner, how: 'pull' | 'ticket', seed: number, at: number, day: string, id = `${at}-${seed >>> 0}`): Spend =>
  roll(l, banner, how, seed, at, day, id, 0);

/** `n` pulls in one go on one banner (MULTI by default; `how` for all of them, or one each), rolled in order from one `seed`,
 *  each from the ledger as the ones before it left it (pity, duplicates), `at`, `at` + 1, … apart. At least one is rare or
 *  better: the last is raised to rare when none before it was. Each is an ordinary spend, kept as is. */
export function pullMany(l: Ledger, banner: Banner, how: 'pull' | 'ticket' | readonly ('pull' | 'ticket')[], seed: number, at: number, day: string, n = MULTI): Spend[] {
  const next = rng(seed), out: Spend[] = [];
  const run: Ledger = { ...l, spends: [...l.spends], owned: new Map(l.owned), landed: new Map(l.landed), pity: { buddy: { ...l.pity.buddy }, acc: { ...l.pity.acc } } };
  for (let i = 0; i < n; i++) {
    const s = Math.floor(next() * 2 ** 32), h = typeof how === 'string' ? how : how[i] ?? 'pull';
    const floor: Rarity = i === n - 1 && !out.some((x) => x.rarity >= 2) ? 2 : 0;
    out.push(roll(run, banner, h, s, at + i, day, `${at + i}-${s}`, floor));
    addSpend(run, out[i]);
  }
  return out;
}

/** Choosing one directly, saved up for. */
export function choose(banner: Banner, item: string, at: number, day: string, id = `${at}-c`): Spend {
  const x = POOL[banner].find((p) => p.id === item);
  if (!x) throw new Error(`no ${banner} ${item}`);
  return { id, at, day, kind: 'choose', banner, cost: CHOOSE[banner][x.rarity], got: item, rarity: x.rarity, refund: 0 };
}

/** The first-run pick: three commons to choose one from, the same three for the same seed. */
export function starterOffer(seed: number): string[] {
  const next = rng(seed), left = POOL.buddy.filter((x) => x.rarity === 0).map((x) => x.id).sort(), out: string[] = [];
  while (out.length < STARTERS && left.length) out.push(...left.splice(Math.floor(next() * left.length), 1));
  return out;
}
export const starter = (item: string, at: number, day: string, id = `${at}-s`): Spend =>
  ({ id, at, day, kind: 'starter', banner: 'buddy', cost: 0, got: item, rarity: 0, refund: 0 });

/** Whether a spend can be made now. */
export function canSpend(w: Wallet, l: Ledger, s: Pick<Spend, 'kind' | 'banner' | 'got'>): boolean {
  if (s.kind === 'ticket') return w.tickets >= 1;
  if (s.kind === 'pull') return w.points >= PULL[s.banner];
  if (s.kind === 'starter') return !l.starter;
  const x = s.got ? POOL[s.banner].find((p) => p.id === s.got) : undefined;
  return !!x && !l.owned.has(x.id) && w.points >= CHOOSE[s.banner][x.rarity];
}
