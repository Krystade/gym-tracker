import { useState } from 'react';
import { plural } from '../domain/format';
import type { persistentPain } from '../domain/painPlan';
import { settingsKey } from '../domain/progression';
import { getPref, setPref } from '../state/prefs';

// A lift likelier than not to hurt next time (domain/painPlan persistentPain, item 08 b), before its first working set today: a
// swap for a while is offered, never made. Dismiss hides it until the lift hurts again (kept per profile on this phone, with the
// latest pain's date). Patterns and options only: never a diagnosis.

const prefName = (lift: string) => `suggest:pain:${settingsKey(lift)}`;

/** `lastPain`: the date of the lift's latest pain. `onSwap` absent: not in today's plan, so the words only. */
export function PainPrompt({ owner, lift, pain, lastPain, onSwap }: {
  owner: string; lift: string; pain: NonNullable<ReturnType<typeof persistentPain>>; lastPain: string; onSwap?: () => void;
}) {
  const [, bump] = useState(0);
  if (getPref<string>(owner, prefName(lift)) === lastPain) return null;
  return (
    <div className="target-suggest pain-suggest" role="group" aria-label="Pain keeps coming back">
      <p><b>{lift} hurt in {pain.hurt} of your last {plural(pain.of, 'session')}</b> — {onSwap ? <>swap it for a while?</> : <>worth a swap for a while.</>}</p>
      <p className="muted small">From your own log: how often pain comes back on a lift, and how fast it fades, put it at likelier than not to hurt next time.</p>
      <div className="target-suggest-actions">
        {onSwap && <button type="button" className="primary" onClick={onSwap}>Swap {lift}</button>}
        <button type="button" onClick={() => { setPref(owner, prefName(lift), lastPain); bump((n) => n + 1); }}>Dismiss</button>
      </div>
    </div>
  );
}
