import { useState } from 'react';
import { PHASES, predictPhase } from '../domain/cycle';
import { useCycle } from '../state/useCycle';

/**
 * Today, under Energy, when the setting is on: one tap saves the day's phase, a second clears it. With enough logged cycles the
 * likely phase gets a faint dashed outline; it isn't pressed and saves nothing until it's tapped. Private: never shown to friends.
 */
export function CycleRow({ date }: { date: string }) {
  const c = useCycle();
  if (!c.tracking) return null;
  const cur = c.days[date];
  const guess = cur ? null : predictPhase(c.days, date);
  return (
    <>
      <div className="chips energy cycle" role="group" aria-label="Cycle">
        <span className="chip-label">Cycle</span>
        {PHASES.map(([p, label]) => (
          <button key={p} type="button" className={guess === p ? 'chip predicted' : 'chip'} aria-pressed={cur === p} onClick={() => void c.setPhase(date, cur === p ? null : p)}>{label}</button>
        ))}
      </div>
      {c.error && <p className="warn small" role="alert">{c.error}</p>}
    </>
  );
}

/** The setting, on the Data screen. Off hides the row on Today and keeps what's logged; Delete clears it here and in the account. */
export function CycleCard() {
  const c = useCycle();
  const [asking, setAsking] = useState(false);
  const any = Object.keys(c.days).length > 0;
  return (
    <section className="card" aria-labelledby="cycle-h">
      <div className="cycle-setting">
        <h2 id="cycle-h">Track cycle phase</h2>
        <button type="button" role="switch" className="switch" aria-checked={c.tracking} aria-label="Track cycle phase" onClick={() => void c.setOn(!c.tracking)} />
      </div>
      <p className="muted small">One tap on Today, under Energy. Only you see it: never your friends, never a shared page. Off hides it and keeps what you logged.</p>
      {any && !asking && <button className="wide danger" onClick={() => setAsking(true)}>Delete cycle data</button>}
      {asking && (
        <div className="confirm-delete">
          <p className="warn">Deletes every cycle day on this phone and in your account.</p>
          <div className="form-actions">
            <button onClick={() => setAsking(false)}>Cancel</button>
            <button className="danger" onClick={() => { void c.wipe(); setAsking(false); }}>Delete cycle data</button>
          </div>
        </div>
      )}
      {c.error && <p className="warn small" role="alert">{c.error}</p>}
    </section>
  );
}
