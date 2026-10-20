// src/ui/HistoryScreen.tsx
import type { SetsStore } from '../state/useSets';
import { byOrderDone, sessionsByDate, sameExercise, type Session } from '../domain/stats';
import { fmtDay, fmtSet, plural } from '../domain/format';
import { localDate } from '../domain/ids';
import type { SetEntry } from '../domain/types';
import { Fragment, memo, useEffect, useMemo, useState } from 'react';
import { paces, sessionMinutes, usualGap } from '../domain/timing';
import { prIds } from '../domain/records';
import { andList, supersets } from '../domain/superset';
import { notSupersets } from '../state/notSuperset';
import { activeProfileDb } from '../db/db';
import { Icon } from './icons';

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
  const sessions = useMemo(() => sessionsByDate(store.entries), [store.entries]);
  const today = localDate(new Date());
  const pace = useMemo(() => paces(store.entries), [store.entries]);
  const prs = useMemo(() => prIds(store.entries), [store.entries]);
  // Each set done in a superset, and the lifts it went with: worked out for a day when that day is shown, not for every
  // day in the log. "Not a superset" is this phone's own: a friend's log has none.
  const own = onAddTo != null;
  const supersetsOn = useMemo(() => {
    const owner = own ? activeProfileDb() : null, days = new Map<string, SetEntry[]>(), done = new Map<string, Map<string, string[]>>();
    for (const e of store.entries) if (e.loggedAt) { const d = days.get(e.date); if (d) d.push(e); else days.set(e.date, [e]); }
    return (date: string): Map<string, string[]> => {
      let out = done.get(date);
      if (out) return out;
      out = new Map();
      const day = days.get(date) ?? [];
      for (const g of supersets(day, date, (ex) => usualGap(pace, ex), { dismissed: owner ? notSupersets(owner, date) : [] })) {
        for (const id of g.after.keys()) {
          const ex = day.find((e) => e.id === id)!.exercise;
          out.set(id, g.lifts.filter((x) => !sameExercise(x, ex)));
        }
      }
      done.set(date, out);
      return out;
    };
  }, [store.entries, pace, own]);
  // Kept from the first render: the caller clears its copy once it's used, and the day stays open.
  const [at] = useState(focus);
  useEffect(() => {
    if (at) document.querySelector(`details.day[data-date="${at}"]`)?.scrollIntoView({ block: 'start' });
    onFocused?.();
  }, []); // once, on arrival
  // Folded months opened since History was: a month's days go on the page only once it's open (years of days are tens of
  // thousands of nodes). The tap that opens one renders them before it opens, so it never shows empty for a frame.
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  const show = (key: string) => setShown((xs) => (xs.has(key) ? xs : new Set(xs).add(key)));
  // By month, newest first. This month and last start open (and the newest month, if both are empty); older ones fold.
  const months = useMemo(() => {
    const out: { key: string; days: Session[] }[] = [];
    for (const s of sessions) {
      const key = s.date.slice(0, 7);
      if (out.at(-1)?.key === key) out.at(-1)!.days.push(s); else out.push({ key, days: [s] });
    }
    return out;
  }, [sessions]);
  if (!sessions.length) return (<><h1>History</h1><p className="muted">No history yet — import it under More.</p></>);
  const [ty, tm] = today.split('-').map(Number);
  const lastMonth = tm === 1 ? `${ty - 1}-12` : `${ty}-${String(tm - 1).padStart(2, '0')}`;
  const monthName = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return (
    <>
      <h1>History</h1>
      {months.map((mo, mi) => {
        const open = mi === 0 || mo.key >= lastMonth || mo.key === at?.slice(0, 7), rendered = open || shown.has(mo.key);
        return (
          <details className="month" key={mo.key} open={open} onToggle={rendered ? undefined : (e) => { if (e.currentTarget.open) show(mo.key); }}>
            <summary onClick={rendered ? undefined : () => show(mo.key)}><span>{monthName(mo.key)} · {plural(mo.days.length, 'session')}</span></summary>
            {rendered && mo.days.map((s) => (
              <Day key={s.date} s={s} open={s === sessions[0] || s.date === at} today={today} prs={prs} supersetsOn={supersetsOn} onOpen={onOpen} onAddTo={onAddTo} />
            ))}
          </details>
        );
      })}
    </>
  );
}

/** A day: what it was in a line, and each lift's sets under it. Rendered again only when something it shows changes. */
const Day = memo(function Day({ s, open, today, prs, supersetsOn, onOpen, onAddTo }: {
  s: Session; open: boolean; today: string; prs: Set<string>; supersetsOn: (date: string) => Map<string, string[]>;
  onOpen: (name: string) => void; onAddTo?: (date: string) => void;
}) {
  const groups = byExercise(s.sets);
  // The day's own sets are all of its date's: no need to read the whole log for each day.
  const mins = sessionMinutes(s.sets, s.date);
  const grouped = supersetsOn(s.date);
  // Cardio counts in minutes, not sets.
  const bouts = s.sets.filter((x) => x.cardio), lifts = s.sets.length - bouts.length;
  const cardio = Math.round(bouts.reduce((a, x) => a + x.cardio!.seconds, 0) / 60);
  return (
    <details className="day" data-date={s.date} open={open}>
      <summary>
        <span className="day-date">{fmtDay(s.date, today)}</span>
        <span className="muted small">{plural(groups.length, 'exercise')}{(lifts > 0 || !bouts.length) && ` · ${plural(lifts, 'set')}`}{bouts.length > 0 && ` · ${cardio} min cardio`}{mins != null && ` · ${mins} min`}{s.sets.some((x) => prs.has(x.id)) && <>{' '}<span className="tag pr-tag">PR</span></>}</span>
      </summary>
      <div className="day-body">
        {groups.map(([name, sets]) => {
          // Warm-ups would bury the working weights: count them, don't list them.
          const working = sets.filter((x) => !x.flags.includes('warmup'));
          const warm = sets.length - working.length;
          const with_ = sets.map((x) => grouped.get(x.id)).find((w) => w?.length);
          return (
          <button key={name} className="row-button" onClick={() => onOpen(name)}>
            <b>{name}</b>
            {with_ && <span className="superset-mark"><Icon name="switch" size={14} sw={2} />Superset with {andList(with_)}</span>}
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
});
