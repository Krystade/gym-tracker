import { MUSCLES, type Muscle } from '../../domain/muscles';
import { status, targetFor, type Profile, type Tier } from '../../domain/profile';

const ICON = { under: '▽', on: '✓', over: '▲' } as const;
const WORD = { under: 'under', on: 'on target', over: 'over' } as const;
const fmt = (n: number) => (n % 1 ? n.toFixed(1) : String(n));

export function MuscleBars({ sets, profile }: { sets: Record<Muscle, number>; profile: Profile }) {
  const max = Math.max(...MUSCLES.map((m) => Math.max(sets[m], targetFor(profile, m)[1])), 1);
  const pct = (v: number) => `${(100 * v) / max}%`;
  return (
    <>
      {([1, 2, 3, 4] as Tier[]).map((tier) => {
        const ms = MUSCLES.filter((m) => profile.tiers[m] === tier);
        if (!ms.length) return null;
        return (
          <div key={tier} className="tier">
            <h3>Priority {tier}</h3>
            {ms.map((m) => {
              const [lo, hi] = targetFor(profile, m);
              const st = status(sets[m], [lo, hi]);
              return (
                <div key={m} className="mrow" aria-label={`${m}: ${fmt(sets[m])} sets, target ${lo}–${hi}, ${WORD[st]}`}>
                  <span className="mname">{m}</span>
                  <span className="mtrack" aria-hidden="true">
                    <span className="mband" style={{ left: pct(lo), width: pct(hi - lo) }} />
                    <span className="mbar" style={{ width: pct(sets[m]) }} />
                  </span>
                  <span className="mval">{fmt(sets[m])}</span>
                  <span className={`mstat ${st}`}><b aria-hidden="true">{ICON[st]}</b> {WORD[st]}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
