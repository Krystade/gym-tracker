import { useMemo } from 'react';
import type { SetEntry } from '../domain/types';
import { byOrderDone, dayOrder, sameExercise } from '../domain/stats';
import { prSetIds } from '../domain/summary';
import { SetRowContent } from './SetRow';
import { SessionSummary } from './SessionSummary';
import type { StripDay } from './readyView';
import type { SettingsStore } from '../state/useSettings';
import { isHoldLift } from '../domain/care';
import { suggest } from '../domain/suggest';
import { cardioTarget } from '../domain/cardio';
import { targetLine } from './ExerciseCard';

// Owner, 2026-10-23: "When tapping a day in my week line, it should move from today to that day so I can review what I did."
// The day tapped shows in today's place on Today, read only: no set form, so no rest and no next set. Fixing a set stays in
// History's ⋯ › Fix sets.

/** A day before today: each lift's sets as its card on Today lists them, in the order done, then the day's summary. */
export function PastDay({ entries, date, onOpen }: { entries: SetEntry[]; date: string; onOpen: (name: string) => void }) {
  const lifts = useMemo(() => dayOrder(entries, date), [entries, date]);
  const prs = useMemo(() => prSetIds(entries, date), [entries, date]);
  if (!lifts.length) return <p className="muted">Nothing logged that day.</p>;
  return (
    <>
      {lifts.map((n) => {
        const sets = entries.filter((e) => e.date === date && sameExercise(e.exercise, n)).sort(byOrderDone);
        return (
          <section key={n} className="card review-card" aria-label={n}>
            <header className="card-head"><button className="link" onClick={() => onOpen(n)}>{n}</button></header>
            <ol className="sets" aria-label={`Sets for ${n}`}>
              {sets.map((s, i) => <li key={s.id}><div className="set-row"><SetRowContent s={s} no={i + 1} estRir={null} pr={prs.has(s.id)} /></div></li>)}
            </ol>
          </section>
        );
      })}
      <SessionSummary entries={entries} date={date} past />
      <p className="muted small review-note">To change a set: History › the day’s ⋯ › Fix sets.</p>
    </>
  );
}

/**
 * A day after today: the week plan's session for it and its lifts, each with the target its card would show that day (owner,
 * 2026-10-23: "should be allowed to see the expected weights"), or why it's a rest day.
 */
export function PlannedDay({ d, label, entries, settings }: { d: StripDay | undefined; label: string; entries: SetEntry[]; settings: SettingsStore }) {
  const train = !!d && d.mark !== 'rest' && d.mark !== 'missed';
  return (
    <section className="card review-plan" aria-label={`Plan for ${label}`}>
      {train ? <>
        <h2>{d.session ?? 'Train'}{d.mark === 'light' && <span className="muted"> · light</span>}</h2>
        {d.slots?.length ? (
          <ol className="review-slots" aria-label="Planned exercises">
            {d.slots.map((s) => <li key={s.exercise}><b>{s.exercise}</b><span className="muted small review-target">{s.minutes != null
              ? cardioTarget(entries, s.exercise, s.minutes, d.date).text
              : targetLine(suggest(entries, s.exercise, settings.get(s.exercise, isHoldLift(s.exercise, entries)), d.date, s.sets, d.mark === 'light'))}</span></li>)}
          </ol>
        ) : <p className="muted">Nothing planned yet.</p>}
      </> : <>
        <h2>Rest</h2>
        {d?.why && <p className="muted">{d.why}</p>}
      </>}
    </section>
  );
}
