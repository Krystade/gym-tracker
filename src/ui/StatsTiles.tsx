import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { addDays, calendarDays, weekStart, weeklyMuscleSets, weeklySummary } from '../domain/analytics';
import { thisWeekCardio } from '../domain/cardio';
import { dayKinds } from '../domain/crew';
import { goalWeek, liftTrend, milestone, prCard, streakNudge, topLifts, weekSets, type Trend } from '../domain/feed';
import { fmtAdded, fmtDay, fmtSet, fmtWeight, plural } from '../domain/format';
import { liftKey } from '../domain/ids';
import { lingering } from '../domain/painPlan';
import { painReport } from '../domain/care';
import { MUSCLES, type Muscle } from '../domain/muscles';
import { targetFor, type Profile } from '../domain/profile';
import { prKinds, recordLabel, records, type RecordKind } from '../domain/records';
import { stall as stallOf } from '../domain/rotation';
import { e1rm, liftSets } from '../domain/stats';
import { rangeDays, rangeFrom, rangeWeeks, rangeWords, RANGES, type Range } from '../domain/statsLayout';
import type { BodyDay } from '../domain/body';
import type { SetEntry } from '../domain/types';
import { streak } from '../domain/analytics';
import { getPref, setPref } from '../state/prefs';
import { BarChart } from './charts/BarChart';
import { Calendar } from './charts/Calendar';
import { ChartTable } from './charts/ChartTable';
import { MuscleBars, paceStatus, weekPace } from './charts/MuscleBars';
import { CareBody } from './CareCard';
import { Icon } from './icons';
import { LineChart } from './LineChart';
import { Ring } from './Ring';
import { Cols, Heat, Meter, Spark, type TileView } from './StatsTile';
import { VolumeSteps } from './VolumeSteps';
import { LastWeek } from './WeekDigest';

// What each Stats v2 tile says and what its sheet holds (plan §2), from the props alone: the same tiles can show a friend's log
// (their entries, their profile, `who`) without reading anything of the person holding the phone. Each tile is its old card
// ported: Getting stronger → a tile per lift; Next milestones; New PR → PRs; Behind this week and Muscle volume → Muscles;
// Sessions per week; Weekly tonnage; Calendar; Joint & back care → Pain flags; This week and Last week → the hero and its sheet.
// Body is hidden for now (owner, 2026-10-20: MyFitnessPal's export needs a paid account).

export type SectionId = 'progress' | 'load' | 'consistency' | 'recovery';
export const SECTIONS: { id: SectionId; title: string }[] = [
  { id: 'progress', title: 'Progress' },
  { id: 'load', title: 'Training load' },
  { id: 'consistency', title: 'Consistency' },
  { id: 'recovery', title: 'Recovery and health' },
];

/** A tile, where it goes, and its sheet. */
export interface TileModel extends TileView {
  section: SectionId;
  /** The sheet's title, if not the label. */ title?: string;
  sheet: () => ReactNode;
  /** A way on from the sheet's head. */ link?: ReactNode;
  /** Drawn on the tile (a PR's confetti). */ extra?: ReactNode;
}

export interface StatsInput {
  entries: SetEntry[]; profile: Profile; today: string; range: Range;
  /** A friend's username: named wherever your own Stats says "your". */ who?: string;
  /** Your own Stats: the profile id its once-only touches are kept under (a PR's confetti), and what only you can do. */ owner?: string;
  /** Lifts pinned that aren't among the four followed. */ alsoLifts?: string[];
  body?: readonly BodyDay[];
  onOpenLift?: (name: string) => void; onOpenPriorities?: () => void;
}

const DAY = 864e5;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
const whoseOf = (who?: string) => (who ? `@${who}’s` : 'your');
/** "today", a weekday this week, else "Oct 3". */
const shortDay = (date: string, today: string) => (date === today ? 'today' : date > addDays(today, -7)
  ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })
  : new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
const tons = (n: number) => (n >= 1000 ? `${fmtWeight(Math.round(n / 100) / 10)}k` : fmtWeight(Math.round(n)));
const fmt1 = (n: number) => (n % 1 ? n.toFixed(1) : String(n));
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const rangeLabel = (r: Range) => RANGES.find((x) => x.id === r)!.label;
export const liftTileId = (name: string) => `lift:${liftKey(name)}`;

/** A lift's change over the range, as a share of where it started; null under two weeks apart. */
const pctOf = (t: Trend) => (t.delta == null || !t.points.length ? null : (100 * t.delta) / t.points[0].v);
/** Up, down or flat, in an arrow and a word as well as a colour. */
function Change({ pct, flat, weeks }: { pct: number | null; flat?: boolean; weeks?: number }) {
  if (flat) return <span className="flat">— flat {Math.max(1, weeks ?? 1)} wk</span>;
  if (pct == null) return <span>too new to say</span>;
  const r = Math.round(pct * 10) / 10;
  if (r === 0) return <span>— no change</span>;
  return r > 0 ? <span className="up">↑ {fmt1(r)}%</span> : <span className="down">↓ {fmt1(-r)}%</span>;
}

/** Every tile for the log, by section, and which ones have news now. Empty for an empty log. */
export function useTiles(input: StatsInput): TileModel[] {
  const { entries, profile, today, range, who, owner, alsoLifts, body, onOpenLift, onOpenPriorities } = input;
  const data = useMemo(() => work(entries, profile, today, range, alsoLifts ?? []), [entries, profile, today, range, alsoLifts]);
  if (!entries.length) return [];
  const whose = whoseOf(who), W = rangeWeeks(range), rl = rangeLabel(range);
  const out: TileModel[] = [];

  // ---- Progress: a tile per followed lift, PRs, the next milestone ----
  for (const l of data.lifts) {
    const t = l.trend, last = t.points.at(-1)!.v, flat = !!t.stall;
    out.push({
      id: liftTileId(t.name), section: 'progress', label: t.name, value: String(Math.round(last)), unit: 'lb',
      ctx: <><Change pct={pctOf(t)} flat={flat} weeks={t.stall?.weeks} />{!flat && pctOf(t) != null && <> · {rl}</>}</>,
      viz: (w) => <Spark values={t.points.map((p) => p.v)} w={w} />, news: l.news,
      sheet: () => <LiftSheet t={t} entries={entries} today={today} range={range} />,
      link: onOpenLift && <button type="button" className="st-link" onClick={() => onOpenLift(t.name)}>Open lift<Icon name="chev-right" size={18} sw={2} /></button>,
    });
  }
  if (data.prs.length) {
    const newest = data.prs.reduce((a, e) => (e.date > a.date ? e : a));
    out.push({
      id: 'prs', section: 'progress', label: 'PRs', value: String(data.prs.length), unit: `in ${rl}`, ctx: <>newest {shortDay(newest.date, today)}</>,
      viz: (w) => <Cols values={data.prWeeks} w={w} />, news: data.prNews,
      sheet: () => <PrSheet entries={entries} prs={data.prs} kinds={data.kinds} today={today} who={who} range={range} />,
      extra: owner && data.prNews && <PrBurst owner={owner} entries={entries} today={today} />,
    });
  }
  if (data.miles.length) {
    const m = data.miles.reduce((a, b) => (b.toGo < a.toGo || (b.toGo === a.toGo && b.progress > a.progress) ? b : a));
    out.push({
      id: 'milestones', section: 'progress', label: 'Next milestone', title: 'Next milestones', value: String(m.next), unit: 'lb',
      ctx: <>{m.name} · {m.toGo} lb to go</>, viz: (w) => <Meter frac={m.progress} w={w} />,
      sheet: () => <MilestonesSheet rows={data.miles} range={range} />,
    });
  }

  // ---- Training load: this week's muscles, tonnage ----
  const mu = data.muscles;
  out.push({
    id: 'muscles', section: 'load', label: 'Muscles · this week', title: 'Sets per muscle', value: String(mu.behind.length), unit: 'behind',
    ctx: <>{[mu.on && `${mu.on} on target`, mu.pace && `${mu.pace} on pace`, mu.over && `${mu.over} over`].filter(Boolean).join(' · ') || 'none on target yet'}</>,
    viz: (w) => <Cols values={mu.cols.map((c) => c.v)} w={w} colour={(i) => STATUS_COL[mu.cols[i].st]} />, news: mu.behind.length > 0,
    sheet: () => <MusclesSheet entries={entries} profile={profile} today={today} who={who} body={owner ? body : undefined} onOpenLift={onOpenLift} />,
    link: onOpenPriorities && <button type="button" className="st-link" onClick={onOpenPriorities}>Priorities<Icon name="chev-right" size={18} sw={2} /></button>,
  });
  const done = data.weeks.slice(0, -1);
  if (done.some((w) => w.tonnage > 0)) {
    const lastWeek = done.at(-1)!.tonnage, avg = done.reduce((a, w) => a + w.tonnage, 0) / done.length;
    const pct = avg > 0 ? Math.round((100 * (lastWeek - avg)) / avg) : 0;
    out.push({
      id: 'tonnage', section: 'load', label: 'Tonnage', value: tons(lastWeek), unit: 'lb',
      ctx: <>last week · {pct === 0 ? '— on avg' : `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% on avg`}</>,
      viz: (w) => <Cols values={done.map((x) => x.tonnage)} w={w} />,
      sheet: () => (<>
        <BarChart label={`Weekly tonnage in pounds, last ${plural(W, 'week')}`} points={data.weeks.map((x) => ({ x: x.week, y: x.tonnage }))} format={(n) => `${tons(n)} lb`} tick={tons} unit="lb" />
        <p className="muted small">Weight × reps of every lifted set, each week. The tile reads the last whole week against the average of the whole weeks before it in the range.</p>
        <ChartTable caption="Weekly tonnage (lb)" head={['Week of', 'Tonnage']} rows={data.weeks.map((x) => [x.week, String(Math.round(x.tonnage))])} />
      </>),
    });
  }

  // ---- Consistency: the calendar, sessions a week ----
  out.push({
    id: 'calendar', section: 'consistency', label: 'Calendar', value: String(data.trained), unit: data.trained === 1 ? 'day trained' : 'days trained',
    ctx: <>{rangeWords(range)} · Monday on top</>, wide: true, vizHeight: 68,
    viz: (w) => <Heat weeks={data.heat} w={w} h={68} />,
    sheet: () => <Calendar days={data.days} today={today} label={`Training calendar, last ${plural(W, 'week')}`} />,
  });
  {
    const goal = profile.weeklyGoal, whole = done.length ? done : data.weeks;
    const avg = whole.reduce((a, w) => a + w.sessions, 0) / whole.length, met = whole.filter((w) => w.sessions >= goal).length;
    out.push({
      id: 'sessions', section: 'consistency', label: 'Sessions a week', value: avg.toFixed(1), unit: 'avg',
      ctx: <>goal {goal} · met {met} of {whole.length}</>,
      viz: (w) => <Cols values={data.weeks.map((x) => x.sessions)} w={w} goal={goal} />,
      sheet: () => (<>
        <BarChart label={`Sessions per week, last ${plural(W, 'week')}`} points={data.weeks.map((x) => ({ x: x.week, y: x.sessions }))} format={(n) => plural(n, 'session')} goal={goal} />
        <p className="muted small">The line: {whose} goal of {plural(goal, 'session')}. A day counts once it has a lifted set; cardio-only days don’t count toward it.</p>
        <ChartTable caption="Sessions per week" head={['Week of', 'Sessions']} rows={data.weeks.map((x) => [x.week, String(x.sessions)])} />
      </>),
    });
  }

  // ---- Recovery and health: pain ----
  if (data.pain.total > 0) {
    const p = data.pain;
    out.push({
      id: 'pain', section: 'recovery', label: 'Pain flags', value: String(p.total), unit: p.total === 1 ? 'set' : 'sets',
      ctx: <>{cap(p.top)}{p.regions > 1 && ` +${p.regions - 1}`}{p.rising ? <> · <span className="danger">↑ rising</span></> : p.lingering ? ' · on and off' : ''}</>,
      viz: (w) => <Cols values={p.weekly} w={w} colour={(i) => (i === p.weekly.length - 1 ? (p.rising ? 'var(--danger)' : 'var(--accent)') : 'var(--col)')} />,
      news: p.rising,
      sheet: () => <CareBody entries={entries} today={today} who={who} weeks={W} />,
    });
  }
  return out;
}

const STATUS_COL = { under: 'var(--warn)', pace: 'var(--col)', on: 'var(--ok)', over: 'var(--accent)' } as const;

interface LiftRow { trend: Trend; news: boolean }
interface MileRow { name: string; best: number; next: number; progress: number; toGo: number }

/** Everything the tiles read, worked out once per log, profile, day and range. */
function work(entries: SetEntry[], profile: Profile, today: string, range: Range, also: string[]) {
  const span = rangeDays(range), W = rangeWeeks(range), from = rangeFrom(range, today), weekAgo = addDays(today, -6);
  const kinds = prKinds(entries);
  const prs = entries.filter((e) => kinds.has(e.id) && e.date >= from && e.date <= today);
  const prNews = prs.some((e) => e.date >= weekAgo);
  const start = addDays(weekStart(today), -7 * (W - 1));
  const prWeeks = Array(W).fill(0) as number[];
  for (const e of prs) { const i = Math.floor(days(start, weekStart(e.date)) / 7); if (i >= 0 && i < W) prWeeks[i]++; }

  // The four lifts followed (and any pinned), each a tile with news when it set a PR this week or went flat since a week ago.
  const names = [...new Set([...topLifts(entries, today, 4, span), ...also])];
  const lifts: LiftRow[] = names.flatMap((name) => {
    const trend = liftTrend(entries, name, today, span);
    if (!trend) return [];
    const k = liftKey(name);
    const pr = prs.some((e) => e.date >= weekAgo && liftKey(e.exercise) === k);
    const newStall = !!trend.stall && !stallOf(entries, name, addDays(today, -7));
    return [{ trend, news: pr || newStall }];
  });
  const miles: MileRow[] = lifts.map(({ trend: t }) => {
    const best = Math.max(...t.points.map((p) => p.v)), m = milestone(best);
    return { name: t.name, best, next: m.next, progress: m.progress, toGo: Math.max(1, Math.ceil(m.next - best)) };
  });

  // This week's muscles against each one's target, as the week so far allows.
  const pace = weekPace(today);
  const { sets } = weeklyMuscleSets(entries, weekStart(today));
  const st = MUSCLES.map((m) => ({ m, range: targetFor(profile, m) })).filter((x) => x.range[0] > 0)
    .map((x) => ({ m: x.m, v: Math.min(1.2, sets[x.m] / x.range[0]), st: paceStatus(sets[x.m], x.range, pace) }));
  const order = { under: 0, pace: 1, on: 2, over: 3 } as const;
  const muscles = {
    behind: st.filter((x) => x.st === 'under').map((x) => x.m as Muscle),
    pace: st.filter((x) => x.st === 'pace').length, on: st.filter((x) => x.st === 'on').length, over: st.filter((x) => x.st === 'over').length,
    cols: [...st].sort((a, b) => order[a.st] - order[b.st]),
  };

  const weeks = weeklySummary(entries, W, today);
  // Whole Monday–Sunday weeks, the last one running to today.
  const calDays = calendarDays(entries, (W - 1) * 7 + 1 + days(weekStart(today), today), today);
  const heat: (0 | 1 | -1)[][] = Array.from({ length: W }, (_, c) => Array.from({ length: 7 }, (_, r) => {
    const d = calDays[c * 7 + r];
    return d ? (d.sets > 0 ? 1 : 0) : -1;
  }));
  const trained = calDays.filter((d) => d.sets > 0).length;

  const report = painReport(entries, today, W);
  const weekly = Array(W).fill(0) as number[];
  for (const r of report) r.weekly.forEach((n, i) => { weekly[i] += n; });
  const long = lingering(entries, today);
  const pain = { total: report.reduce((a, r) => a + r.total, 0), top: report[0]?.region ?? 'other', regions: report.length, rising: report.some((r) => r.rising), lingering: long.length > 0, weekly };

  return { kinds, prs, prNews, prWeeks, lifts, miles, muscles, weeks, days: calDays, heat, trained, pain };
}

// ---- The hero: this week against the goal ----

export function useWeek(entries: SetEntry[], profile: Profile, today: string) {
  return useMemo(() => {
    const goal = profile.weeklyGoal;
    const w = goalWeek(entries, today, goal);
    const from = weekStart(today);
    const dates = [...new Set(entries.filter((e) => e.date >= from && e.date <= today).map((e) => e.date))].sort();
    const segs = dates.map((d) => dayKinds(entries.filter((e) => e.date === d)).kinds[0] ?? null);
    const st = streak(weeklySummary(entries, 104, today), goal);
    const kinds = prKinds(entries);
    const prs = entries.filter((e) => kinds.has(e.id) && e.date >= from && e.date <= today).length;
    return { w, goal, segs, sets: weekSets(entries, today), prs, st, cardio: Math.round(thisWeekCardio(entries, today)), trainedToday: dates.includes(today) };
  }, [entries, profile.weeklyGoal, today]);
}

/** The week's one full-width tile: a ring of its sessions out of the goal, sets, PRs, the streak, cardio, and what's left. */
export function WeekHero({ entries, profile, today, who, onOpen }: { entries: SetEntry[]; profile: Profile; today: string; who?: string; onOpen: () => void }) {
  const v = useWeek(entries, profile, today);
  const diff = v.sets.sets - v.sets.before;
  const n = streakNudge({ sessions: v.w.sessions, goal: v.goal, streak: v.st.current, today, trainedToday: v.trainedToday }, whoseOf(who));
  return (
    <section className="st-hero" aria-label="This week">
      <h2 className="sr-only">This week</h2>
      <button type="button" className="st-week" aria-haspopup="dialog" onClick={onOpen}>
        <span className="st-ringwrap">
          <Ring segs={v.segs} total={Math.max(v.goal, v.segs.length)} size={76} width={7} gap={10} draw merge={false} />
          <span className="st-rc"><b>{v.w.sessions}</b><i>/{v.goal}</i><span className="sr-only"> sessions</span></span>
        </span>
        <dl className="st-wk-cells">
          <div><dt>Sets</dt><dd>{v.sets.sets}{diff !== 0 && <small className={diff > 0 ? 'up' : undefined} aria-label={`, ${Math.abs(diff)} ${diff > 0 ? 'more' : 'fewer'} than last week by today`}>{diff > 0 ? '↑' : '↓'}{Math.abs(diff)}</small>}</dd></div>
          <div><dt>PRs</dt><dd>{v.prs}{v.prs > 0 && <small>new</small>}</dd></div>
          <div><dt>Streak</dt><dd>{v.st.current > 0 && <Icon name="flame" size={16} sw={2} className="st-flame" />}{v.st.current}<small>wk</small></dd></div>
          <div><dt>Cardio</dt><dd>{v.cardio}<small>min</small></dd></div>
        </dl>
        <span className="st-wk-nudge"><Icon name="target" size={18} /><span><b>{n.lead}</b>{n.rest}</span></span>
      </button>
    </section>
  );
}

/** This week in full, the program's last 4 weeks, and last week's digest. */
export function WeekSheet({ entries, profile, today, program }: { entries: SetEntry[]; profile: Profile; today: string; who?: string; program: { done: number; planned: number } | null }) {
  const v = useWeek(entries, profile, today);
  const diff = v.sets.sets - v.sets.before;
  const dow = new Date(`${today}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
  return (<>
    <dl className="st-lines">
      <div><dt>Sessions</dt><dd><b>{v.w.sessions} of {v.goal}</b>{v.w.cardioDays > 0 && <span> + {plural(v.w.cardioDays, 'cardio day')}</span>}</dd></div>
      <div><dt>Sets</dt><dd><b>{v.sets.sets}</b>{diff !== 0 && <span> · {diff > 0 ? '↑' : '↓'} {Math.abs(diff)} on last week by {dow}</span>}</dd></div>
      <div><dt>PRs</dt><dd><b>{v.prs}</b>{v.prs > 0 && <span> new</span>}</dd></div>
      <div><dt>Streak</dt><dd><b>{plural(v.st.current, 'week')}</b><span> · best {v.st.best}</span></dd></div>
      <div><dt>Cardio</dt><dd><b>{v.cardio} min</b></dd></div>
    </dl>
    {program && program.planned > 0 && <p className="st-program">Program, 4 weeks <b>{Math.round((100 * program.done) / program.planned)}% · {program.done} / {program.planned} sets</b></p>}
    <LastWeek entries={entries} profile={profile} today={today} />
  </>);
}

// ---- Sheets ----

/** A lift over the range: its e1RM each session (drag across to read one), the best set, where it's heading, its rep maxes. */
function LiftSheet({ t, entries, today, range }: { t: Trend; entries: SetEntry[]; today: string; range: Range }) {
  const from = rangeFrom(range, today);
  const v = useMemo(() => {
    const kinds = prKinds(entries);
    const sets = liftSets(entries, t.name).filter((e) => e.date >= from && e.date <= today);
    const prDays = new Set(sets.filter((e) => kinds.get(e.id)?.includes('e1rm')).map((e) => e.date));
    let best: SetEntry | null = null, bv = -Infinity;
    for (const e of sets) { const x = e1rm(e); if (x != null && x > bv) { bv = x; best = e; } }
    const held = records(entries, t.name);
    const rms = ([3, 5, 8, 10, 12] as const).flatMap((n) => { const h = held.get(`rm${n}` as RecordKind); return h ? [{ n, v: h.value }] : []; });
    return { points: t.points.map((p) => ({ date: p.date, e1rm: p.v, pr: prDays.has(p.date) })), best, sessions: new Set(sets.map((e) => e.date)).size, rms };
  }, [entries, t, from, today]);
  const last = t.points.at(-1)!.v, peak = Math.max(...t.points.map((p) => p.v)), m = milestone(peak), pct = pctOf(t);
  const status = t.stall ? <span className="flat">— Flat {Math.max(1, t.stall.weeks)} wk</span> : pct == null ? 'New' : pct > 0.05 ? <span className="up">↑ Climbing</span> : pct < -0.05 ? <span className="down">↓ Down</span> : '— Level';
  return (<>
    <div className="st-dr-hero"><span className="st-dr-k">e1RM · {rangeLabel(range)}</span><span className="st-dr-v"><b>{Math.round(last)}</b> lb <Change pct={pct} flat={!!t.stall} weeks={t.stall?.weeks} /></span></div>
    <LineChart points={v.points} today={today} label={`${t.name} e1RM per session, last ${rangeWords(range)}`} what="this lift" />
    <dl className="st-cells3">
      <div><dt>Best set</dt><dd>{v.best ? fmtSet(v.best) : '—'}</dd></div>
      <div><dt>Sessions</dt><dd>{v.sessions}</dd></div>
      <div><dt>Status</dt><dd>{status}</dd></div>
    </dl>
    <div className="st-mile">
      <div className="st-mile-top">Next: {m.next} lb<span>{Math.max(1, Math.ceil(m.next - peak))} lb to go</span></div>
      <div className="st-meter" role="img" aria-label={`${Math.round(peak)} of ${m.next} lb`}><i style={{ '--w': `${Math.round(m.progress * 100)}%` } as CSSProperties} /></div>
    </div>
    {v.rms.length > 0 && (
      <div className="st-chips"><span className="st-chips-k">Rep maxes</span>{v.rms.map((r) => <span key={r.n} className="st-chip">{r.n}RM<span>{fmtAdded(r.v)}</span></span>)}</div>
    )}
  </>);
}

const CONFETTI = 16;
/** The newest PR's confetti, the first time this phone shows it on the tile; never again. */
function PrBurst({ owner, entries, today }: { owner: string; entries: SetEntry[]; today: string }) {
  const pr = useMemo(() => prCard(entries, today), [entries, today]);
  const [burst] = useState(() => !!pr && getPref<string>(owner, 'stats:pr-seen') !== pr.set.id);
  useEffect(() => { if (pr) setPref(owner, 'stats:pr-seen', pr.set.id); }, [pr, owner]);
  if (!burst) return null;
  return (
    <span className="st-confetti" aria-hidden="true">
      {Array.from({ length: CONFETTI }, (_, i) => <i key={i} style={{ '--i': i, '--x': `${((i * 37) % 100) - 50}px`, '--y': `${-40 - ((i * 53) % 70)}px`, '--r': `${(i * 67) % 360}deg`, '--c': `var(--kind-${['legs', 'push', 'pull', 'core', 'cardio'][i % 5]})` } as CSSProperties} />)}
    </span>
  );
}

const MAX_PRS = 30;
/** The newest PR of the week, then every PR in the range, newest first, with what each one broke. */
function PrSheet({ entries, prs, kinds, today, who, range }: { entries: SetEntry[]; prs: SetEntry[]; kinds: Map<string, RecordKind[]>; today: string; who?: string; range: Range }) {
  const pr = useMemo(() => prCard(entries, today, whoseOf(who)), [entries, today, who]);
  const list = [...prs].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.exercise.localeCompare(b.exercise)));
  return (<>
    {pr && (
      <section className="st-pr" aria-label="New PR">
        <span className="st-pr-cup" aria-hidden="true"><Icon name="trophy" size={24} sw={2} /></span>
        <div>
          <p className="st-pr-k">New PR · {shortDay(pr.set.date, today)}</p>
          <p className="st-pr-t">{pr.set.exercise} {fmtAdded(pr.set.weight)} × {pr.set.reps ?? '?'}</p>
          <p className="st-pr-d">{pr.detail}</p>
        </div>
      </section>
    )}
    <h3>Last {rangeWords(range)} · {plural(prs.length, 'PR')}</h3>
    <ul className="st-list" aria-label="PRs">
      {list.slice(0, MAX_PRS).map((e) => (
        <li key={e.id}><span className="st-list-d">{fmtDay(e.date, today)}</span><span className="st-list-m"><b>{e.exercise}</b> {fmtSet(e)}</span><span className="st-list-s">{(kinds.get(e.id) ?? []).map(recordLabel).join(', ')}</span></li>
      ))}
    </ul>
    {list.length > MAX_PRS && <p className="muted small">and {plural(list.length - MAX_PRS, 'more PR')} before those.</p>}
  </>);
}

function MilestonesSheet({ rows, range }: { rows: MileRow[]; range: Range }) {
  return (<>
    <ul className="st-miles" aria-label="Next milestones">
      {rows.map((r) => (
        <li key={r.name}>
          <span className="st-ml-n">{r.name}</span>
          <span className="st-ml-v"><b>{r.next}</b> lb<small>{r.toGo} lb to go</small></span>
          <span className="st-meter" role="img" aria-label={`${Math.round(r.best)} of ${r.next} lb`}><i style={{ '--w': `${Math.round(r.progress * 100)}%` } as CSSProperties} /></span>
        </li>
      ))}
    </ul>
    <p className="muted small">The next round number above each lift’s best e1RM in the last {rangeWords(range)}: steps of 5 lb under 50, 10 under 150, then 25.</p>
  </>);
}

/** This week's sets per muscle: what's behind (a lift for each), every muscle against its target band, the next steps. */
function MusclesSheet({ entries, profile, today, who, body, onOpenLift }: { entries: SetEntry[]; profile: Profile; today: string; who?: string; body?: readonly BodyDay[]; onOpenLift?: (name: string) => void }) {
  const v = useMemo(() => {
    const week = weeklyMuscleSets(entries, weekStart(today));
    const last = weeklyMuscleSets(entries, addDays(weekStart(today), -7));
    return { week, last };
  }, [entries, today]);
  const pace = weekPace(today);
  const behind = useMemo(() => behindRows(entries, profile, today), [entries, profile, today]);
  const gone = Math.round(pace * 7), dow = new Date(`${today}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
  return (<>
    <p className="st-hint">{dow}: {plural(gone, 'day')} of 7 gone. Fractional sets this week (direct 1, indirect ½; a chin-up’s biceps ¾) against each priority’s target range (outlined). “On pace” is short of the target but keeping up with the week so far.</p>
    {behind.length > 0 && (
      <section className="st-behind" aria-label="Behind this week">
        <h3><span className="st-status-ic" aria-hidden="true">!</span>Behind pace · {behind.length}{behind.some((b) => b.fix) && ` · a lift of ${who ? `@${who}’s` : 'yours'} for each`}</h3>
        <ul>
          {behind.map((b) => (
            <li key={b.muscle}>
              <span className="st-bh-m">{b.muscle}</span>
              <span className="st-bh-n">{fmt1(b.sets)} of {b.range[0]}–{b.range[1]}</span>
              {b.fix && (onOpenLift ? <button type="button" className="st-fix" onClick={() => onOpenLift(b.fix!)}>{b.fix}<Icon name="chev-right" size={16} sw={2} /></button> : <span className="st-fix">{b.fix}</span>)}
            </li>
          ))}
        </ul>
      </section>
    )}
    <MuscleBars sets={v.week.sets} profile={profile} pace={pace} />
    {v.week.unmapped.length > 0 && <p className="muted small">Not counted (unknown muscles): {v.week.unmapped.join(', ')}</p>}
    {body && <VolumeSteps entries={entries} body={body} profile={profile} today={today} />}
    <ChartTable caption="Fractional sets per muscle" head={['Muscle', 'This week / last week']} rows={MUSCLES.map((m) => [m, `${fmt1(v.week.sets[m])} / ${fmt1(v.last.sets[m])}`])} />
  </>);
}

/** Every muscle behind the week's pace (not just four), furthest first, each with a lift of theirs that works it. */
function behindRows(entries: SetEntry[], profile: Profile, today: string) {
  const pace = weekPace(today);
  if (pace <= 0) return [];
  const { sets } = weeklyMuscleSets(entries, weekStart(today));
  return MUSCLES.map((m) => ({ muscle: m, sets: sets[m], range: targetFor(profile, m) }))
    .filter((b) => b.range[0] > 0 && paceStatus(b.sets, b.range, pace) === 'under')
    .sort((a, b) => a.sets / a.range[0] - b.sets / b.range[0] || MUSCLES.indexOf(a.muscle) - MUSCLES.indexOf(b.muscle))
    .map((b) => ({ ...b, fix: quickFixOf(entries, b.muscle, today) }));
}
import { quickFix as quickFixOf } from '../domain/feed';
