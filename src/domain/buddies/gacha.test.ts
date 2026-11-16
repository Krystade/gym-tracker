import { describe, expect, it } from 'vitest';
import { canSpend, CHOOSE, choose, DUPE_REFUND, dupeRefund, ledgerOf, MULTI, ODDS, parseSpend, PITY_EPIC, PITY_RARE, pityIn, pull, PULL, pulledCount, pullMany, rng, rollRarity, starter, starterOffer, walletOf, type Spend } from './gacha';
import { POOL, RETIRED, type Banner } from './roster';

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

describe('duplicates, refunds and multi-pulls', () => {
  it('a pull lands on any one of its rarity, owned or not: duplicates happen, each giving half the pull back (a ticket too)', () => {
    const s = pulls(POOL.acc.length * 3, 'acc', 11);
    const got = s.map((x) => x.got);
    expect(got.every((g) => !!g)).toBe(true);
    expect(new Set(got).size).toBeLessThan(got.length);
    s.forEach((x, i) => {
      const before = ledgerOf(s.slice(0, i));
      expect(POOL.acc.find((p) => p.id === x.got)!.rarity).toBe(x.rarity);
      expect(x.refund).toBe(before.owned.has(x.got!) ? dupeRefund('acc') : 0);
    });
    expect([dupeRefund('buddy'), dupeRefund('acc')]).toEqual([Math.round(PULL.buddy * DUPE_REFUND), Math.round(PULL.acc * DUPE_REFUND)]);
    const mine = ledgerOf(POOL.acc.map((p, i) => choose('acc', p.id, i + 1, D, `c${p.id}`)));
    const t = pull(mine, 'acc', 'ticket', 5, 999, D);
    expect([t.cost, t.refund]).toEqual([0, dupeRefund('acc')]);
  });
  it('within a rarity every one is as likely, owned or not (each within ±25% of its share over 60k rolls)', () => {
    const owned = ledgerOf(POOL.acc.filter((p) => p.rarity === 0).slice(0, 10).map((p, i) => choose('acc', p.id, i + 1, D, `c${i}`)));
    const commons = POOL.acc.filter((p) => p.rarity === 0), hit = new Map<string, number>();
    const r = rng(3);
    let n = 0;
    for (let i = 0; i < 100_000; i++) {
      const p = pull(owned, 'acc', 'pull', Math.floor(r() * 2 ** 32), 1, D);
      if (p.rarity === 0) { n++; hit.set(p.got!, (hit.get(p.got!) ?? 0) + 1); }
    }
    for (const c of commons) expect(Math.abs((hit.get(c.id) ?? 0) / (n / commons.length) - 1)).toBeLessThan(0.25);
  });
  it('pulledCount: every spend that landed it, old spends and refunds as stored; nothing owned is taken away', () => {
    const id = POOL.acc[0].id;
    const old: Spend = { id: 'old', at: 1, day: D, kind: 'pull', banner: 'acc', cost: 3, seed: 1, got: null, rarity: 0, refund: 1 };
    const s = [old, choose('acc', id, 2, D, 'c'), { ...pull(ledgerOf([]), 'acc', 'pull', 1, 3, D, 'p'), got: id, rarity: POOL.acc[0].rarity, refund: 5 },
      { ...pull(ledgerOf([]), 'acc', 'ticket', 2, 4, D, 't'), got: id, rarity: POOL.acc[0].rarity, refund: 5 }];
    const l = ledgerOf(s);
    expect(pulledCount(l, id)).toBe(3);
    expect(pulledCount(l, POOL.acc[1].id)).toBe(0);
    expect([l.spent, l.refunds]).toEqual([3 + CHOOSE.acc[POOL.acc[0].rarity] + PULL.acc, 1 + 5 + 5]); // old cost and refund kept exactly
    expect([...l.owned.keys()]).toEqual([id]);
  });
  it(`pullMany: ${MULTI} seeded pulls in order, the same for the same seed, at least one rare or better every time`, () => {
    const base = ledgerOf(pulls(3, 'buddy', 2));
    expect(pullMany(base, 'buddy', 'pull', 77, 100, D)).toEqual(pullMany(base, 'buddy', 'pull', 77, 100, D));
    for (let seed = 0; seed < 2000; seed++) {
      const xs = pullMany(base, 'buddy', 'pull', seed, 100, D);
      expect(xs).toHaveLength(MULTI);
      expect(xs.some((x) => x.rarity >= 2)).toBe(true);
      expect(new Set(xs.map((x) => x.id)).size).toBe(MULTI);
      expect(xs.map((x) => x.at)).toEqual(Array.from({ length: MULTI }, (_, i) => 100 + i));
    }
    // each is the pull it would be from the ledger the ones before it left: pity and duplicates carry through
    const xs = pullMany(base, 'acc', ['ticket', 'ticket', 'pull'], 9, 200, D, 3);
    xs.forEach((x, i) => expect(x.refund).toBe(ledgerOf([...base.spends, ...xs.slice(0, i)]).owned.has(x.got!) ? dupeRefund('acc') : 0));
    expect(xs.map((x) => [x.kind, x.cost])).toEqual([['ticket', 0], ['ticket', 0], ['pull', PULL.acc]]);
    expect(base.spends).toHaveLength(3); // the ledger it was given is left as it was
  });
  it('without the guarantee about 2 in 7 tens (0.87^9) would hold no rare in the first 9: the floor only lifts the last pull of such a run', () => {
    let lifted = 0;
    for (let seed = 0; seed < 2000; seed++) {
      const xs = pullMany(ledgerOf([]), 'acc', 'pull', seed, 1, D);
      if (xs.slice(0, -1).every((x) => x.rarity < 2)) { lifted++; expect(xs.at(-1)!.rarity).toBeGreaterThanOrEqual(2); }
    }
    expect(lifted / 2000).toBeGreaterThan(0.24);
    expect(lifted / 2000).toBeLessThan(0.33);
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
    expect(l.owned.size).toBe(new Set(s.map((x) => x.got)).size);
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
  it('a spend that landed a buddy since retired is as if never made: points and ticket back, the starter free again', () => {
    const gone = [...RETIRED][0], kept = POOL.buddy[0].id;
    expect(POOL.buddy.some((p) => p.id === gone)).toBe(false);
    const was = [starter(gone, 1, D, 's1'), { ...pull(ledgerOf([]), 'buddy', 'pull', 1, 2, D, 'p'), got: gone, refund: 0 },
      { ...pull(ledgerOf([]), 'buddy', 'ticket', 2, 3, D, 't'), got: gone, refund: 0 }, choose('buddy', kept, 4, D, 'c')];
    const read = was.map((s) => parseSpend(JSON.parse(JSON.stringify(s)))!);
    expect(read.map((s) => s.got)).toEqual([gone, gone, gone, kept]); // kept as stored: a sync never writes it away
    const l = ledgerOf(read);
    expect([...l.owned.keys()]).toEqual([kept]);
    expect([l.spent, l.ticketsUsed, l.starter]).toEqual([CHOOSE.buddy[POOL.buddy[0].rarity], 0, false]);
    expect(canSpend({ points: 0, tickets: 0 }, l, { kind: 'starter', banner: 'buddy', got: starterOffer(1)[0] })).toBe(true);
    expect([...ledgerOf([...read, starter(starterOffer(1)[0], 5, D, 's2')]).owned.keys()]).toEqual([kept, starterOffer(1)[0]]);
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
