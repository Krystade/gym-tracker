import { useMemo, useState } from 'react';
import { addDays } from '../domain/analytics';
import { digestWeek, weekDigest, type Digest } from '../domain/digest';
import { plural } from '../domain/format';
import type { Profile } from '../domain/profile';
import type { SetEntry } from '../domain/types';
import { getPref, setPref } from '../state/prefs';

const MAX_LIFTS = 6;

/** "Oct 5–11", or "Sep 28–Oct 4" across a month. */
export function weekRange(week: string): string {
  const day = (iso: string, month: boolean) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', month ? { month: 'short', day: 'numeric' } : { day: 'numeric' });
  };
  const end = addDays(week, 6);
  return `${day(week, true)}–${day(end, end.slice(5, 7) !== week.slice(5, 7))}`;
}

/** Against the week before: an arrow and the difference, said in words to a screen reader. */
function Delta({ now, before, unit = '' }: { now: number; before: number; unit?: string }) {
  const d = Math.round((now - before) * 10) / 10;
  const said = d === 0 ? 'same as the week before' : `${Math.abs(d)}${unit} ${d > 0 ? 'more' : 'fewer'} than the week before`;
  return <span className={`digest-delta${d > 0 ? ' up' : d < 0 ? ' down' : ''}`} aria-label={said} title={said}>{d === 0 ? '=' : `${d > 0 ? '↑' : '↓'}${Math.abs(d)}`}</span>;
}

/** The week's numbers: sessions and streak, sets, PRs, cardio when there was some; then by lift and the muscles short. */
export function DigestBody({ d }: { d: Digest }) {
  const lifts = d.lifts.slice(0, MAX_LIFTS);
  return (<>
    <dl className="digest-lines">
      <div><dt>Sessions</dt><dd><b>{d.sessions} of {d.goal}</b>{d.cardioDays > 0 && <span className="muted"> + {plural(d.cardioDays, 'cardio day')}</span>}</dd><Delta now={d.sessions} before={d.before.sessions} /></div>
      <div><dt>Streak</dt><dd><b>{plural(d.streak, 'week')}</b></dd><span /></div>
      <div><dt>Sets</dt><dd><b>{d.sets}</b></dd><Delta now={d.sets} before={d.before.sets} /></div>
      <div><dt>PRs</dt><dd><b>{d.prs}</b></dd><Delta now={d.prs} before={d.before.prs} /></div>
      {d.cardioMinutes > 0 && <div><dt>Cardio</dt><dd><b>{Math.round(d.cardioMinutes)} min</b></dd><Delta now={Math.round(d.cardioMinutes)} before={Math.round(d.before.cardioMinutes)} unit=" min" /></div>}
    </dl>
    <p className="muted small digest-key">Arrows: against the week before.</p>
    {lifts.length > 0 && <>
      <h3 className="digest-sub">By lift</h3>
      <ul className="digest-lifts" aria-label="By lift">
        {lifts.map((l) => (
          <li key={l.exercise}><span>{l.exercise}</span><span className="muted">{plural(l.sets, l.cardio ? 'bout' : 'set')}{l.prs > 0 && <> · <b className="digest-pr">{plural(l.prs, 'PR')}</b></>}</span></li>
        ))}
      </ul>
      {d.lifts.length > MAX_LIFTS && <p className="muted small">and {plural(d.lifts.length - MAX_LIFTS, 'more lift')}</p>}
    </>}
    {d.under.length > 0 && <>
      <h3 className="digest-sub">Furthest under target</h3>
      <ul className="digest-lifts" aria-label="Muscles furthest behind">
        {d.under.map((u) => <li key={u.muscle}><span>{u.muscle}</span><span className="muted">{u.sets} of {u.target[0]}–{u.target[1]} sets</span></li>)}
      </ul>
    </>}
  </>);
}

/** Stats: the week just gone, always open, next to This week. */
export function LastWeekCard({ entries, profile, today }: { entries: SetEntry[]; profile: Profile; today: string }) {
  const week = digestWeek(today);
  const d = useMemo(() => weekDigest(entries, profile, week), [entries, profile, week]);
  return (
    <section className="card digest" aria-label="Last week">
      <h2>Last week <span className="muted small">· {weekRange(week)}</span></h2>
      <DigestBody d={d} />
    </section>
  );
}

/**
 * Today, from Monday: last week's digest, folded or open as you last left it, and hidden for the rest of the week once
 * dismissed. The recap push (`recap`, when it was tapped) opens it whatever its state: on the Sunday it's sent, at the
 * week that day ends.
 */
export function TodayDigest({ owner, entries, profile, today, recap }: { owner: string; entries: SetEntry[]; profile: Profile; today: string; recap?: number }) {
  const fromRecap = !!recap && new Date(recap).toDateString() === new Date(`${today}T12:00:00`).toDateString();
  const week = digestWeek(today, fromRecap);
  // A recap tap opens it once: unfolded and un-dismissed, then it behaves as ever.
  const [, bump] = useState(0);
  if (recap && getPref<number>(owner, 'digest:recap') !== recap) {
    setPref(owner, 'digest:recap', recap);
    setPref(owner, 'digest:folded', false);
    if (getPref<string>(owner, 'digest:dismissed') === week) setPref(owner, 'digest:dismissed', undefined);
  }
  const folded = getPref<boolean>(owner, 'digest:folded') ?? false;
  const dismissed = getPref<string>(owner, 'digest:dismissed') === week;
  const d = useMemo(() => weekDigest(entries, profile, week), [entries, profile, week]);
  // Nothing to look back on before the first week with anything logged.
  if (dismissed || !entries.some((e) => e.date <= d.end)) return null;
  const title = week === digestWeek(today) ? 'Last week' : 'This week';
  const set = (name: string, v: unknown) => { setPref(owner, name, v); bump((n) => n + 1); };
  return (
    <section className="card digest" aria-label={title}>
      <h2><button type="button" className="digest-toggle" aria-expanded={!folded} onClick={() => set('digest:folded', !folded)}>
        <span>{title} <span className="muted small">· {weekRange(week)}</span></span>
        {folded && <span className="muted small">{d.sessions} of {d.goal} sessions · {plural(d.sets, 'set')} · {plural(d.prs, 'PR')}</span>}
      </button></h2>
      {!folded && <>
        <DigestBody d={d} />
        <button type="button" className="wide digest-hide" onClick={() => set('digest:dismissed', week)}>Hide until next week</button>
      </>}
    </section>
  );
}
