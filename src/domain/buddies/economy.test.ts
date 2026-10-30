import { describe, expect, it } from 'vitest';
import { CHOOSE, choose, ledgerOf, pull, PULL, pullWorth, rng, starter, starterOffer, TARGET, walletOf, type Spend } from './gacha';
import { pointsAt } from './rewards';
import { ACCESSORIES, BUDDIES, POOL, type Banner } from './roster';

// Pacing (owner 2026-10-29: everything owned in about 6 months at his own pace, 1.2 sessions a week of about 10 working
// sets). A synthetic lifter, seeded: its sets a session, +5 a session, +20 for the 85% of weeks the goal is met, 1 per 3 cardio
// minutes, about 15 points a week of bronze and silver achievements with a ticket every 6 weeks, and Your body's Weigh-ins and
// Photo days paying each level as it's crossed (4 weigh-ins a week, a photo day every 2 weeks). The player spends a
// ticket as soon as it has one, pulls while a pull is worth its price (domain/buddies/gacha pullWorth), and otherwise saves
// up and chooses what's missing, cheapest first; buddies, then accessories. Rewards and income are the ones
// domain/buddies/points and rewards pay. Prices come from the roster, so this holds however the rarities are sorted.

interface Lifter { sessions: number; sets: number; cardioMin: number }
function weeksToAll(l: Lifter, seed: number): number {
  const r = rng(seed);
  let spends: Spend[] = [starter(starterOffer(seed)[0], 0, '2026-01-01')], pts = 0, tickets = 0, carry = 0, t = 1, photos = 0;
  const total = BUDDIES.length + ACCESSORIES.length;
  for (let w = 1; w <= 156; w++) {
    carry += l.sessions; const s = Math.floor(carry); carry -= s;
    pts += s * l.sets + 5 * s + (r() < 0.85 ? 20 : 0) + Math.floor(l.cardioMin / 3) + 15;
    const weighs = TARGET.weighInsPerWeek * w, shot = Math.floor(TARGET.photoDaysPerWeek * w);
    pts += pointsAt('weigh-ins', weighs) - pointsAt('weigh-ins', weighs - TARGET.weighInsPerWeek) + pointsAt('photo-days', shot) - pointsAt('photo-days', photos);
    photos = shot;
    if (w % 6 === 0) tickets++;
    for (;;) {
      const led = ledgerOf(spends), wal = walletOf({ points: pts, tickets }, led);
      if (led.owned.size >= total) return w;
      const left = (b: Banner) => POOL[b].filter((x) => !led.owned.has(x.id));
      const b: Banner = left('buddy').length ? 'buddy' : 'acc';
      const missing = [0, 1, 2, 3, 4].map((k) => left(b).filter((x) => x.rarity === k).length);
      const next = [...left(b)].sort((x, y) => x.rarity - y.rarity)[0];
      const at = t++;
      if (wal.tickets > 0) spends = [...spends, pull(led, b, 'ticket', Math.floor(r() * 2 ** 32), at, '2026-01-01')];
      else if (pullWorth(missing, PULL[b], CHOOSE[b]) >= PULL[b]) {
        if (wal.points < PULL[b]) break;
        spends = [...spends, pull(led, b, 'pull', Math.floor(r() * 2 ** 32), at, '2026-01-01')];
      } else if (wal.points >= CHOOSE[b][next.rarity]) spends = [...spends, choose(b, next.id, at, '2026-01-01')];
      else break;
    }
  }
  return Infinity;
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const runs = (l: Lifter, n: number, seed: number) => Array.from({ length: n }, (_, i) => weeksToAll(l, seed + i));

describe('pacing: everything in about 6 months at the owner\'s pace', () => {
  it(`a ${TARGET.sessionsPerWeek}×/week lifter owns every buddy and accessory in about ${TARGET.weeks} weeks (median of 15 runs, 22–30)`, () => {
    const ws = runs({ sessions: TARGET.sessionsPerWeek, sets: TARGET.setsPerSession, cardioMin: 0 }, 15, 1000);
    const m = median(ws);
    console.log('1.2x', ws.join(' '), 'median', m, '| prices', PULL, CHOOSE,
      '| 3x', median(runs({ sessions: 3, sets: 17, cardioMin: 45 }, 9, 50)), '| 4x', median(runs({ sessions: 4, sets: 17, cardioMin: 80 }, 9, 70)));
    expect(m).toBeGreaterThanOrEqual(22);
    expect(m).toBeLessThanOrEqual(30);
  });
});
