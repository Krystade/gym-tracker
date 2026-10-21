import { MUSCLES, type Muscle } from '../../domain/muscles';
import { weekStatus } from '../../domain/analytics';
import { targetFor, type Profile, type Tier } from '../../domain/profile';

const ICON = { under: '▽', pace: '·', on: '✓', over: '▲' } as const;
const WORD = { under: 'under', pace: 'on pace', on: 'on target', over: 'over' } as const;
const fmt = (n: number) => (n % 1 ? n.toFixed(1) : String(n));

const RANK = { under: 0, pace: 1, on: 2, over: 3 } as const;
/** Muscles that need sets first, the order kept within each status. */
export const paceOrder = <M,>(ms: M[], st: (m: M) => keyof typeof RANK): M[] =>
  ms.map((m, i) => [m, RANK[st(m)], i] as const).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([m]) => m);

/** A muscle's week so far (domain/analytics weekStatus): short of its target but within what the sessions `left` can add, `reach` each, is "on pace". */
export const paceStatus = (value: number, range: [number, number], left?: number, reach?: number) => weekStatus(value, range, left, reach);

// `left` (the sessions the week has left) is for the current week only (Stats); a built program has no "so far", so Program
// leaves it out. `reach`: what a session left can add to each muscle (feed weekPace).
export function MuscleBars({ sets, profile, left, reach }: { sets: Record<Muscle, number>; profile: Profile; left?: number; reach?: Record<Muscle, number> }) {
  const max = Math.max(...MUSCLES.map((m) => Math.max(sets[m], targetFor(profile, m)[1])), 1);
  const pct = (v: number) => `${(100 * v) / max}%`;
  return (
    <>
      {([1, 2, 3, 4] as Tier[]).map((tier) => {
        const tierMs = MUSCLES.filter((m) => profile.tiers[m] === tier);
        // On Stats, what's behind this week comes first in each tier, where you look before the gym.
        const ms = left === undefined ? tierMs : paceOrder(tierMs, (m) => paceStatus(sets[m], targetFor(profile, m), left, reach?.[m]));
        if (!ms.length) return null;
        return (
          <div key={tier} className="tier">
            <h3>Priority {tier}</h3>
            {ms.map((m) => {
              const [lo, hi] = targetFor(profile, m);
              const st = paceStatus(sets[m], [lo, hi], left, reach?.[m]);
              return (
                <div key={m} className="mrow" aria-label={`${m}: ${fmt(sets[m])} sets, target ${lo}–${hi}, ${WORD[st]}`}>
                  <span className="mname">{m}</span>
                  <span className="mtrack" aria-hidden="true">
                    <span className="mband" style={{ left: pct(lo), width: pct(hi - lo) }} />
                    <span className="mbar" style={{ width: pct(sets[m]) }} />
                  </span>
                  <span className="mval">{fmt(sets[m])}<span className="mtarget"> / {lo}–{hi}</span></span>
                  <span className={`mstat ${st}`}><b aria-hidden="true">{ICON[st]}</b> <span className="mword">{WORD[st]}</span></span>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
