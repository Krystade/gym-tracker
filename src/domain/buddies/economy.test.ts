import { describe, expect, it } from 'vitest';
import { addSpend, CHOOSE, choose, dupeRefund, ledgerOf, ODDS, pull, PULL, rng, starter, starterOffer, TARGET, targetIncome, targetTickets, walletOf, type Ledger } from './gacha';
import { INCOME } from './points';
import { pointsAt } from './rewards';
import { POOL, type Banner } from './roster';

// The economy (owner 2026-11-15: the gambling and the tickets up front; owning everything slower is fine). No target is held
// here any more: this simulates how long owning every buddy and accessory takes, Monte Carlo, and reports it.
// A synthetic lifter, seeded: its sets a session, +5 a session, +20 and a ticket for the 85% of weeks the goal is met, a ticket
// every 5 sessions, 1 per 3 cardio minutes, about 15 points a week of bronze and silver achievements with a gold or platinum
// ticket every 6 weeks, and Your body's Weigh-ins and Photo days paying each level as it's crossed (4 weigh-ins a week, a photo
// day every 2 weeks). The player spends a ticket as soon as it has one, on the banner a pull is worth most on; pulls with points
// while a pull is worth its price (what it can land that's missing at its choosing price, a duplicate its refund); otherwise
// saves up and chooses the cheapest thing missing. Pulls are the real ones (domain/buddies/gacha pull, pity and duplicates).

const BANNERS = ['buddy', 'acc'] as const;
interface Lifter { sessions: number; sets: number; cardioMin: number }
const HORIZON = 52 * 30;

/** A pull's worth on `b` by the odds, with `left[r]` of each rarity's `all[r]` still missing. */
const worth = (b: Banner, left: readonly number[], all: readonly number[]) =>
  ODDS.reduce((a, q, r) => a + q * (left[r] / all[r] * CHOOSE[b][r] + (1 - left[r] / all[r]) * dupeRefund(b)), 0);

function weeksToAll(l: Lifter, seed: number): { weeks: number; pulls: number; tickets: number; chose: number } {
  const r = rng(seed), first = starterOffer(seed)[0];
  const led: Ledger = ledgerOf([starter(first, 0, '2026-01-01')]);
  const all = Object.fromEntries(BANNERS.map((b) => [b, [0, 1, 2, 3, 4].map((k) => POOL[b].filter((x) => x.rarity === k).length)])) as Record<Banner, number[]>;
  const left = Object.fromEntries(BANNERS.map((b) => [b, [0, 1, 2, 3, 4].map((k) => POOL[b].filter((x) => x.rarity === k && !led.owned.has(x.id)).length)])) as Record<Banner, number[]>;
  const total = BANNERS.reduce((a, b) => a + POOL[b].length, 0);
  let pts = 0, tickets = 0, carry = 0, sessions = 0, photos = 0, t = 1, pulls = 0, used = 0, chose = 0;
  const spend = (b: Banner, s: ReturnType<typeof pull>) => {
    const had = led.owned.size;
    addSpend(led, s);
    if (led.owned.size > had) left[b][s.rarity]--;
  };
  for (let w = 1; w <= HORIZON; w++) {
    carry += l.sessions; const s = Math.floor(carry); carry -= s;
    const goal = r() < TARGET.goalWeekShare;
    pts += s * (l.sets * INCOME.set + INCOME.session) + (goal ? INCOME.goalWeek : 0) + Math.floor(l.cardioMin / INCOME.cardioMin) + TARGET.achievementPointsPerWeek;
    const weighs = TARGET.weighInsPerWeek * w, shot = Math.floor(TARGET.photoDaysPerWeek * w);
    pts += pointsAt('weigh-ins', weighs) - pointsAt('weigh-ins', weighs - TARGET.weighInsPerWeek) + pointsAt('photo-days', shot) - pointsAt('photo-days', photos);
    photos = shot;
    tickets += (goal ? INCOME.goalWeekTickets : 0) + Math.floor((sessions + s) / INCOME.sessionsPerTicket) - Math.floor(sessions / INCOME.sessionsPerTicket) + (w % 6 === 0 ? 1 : 0);
    sessions += s;
    for (;;) {
      if (led.owned.size >= total) return { weeks: w, pulls, tickets: used, chose };
      const wal = walletOf({ points: pts, tickets }, led);
      const open = BANNERS.filter((b) => left[b].some((n) => n > 0));
      const best = open.reduce((a, b) => (worth(b, left[b], all[b]) / PULL[b] > worth(a, left[a], all[a]) / PULL[a] ? b : a));
      const at = t++;
      if (wal.tickets > 0) { spend(best, pull(led, best, 'ticket', Math.floor(r() * 2 ** 32), at, '2026-01-01')); pulls++; used++; continue; }
      if (worth(best, left[best], all[best]) >= PULL[best]) {
        if (wal.points < PULL[best]) break;
        spend(best, pull(led, best, 'pull', Math.floor(r() * 2 ** 32), at, '2026-01-01')); pulls++;
        continue;
      }
      const next = open.flatMap((b) => POOL[b].filter((x) => !led.owned.has(x.id)).map((x) => ({ b, x, cost: CHOOSE[b][x.rarity] }))).sort((a, b) => a.cost - b.cost)[0];
      if (wal.points < next.cost) break;
      spend(next.b, choose(next.b, next.x.id, at, '2026-01-01')); chose++;
    }
  }
  return { weeks: Infinity, pulls, tickets: used, chose };
}
const at = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))];
const runs = (l: Lifter, n: number, seed: number) => Array.from({ length: n }, (_, i) => weeksToAll(l, seed + i));

describe('the economy: how long owning everything takes (reported, not a target)', () => {
  it(`a ${TARGET.sessionsPerWeek}×/week lifter of ${TARGET.setsPerSession} sets owns every buddy and accessory within ${HORIZON / 52} years, every run`, () => {
    const rs = runs({ sessions: TARGET.sessionsPerWeek, sets: TARGET.setsPerSession, cardioMin: 0 }, 200, 1000);
    const ws = rs.map((x) => x.weeks);
    const fast = runs({ sessions: 3, sets: 17, cardioMin: 45 }, 40, 50).map((x) => x.weeks);
    console.log(JSON.stringify({
      prices: { PULL, CHOOSE, dupe: { buddy: dupeRefund('buddy'), acc: dupeRefund('acc') } },
      perWeek: { points: +targetIncome().toFixed(1), tickets: +targetTickets().toFixed(2), achievementTickets: +(1 / 6).toFixed(2) },
      target: { median: at(ws, 0.5), p10: at(ws, 0.1), p90: at(ws, 0.9), pulls: at(rs.map((x) => x.pulls), 0.5), tickets: at(rs.map((x) => x.tickets), 0.5), chose: at(rs.map((x) => x.chose), 0.5) },
      threeTimes: { median: at(fast, 0.5), p90: at(fast, 0.9) },
    }));
    expect(ws.every(Number.isFinite)).toBe(true);
    expect(fast.every(Number.isFinite)).toBe(true);
  });
  it('the same seed simulates the same, and it is the real pull: duplicates happen along the way', () => {
    const l = { sessions: TARGET.sessionsPerWeek, sets: TARGET.setsPerSession, cardioMin: 0 };
    expect(weeksToAll(l, 7)).toEqual(weeksToAll(l, 7));
    const r = weeksToAll(l, 7);
    expect(r.pulls).toBeGreaterThan(BANNERS.reduce((a, b) => a + POOL[b].length, 0));
  });
});
