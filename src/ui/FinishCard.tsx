import { useMemo, type CSSProperties } from 'react';
import { addDays } from '../domain/analytics';
import type { BodyDay } from '../domain/body';
import { isHoldLift } from '../domain/care';
import { finishSummary, nextUp } from '../domain/finish';
import { fmtDay, fmtSet, fmtWeight } from '../domain/format';
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
 * `how`: closed by Finish or by going quiet, or (null) only the plan done. `planName`: the day's (Day A, Quick); `past`: a session
 * before today's, shown the next time the app is opened after it closed by itself (`onDismiss`); else `onMore`, "Add more".
 */
export function FinishCard({ entries, date, today, profile, program, plans, planName, how, body, settings, owner, onMore, onDismiss }: {
  entries: SetEntry[]; date: string; today: string; profile: Profile; program: Program | null; plans: DayPlan[]; planName?: string;
  how: 'finish' | 'auto' | null; body: readonly BodyDay[]; settings: SettingsStore; owner: string; onMore?: () => void; onDismiss?: () => void;
}) {
  const past = date < today;
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

  const title = past ? `Last workout · ${fmtDay(date, today)}` : `${how ? 'Workout done' : 'Plan done'}${planName ? ` · ${planName}` : ''}`;
  const next = [up.day, up.inDays != null && when(date, up.inDays, today)].filter(Boolean).join(' · ');
  return (
    <section className="card finish-card" aria-label={past ? 'Last workout' : 'Workout summary'}>
      <div className="finish-head">
        <h2><Icon name="check" size={20} sw={2.5} />{title}</h2>
        {onDismiss && <button type="button" className="mini icon" aria-label="Dismiss last workout" onClick={onDismiss}><Icon name="close" size={20} /></button>}
      </div>
      {how === 'auto' && !past && <p className="muted small finish-why">Closed after a quiet spell. Log a set to pick it back up.</p>}
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
