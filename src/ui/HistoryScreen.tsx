// src/ui/HistoryScreen.tsx
import type { SetsStore } from '../state/useSets';
import { byOrderDone, exerciseNames, sessionsByDate, sameExercise, type Session } from '../domain/stats';
import { fmtDay, fmtSet, plural } from '../domain/format';
import { localDate } from '../domain/ids';
import type { SetEntry } from '../domain/types';
import { Fragment, memo, useCallback, useEffect, useMemo, useState } from 'react';
import { sessionMinutes } from '../domain/timing';
import { gapModel } from '../domain/learn/switch';
import { prIds } from '../domain/records';
import { andList, supersets, type GapModel } from '../domain/superset';
import { allNotSupersets, notSupersets } from '../state/notSuperset';
import { activeProfileDb } from '../db/db';
import { Icon } from './icons';
import { ExercisePicker } from './ExercisePicker';
import { Input } from './Field';
import { changeLift, setWeight } from '../domain/dayEdit';
import { StatsSheet } from './StatsSheet';

/** The last fix made from History, for its Undo: the sets as they were before it. */
interface Fixed { date: string; text: string; before: SetEntry[] }

function byExercise(sets: SetEntry[]): [string, SetEntry[]][] {
  const out: [string, SetEntry[]][] = [];
  for (const s of sets) {
    const g = out.find(([n]) => sameExercise(n, s.exercise));
    if (g) g[1].push(s); else out.push([s.exercise, [s]]);
  }
  return out.map(([n, xs]) => [n, xs.sort(byOrderDone)]);
}

/** Without onAddTo (a friend's log) it's read-only. `focus`: a day to open and scroll to (a record tapped on a lift's screen). */
export function HistoryScreen({ who, store, onOpen, onAddTo, focus = null, onFocused }: {
  /** A friend's username: their log, read-only. */ who?: string; store: SetsStore; onOpen: (name: string) => void; onAddTo?: (date: string) => void; focus?: string | null; onFocused?: () => void;
}) {
  const sessions = useMemo(() => sessionsByDate(store.entries), [store.entries]);
  const today = localDate(new Date());
  const prs = useMemo(() => prIds(store.entries), [store.entries]);
  // Each set done in a superset, and the lifts it went with: worked out for a day when that day is shown, not for every
  // day in the log. "Not a superset" is this phone's own: a friend's log has none.
  const own = onAddTo != null;
  const supersetsOn = useMemo(() => {
    const owner = own ? activeProfileDb() : null, days = new Map<string, SetEntry[]>(), done = new Map<string, Map<string, string[]>>();
    for (const e of store.entries) if (e.loggedAt) { const d = days.get(e.date); if (d) d.push(e); else days.set(e.date, [e]); }
    // His gap model as of today (learn/switch), fitted once, when a day is first shown: today reads as Today does.
    let fitted: GapModel | null = null;
    const fit = () => (fitted ??= gapModel(store.entries, today, owner ? allNotSupersets(owner) : {}));
    const model: GapModel = { day: (r) => fit().day(r), prior: (k) => fit().prior(k) };
    return (date: string): Map<string, string[]> => {
      let out = done.get(date);
      if (out) return out;
      out = new Map();
      const day = days.get(date) ?? [];
      for (const g of supersets(day, date, model, { dismissed: owner ? notSupersets(owner, date) : [] })) {
        for (const id of g.after.keys()) {
          const ex = day.find((e) => e.id === id)!.exercise;
          out.set(id, g.lifts.filter((x) => !sameExercise(x, ex)));
        }
      }
      done.set(date, out);
      return out;
    };
  }, [store.entries, own, today]);
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
  // Fix sets (own log only): the day being fixed, the lift whose name is being changed, and the last fix for Undo.
  const [fixing, setFixing] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ date: string; name: string } | null>(null);
  const [fixed, setFixed] = useState<Fixed | null>(null);
  const { updateMany } = store;
  const apply = useCallback(async (date: string, changed: SetEntry[], text: string) => {
    if (!changed.length) return;
    const was = new Map(store.entries.map((e) => [e.id, e]));
    const before = changed.map((e) => was.get(e.id)!).filter(Boolean);
    if (await updateMany(changed)) setFixed({ date, text, before });
  }, [store.entries, updateMany]);
  const undo = useCallback(async () => {
    if (fixed && (await updateMany(fixed.before))) setFixed(null);
  }, [fixed, updateMany]);
  const onChangeLift = useCallback((date: string, name: string) => setPicking({ date, name }), []);
  // A day's "⋯" (owner, 2026-10-22: Fix sets on every day card was clutter): its actions in a small sheet, one day at a time.
  const [menu, setMenu] = useState<string | null>(null);
  // Back from the picker: the day being fixed in view again.
  useEffect(() => {
    if (!picking && fixing) document.querySelector(`details.day[data-date="${fixing}"]`)?.scrollIntoView({ block: 'start' });
  }, [picking]);
  const title = who ? `@${who}’s history` : 'History';
  if (picking) {
    const day = store.entries.filter((e) => e.date === picking.date);
    return <ExercisePicker recent={exerciseNames(store.entries)} title={`Change ${picking.name} on ${fmtDay(picking.date, today)} to`} onCancel={() => setPicking(null)}
      onPick={(to) => { const n = changeLift(day, picking.name, to); setPicking(null); void apply(picking.date, n, `${plural(n.length, 'set')}: ${picking.name} → ${to}`); }} />;
  }
  if (!sessions.length) return (<><h1 className={who ? 'who-title' : undefined}>{title}</h1><p className="muted">{who ? `No sessions from @${who} yet.` : 'No history yet — import it under More.'}</p></>);
  const [ty, tm] = today.split('-').map(Number);
  const lastMonth = tm === 1 ? `${ty - 1}-12` : `${ty}-${String(tm - 1).padStart(2, '0')}`;
  const monthName = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return (
    <>
      <h1 className={who ? 'who-title' : undefined}>{title}</h1>
      {months.map((mo, mi) => {
        const open = mi === 0 || mo.key >= lastMonth || mo.key === at?.slice(0, 7), rendered = open || shown.has(mo.key);
        return (
          <details className="month" key={mo.key} open={open} onToggle={rendered ? undefined : (e) => { if (e.currentTarget.open) show(mo.key); }}>
            <summary onClick={rendered ? undefined : () => show(mo.key)}><span>{monthName(mo.key)} · {plural(mo.days.length, 'session')}</span></summary>
            {rendered && mo.days.map((s) => (
              <Day key={s.date} s={s} open={s === sessions[0] || s.date === at || s.date === fixing} today={today} prs={prs} supersetsOn={supersetsOn} onOpen={onOpen}
                onMenu={own ? setMenu : undefined}
                fix={own ? { on: fixing === s.date, set: setFixing, changeLift: onChangeLift, apply, fixed: fixed?.date === s.date ? fixed : null, undo } : undefined} />
            ))}
          </details>
        );
      })}
      {menu && (
        <StatsSheet title={fmtDay(menu, today)} onClose={() => setMenu(null)}>
          <div className="day-actions">
            {onAddTo && <button className="wide" onClick={() => { const d = menu; setMenu(null); onAddTo(d); }}>Add to this day</button>}
            <button className="wide" onClick={() => { setFixing(menu); setMenu(null); }}>Fix sets</button>
          </div>
        </StatsSheet>
      )}
    </>
  );
}

/** A day: what it was in a line, and each lift's sets under it. Rendered again only when something it shows changes. */
interface FixProps {
  on: boolean; set: (date: string | null) => void; changeLift: (date: string, name: string) => void;
  apply: (date: string, changed: SetEntry[], text: string) => Promise<void>; fixed: Fixed | null; undo: () => Promise<void>;
}

/**
 * `onMenu`: the day's "⋯" (own log only), opening its actions: Add to this day and Fix sets. It sits beside the chevron, outside
 * the summary (a button inside one would be a button in a button), and goes while the day is being fixed (Done ends that).
 */
const Day = memo(function Day({ s, open, today, prs, supersetsOn, onOpen, onMenu, fix }: {
  s: Session; open: boolean; today: string; prs: Set<string>; supersetsOn: (date: string) => Map<string, string[]>;
  onOpen: (name: string) => void; onMenu?: (date: string) => void; fix?: FixProps;
}) {
  const groups = byExercise(s.sets);
  // The day's own sets are all of its date's: no need to read the whole log for each day.
  const mins = sessionMinutes(s.sets, s.date);
  const grouped = supersetsOn(s.date);
  // Cardio counts in minutes, not sets.
  const bouts = s.sets.filter((x) => x.cardio), lifts = s.sets.length - bouts.length;
  const cardio = Math.round(bouts.reduce((a, x) => a + x.cardio!.seconds, 0) / 60);
  const menu = onMenu && !fix?.on;
  return (
    <div className={menu ? 'day-item has-menu' : 'day-item'}>
    <details className="day" data-date={s.date} open={open}>
      <summary>
        <span className="day-date">{fmtDay(s.date, today)}</span>
        <span className="muted small">{plural(groups.length, 'exercise')}{(lifts > 0 || !bouts.length) && ` · ${plural(lifts, 'set')}`}{bouts.length > 0 && ` · ${cardio} min cardio`}{mins != null && ` · ${mins} min`}{s.sets.some((x) => prs.has(x.id)) && <>{' '}<span className="tag pr-tag">PR</span></>}</span>
      </summary>
      <div className="day-body">
        {fix?.fixed && (
          <div role="status" className="fix-done">
            <span className="ok">✓ Changed {fix.fixed.text}</span>
            <button className="mini" onClick={() => void fix.undo()}>Undo</button>
          </div>
        )}
        {fix?.on ? <FixDay s={s} groups={groups} fix={fix} /> : groups.map(([name, sets]) => {
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
      </div>
    </details>
    {menu && <button type="button" className="day-menu-btn" aria-label={`More for ${fmtDay(s.date, today)}`} aria-haspopup="dialog" onClick={() => onMenu(s.date)}><Icon name="more" size={22} /></button>}
    </div>
  );
});

/**
 * History → a day → Fix sets: each lift's sets to tick, Change lift (that day's sets of it to another lift, from the
 * picker), and one weight for the ticked sets (an empty bar logged as 0 or BW). Saved as edits (domain/dayEdit), Undo above.
 */
function FixDay({ s, groups, fix }: { s: Session; groups: [string, SetEntry[]][]; fix: FixProps }) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [weight, setWeightText] = useState('');
  const w = weight.trim() === '' ? NaN : Number(weight);
  const ok = picked.size > 0 && Number.isFinite(w) && w >= 0 && w < 2000;
  const toggle = (id: string) => setPicked((xs) => { const n = new Set(xs); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function save() {
    const changed = setWeight(s.sets, [...picked], w);
    await fix.apply(s.date, changed, `${plural(changed.length, 'set')} to ${w === 0 ? 'BW' : `${w} lb`}`);
    setPicked(new Set()); setWeightText('');
  }
  return (
    <div className="fix-day">
      {groups.map(([name, sets]) => (
        <div key={name} className="fix-lift" role="group" aria-label={name}>
          <div className="fix-head"><b>{name}</b><button className="mini" onClick={() => fix.changeLift(s.date, name)}>Change lift</button></div>
          {sets.filter((x) => !x.cardio).map((x) => (
            <label key={x.id} className="fix-set">
              <input type="checkbox" checked={picked.has(x.id)} onChange={() => toggle(x.id)} />
              <span>#{x.setNo} · {fmtSet(x)}{x.flags.includes('warmup') && <span className="muted small"> warm-up</span>}</span>
            </label>
          ))}
        </div>
      ))}
      <div className="fix-weight">
        <label className="field">Weight for {plural(picked.size, 'ticked set')} (lb)
          <Input inputMode="decimal" value={weight} onChange={(e) => setWeightText(e.target.value)} />
        </label>
        <button className="primary" disabled={!ok} onClick={() => void save()}>Set weight</button>
      </div>
      <button className="wide" onClick={() => fix.set(null)}>Done</button>
    </div>
  );
}
