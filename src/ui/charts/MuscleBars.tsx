import { MUSCLES, type Muscle } from '../../domain/muscles';
import { status, targetFor, type Profile, type Tier } from '../../domain/profile';

const ICON = { under: '▽', pace: '·', on: '✓', over: '▲' } as const;
const WORD = { under: 'under', pace: 'on pace', on: 'on target', over: 'over' } as const;
const fmt = (n: number) => (n % 1 ? n.toFixed(1) : String(n));

/** How much of the training week is behind us: the days before today (Mon = 0), so a Monday asks for nothing yet. */
export function weekPace(today: string): number {
  const dow = (new Date(today + 'T00:00:00').getDay() + 6) % 7;
  return dow / 7;
}

const RANK = { under: 0, pace: 1, on: 2, over: 3 } as const;
/** Muscles that need sets first, the order kept within each status. */
export const paceOrder = <M,>(ms: M[], st: (m: M) => keyof typeof RANK): M[] =>
  ms.map((m, i) => [m, RANK[st(m)], i] as const).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([m]) => m);

/** `status`, except that a muscle short of its target but keeping up with the week so far is "on pace", not "under". */
export function paceStatus(value: number, range: [number, number], pace?: number): 'under' | 'pace' | 'on' | 'over' {
  const st = status(value, range);
  return st === 'under' && pace !== undefined && value >= range[0] * pace ? 'pace' : st;
}

// `pace` is for the current week only (Stats); a built program has no "so far", so Program leaves it out.
export function MuscleBars({ sets, profile, pace }: { sets: Record<Muscle, number>; profile: Profile; pace?: number }) {
  const max = Math.max(...MUSCLES.map((m) => Math.max(sets[m], targetFor(profile, m)[1])), 1);
  const pct = (v: number) => `${(100 * v) / max}%`;
  return (
    <>
      {([1, 2, 3, 4] as Tier[]).map((tier) => {
        const tierMs = MUSCLES.filter((m) => profile.tiers[m] === tier);
        // On Stats, what's behind this week comes first in each tier, where you look before the gym.
        const ms = pace === undefined ? tierMs : paceOrder(tierMs, (m) => paceStatus(sets[m], targetFor(profile, m), pace));
        if (!ms.length) return null;
        return (
          <div key={tier} className="tier">
            <h3>Priority {tier}</h3>
            {ms.map((m) => {
              const [lo, hi] = targetFor(profile, m);
              const st = paceStatus(sets[m], [lo, hi], pace);
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
