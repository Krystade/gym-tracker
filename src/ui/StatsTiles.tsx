import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { addDays, calendarDays, REACH, SESSION_CAP, weekStart, weeklyMuscleSets, weeklySummary } from '../domain/analytics';
import { thisWeekCardio } from '../domain/cardio';
import { dayKinds } from '../domain/crew';
import { goalWeek, liftTrend, milestone, prCard, quickFix as quickFixOf, streakNudge, topLifts, weekPace, weekSets, type Trend } from '../domain/feed';
import { fmtAdded, fmtDay, fmtSet, fmtWeight, plural } from '../domain/format';
import { liftKey } from '../domain/ids';
import { lingering } from '../domain/painPlan';
import { painReport } from '../domain/care';
import { MUSCLES, type Muscle } from '../domain/muscles';
import { targetFor, type Profile } from '../domain/profile';
import { prKinds, recordLabel, records, type RecordKind } from '../domain/records';
import type { Rotation as RotationOffer } from '../domain/rotation';
import { stall as stallOf } from '../domain/rotation';
import { e1rm, liftSets } from '../domain/stats';
import { forViewer, rangeDays, rangeFrom, rangeLabel, rangeWeeks, rangeWords, type Range } from '../domain/statsLayout';
import type { Program } from '../domain/program';
import {
  balance, effort, energyVsLifts, hitRate, liftsInRotation, milestoneDate, MILESTONE_MIN_SESSIONS, plateaus, prTimeline, rateOfGain, rests, sessionsAWeek, strengthIndex, whenTrained, type LiftState,
} from '../domain/statsTiles';
import { restSeconds } from '../domain/timing';
import { weightSummary, type BodyDay } from '../domain/body';
import type { SetEntry } from '../domain/types';
import { streak } from '../domain/analytics';
import { getPref, setPref } from '../state/prefs';
import { BarChart } from './charts/BarChart';
import { Calendar } from './charts/Calendar';
import { ChartTable } from './charts/ChartTable';
import { MuscleBars, paceStatus } from './charts/MuscleBars';
import { CareBody } from './CareCard';
import { Icon } from './icons';
import { LineChart } from './LineChart';
import { Ring } from './Ring';
import { Cols, Heat, Meter, Spark, type TileView } from './StatsTile';
import {
  balanceWord, BalanceSheet, dayName, DaysSheet, Dir, EffortSheet, EnergySheet, HitRateSheet, hourLabel, LiftsSheet, mss, PlateauSheet, PrDots, PrKinds, Pips,
  PullPush, RateSheet, RestSheet, shortDate, signed, spread, SparkRef, StartSheet,
} from './StatsSheets';
import { VolumeSteps } from './VolumeSteps';
import { WeightSheet } from './WeightSheet';
import { LastWeek } from './WeekDigest';

// What each Stats v2 tile says and what its sheet holds (plan §2), from the props alone: the same tiles can show a friend's log
// (their entries, their profile, `who`) without reading anything of the person holding the phone. Each tile is its old card
// ported: Getting stronger → a tile per lift; Next milestones; New PR → PRs; Behind this week and Muscle volume → Muscles;
// Sessions per week; Weekly tonnage; Calendar; Joint & back care → Pain flags; This week and Last week → the hero and its sheet.
// Body (IA A5, owner 2026-10-21): a Weight tile, only on your own Stats and only once you've weighed in; no photos on Stats.
// A friend's page shows the same tiles from the line Friends keeps of them (`window`: 8 weeks of sets, their goal, the PR ids
// their phone wrote), reading nothing more; tiles that line can't fill, and those only the owner sees, are left out (forViewer).

export type SectionId = 'progress' | 'load' | 'consistency' | 'recovery' | 'body';
export const SECTIONS: { id: SectionId; title: string }[] = [
  { id: 'progress', title: 'Progress' },
  { id: 'load', title: 'Training load' },
  { id: 'consistency', title: 'Consistency' },
  { id: 'recovery', title: 'Recovery and health' },
  { id: 'body', title: 'Body' },
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
  /** The rest timer's seconds for a lift (your setting, else what your sets taught it, else the research default). */ timer?: (exercise: string) => number;
  /** Your own Stats: the variation a flat lift's page would offer (null: none, or dismissed). */ rotationOf?: (lift: string) => RotationOffer | null;
  onOpenLift?: (name: string) => void; onOpenPriorities?: () => void;
  /** The program: what a planned session left this week can add to a muscle (feed weekPace). */ program?: Program | null;
  /**
   * A friend's line as Friends keeps it (state/friendCache, 8 weeks): their PR sets are the ids their phone wrote from their whole
   * log (feed friendPrs), since 8 weeks can't tell a PR from a best-in-8-weeks; nothing that needs more than the window is shown.
   */
  window?: { prs: ReadonlySet<string> };
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
  const { entries, profile, today, range, who, owner, alsoLifts, body, timer, rotationOf, onOpenLift, onOpenPriorities, program, window: win } = input;
  const data = useMemo(() => work(entries, profile, today, range, alsoLifts ?? [], program, win?.prs), [entries, profile, today, range, alsoLifts, program, win?.prs]);
  // Your energy is yours: a friend's Stats leaves it out, as it does their body data.
  const more = useMemo(() => s2(entries, today, range, timer ?? DEFAULT_TIMER, owner ? body ?? [] : []), [entries, today, range, timer, owner, body]);
  // Body weight is yours alone too (owner, 2026-10-21: friends never see a friend's weight); forViewer leaves its tile out as well.
  const bw = useMemo(() => (owner ? weightSummary(body ?? [], rangeFrom(range, today), today) : null), [owner, body, range, today]);
  // ---- Body: weight, once there's a weigh-in (IA A5, owner 2026-10-21), with or without a set logged ----
  const weight: TileModel | null = bw && (() => {
    const r = bw.rate, band = bw.band, old = days(bw.last.date, today) > 14;
    return {
      id: 'weight', section: 'body', label: 'Weight', title: 'Body weight', value: bw.last.trend.toFixed(1), unit: 'lb trend',
      ctx: old ? <>last weighed {shortDate(bw.last.date)}</>
        : r && band ? <>{Math.abs(r.lbPerWeek) < 0.05 ? '—' : r.lbPerWeek > 0 ? '↑' : '↓'} {fmt1(Math.round(Math.abs(r.lbPerWeek) * 10) / 10)} lb/wk · <span className={band.tone === 'warn' ? 'warn' : undefined}>{band.label}</span></>
        : <>{plural(bw.count, 'weigh-in')} · rate after 2 wk</>,
      viz: (w) => <Spark values={bw.points.map((p) => p.trend)} w={w} />,
      sheet: () => <WeightSheet s={bw} body={body ?? []} today={today} range={range} />,
    };
  })();
  if (!entries.length) return forViewer(weight ? [weight] : [], { owner: !!owner, window: !!win });
  const whose = whoseOf(who), W = rangeWeeks(range), rl = rangeLabel(range);
  const out: TileModel[] = [];

  // ---- Progress: a tile per followed lift, PRs, the next milestone ----
  for (const l of data.lifts) {
    const t = l.trend, last = t.points.at(-1)!.v, flat = !!t.stall;
    out.push({
      id: liftTileId(t.name), section: 'progress', label: t.name, value: String(Math.round(last)), unit: 'lb',
      ctx: <><Change pct={pctOf(t)} flat={flat} weeks={t.stall?.weeks} />{!flat && pctOf(t) != null && <> · {rl}</>}</>,
      viz: (w) => <Spark values={t.points.map((p) => p.v)} w={w} />, news: l.news,
      sheet: () => <LiftSheet t={t} entries={entries} today={today} range={range} prIds={win?.prs} />,
      link: onOpenLift && <button type="button" className="st-link" onClick={() => onOpenLift(t.name)}>Open lift<Icon name="chev-right" size={18} sw={2} /></button>,
    });
  }
  const fol = rateOfGain(data.lifts.map((l) => ({ name: l.trend.name, points: l.trend.points })));
  if (fol.median != null) {
    const med = fol.median, index = strengthIndex(data.lifts.map((l) => l.trend), rangeFrom(range, today), W).filter((v): v is number => v != null);
    out.push({
      id: 'rate', section: 'progress', label: 'Rate of gain', value: signed(med), unit: '%/wk',
      ctx: <><Dir v={med} /> · median of {fol.rows.length}</>, viz: (w) => <Spark values={index} w={w} />,
      sheet: () => <RateSheet entries={entries} today={today} range={range} median={med} followed={fol.rows.length} />,
    });
  }
  if (data.prs.length) {
    const newest = data.prs.reduce((a, e) => (e.date > a.date ? e : a));
    const tl = prTimeline(data.prs.map((e) => ({ date: e.date, kinds: data.kinds.get(e.id) ?? [] })), rangeFrom(range, today), today);
    out.push({
      id: 'prs', section: 'progress', label: 'PRs', value: String(data.prs.length), unit: `in ${rl}`, ctx: <>{tl.thisMonth} this month · newest {shortDay(newest.date, today)}</>,
      viz: (w) => <PrDots dots={tl.dots} w={w} />, news: data.prNews,
      // A friend's line has which sets were PRs, not what each one broke: no kinds, and no newest-PR card worked out from 8 weeks.
      sheet: () => <PrSheet entries={entries} prs={data.prs} kinds={data.kinds} today={today} who={who} range={range} card={!win}
        byKind={!win && <PrKinds dots={tl.dots} groups={tl.groups} from={rangeFrom(range, today)} to={today} />} />,
      extra: owner && data.prNews && <PrBurst owner={owner} entries={entries} today={today} />,
    });
  }
  if (data.lifts.some((l) => l.trend.points.length >= 3)) {
    const states: LiftState[] = data.lifts.map((l) => ({ name: l.trend.name, stall: l.trend.stall && { weeks: l.trend.stall.weeks, since: l.trend.stall.since }, pct: pctOf(l.trend) }));
    const p = plateaus(states), longest = p.flat[0]?.stall?.weeks;
    out.push({
      id: 'plateaus', section: 'progress', label: 'Plateaus', value: String(p.flat.length), unit: `of ${p.of} flat`,
      ctx: p.flat.length ? <span className="flat">— longest {Math.max(1, longest ?? 1)} wk</span> : <>none flat</>,
      viz: (w) => <Pips pips={p.pips.map((x) => x.pip)} w={w} />, news: data.lifts.some((l) => l.newStall),
      sheet: () => <PlateauSheet flat={p.flat} moving={states.filter((x) => !x.stall)} today={today} rotationOf={rotationOf} onOpenLift={onOpenLift} who={who} />,
    });
  }
  if (data.miles.length) {
    const m = data.miles.reduce((a, b) => (b.toGo < a.toGo || (b.toGo === a.toGo && b.progress > a.progress) ? b : a));
    out.push({
      id: 'milestones', section: 'progress', label: 'Next milestone', title: 'Next milestones', value: String(m.next), unit: 'lb',
      ctx: <>{m.name} · {m.when ? `~${shortDate(m.when.date)}` : `${m.toGo} lb to go`}</>, viz: (w) => <Meter frac={m.progress} w={w} />,
      sheet: () => <MilestonesSheet rows={data.miles} range={range} />,
    });
  }
  if (more.hits.sets >= 3) {
    const h = more.hits, weekly = h.weekly.filter((v): v is number => v != null).map((v) => 100 * v);
    out.push({
      id: 'hitrate', section: 'progress', label: 'Target hit rate', value: String(Math.round((100 * h.hit) / h.sets)), unit: '%',
      ctx: <>{h.hit} of {h.sets} sets hit</>, viz: (w) => <Spark values={weekly} w={w} />,
      sheet: () => <HitRateSheet r={h} range={range} />,
    });
  }

  // ---- Training load: this week's muscles, tonnage ----
  const mu = data.muscles;
  out.push({
    id: 'muscles', section: 'load', label: 'Muscles · this week', title: 'Sets per muscle', value: String(mu.behind.length), unit: 'behind',
    ctx: <>{[mu.on && `${mu.on} on target`, mu.pace && `${mu.pace} on pace`, mu.over && `${mu.over} over`].filter(Boolean).join(' · ') || 'none on target yet'}</>,
    viz: (w) => <Cols values={mu.cols.map((c) => c.v)} w={w} colour={(i) => STATUS_COL[mu.cols[i].st]} />, news: mu.behind.length > 0,
    sheet: () => <MusclesSheet entries={entries} profile={profile} today={today} who={who} body={owner ? body : undefined} program={program} onOpenLift={onOpenLift} />,
    link: onOpenPriorities && <button type="button" className="st-link" onClick={onOpenPriorities}>Priorities<Icon name="chev-right" size={18} sw={2} /></button>,
  });
  if (more.effort && more.effort.logged >= 3) {
    const e = more.effort;
    out.push({
      id: 'effort', section: 'load', label: 'How hard', value: e.avg.toFixed(1), unit: 'RIR avg',
      ctx: <>{Math.round(e.hard * 100)}% at RIR 0–2</>,
      viz: (w) => <Cols values={e.bins} w={w} colour={(i) => (i <= 2 ? 'var(--accent)' : 'var(--col)')} />,
      sheet: () => <EffortSheet r={e} range={range} />,
    });
  }
  if (more.rests && more.rests.n >= 3) {
    const r = more.rests, d = r.rest - r.timer, perSession = r.sessions.flatMap((x) => (x.rest == null ? [] : [x.rest]));
    out.push({
      id: 'rest', section: 'load', label: 'Rest between sets', value: mss(r.rest), unit: 'median',
      ctx: <>timer {mss(r.timer)} · {Math.abs(d) < 15 ? '— at it' : `${d > 0 ? '↑' : '↓'} ${mss(Math.abs(d))} ${d > 0 ? 'longer' : 'shorter'}`}</>,
      viz: (w) => <SparkRef values={perSession} at={r.timer} w={w} />,
      sheet: () => <RestSheet r={r} range={range} today={today} />,
    });
  }
  if (more.balance.ratio != null && more.balance.pull > 0 && more.balance.pull + more.balance.push >= 6) {
    const b = more.balance;
    out.push({
      id: 'pullpush', section: 'load', label: 'Pull vs push', value: b.ratio!.toFixed(1), unit: 'pull per push',
      ctx: <>{balanceWord(b.ratio!)}</>, vizHeight: 30, viz: (w) => <PullPush pull={b.pull} push={b.push} w={w} />,
      sheet: () => <BalanceSheet b={b} range={range} weeks={more.weeks} />,
    });
  }
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

  if (more.lifts.lifts.length >= 2) {
    const r = more.lifts;
    out.push({
      id: 'lifts', section: 'load', label: 'Lifts in rotation', value: String(r.lifts.length), unit: 'lifts',
      ctx: <>{[r.fresh.length > 0 && `${r.fresh.length} new`, r.dropped.length > 0 && `${r.dropped.length} dropped`].filter(Boolean).join(' · ') || 'none new'}</>,
      // Through last week: a week under way understates it.
      viz: (w) => <Spark values={r.weekly.length > 2 ? r.weekly.slice(0, -1) : r.weekly} w={w} />,
      sheet: () => <LiftsSheet r={r} range={range} today={today} />,
    });
  }

  // ---- Consistency: the calendar, sessions a week, best days, the usual start ----
  out.push({
    id: 'calendar', section: 'consistency', label: 'Calendar', value: String(data.trained), unit: data.trained === 1 ? 'day trained' : 'days trained',
    ctx: <>{rangeWords(range)} · Monday on top</>, wide: true, vizHeight: 68,
    viz: (w) => <Heat weeks={data.heat} w={w} h={68} />,
    sheet: () => <Calendar days={data.days} today={today} label={`Training calendar, last ${plural(W, 'week')}`} />,
  });
  {
    // Over the weeks since the first logged set, not the range's weeks before it (owner bug, 2026-10-21).
    const goal = profile.weeklyGoal, sw = sessionsAWeek(data.weeks, data.first, goal), n = sw.weeks.length;
    out.push({
      id: 'sessions', section: 'consistency', label: 'Sessions a week', value: sw.avg.toFixed(1), unit: 'avg',
      ctx: <>goal {goal} · met {sw.met} of {sw.of}</>,
      viz: (w) => <Cols values={sw.weeks.map((x) => x.sessions)} w={w} goal={goal} />,
      sheet: () => (<>
        <BarChart label={`Sessions per week, last ${plural(n, 'week')}`} points={sw.weeks.map((x) => ({ x: x.week, y: x.sessions }))} format={(k) => plural(k, 'session')} goal={goal} />
        <p className="muted small">The line: {whose} goal of {plural(goal, 'session')}. A day counts once it has a lifted set; cardio-only days don’t count toward it. The average is over {sw.of === 1 ? 'this week' : `the ${sw.of} whole weeks`}{n < W ? ' since the first logged set' : ''}{sw.of > 1 ? ', this one left out until it’s done' : ''}.</p>
        <ChartTable caption="Sessions per week" head={['Week of', 'Sessions']} rows={sw.weeks.map((x) => [x.week, String(x.sessions)])} />
      </>),
    });
  }

  const wt = more.when;
  if (wt.days >= 3) {
    const a = wt.top[0];
    out.push({
      id: 'days', section: 'consistency', label: 'Best days', word: true, value: a == null ? 'No favourite' : wt.top.map((i) => dayName(i)).join(' · '),
      ctx: <>{a == null ? `${wt.days} days over ${plural(wt.weeks, 'week')}` : `${wt.byDay[a]} of ${wt.weeks} ${dayName(a, true)}s`}</>,
      viz: (w) => <Cols values={wt.byDay} w={w} colour={(i) => (wt.top.includes(i) ? 'var(--accent)' : 'var(--col)')} />,
      sheet: () => <DaysSheet w={wt} range={range} />,
    });
  }
  if (wt.timed >= 3 && wt.start != null) {
    const used = wt.hours.flatMap((n, h) => (n ? [h] : [])), usual = Math.floor(wt.start);
    const lo = Math.max(0, Math.min(used[0] - 1, usual - 3)), hi = Math.min(23, Math.max(used.at(-1)! + 1, lo + 6));
    out.push({
      id: 'start', section: 'consistency', label: 'Usual start', value: hourLabel(wt.start),
      ctx: <>{spread(wt) || `${wt.timed} days timed`}</>,
      viz: (w) => <Cols values={wt.hours.slice(lo, hi + 1)} w={w} colour={(i) => (lo + i === usual ? 'var(--accent)' : 'var(--col)')} />,
      sheet: () => <StartSheet w={wt} range={range} />,
    });
  }

  // ---- Recovery and health: pain, energy ----
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
  if (more.energy && more.energy.days.length >= 3) {
    const e = more.energy;
    out.push({
      id: 'energy', section: 'recovery', label: 'Energy', value: e.avg.toFixed(1), unit: 'of 5',
      ctx: <>{e.low != null && e.high != null ? `lifts: low days ${signed(e.low, 0)}% · high ${signed(e.high, 0)}%` : `${e.days.length} days logged`}</>,
      viz: (w) => <Spark values={e.days.map((d) => d.energy)} w={w} />,
      sheet: () => <EnergySheet e={e} range={range} today={today} />,
    });
  }

  if (weight) out.push(weight);
  return forViewer(out, { owner: !!owner, window: !!win });
}

/** Without a timer to ask: the research default. */
const DEFAULT_TIMER = (exercise: string) => restSeconds(exercise);

/** What S2's tiles read over the range: one pass each, once per log, day, range, timer and body log. */
function s2(entries: SetEntry[], today: string, range: Range, timer: (exercise: string) => number, body: readonly BodyDay[]) {
  const from = rangeFrom(range, today);
  return {
    hits: hitRate(entries, from, today), effort: effort(entries, from, today), rests: rests(entries, from, today, timer),
    balance: balance(entries, from, today), lifts: liftsInRotation(entries, from, today), when: whenTrained(entries, from, today),
    energy: energyVsLifts(entries, body, from, today),
    /** Each week's Monday over the range, oldest first (the balance's weekly rows). */
    weeks: Array.from({ length: Math.floor((Date.parse(weekStart(today)) - Date.parse(weekStart(from))) / (7 * DAY)) + 1 }, (_, i) => addDays(weekStart(from), 7 * i)),
  };
}

const STATUS_COL = { under: 'var(--warn)', pace: 'var(--col)', on: 'var(--ok)', over: 'var(--accent)' } as const;

interface LiftRow { trend: Trend; news: boolean; newStall: boolean }
interface MileRow { name: string; best: number; next: number; progress: number; toGo: number; /** When the trend gets there (6+ sessions, rising). */ when: { date: string; early: string; late: string } | null }

/** Everything the tiles read, worked out once per log, profile, day and range. */
function work(entries: SetEntry[], profile: Profile, today: string, range: Range, also: string[], program?: Program | null, prIds?: ReadonlySet<string>) {
  const span = rangeDays(range), W = rangeWeeks(range), from = rangeFrom(range, today), weekAgo = addDays(today, -6);
  const kinds = prIds ? new Map<string, RecordKind[]>() : prKinds(entries);
  const isPr = (e: SetEntry) => (prIds ? prIds.has(e.id) : kinds.has(e.id));
  const prs = entries.filter((e) => isPr(e) && e.date >= from && e.date <= today);
  const prNews = prs.some((e) => e.date >= weekAgo);

  // The four lifts followed (and any pinned), each a tile with news when it set a PR this week or went flat since a week ago.
  const names = [...new Set([...topLifts(entries, today, 4, span), ...also])];
  const lifts: LiftRow[] = names.flatMap((name) => {
    const trend = liftTrend(entries, name, today, span);
    if (!trend) return [];
    const k = liftKey(name);
    const pr = prs.some((e) => e.date >= weekAgo && liftKey(e.exercise) === k);
    const newStall = !!trend.stall && !stallOf(entries, name, addDays(today, -7));
    return [{ trend, news: pr || newStall, newStall }];
  });
  const miles: MileRow[] = lifts.map(({ trend: t }) => {
    const best = Math.max(...t.points.map((p) => p.v)), m = milestone(best);
    return { name: t.name, best, next: m.next, progress: m.progress, toGo: Math.max(1, Math.ceil(m.next - best)), when: milestoneDate(t.points, m.next, today) };
  });

  // This week's muscles against each one's target: behind only once the sessions the week has left can't make it up, each at
  // what a session of his realistically gives that muscle (feed weekPace).
  const { left, reach } = weekPace(entries, profile, today, program);
  const { sets } = weeklyMuscleSets(entries, weekStart(today));
  const st = MUSCLES.map((m) => ({ m, range: targetFor(profile, m) })).filter((x) => x.range[0] > 0)
    .map((x) => ({ m: x.m, v: Math.min(1.2, sets[x.m] / x.range[0]), st: paceStatus(sets[x.m], x.range, left, reach[x.m]) }));
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

  // The first logged set (any kind): Sessions a week averages from its week on.
  let first: string | null = null;
  for (const e of entries) if (first == null || e.date < first) first = e.date;

  return { kinds, prs, prNews, lifts, miles, muscles, left, weeks, first, days: calDays, heat, trained, pain };
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
function LiftSheet({ t, entries, today, range, prIds }: { t: Trend; entries: SetEntry[]; today: string; range: Range; /** A friend's line: their PR ids (useTiles `window`). */ prIds?: ReadonlySet<string> }) {
  const from = rangeFrom(range, today);
  const v = useMemo(() => {
    const kinds = prIds ? null : prKinds(entries);
    const sets = liftSets(entries, t.name).filter((e) => e.date >= from && e.date <= today);
    const prDays = new Set(sets.filter((e) => (kinds ? kinds.get(e.id)?.includes('e1rm') : prIds!.has(e.id))).map((e) => e.date));
    let best: SetEntry | null = null, bv = -Infinity;
    for (const e of sets) { const x = e1rm(e); if (x != null && x > bv) { bv = x; best = e; } }
    // Rep maxes are all-time records: 8 weeks of a friend's sets would pass off their best in 8 weeks as one.
    const held = prIds ? new Map<RecordKind, { value: number }>() : records(entries, t.name);
    const rms = ([3, 5, 8, 10, 12] as const).flatMap((n) => { const h = held.get(`rm${n}` as RecordKind); return h ? [{ n, v: h.value }] : []; });
    return { points: t.points.map((p) => ({ date: p.date, e1rm: p.v, pr: prDays.has(p.date) })), best, sessions: new Set(sets.map((e) => e.date)).size, rms };
  }, [entries, t, from, today, prIds]);
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
function PrSheet({ entries, prs, kinds, today, who, range, byKind, card = true }: { entries: SetEntry[]; prs: SetEntry[]; kinds: Map<string, RecordKind[]>; today: string; who?: string; range: Range; /** The timeline by kind. */ byKind?: ReactNode; /** The newest PR's card (worked out from the whole log). */ card?: boolean }) {
  const pr = useMemo(() => (card ? prCard(entries, today, whoseOf(who)) : null), [entries, today, who, card]);
  const list = [...prs].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.exercise.localeCompare(b.exercise)));
  return (<>
    {pr && (
      <section className="st-pr" aria-label="New PR">
        <span className="st-pr-cup" aria-hidden="true"><Icon name="trophy" size={24} sw={2} /></span>
        <div>
          <p className="st-pr-k">New PR · {shortDay(pr.set.date, today)}</p>
          <p className="st-pr-t">{pr.set.exercise} {fmtSet(pr.set)}</p>
          <p className="st-pr-d">{pr.detail}</p>
        </div>
      </section>
    )}
    {byKind}
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
          {r.when && <span className="st-ml-d">Likely about <b>{shortDate(r.when.date)}</b>{r.when.early !== r.when.late && ` · ${shortDate(r.when.early)} to ${shortDate(r.when.late)}`}</span>}
        </li>
      ))}
    </ul>
    <p className="muted small">The next round number above each lift’s best e1RM in the last {rangeWords(range)}: steps of 5 lb under 50, 10 under 150, then 25.{rows.some((r) => r.when) && ` A date shows once a lift has ${MILESTONE_MIN_SESSIONS} or more sessions and is clearly climbing: where its trend line gets there, and the range it lands in 8 times in 10.`}</p>
  </>);
}

/** This week's sets per muscle: what's behind (a lift for each), every muscle against its target band, the next steps. */
export function MusclesSheet({ entries, profile, today, who, body, program, onOpenLift }: { entries: SetEntry[]; profile: Profile; today: string; who?: string; body?: readonly BodyDay[]; program?: Program | null; onOpenLift?: (name: string) => void }) {
  const v = useMemo(() => {
    const week = weeklyMuscleSets(entries, weekStart(today));
    const last = weeklyMuscleSets(entries, addDays(weekStart(today), -7));
    return { week, last };
  }, [entries, today]);
  const { left, reach } = useMemo(() => weekPace(entries, profile, today, program), [entries, profile, today, program]);
  const behind = useMemo(() => behindRows(entries, profile, today, program), [entries, profile, today, program]);
  const dow = new Date(`${today}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
  return (<>
    <p className="st-hint">{dow}: {left ? `${plural(left, 'session')} left this week` : 'the week is done'}{who ? '' : ` at your goal of ${profile.weeklyGoal}`}. Fractional sets this week (direct 1, indirect ½; a chin-up’s biceps ¾) against each priority’s target range (outlined). “On pace”: short of the target, but the sessions left can still make it up, each at what a session of {who ? `@${who}’s` : 'yours'} usually gives that muscle and half again ({REACH.floor} to {SESSION_CAP} sets). Behind: they can’t.</p>
    {behind.length > 0 && (
      <section className="st-behind" aria-label="Behind this week">
        <h3><span className="st-status-ic" aria-hidden="true">!</span>Behind · {behind.length}{behind.some((b) => b.fix) && ` · a lift of ${who ? `@${who}’s` : 'yours'} for each`}</h3>
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
    <MuscleBars sets={v.week.sets} profile={profile} left={left} reach={reach} />
    {v.week.unmapped.length > 0 && <p className="muted small">Not counted (unknown muscles): {v.week.unmapped.join(', ')}</p>}
    {body && <VolumeSteps entries={entries} body={body} profile={profile} today={today} />}
    <ChartTable caption="Fractional sets per muscle" head={['Muscle', 'This week / last week']} rows={MUSCLES.map((m) => [m, `${fmt1(v.week.sets[m])} / ${fmt1(v.last.sets[m])}`])} />
  </>);
}

/** Every muscle behind what the rest of the week can make up (not just four), furthest first, each with a lift of theirs that works it. */
function behindRows(entries: SetEntry[], profile: Profile, today: string, program?: Program | null) {
  const { left, reach } = weekPace(entries, profile, today, program);
  const { sets } = weeklyMuscleSets(entries, weekStart(today));
  return MUSCLES.map((m) => ({ muscle: m, sets: sets[m], range: targetFor(profile, m) }))
    .filter((b) => b.range[0] > 0 && paceStatus(b.sets, b.range, left, reach[b.muscle]) === 'under')
    .sort((a, b) => a.sets / a.range[0] - b.sets / b.range[0] || MUSCLES.indexOf(a.muscle) - MUSCLES.indexOf(b.muscle))
    .map((b) => ({ ...b, fix: quickFixOf(entries, b.muscle, today) }));
}
