import { fmtDay } from '../domain/format';
import { LIGHT, LIGHT_DAYS, RECENT, type Systemic } from '../domain/learn/deload';

// Item 06 on Today. When his fatigue-adjusted strength is down across lifts and a second signal agrees (learn/deload), a light week
// is offered, never started by itself: Start light week, or Not now (it stays away a week). While the week is on, one line says
// so, with its end, and a way to end it early.

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)} %`;
const list = (xs: string[]) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

export function DeloadPrompt({ s, onStart, onLater }: { s: Systemic; onStart: () => void; onLater: () => void }) {
  const down = s.lifts.filter((l) => l.pooled.mean < 0).sort((a, b) => a.pooled.mean - b.pooled.mean);
  const named = down.slice(0, 3).map((l) => l.name);
  const more = down.length - named.length;
  const why = [
    s.energy?.low && <>your energy is lower than usual ({s.energy.recent} against {s.energy.usual})</>,
    s.pain.length >= 2 && <>you’ve had aches in {list(s.pain)}</>,
  ].filter(Boolean);
  return (
    <div className="target-suggest deload-suggest" role="group" aria-label="Light week">
      <p><b>Down across your lifts, about {pct(s.shift.mean)}</b> — that points to fatigue, not the lifts. Take a light week?</p>
      <p className="muted small">
        {list(named)}{more > 0 && ` and ${more} more`} {down.length === 1 ? 'is' : 'are'} below where {down.length === 1 ? 'it was' : 'they were'} (fatigue-adjusted, your last {RECENT} sessions of each),
        and {why.map((w, i) => <span key={i}>{i > 0 && ' and '}{w}</span>)}. Switching lifts waits till it’s done.
      </p>
      <p className="small">{LIGHT_DAYS} days: half the sets, about {Math.round(LIGHT.load * 100)} % lighter, stop about {LIGHT.rir} short. Then your targets pick up where they were.</p>
      <div className="target-suggest-actions">
        <button type="button" className="primary" onClick={onStart}>Start light week</button>
        <button type="button" onClick={onLater}>Not now</button>
      </div>
    </div>
  );
}

export function LightWeekLine({ to, today, onEnd }: { to: string; today: string; onEnd: () => void }) {
  return (
    <p className="card note-card light-week" role="status">
      <span><b>Light week</b> till {fmtDay(to, today)} · half the sets, lighter, stop about {LIGHT.rir} short</span>
      <button className="mini" style={{ whiteSpace: 'nowrap' }} onClick={onEnd}>End it</button>
    </p>
  );
}
