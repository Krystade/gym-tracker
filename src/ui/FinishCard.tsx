import { useMemo, type CSSProperties } from 'react';
import { addDays } from '../domain/analytics';
import type { BodyDay } from '../domain/body';
import { isHoldLift } from '../domain/care';
import { finishSummary, nextUp } from '../domain/finish';
import { fmtSet, fmtWeight } from '../domain/format';
import { volumeAdvice } from '../domain/learn/volume';
import type { DayPlan, Program } from '../domain/program';
import type { Profile } from '../domain/profile';
import { nextTarget } from '../domain/progression';
import { daySets, sameExercise } from '../domain/stats';
import type { SetEntry } from '../domain/types';
import { zone } from '../push/activity';
import { tappedLight } from '../state/lightWeek';
import type { SettingsStore } from '../state/useSettings';
import { Icon } from './icons';

// The plan, turned into the day's summary once it's done (owner, 2026-10-20): on Finish, by itself once the session has gone
// quiet, or as everything planned is done. A card in the plan's place on Today, never over anything (the phone is his alone,
// but a sheet would still take the screen for nothing). "Add more" brings the plan back.

const half = (n: number) => fmtWeight(Math.round(n * 2) / 2);
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** A day `k` days after `date`, as said on `today`: today, tomorrow, or its weekday. */
function when(date: string, k: number, today: string): string {
  const d = addDays(date, k);
  return d === today ? 'today' : d === addDays(today, 1) ? 'tomorrow' : WEEKDAY[new Date(`${d}T12:00:00Z`).getUTCDay()];
}

/**
 * A session before today's that closed while the app was away (IA A1, owner 2026-10-21): one line, "Tue’s workout · 12 sets ·
 * 34 min", and a tap opens that day in History, where the whole session is.
 */
export function LastWorkoutLine({ entries, date, today, profile, onOpen }: { entries: SetEntry[]; date: string; today: string; profile: Profile; onOpen: () => void }) {
  const s = useMemo(() => finishSummary(entries, date, profile), [entries, date, profile]);
  const day = date === addDays(today, -1) ? 'Yesterday' : WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return (
    <section className="past-workout" aria-label="Last workout">
      <button type="button" className="card past-line" onClick={onOpen}>
        <span className="past-line-t"><b>{day}’s workout</b><span> · {s.sets} {s.sets === 1 ? 'set' : 'sets'}{s.minutes != null && ` · ${s.minutes} min`}</span></span>
        <span className="past-line-go">History<Icon name="chev-right" size={18} sw={2} /></span>
      </button>
    </section>
  );
}

/** `how`: closed by Finish or by going quiet, or (null) only the plan done. `planName`: the day's (Day A, Quick). `onMore`: "Add more". */
export function FinishCard({ entries, date, today, profile, program, plans, planName, how, body, settings, owner, onMore }: {
  entries: SetEntry[]; date: string; today: string; profile: Profile; program: Program | null; plans: DayPlan[]; planName?: string;
  how: 'finish' | 'auto' | null; body: readonly BodyDay[]; settings: SettingsStore; owner: string; onMore?: () => void;
}) {
  const s = useMemo(() => finishSummary(entries, date, profile), [entries, date, profile]);
  const up = useMemo(() => nextUp(entries, program, plans, date, zone()), [entries, program, plans, date]);
  // What the learning layer says for next time: the lifts done today whose next target goes up, and the volume steps (item 07)
  // for the muscles trained today.
  const higher = useMemo(() => {
    const names: string[] = [];
    for (const e of daySets(entries, date)) if (!names.some((n) => sameExercise(n, e.exercise))) names.push(e.exercise);
    return names.flatMap((ex) => {
      const t = nextTarget(entries, ex, settings.get(ex, isHoldLift(ex, entries)), addDays(date, 1));
      return t?.kind === 'increase' && t.weight > 0 ? [`${ex} ${fmtWeight(t.weight)} lb`] : [];
    }).slice(0, 3);
  }, [entries, date, settings]);
  const steps = useMemo(() => {
    const a = volumeAdvice(entries, body, profile, today, tappedLight(owner));
    return (a?.muscles ?? []).filter((m) => m.kind === 'raise' && s.muscles.some((x) => x.muscle === m.muscle)).slice(0, 3);
  }, [entries, body, profile, today, owner, s.muscles]);

  const title = `${how ? 'Workout done' : 'Plan done'}${planName ? ` · ${planName}` : ''}`;
  const next = [up.day, up.inDays != null && when(date, up.inDays, today)].filter(Boolean).join(' · ');
  return (
    <section className="card finish-card" aria-label="Workout summary">
      <div className="finish-head">
        <h2><Icon name="check" size={20} sw={2.5} />{title}</h2>
      </div>
      {how === 'auto' && <p className="muted small finish-why">Closed after a quiet spell. Log a set to pick it back up.</p>}
      <dl className="finish-stats">
        <div><dt>Sets</dt><dd>{s.sets}{s.bouts > 0 && <small> +{s.bouts} cardio</small>}</dd></div>
        <div><dt>Tonnage</dt><dd>{s.tonnage.toLocaleString('en-US')}<small> lb</small></dd></div>
        <div><dt>Time</dt><dd>{s.minutes != null ? <>{s.minutes}<small> min</small></> : '—'}</dd></div>
      </dl>
      {s.prs.length > 0 && (
        <ul className="finish-prs" aria-label="PRs">
          {s.prs.map((p) => <li key={p.exercise}><span className="tag pr-tag">PR</span><b>{p.exercise}</b><span className="nw">{fmtSet(p.set)}</span></li>)}
        </ul>
      )}
      {s.muscles.length > 0 && (
        <>
          <h3 className="finish-sub">This week, against your targets</h3>
          <ul className="finish-muscles" aria-label="Sets per muscle this week">
            {s.muscles.map((m) => (
              <li key={m.muscle} className={m.status} aria-label={`${m.muscle}: ${half(m.week)} sets this week, of ${half(m.band[0])} to ${half(m.band[1])}`}>
                <span>{m.muscle}</span>
                <span className="finish-bar-track" aria-hidden="true" style={{ '--lo': `${Math.min(100, (100 * m.band[0]) / Math.max(m.band[1], 1))}%` } as CSSProperties}>
                  <i style={{ width: `${Math.min(100, (100 * m.week) / Math.max(m.band[1], 1))}%` }} />
                </span>
                <span className="nw">{half(m.week)} <small>of {half(m.band[0])}–{half(m.band[1])}</small></span>
              </li>
            ))}
          </ul>
        </>
      )}
      {(next || higher.length > 0 || steps.length > 0) && (
        <div className="finish-next" aria-label="Next">
          {next && <p><b>Next:</b> {next}</p>}
          {higher.length > 0 && <p className="muted small">Go up next time: {higher.join(' · ')}</p>}
          {steps.length > 0 && <p className="muted small">Next 3 weeks: {steps.map((m) => `${m.muscle} ${half(m.base!)} → ${half(m.aim!)} a week`).join(' · ')}</p>}
        </div>
      )}
      {onMore && <button type="button" className="wide finish-more" onClick={onMore}>Add more</button>}
    </section>
  );
}
