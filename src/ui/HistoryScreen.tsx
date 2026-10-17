// src/ui/HistoryScreen.tsx
import type { SetsStore } from '../state/useSets';
import { byOrderDone, sessionsByDate, sameExercise } from '../domain/stats';
import { fmtDay, fmtSet, plural } from '../domain/format';
import { localDate } from '../domain/ids';
import type { SetEntry } from '../domain/types';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { paces, sessionMinutes } from '../domain/timing';
import { prIds } from '../domain/records';

function byExercise(sets: SetEntry[]): [string, SetEntry[]][] {
  const out: [string, SetEntry[]][] = [];
  for (const s of sets) {
    const g = out.find(([n]) => sameExercise(n, s.exercise));
    if (g) g[1].push(s); else out.push([s.exercise, [s]]);
  }
  return out.map(([n, xs]) => [n, xs.sort(byOrderDone)]);
}

/** Without onAddTo (a friend's log) it's read-only. `focus`: a day to open and scroll to (a record tapped on a lift's screen). */
export function HistoryScreen({ store, onOpen, onAddTo, focus = null, onFocused }: {
  store: SetsStore; onOpen: (name: string) => void; onAddTo?: (date: string) => void; focus?: string | null; onFocused?: () => void;
}) {
  const sessions = sessionsByDate(store.entries);
  const today = localDate(new Date());
  const pace = useMemo(() => paces(store.entries), [store.entries]);
  const prs = useMemo(() => prIds(store.entries), [store.entries]);
  // Kept from the first render: the caller clears its copy once it's used, and the day stays open.
  const [at] = useState(focus);
  useEffect(() => {
    if (at) document.querySelector(`details.day[data-date="${at}"]`)?.scrollIntoView({ block: 'start' });
    onFocused?.();
  }, []); // once, on arrival
  if (!sessions.length) return (<><h1>History</h1><p className="muted">No history yet — import it under More.</p></>);
  // By month, newest first. This month and last start open (and the newest month, if both are empty); older ones fold.
  const months: { key: string; days: typeof sessions }[] = [];
  for (const s of sessions) {
    const key = s.date.slice(0, 7);
    if (months.at(-1)?.key === key) months.at(-1)!.days.push(s); else months.push({ key, days: [s] });
  }
  const [ty, tm] = today.split('-').map(Number);
  const lastMonth = tm === 1 ? `${ty - 1}-12` : `${ty}-${String(tm - 1).padStart(2, '0')}`;
  const monthName = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return (
    <>
      <h1>History</h1>
      {months.map((mo, mi) => (
      <details className="month" key={mo.key} open={mi === 0 || mo.key >= lastMonth || mo.key === at?.slice(0, 7)}>
        <summary><span>{monthName(mo.key)} · {plural(mo.days.length, 'session')}</span></summary>
      {mo.days.map((s) => {
        const i = sessions.indexOf(s);
        const groups = byExercise(s.sets);
        const mins = sessionMinutes(store.entries, s.date, pace);
        // Cardio counts in minutes, not sets.
        const bouts = s.sets.filter((x) => x.cardio), lifts = s.sets.length - bouts.length;
        const cardio = Math.round(bouts.reduce((a, x) => a + x.cardio!.seconds, 0) / 60);
        return (
          <details className="day" key={s.date} data-date={s.date} open={i === 0 || s.date === at}>
            <summary>
              <span className="day-date">{fmtDay(s.date, today)}</span>
              <span className="muted small">{plural(groups.length, 'exercise')}{(lifts > 0 || !bouts.length) && ` · ${plural(lifts, 'set')}`}{bouts.length > 0 && ` · ${cardio} min cardio`}{mins != null && ` · ${mins} min`}{s.sets.some((x) => prs.has(x.id)) && <>{' '}<span className="tag pr-tag">PR</span></>}</span>
            </summary>
            <div className="day-body">
              {groups.map(([name, sets]) => {
                // Warm-ups would bury the working weights: count them, don't list them.
                const working = sets.filter((x) => !x.flags.includes('warmup'));
                const warm = sets.length - working.length;
                return (
                <button key={name} className="row-button" onClick={() => onOpen(name)}>
                  <b>{name}</b>
                  <span className="muted">
                    {working.map((x, j) => <Fragment key={x.id}>{j > 0 && ', '}<span className="nw">{fmtSet(x)}{prs.has(x.id) && <>{' '}<span className="tag pr-tag">PR</span></>}{x.flags.includes('pain') && <>{' '}<span className="pain-mark">pain</span></>}{x.tags?.map((t) => <Fragment key={t}>{' '}<span className="tag own">{t}</span></Fragment>)}</span></Fragment>)}
                    {warm > 0 && `${working.length ? ' + ' : ''}${plural(warm, 'warm-up')}`}
                  </span>
                  {sets.filter((x) => x.note).map((x) => <span key={x.id} className="muted">“{x.note}”</span>)}
                </button>
                );
              })}
              {onAddTo && <button className="wide" onClick={() => onAddTo(s.date)}>Add to this day</button>}
            </div>
          </details>
        );
      })}
      </details>
      ))}
    </>
  );
}
