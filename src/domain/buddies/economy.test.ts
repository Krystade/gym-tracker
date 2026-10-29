import { describe, expect, it } from 'vitest';
import { CHOOSE, choose, ledgerOf, pull, PULL, rng, starter, starterOffer, walletOf, type Spend } from './gacha';
import { ACCESSORIES, BUDDIES, POOL, type Banner } from './roster';

// Pacing (owner 2026-10-28: everything earnable in about 6 months). A synthetic lifter, seeded: 17 working sets a session,
// +5 a session, +20 for the 85% of weeks the goal is met, 1 per 3 cardio minutes, and about 15 points a week of bronze and
// silver achievements with a ticket every 6 weeks. The player gambles, and once what's missing in a banner costs no more to
// choose than the bank holds, chooses it. Rewards and income are the ones domain/buddies/points and rewards pay.

interface Lifter { sessions: number; cardioMin: number }
function weeksToAll(l: Lifter, seed: number): number {
  const r = rng(seed);
  let spends: Spend[] = [starter(starterOffer(seed)[0], 0, '2026-01-01')], pts = 0, tickets = 0, carry = 0, t = 1;
  const total = BUDDIES.length + ACCESSORIES.length;
  for (let w = 1; w <= 156; w++) {
    carry += l.sessions; const s = Math.floor(carry); carry -= s;
    pts += s * 17 + 5 * s + (r() < 0.85 ? 20 : 0) + Math.floor(l.cardioMin / 3) + 15;
    if (w % 6 === 0) tickets++;
    const spend = (x: Spend) => { spends = [...spends, x]; };
    for (;;) {
      const led = ledgerOf(spends), wal = walletOf({ points: pts, tickets }, led);
      if (led.owned.size >= total) return w;
      const left = (b: Banner) => POOL[b].filter((x) => !led.owned.has(x.id));
      const b: Banner = left('buddy').length ? 'buddy' : 'acc';
      const cost = left(b).reduce((a, x) => a + CHOOSE[b][x.rarity], 0);
      if (wal.tickets > 0) spend(pull(led, b, 'ticket', Math.floor(r() * 2 ** 32), t++, '2026-01-01'));
      else if (cost <= wal.points) { for (const x of left(b)) spend(choose(b, x.id, t++, '2026-01-01')); }
      else if (wal.points >= PULL[b]) spend(pull(led, b, 'pull', Math.floor(r() * 2 ** 32), t++, '2026-01-01'));
      else break;
    }
  }
  return Infinity;
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

describe('pacing: everything in about 6 months', () => {
  it('a 3×/week lifter owns every buddy and accessory in about 26 weeks (median of 15 runs, 20–32)', () => {
    const ws = Array.from({ length: 15 }, (_, i) => weeksToAll({ sessions: 3, cardioMin: 45 }, 1000 + i));
    const m = median(ws);
    console.log('3x', ws.join(' '), 'median', m, '| 4x', median(Array.from({ length: 9 }, (_, i) => weeksToAll({ sessions: 4, cardioMin: 80 }, 50 + i))),
      '| 1.2x', median(Array.from({ length: 9 }, (_, i) => weeksToAll({ sessions: 1.2, cardioMin: 0 }, 70 + i))));
    expect(m).toBeGreaterThanOrEqual(20);
    expect(m).toBeLessThanOrEqual(32);
  });
});
