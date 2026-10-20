import { useMemo, useState } from 'react';
import { activeProfileDb } from '../db/db';
import type { BodyDay } from '../domain/body';
import { BASE_WEEKS, volumeAdvice, type MuscleVolume, type Why } from '../domain/learn/volume';
import type { Profile } from '../domain/profile';
import type { SetEntry } from '../domain/types';
import { tappedLight } from '../state/lightWeek';

// Item 07 on Stats: the muscles below their weekly range, each with its next step (+20 % of his last 3 weeks, toward the range),
// or held while something says he isn't recovering. Nothing is applied: it says what to aim at. Shown only when there's a step.

const fmt = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));
const ALL: Partial<Record<Why, (e: { recent: number; usual: number } | null) => string>> = {
  deload: () => 'you’re down across your lifts and tired, so a light week comes first',
  light: () => 'a light week is on',
  down: () => 'you’re down across your lifts lately',
  energy: (e) => `your energy is lower than usual${e ? ` (${e.recent} against ${e.usual})` : ''}`,
};
const own = (x: MuscleVolume) => x.why === 'decline' ? `its lifts are down ${Math.max(1, Math.round(-100 * (x.decline?.shift.mean ?? 0)))} % lately`
  : x.why === 'pain' ? `${x.lift} is likely to hurt` : '';

export function VolumeSteps({ entries, body, profile, today }: { entries: SetEntry[]; body: readonly BodyDay[]; profile: Profile; today: string }) {
  const [owner] = useState(activeProfileDb);
  const a = useMemo(() => volumeAdvice(entries, body, profile, today, tappedLight(owner)), [entries, body, profile, today, owner]);
  const rows = a?.muscles.filter((x) => x.kind === 'raise' || x.kind === 'hold') ?? [];
  if (!a || !rows.length) return null;
  // Priority 1 first, as the bars above.
  rows.sort((x, y) => profile.tiers[x.muscle] - profile.tiers[y.muscle]);
  const whole = rows.find((x) => x.why && ALL[x.why])?.why;
  return (
    <div className="target-suggest volume-steps" role="group" aria-label="Next 3 weeks">
      <p><b>Next {BASE_WEEKS} weeks</b> · {whole ? <>held at your last {BASE_WEEKS}: {ALL[whole]!(a.energy)}.</> : <>20 % more than your last {BASE_WEEKS}, toward each target.</>}</p>
      <ul className="target-suggest-changes" aria-label="Weekly sets to aim at">
        {rows.map((x) => (
          <li key={x.muscle} className={x.kind} aria-label={`${x.muscle}: ${fmt(x.base!)} sets a week, ${x.kind === 'raise' ? `aim at ${fmt(x.aim!)}` : `held${own(x) ? `, ${own(x)}` : ''}`}`}>
            <span>{x.muscle}</span><span>{fmt(x.base!)}/wk</span>
            <span>{x.kind === 'raise' ? <>→ <b>{fmt(x.aim!)}</b></> : 'held'}</span>
            {own(x) && <small>{own(x)}</small>}
          </li>
        ))}
      </ul>
      <p className="muted small">More at once hasn’t added muscle in trained lifters. A stall changes the lift, not the sets.</p>
    </div>
  );
}
