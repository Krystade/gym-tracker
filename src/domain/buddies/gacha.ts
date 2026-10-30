import { INCOME } from './points';
import { POOL, type Banner, type Rarity } from './roster';

// Pulls, tickets and choosing (plan §16.5, §16.7 with §15.4's odds, pity and refunds; owner 2026-10-28: either banner can
// take a ticket, nothing costs money; owner 2026-10-29: everything owned in about 6 months at his own pace).
// - What is stored is only the spends, each with its roll: a sync never re-rolls one (rule 6). Everything else (what you own,
//   pity, the points spent) is worked out from them, in the order they were made.
// - A pull never lands on something you own while its rarity still has something you're missing; once a rarity is complete,
//   landing on it refunds part of the price instead.
// - Pity, per banner: a rare or better by the 10th pull, an epic or better by the 40th. A ticket is a pull: it counts too.
// - Prices are worked out from the roster (how many of each rarity) and TARGET, never written in: re-sorting rarities or
//   adding buddies keeps the 6 months with no retuning (economy.test simulates it).

export const ODDS = [0.60, 0.27, 0.09, 0.03, 0.01] as const;
export const PITY_RARE = 10, PITY_EPIC = 40;
/** Share of the pull's price back when its rarity is already complete, common → legendary. */
export const REFUND = [0.2, 0.3, 0.4, 0.5, 0.6] as const;
export const STARTERS = 3;

/** The pace prices are set for: the owner's own, from his log (2026-10-29: 1.23 sessions a week over 26 weeks, about 10
 *  working sets each), owning everything in about 26 weeks. A goal week 85% of weeks and about 15 achievement points a week. */
export const TARGET = { weeks: 26, sessionsPerWeek: 1.2, setsPerSession: 10, goalWeekShare: 0.85, achievementPointsPerWeek: 15 } as const;
/** Points a week at TARGET's pace (the income domain/buddies/points pays; no cardio). */
export const targetIncome = (): number =>
  TARGET.sessionsPerWeek * (TARGET.setsPerSession * INCOME.set + INCOME.session) + TARGET.goalWeekShare * INCOME.goalWeek + TARGET.achievementPointsPerWeek;

/** Relative prices, scaled to TARGET: a pull, then choosing common → legendary (saving up to pick costs about 2–3× what
 *  gambling does). */
const SHAPE: Record<Banner, { pull: number; choose: readonly number[] }> = {
  buddy: { pull: 13, choose: [30, 50, 95, 170, 280] },
  acc: { pull: 8, choose: [20, 30, 55, 100, 180] },
};

/** What a pull is worth by the odds: what it can land that's missing at its choosing price, a complete rarity its refund. */
export const pullWorth = (left: readonly number[], pull: number, choose: readonly number[]): number =>
  ODDS.reduce((a, q, r) => a + q * (left[r] > 0 ? choose[r] : pull * REFUND[r]), 0);

/** Points to own `left` (how many missing of each rarity) on average, without luck or pity, for a player who pulls while a
 *  pull is worth its price and then chooses the rest. */
export function costToOwn(left: readonly number[], pull: number, choose: readonly number[]): number {
  const l = [...left];
  let cost = 0;
  for (let i = 0; i < 100_000 && l.some((n) => n > 1e-9) && pullWorth(l, pull, choose) >= pull; i++) {
    cost += pull;
    ODDS.forEach((q, r) => { const got = Math.min(l[r], q); l[r] -= got; cost -= (q - got) * pull * REFUND[r]; });
  }
  return cost + l.reduce((a, n, r) => a + n * choose[r], 0);
}

const counts = (b: Banner) => { const c = [0, 0, 0, 0, 0]; for (const x of POOL[b]) c[x.rarity]++; if (b === 'buddy') c[0] = Math.max(0, c[0] - 1); return c; };
/** How much SHAPE is scaled by: TARGET's points over TARGET's weeks buy everything but the starter. */
export const PRICE_SCALE = (targetIncome() * TARGET.weeks) /
  (['buddy', 'acc'] as const).reduce((a, b) => a + costToOwn(counts(b), SHAPE[b].pull, SHAPE[b].choose), 0);
const price = (x: number) => Math.max(1, Math.round(x * PRICE_SCALE));
/** Points for a random pull. */
export const PULL: Record<Banner, number> = { buddy: price(SHAPE.buddy.pull), acc: price(SHAPE.acc.pull) };
/** Points to choose one directly, common → legendary. */
export const CHOOSE: Record<Banner, readonly number[]> = { buddy: SHAPE.buddy.choose.map(price), acc: SHAPE.acc.choose.map(price) };

export type SpendKind = 'pull' | 'ticket' | 'choose' | 'starter';
export interface Spend {
  /** Unique, and its meta key (`spend:<id>`). */ id: string;
  /** When it was made (epoch ms): orders the ledger. */ at: number;
  /** The local day it was made: a buddy counts its training from it. */ day: string;
  kind: SpendKind; banner: Banner;
  /** Points paid (0 for a ticket or the starter). */ cost: number;
  /** The roll's seed, kept for the record. */ seed?: number;
  /** What it landed on; null when it landed on a complete rarity and refunded. */ got: string | null;
  rarity: Rarity;
  /** Points given back (a complete rarity). */ refund: number;
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
  spent: number; refunds: number; ticketsUsed: number;
  /** Pulls since the last rare-or-better and epic-or-better, per banner. */ pity: Record<Banner, Pity>;
  starter: boolean;
}

const RARE = new Set([0, 1, 2, 3, 4]);
const ITEM = new Map(Object.values(POOL).flat().map((x) => [x.id, x]));
/** A synced spend, read as untrusted: anything malformed is dropped whole. */
export function parseSpend(x: unknown): Spend | null {
  const s = x as Partial<Spend> | null;
  if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !s.id || typeof s.at !== 'number' || !Number.isFinite(s.at)) return null;
  if (typeof s.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.day)) return null;
  if (!['pull', 'ticket', 'choose', 'starter'].includes(s.kind as string) || (s.banner !== 'buddy' && s.banner !== 'acc')) return null;
  if (typeof s.cost !== 'number' || !(s.cost >= 0) || typeof s.refund !== 'number' || !(s.refund >= 0) || !RARE.has(s.rarity as number)) return null;
  const got = typeof s.got === 'string' && ITEM.has(s.got) ? s.got : null;
  return { id: s.id, at: s.at, day: s.day, kind: s.kind!, banner: s.banner, cost: s.cost, ...(typeof s.seed === 'number' && { seed: s.seed }), got, rarity: s.rarity as Rarity, refund: s.refund };
}

/** What the spends add up to, made in order (each id once). Never re-rolls: a spend's stored `got` is what it got. */
export function ledgerOf(spends: readonly Spend[]): Ledger {
  const seen = new Set<string>();
  const xs = [...spends].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).filter((s) => !seen.has(s.id) && !!seen.add(s.id));
  const l: Ledger = { spends: xs, owned: new Map(), spent: 0, refunds: 0, ticketsUsed: 0, pity: { buddy: { rare: 0, epic: 0 }, acc: { rare: 0, epic: 0 } }, starter: false };
  for (const s of xs) {
    if (s.kind === 'starter') { if (l.starter || s.banner !== 'buddy') continue; l.starter = true; }
    l.spent += s.cost; l.refunds += s.refund;
    if (s.kind === 'ticket') l.ticketsUsed++;
    if (s.kind === 'pull' || s.kind === 'ticket') {
      const p = l.pity[s.banner];
      p.rare = s.rarity >= 2 ? 0 : p.rare + 1;
      p.epic = s.rarity >= 3 ? 0 : p.epic + 1;
    }
    if (s.got && !l.owned.has(s.got)) l.owned.set(s.got, s.day);
  }
  return l;
}

/** Points and tickets left: what training earned (domain/buddies/points), less what was spent, plus refunds. Never below 0. */
export interface Wallet { points: number; tickets: number }
export const walletOf = (earned: Wallet, l: Ledger): Wallet =>
  ({ points: Math.max(0, earned.points + l.refunds - l.spent), tickets: Math.max(0, earned.tickets - l.ticketsUsed) });

/** Pulls left until pity's next guarantee: "rare+ in 3". */
export const pityIn = (l: Ledger, b: Banner): Pity => ({ rare: PITY_RARE - l.pity[b].rare, epic: PITY_EPIC - l.pity[b].epic });

/** The rarity a roll lands on: the odds, then pity. */
export function rollRarity(x: number, pity: Pity): Rarity {
  let r = 0, acc = ODDS[0];
  while (r < 4 && x >= acc) acc += ODDS[++r];
  if (pity.epic + 1 >= PITY_EPIC && r < 3) return 3;
  if (pity.rare + 1 >= PITY_RARE && r < 2) return 2;
  return r as Rarity;
}

const missing = (l: Ledger, b: Banner, r: Rarity) => POOL[b].filter((x) => x.rarity === r && !l.owned.has(x.id)).map((x) => x.id).sort();

/** A pull (with points, or a ticket): rolled once here from `seed`, then kept as is. */
export function pull(l: Ledger, banner: Banner, how: 'pull' | 'ticket', seed: number, at: number, day: string, id = `${at}-${seed >>> 0}`): Spend {
  const next = rng(seed);
  const rarity = rollRarity(next(), l.pity[banner]);
  const left = missing(l, banner, rarity);
  const got = left.length ? left[Math.floor(next() * left.length)] : null;
  return { id, at, day, kind: how, banner, cost: how === 'pull' ? PULL[banner] : 0, seed: seed >>> 0, got, rarity, refund: got ? 0 : Math.round(PULL[banner] * REFUND[rarity]) };
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
