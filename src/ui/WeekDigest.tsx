import { useEffect, useRef, useState } from 'react';
import { addDays } from '../domain/analytics';
import { digestWeek, weekDigest, type Digest } from '../domain/digest';
import { plural } from '../domain/format';
import type { Profile } from '../domain/profile';
import type { SetEntry } from '../domain/types';
import { getPref, setPref } from '../state/prefs';
import { Icon } from './icons';

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

/** What a digest was last worked out from, kept by the component showing it. */
export interface KeptDigest { week?: string; past?: SetEntry[]; goal?: number; base?: Digest; profile?: Profile; d?: Digest }

/**
 * `week`'s digest, worked out from the whole log (every set's PRs, two years of weeks for the streak) again only when a set
 * up to the week's end changes: a set logged today can't move last week's numbers. The fitted targets do move with today's
 * sets, so what reads them (the muscles under target) is redone, from the week's own sets. `logged`: anything by its end.
 */
export function keptDigest(k: KeptDigest, entries: SetEntry[], profile: Profile, week: string): { d: Digest; logged: boolean } {
  const end = addDays(week, 6), xs = entries.filter((e) => e.date <= end);
  // The same sets as last time, in a new log array (useSets keeps every set it didn't change).
  const same = k.week === week && k.past?.length === xs.length && xs.every((e, i) => e === k.past![i]);
  // Of the profile, only the goal reads the whole log: the streak counts the weeks that met it.
  if (!same || k.goal !== profile.weeklyGoal) Object.assign(k, { week, past: xs, goal: profile.weeklyGoal, base: weekDigest(xs, profile, week), d: undefined });
  if (!k.d || k.profile !== profile) {
    const under = weekDigest(k.past!.filter((e) => e.date >= week), profile, week).under;
    Object.assign(k, { profile, d: { ...k.base!, goal: profile.weeklyGoal, under } });
  }
  return { d: k.d!, logged: k.past!.length > 0 };
}

/** The digest, kept between renders (see keptDigest). Off (dismissed): nothing is worked out. */
function useWeekDigest(entries: SetEntry[], profile: Profile, week: string, on = true): { d: Digest; logged: boolean } | null {
  const [kept] = useState<KeptDigest>(() => ({}));
  return on ? keptDigest(kept, entries, profile, week) : null;
}

/** Stats: the week just gone, always open, in This week's sheet. */
export function LastWeek({ entries, profile, today }: { entries: SetEntry[]; profile: Profile; today: string }) {
  const week = digestWeek(today);
  const { d } = useWeekDigest(entries, profile, week)!;
  return (
    <section className="digest st-digest" aria-label="Last week">
      <h3>Last week <span>· {weekRange(week)}</span></h3>
      <DigestBody d={d} />
    </section>
  );
}

/** The week whose digest is open on Today (IA A1, owner 2026-10-21): a new week starts collapsed. Per profile. */
export const DIGEST_OPEN = 'digest:open';

/**
 * Today, below the plan (IA A1, owner 2026-10-21): last week's digest as a collapsible card. It starts collapsed to one line, a tap
 * opens it in place, and it stays as you left it for that week (a new week starts collapsed); "Hide until next week" takes it
 * off Today for the rest of the week. The recap push (`recap`, when it was tapped) opens it whatever its state, and brings it on
 * screen: on the Sunday it's sent, at the week that day ends.
 */
export function TodayDigest({ owner, entries, profile, today, recap }: { owner: string; entries: SetEntry[]; profile: Profile; today: string; recap?: number }) {
  const fromRecap = !!recap && new Date(recap).toDateString() === new Date(`${today}T12:00:00`).toDateString();
  const week = digestWeek(today, fromRecap);
  // A recap tap opens it once: open and un-dismissed, then it behaves as ever.
  const [, bump] = useState(0);
  const box = useRef<HTMLElement>(null);
  const [scrollFor, setScrollFor] = useState<number | null>(null);
  if (recap && getPref<number>(owner, 'digest:recap') !== recap) {
    setPref(owner, 'digest:recap', recap);
    setPref(owner, DIGEST_OPEN, week);
    if (getPref<string>(owner, 'digest:dismissed') === week) setPref(owner, 'digest:dismissed', undefined);
    setScrollFor(recap);
  }
  // It sits below the plan, so the tap that opened it brings it on screen too (once per tap).
  useEffect(() => {
    if (scrollFor == null) return;
    box.current?.scrollIntoView({ block: 'start' });
    setScrollFor(null);
  }, [scrollFor]);
  const open = getPref<string>(owner, DIGEST_OPEN) === week;
  const dismissed = getPref<string>(owner, 'digest:dismissed') === week;
  const w = useWeekDigest(entries, profile, week, !dismissed);
  // Nothing to look back on before the first week with anything logged.
  if (!w?.logged) return null;
  const { d } = w;
  const title = week === digestWeek(today) ? 'Last week' : 'This week';
  const set = (name: string, v: unknown) => { setPref(owner, name, v); bump((n) => n + 1); };
  return (
    <section ref={box} className={`card digest${open ? '' : ' digest-folded'}`} aria-label={title}>
      <h2><button type="button" className="digest-toggle" aria-expanded={open} onClick={() => set(DIGEST_OPEN, open ? undefined : week)}>
        {open
          ? <span>{title} <span className="muted small">· {weekRange(week)}</span></span>
          : <span className="digest-line"><span>{title}</span><span className="muted">{[`${d.sessions} of ${d.goal} sessions`, plural(d.sets, 'set'), plural(d.prs, 'PR')].map((x) => <span key={x}> · <span className="nowrap">{x}</span></span>)}</span></span>}
        <Icon name="chev-down" size={18} sw={2} className={open ? 'flip' : undefined} />
      </button></h2>
      {open && <>
        <DigestBody d={d} />
        <button type="button" className="wide digest-hide" onClick={() => set('digest:dismissed', week)}>Hide until next week</button>
      </>}
    </section>
  );
}
