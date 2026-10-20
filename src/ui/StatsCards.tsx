import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { activeProfileDb } from '../db/db';
import { addDays, streak, weekStart, weeklySummary } from '../domain/analytics';
import { dayKinds } from '../domain/crew';
import { behindMuscles, goalWeek, liftTrend, milestone, prCard, prsBetween, streakNudge, topLifts, weekSets, type Trend } from '../domain/feed';
import { fmtWeight, plural } from '../domain/format';
import type { Profile } from '../domain/profile';
import type { SetEntry } from '../domain/types';
import { getPref, setPref } from '../state/prefs';
import { Icon } from './icons';
import { Ring } from './Ring';

// Stats as answers (round 18, direction A): how the week is going against your goal, a PR worth seeing, whether you're getting
// stronger lift by lift (and where it's gone flat), the next round number on each, and which muscles are behind with a lift for
// each. Everything is you against your own past; nothing here ever reads anyone else.

const fmtDay = (date: string, today: string) => (date === today ? 'today' : date > addDays(today, -7)
  ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })
  : new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
const setText = (e: SetEntry) => `${e.weight === 0 ? 'BW' : fmtWeight(e.weight)} × ${e.reps ?? '?'}`;

/** The week's ring: a segment per session (its kind), out of your goal; sets against last week by the same day; PRs; the streak. */
export function WeekRing({ entries, profile, today, program }: { entries: SetEntry[]; profile: Profile; today: string; program?: { done: number; planned: number } | null }) {
  const v = useMemo(() => {
    const goal = profile.weeklyGoal;
    const w = goalWeek(entries, today, goal);
    const from = weekStart(today);
    const days = [...new Set(entries.filter((e) => e.date >= from && e.date <= today).map((e) => e.date))].sort();
    const segs = days.map((d) => dayKinds(entries.filter((e) => e.date === d)).kinds[0] ?? null);
    const st = streak(weeklySummary(entries, 104, today), goal);
    return { w, segs, sets: weekSets(entries, today), prs: prsBetween(entries, from, today).length, st, trainedToday: days.includes(today), goal };
  }, [entries, profile.weeklyGoal, today]);
  const diff = v.sets.sets - v.sets.before;
  const n = streakNudge({ sessions: v.w.sessions, goal: v.goal, streak: v.st.current, today, trainedToday: v.trainedToday });
  return (
    <section className="card st-week" aria-label="This week">
      <h2 className="sr-only">This week</h2>
      <div className="st-week-top">
        <div className="st-ring">
          <Ring segs={v.segs} total={Math.max(v.goal, v.segs.length)} size={128} width={11} gap={6} draw merge={false} />
          <span className="st-ring-c" aria-hidden="true"><b>{v.w.sessions}</b><i>/{v.goal}</i><small>sessions</small></span>
        </div>
        <dl className="st-rows">
          <div><dt>Sessions</dt><dd>{v.w.sessions} of {v.goal}{v.w.cardioDays > 0 && <small>+ {plural(v.w.cardioDays, 'cardio day')}</small>}</dd></div>
          <div><dt>Sets</dt><dd>{v.sets.sets}{diff !== 0 && <small className={diff > 0 ? 'up' : 'down'} aria-label={`${diff > 0 ? 'up' : 'down'} ${Math.abs(diff)} on last week by today`}>{diff > 0 ? '↑' : '↓'}{Math.abs(diff)}</small>}</dd></div>
          <div><dt>PRs</dt><dd>{v.prs ? `${v.prs} new` : '0'}</dd></div>
          <div><dt>Streak</dt><dd className="st-streak">{v.st.current > 0 && <Icon name="flame" size={18} sw={2} className="st-flame" />}{v.st.current} wk<small>best {v.st.best}</small></dd></div>
        </dl>
      </div>
      {program && program.planned > 0 && <p className="st-program">Program, 4 weeks <b>{Math.round((100 * program.done) / program.planned)}% · {program.done} / {program.planned} sets</b></p>}
      <p className="st-nudge"><Icon name="target" size={20} /><span><b>{n.lead}</b>{n.rest}</span></p>
    </section>
  );
}

const CONFETTI = 16;
/** The newest PR of the last 7 days; confetti the first time this phone shows it, never again. */
export function PrCardView({ entries, today, juice }: { entries: SetEntry[]; today: string; /** Off on a friend's Stats. */ juice: boolean }) {
  const pr = useMemo(() => prCard(entries, today), [entries, today]);
  const [owner] = useState(activeProfileDb);
  const [burst] = useState(() => juice && !!pr && getPref<string>(owner, 'stats:pr-seen') !== pr.set.id);
  useEffect(() => { if (juice && pr) setPref(owner, 'stats:pr-seen', pr.set.id); }, [juice, pr, owner]);
  if (!pr) return null;
  return (
    <section className="st-pr" aria-label="New PR">
      <span className="st-pr-cup" aria-hidden="true"><Icon name="trophy" size={26} sw={2} /></span>
      <div>
        <p className="st-pr-k">New PR · {fmtDay(pr.set.date, today)}</p>
        <p className="st-pr-t">{pr.set.exercise} {setText(pr.set)}</p>
        <p className="st-pr-d">{pr.detail}</p>
      </div>
      {burst && (
        <span className="st-confetti" aria-hidden="true">
          {Array.from({ length: CONFETTI }, (_, i) => <i key={i} style={{ '--i': i, '--x': `${((i * 37) % 100) - 50}px`, '--y': `${-40 - ((i * 53) % 70)}px`, '--r': `${(i * 67) % 360}deg`, '--c': `var(--kind-${['legs', 'push', 'pull', 'core', 'cardio'][i % 5]})` } as CSSProperties} />)}
        </span>
      )}
    </section>
  );
}

/** A lift's 12 weeks as a line: each session's best e1RM. Decorative; the words beside it say the change. */
function Spark({ t }: { t: Trend }) {
  const W = 110, H = 30, p = t.points;
  if (p.length < 2) return <svg className="st-spark" width={W} height={H} aria-hidden="true" />;
  const lo = Math.min(...p.map((x) => x.v)), hi = Math.max(...p.map((x) => x.v)), x0 = Date.parse(p[0].date), span = Math.max(1, Date.parse(p.at(-1)!.date) - x0);
  const pt = (x: { date: string; v: number }) => [((Date.parse(x.date) - x0) / span) * (W - 6) + 3, H - 4 - ((x.v - lo) / Math.max(1, hi - lo)) * (H - 8)];
  const d = p.map((x, i) => `${i ? 'L' : 'M'}${pt(x).map((n) => n.toFixed(1)).join(' ')}`).join('');
  const [lx, ly] = pt(p.at(-1)!);
  return (
    <svg className={`st-spark${t.stall ? ' flat' : ''}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={d} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="3" />
    </svg>
  );
}

/** Getting stronger: your most-trained lifts, each one's change in e1RM from your own start over 12 weeks; a stalled one says so. */
export function Stronger({ entries, today, onOpen }: { entries: SetEntry[]; today: string; onOpen?: (name: string) => void }) {
  const trends = useMemo(() => topLifts(entries, today, 4).map((n) => liftTrend(entries, n, today)).filter((t): t is Trend => !!t), [entries, today]);
  if (!trends.length) return null;
  return (<>
    <section className="card st-stronger" aria-label="Getting stronger">
      <h2>Getting stronger <span>e1RM, 12 weeks</span></h2>
      <ul>
        {trends.map((t) => {
          const flat = !!t.stall, delta = t.delta == null ? null : Math.round(t.delta);
          const body = (<>
            <span className="st-lift"><b>{t.name}</b><small>{flat ? `${plural(Math.max(1, t.stall!.weeks), 'week')}, no change` : `${setText(t.top)} ${fmtDay(t.top.date, today)}`}</small></span>
            <Spark t={t} />
            <span className={`st-delta${flat ? ' flat' : delta != null && delta > 0 ? ' up' : ''}`}>{flat ? 'flat' : delta == null ? '–' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)}`}</span>
          </>);
          return <li key={t.name}>{onOpen ? <button className="st-row" aria-label={`${t.name}: ${flat ? 'flat' : delta == null ? 'too new to say' : `${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta ?? 0)} lb e1RM`}`} onClick={() => onOpen(t.name)}>{body}</button> : <div className="st-row">{body}</div>}</li>;
        })}
      </ul>
    </section>
    <Milestones trends={trends} />
  </>);
}

/** B's next milestones: each followed lift's best e1RM over 12 weeks, and the next round number above it. */
function Milestones({ trends }: { trends: Trend[] }) {
  const rows = trends.map((t) => { const best = Math.max(...t.points.map((p) => p.v)); return { name: t.name, best, ...milestone(best) }; });
  return (
    <section className="card st-miles" aria-label="Next milestones">
      <h2>Next milestones <span>e1RM</span></h2>
      <ul>
        {rows.map((r) => (
          <li key={r.name}>
            <span className="st-ml-n">{r.name}</span>
            <span className="st-ml-v"><b>{r.next}</b> lb<small>{Math.max(1, Math.ceil(r.next - r.best))} to go</small></span>
            <span className="st-ml-bar" role="img" aria-label={`${Math.round(r.best)} of ${r.next} lb`}><i style={{ '--p': `${Math.round(r.progress * 100)}%` } as CSSProperties} /></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Behind this week: only the muscles under target and under the week's pace, each with a lift of yours that works it. */
export function BehindCard({ entries, profile, today, onOpen }: { entries: SetEntry[]; profile: Profile; today: string; onOpen?: (name: string) => void }) {
  const rows = useMemo(() => behindMuscles(entries, profile, today), [entries, profile, today]);
  if (!rows.length) return null;
  const pace = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${weekStart(today)}T12:00:00Z`)) / 864e5 / 7;
  const fmt = (n: number) => (n % 1 ? n.toFixed(1) : String(n));
  return (
    <section className="card st-behind" aria-label="Behind this week">
      <h2>Behind this week <span>sets so far</span></h2>
      <ul>
        {rows.map((b) => {
          const max = b.range[1] * 1.1;
          return (
            <li key={b.muscle}>
              <span className="st-bh-m">{b.muscle}</span>
              <span className="st-bh-bar" aria-hidden="true"><i style={{ '--w': `${Math.min(100, (b.sets / max) * 100)}%` } as CSSProperties} /><em style={{ '--x': `${((b.range[0] * pace) / max) * 100}%` } as CSSProperties} /></span>
              <span className="st-bh-n">{fmt(b.sets)} of {b.range[0]}–{b.range[1]}</span>
              {b.fix && (onOpen ? <button className="quiet-btn st-fix" onClick={() => onOpen(b.fix!)}>{b.fix}</button> : <span className="st-fix">{b.fix}</span>)}
            </li>
          );
        })}
      </ul>
      <p className="muted small">The line: where today should be. Each lift is one of yours that works it.</p>
    </section>
  );
}
