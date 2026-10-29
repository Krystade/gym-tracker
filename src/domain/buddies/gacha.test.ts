import { describe, expect, it } from 'vitest';
import { canSpend, CHOOSE, choose, ledgerOf, ODDS, parseSpend, PITY_EPIC, PITY_RARE, pityIn, pull, PULL, REFUND, rng, rollRarity, starter, starterOffer, walletOf, type Spend } from './gacha';
import { POOL, type Banner } from './roster';

const D = '2026-11-01';
/** Pulls in a row on one banner, each from the ledger so far, as the app would make them. */
function pulls(n: number, banner: Banner, seed = 1, start: Spend[] = []): Spend[] {
  const r = rng(seed), out = [...start];
  for (let i = 0; i < n; i++) out.push(pull(ledgerOf(out), banner, 'pull', Math.floor(r() * 2 ** 32), out.length + 1, D));
  return out;
}

describe('odds and pity', () => {
  it('over 100k rolls each rarity lands within ±0.5 pt of its stated rate (before pity)', () => {
    const r = rng(42), n = 100_000, hit = [0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) hit[rollRarity(r(), { rare: 0, epic: 0 })]++;
    hit.forEach((h, i) => expect(Math.abs(h / n - ODDS[i])).toBeLessThan(0.005));
  });
  it('pity never passes 10 for rare+ or 40 for epic+, over a long run (rarities refill so it never stops landing)', () => {
    const r = rng(7);
    let rare = 0, epic = 0, worstRare = 0, worstEpic = 0;
    for (let i = 0; i < 100_000; i++) {
      const x = rollRarity(r(), { rare, epic });
      rare = x >= 2 ? 0 : rare + 1; epic = x >= 3 ? 0 : epic + 1;
      worstRare = Math.max(worstRare, rare + 1); worstEpic = Math.max(worstEpic, epic + 1);
    }
    expect(worstRare).toBe(PITY_RARE);
    expect(worstEpic).toBe(PITY_EPIC);
  });
  it('the 10th pull without a rare is a rare; the 40th without an epic is an epic', () => {
    expect(rollRarity(0, { rare: PITY_RARE - 1, epic: 0 })).toBe(2);
    expect(rollRarity(0, { rare: PITY_RARE - 2, epic: 0 })).toBe(0);
    expect(rollRarity(0, { rare: 0, epic: PITY_EPIC - 1 })).toBe(3);
    expect(rollRarity(0.999, { rare: PITY_RARE - 1, epic: PITY_EPIC - 1 })).toBe(4); // a legendary stays one
  });
  it('the ledger counts pity per banner, tickets included; the button says how far off', () => {
    const s = pulls(5, 'acc', 3);
    const l = ledgerOf(s);
    expect(l.pity.buddy).toEqual({ rare: 0, epic: 0 });
    const sinceRare = s.length - 1 - s.map((x) => x.rarity >= 2).lastIndexOf(true);
    expect(l.pity.acc.rare).toBe(sinceRare);
    expect(pityIn(l, 'acc').rare).toBe(PITY_RARE - sinceRare);
    const t = pull(l, 'acc', 'ticket', 9, 99, D);
    expect(t.cost).toBe(0);
    expect(ledgerOf([...s, t]).pity.acc.epic).toBe(t.rarity >= 3 ? 0 : l.pity.acc.epic + 1);
  });
});

describe('no duplicates, then refunds', () => {
  it('a pull never lands on something owned while its rarity has something missing', () => {
    const s = pulls(POOL.acc.length * 3, 'acc', 11);
    const got = s.map((x) => x.got).filter(Boolean);
    expect(new Set(got).size).toBe(got.length);
    for (const x of s) if (!x.got) {
      // a refund only when, at that moment, every item of its rarity was already owned
      const before = ledgerOf(s.slice(0, s.indexOf(x)));
      expect(POOL.acc.filter((p) => p.rarity === x.rarity).every((p) => before.owned.has(p.id))).toBe(true);
      expect(x.refund).toBe(Math.round(PULL.acc * REFUND[x.rarity]));
    }
  });
  it('a complete rarity refunds its share of the price', () => {
    const commons = POOL.buddy.filter((p) => p.rarity === 0).map((p) => choose('buddy', p.id, 1, D, `c${p.id}`));
    const l = ledgerOf(commons);
    let seed = 0; while (rollRarity(rng(seed)(), l.pity.buddy) !== 0) seed++;
    const p = pull(l, 'buddy', 'pull', seed, 2, D);
    expect([p.got, p.refund]).toEqual([null, Math.round(PULL.buddy * REFUND[0])]);
  });
});

describe('the ledger', () => {
  it('a stored roll is never re-rolled: the ledger owns what each spend says it got, and the same seed rolls the same', () => {
    const l = ledgerOf([]);
    expect(pull(l, 'buddy', 'pull', 123, 1, D)).toEqual(pull(l, 'buddy', 'pull', 123, 1, D));
    const forged = { ...pull(l, 'buddy', 'pull', 123, 1, D), got: POOL.buddy.at(-1)!.id };
    expect([...ledgerOf([forged]).owned.keys()]).toEqual([POOL.buddy.at(-1)!.id]);
  });
  it('each spend counts once (a sync that brings one back twice), in the order made; an item joins on its first day', () => {
    const a = choose('buddy', POOL.buddy[0].id, 5, '2026-11-05', 'a'), b = { ...choose('buddy', POOL.buddy[0].id, 3, '2026-11-03', 'b') };
    const l = ledgerOf([a, a, b]);
    expect(l.spent).toBe(2 * CHOOSE.buddy[POOL.buddy[0].rarity]);
    expect(l.owned.get(POOL.buddy[0].id)).toBe('2026-11-03');
  });
  it('the balance is earned − spent + refunds, never below 0, and an edit under it takes nothing owned back', () => {
    const s = pulls(6, 'buddy', 5);
    const l = ledgerOf(s);
    expect(walletOf({ points: 1000, tickets: 2 }, l)).toEqual({ points: 1000 - 6 * PULL.buddy + l.refunds, tickets: 2 });
    expect(walletOf({ points: 10, tickets: 0 }, l).points).toBe(0);
    expect(l.owned.size).toBe(s.filter((x) => x.got).length);
  });
  it('one starter only, free, from three commons offered the same for the same seed', () => {
    const offer = starterOffer(77);
    expect(offer).toEqual(starterOffer(77));
    expect(new Set(offer).size).toBe(3);
    expect(offer.every((id) => POOL.buddy.find((p) => p.id === id)!.rarity === 0)).toBe(true);
    const l = ledgerOf([starter(offer[0], 1, D, 's1'), starter(offer[1], 2, D, 's2')]);
    expect([...l.owned.keys()]).toEqual([offer[0]]);
    expect(canSpend({ points: 0, tickets: 0 }, l, { kind: 'starter', banner: 'buddy', got: offer[2] })).toBe(false);
  });
  it('can spend: a pull needs its price, a ticket a ticket, a choice its price and not owned', () => {
    const l = ledgerOf([choose('acc', POOL.acc[0].id, 1, D)]);
    const w = { points: PULL.buddy, tickets: 0 };
    expect(canSpend(w, l, { kind: 'pull', banner: 'buddy', got: null })).toBe(true);
    expect(canSpend({ ...w, points: PULL.buddy - 1 }, l, { kind: 'pull', banner: 'buddy', got: null })).toBe(false);
    expect(canSpend(w, l, { kind: 'ticket', banner: 'acc', got: null })).toBe(false);
    expect(canSpend({ points: 1e6, tickets: 0 }, l, { kind: 'choose', banner: 'acc', got: POOL.acc[0].id })).toBe(false);
    expect(canSpend({ points: 1e6, tickets: 0 }, l, { kind: 'choose', banner: 'acc', got: POOL.acc[1].id })).toBe(true);
  });
  it('a synced spend is read as untrusted', () => {
    const ok = pull(ledgerOf([]), 'buddy', 'pull', 1, 1, D);
    expect(parseSpend(JSON.parse(JSON.stringify(ok)))).toEqual(ok);
    expect(parseSpend({ ...ok, cost: -5 })).toBeNull();
    expect(parseSpend({ ...ok, day: 'soon' })).toBeNull();
    expect(parseSpend({ ...ok, banner: 'cash' })).toBeNull();
    expect(parseSpend({ ...ok, rarity: 9 })).toBeNull();
    expect(parseSpend({ ...ok, got: 'not-a-buddy' })!.got).toBeNull();
  });
});
