import type { BodyDay } from '../domain/body';
import { MUSCLES, type Muscle } from '../domain/muscles';
import type { DayPlan, Program, Slot } from '../domain/program';
import type { Profile } from '../domain/profile';
import type { SetEntry } from '../domain/types';
import type { Systemic } from '../domain/learn/deload';
import { dayLabel, readinessModel, type Readiness, type SessionReady } from '../domain/learn/readiness';
import { P_FRESH } from '../domain/learn/recovery';
import { readinessPlanned, type PlanDay, type WeekPlan } from '../domain/learn/schedule';

// Readiness S4: what the READY tile, the week strip and the Why sheet say, from learn/schedule.readinessPlanned. Pure, so every
// string they show can be checked (by the day only, owner Q2: no clock time anywhere) without a browser.

export type Planned = Readiness & { plan: WeekPlan | null };

export interface ReadyInput {
  entries: readonly SetEntry[]; body: readonly BodyDay[];
  program: Program | null; plans: readonly DayPlan[]; profile: Profile;
  /** The quick day's slots for today (no program only), as Today would build it. */
  quick: Slot[] | null;
  today: string; tz: string;
  tapped?: { from: string; end?: string } | null;
}

const sameRefs = <T>(a: readonly T[], b: readonly T[]) => a === b || (a.length === b.length && a.every((x, i) => x === b[i]));

/** The input as the day started: the log and plans before today (so a set or a plan picked today never moves it). */
export const beforeToday = (i: ReadyInput): ReadyInput => ({ ...i, entries: i.entries.filter((e) => e.date < i.today), plans: i.plans.filter((p) => p.date < i.today) });

let LAST: { i: ReadyInput; out: Planned } | null = null;
/**
 * The day's readiness and week plan as the day started (see beforeToday), kept while its inputs are the same: a set logged today
 * recomputes nothing. The tile shows it until today's first set, and Today suggests its session.
 */
export function readyMorning(input: ReadyInput): Planned {
  const i = beforeToday(input);
  const l = LAST?.i;
  if (l && l.today === i.today && l.tz === i.tz && l.body === i.body && l.program === i.program && l.profile === i.profile && l.quick === i.quick
    && (l.tapped?.from ?? '') === (i.tapped?.from ?? '') && (l.tapped?.end ?? '') === (i.tapped?.end ?? '')
    && sameRefs(l.entries, i.entries) && sameRefs(l.plans, i.plans)) return LAST!.out;
  const out = planned(i);
  LAST = { i, out };
  return out;
}

/** The day's readiness and plan now (today's sets and plan in): after the first set, when he opens the tile again. */
export const readyNow = (i: ReadyInput): Planned => planned(i);

function planned(i: ReadyInput): Planned {
  return readinessPlanned({ entries: i.entries, body: i.body, weeklyGoal: i.profile.weeklyGoal, program: i.program, plans: i.plans, quick: i.quick, today: i.today, tz: i.tz, tapped: i.tapped, profile: i.profile });
}

/**
 * The program day Today suggests (owner Q3: the planner may reorder days): the plan's session today; on a rest day (or the goal
 * met), the readiest candidate. Null: nothing to suggest (no program), so Today keeps program.nextDay.
 */
export function suggestedDay(r: Planned): number | null {
  const d0 = r.plan?.days[0];
  if (d0?.train && d0.session?.kind === 'program' && d0.session.day != null) return d0.session.day;
  return r.best?.day ?? null;
}

// ---- The tile ----------------------------------------------------------------------------------------------------------------

export interface TileView {
  /** The number as shown (never "0": under 1 % reads "<1"); null with nothing to read it from (the calm fallback). */
  number: string | null;
  verdict: string;
  kind: 'go' | 'tight' | 'light' | 'rest';
  /**
   * The session it reads ("Day A"), and its sets at full strength ("9 of 11 sets at full strength"): Ready's own count (a set
   * that may hurt counts less, as in the number), so the two always agree.
   */
  session: string | null; sets: string | null;
  /** The next fresh day, as a day: "Fresh today", "Fresh by Thu"; on a rest day the next session: "Next: Day B · Sat". */
  fresh: string | null;
  /** One calm line: a layoff, no history yet, nothing to read. */
  note: string | null;
}

/** The session the tile reads: today's in the plan, else the readiest candidate. */
export function tileSession(r: Planned): { name: string; ready: SessionReady } | null {
  const d0 = r.plan?.days[0];
  if (d0?.train && d0.session && d0.ready && d0.ready.ready != null) return { name: d0.session.name, ready: d0.ready };
  return r.best ? { name: r.best.name, ready: r.best } : null;
}

export const shownNumber = (n: number | null): string | null => (n == null ? null : n < 1 ? '<1' : String(Math.round(n)));

export function tileView(r: Planned): TileView {
  const s = tileSession(r);
  const today = r.today;
  const v = r.verdict;
  // Never trained: nothing to read a number from (it would say 100 of nothing), so the calm line instead.
  const note = r.layoff.on && r.layoff.sinceLast != null ? `First session in ${r.layoff.sinceLast} days: always a go after a break.` : null;
  if (!s || r.layoff.sinceLast == null) {
    return { number: null, verdict: v.label, kind: v.kind, session: null, sets: null, fresh: null, note: note ?? 'Log a few sessions and this learns when you’re fresh, muscle by muscle.' };
  }
  const sr = s.ready;
  let fresh: string | null = null;
  if (v.kind === 'rest') {
    const next = r.plan?.days.find((d) => d.train && d.date > today);
    fresh = next ? `Next: ${next.session?.name ?? 'train'} · ${dayLabel(next.date, today)}` : null;
  } else if (sr.freshBy) fresh = sr.freshBy <= today ? 'Fresh today' : `Fresh by ${dayLabel(sr.freshBy, today)}`;
  return {
    number: shownNumber(sr.ready), verdict: v.label, kind: v.kind, session: s.name,
    sets: sr.total > 0 && sr.ready != null ? `${Math.round((sr.ready * sr.total) / 100)} of ${sr.total} sets at full strength` : null, fresh, note,
  };
}

// ---- The week strip ----------------------------------------------------------------------------------------------------------

export interface StripDay {
  date: string;
  /** "Today", else the weekday ("Thu"). */
  label: string;
  mark: 'train' | 'light' | 'rest' | 'optional';
  session: string | null;
}
export interface StripView {
  days: StripDay[];
  /** Each rest reason once, with the days it covers: "Thu, Fri" · "Less usual for you than the days planned". */
  reasons: { days: string; label: string }[];
  /** "1 of 3 done" this week. */
  goal: string;
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekday = (d: string) => WD[new Date(`${d}T00:00:00Z`).getUTCDay()];

export function stripView(r: Planned): StripView | null {
  const p = r.plan;
  if (!p || !p.days.length) return null;
  const goalMet = r.verdict.why === 'goal-met';
  const days: StripDay[] = p.days.map((d: PlanDay, i) => ({
    date: d.date, label: i === 0 ? 'Today' : weekday(d.date),
    // The goal met: today is an extra, optional (owner S4), whatever the plan rests it for.
    mark: i === 0 && goalMet && !d.train ? 'optional' : d.train ? (d.light ? 'light' : 'train') : 'rest',
    session: d.train ? d.session?.name ?? null : null,
  }));
  const reasons: { days: string[]; label: string }[] = [];
  p.days.forEach((d, i) => {
    if (d.train || !d.rest) return;
    const label = i === 0 && goalMet ? 'Goal met · an extra session is optional' : d.rest.label;
    const at = reasons.find((x) => x.label === label);
    const name = i === 0 ? 'Today' : weekday(d.date);
    if (at) at.days.push(name); else reasons.push({ days: [name], label });
  });
  return { days, reasons: reasons.map((x) => ({ days: x.days.join(', '), label: x.label })), goal: `${r.week.done} of ${r.week.goal} done` };
}

// ---- The Why sheet -----------------------------------------------------------------------------------------------------------

export interface MuscleRow { muscle: Muscle; last: string; fresh: string; pct: number }
export interface VolumeRow { muscle: Muscle; done: number; planned: number; band: [number, number]; text: string }
export interface WhyView {
  /** The verdict, and why in a sentence. */
  verdict: string; because: string;
  /** Waiting's gain, when today rested for recovery or nearly did (owner S4: a whole set or more). */
  gain: string | null;
  muscles: MuscleRow[];
  /** "research 80% · you 20%". */
  source: string;
  energy: string; systemic: string; pain: string[];
  volume: VolumeRow[];
}

const DAY = 864e5;
const ago = (date: string, today: string) => {
  const n = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
};
const sets1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '');

const SYSTEMIC: Record<Systemic['verdict'], string> = {
  deload: 'Down across your lifts, with a second sign: a light week is suggested',
  break: 'Back from a week off: that unloaded you, no deload needed',
  light: 'A light week is on: half the sets',
  few: 'Too few recent sessions across your lifts to read a trend',
  steady: 'Steady across your lifts: no deload',
  alone: 'Down across your lifts, but nothing else says tired: no deload yet',
};

function because(r: Planned): string {
  const goal = r.week.goal;
  switch (r.verdict.why) {
    case 'layoff': return r.layoff.sinceLast == null ? 'No sessions logged yet: always a go.' : `${r.layoff.sinceLast} days since you trained: after a break, always a go.`;
    case 'goal-met': return `Your goal of ${goal} this week is met. More sets this week still help size, so an extra session is fine.`;
    case 'plan-rest': {
      const why = r.plan?.days[0]?.rest?.label;
      return `Your week’s plan meets your goal of ${goal} with today off${why ? `: ${why.charAt(0).toLowerCase()}${why.slice(1)}` : ''}.`;
    }
    case 'deload': return 'Down across your lifts with a second sign: go light, about half the sets.';
    case 'light': return 'A light week is on: about half the sets.';
    case 'tight': return `No spare day left for your goal of ${goal}: every day left counts.`;
    case 'plan': return 'Today is in your week’s plan.';
    default: return 'No reason to wait.';
  }
}

export function whyView(r: Planned, i: Pick<ReadyInput, 'entries' | 'body' | 'tz'>, sys: Systemic | null): WhyView {
  const today = r.today;
  const rec = readinessModel(i.entries, i.body, today, i.tz).recovery;
  const muscles: MuscleRow[] = [];
  if (rec) {
    for (const m of MUSCLES) {
      const x = rec.muscles.get(m);
      if (!x?.lastTrained || x.lastTrained < new Date(Date.parse(`${today}T00:00:00Z`) - 13 * DAY).toISOString().slice(0, 10)) continue;
      const p = rec.pRecovered(m, today), f = p > P_FRESH ? today : rec.freshBy(m);
      muscles.push({ muscle: m, last: ago(x.lastTrained, today), fresh: f == null ? '—' : f <= today ? 'now' : dayLabel(f, today), pct: Math.round(100 * p) });
    }
    muscles.sort((a, b) => a.pct - b.pct || a.muscle.localeCompare(b.muscle));
  }
  const gain = r.plan?.restGain
    ? r.plan.restGain.held
      ? `Waiting would gain only ${sets1(r.plan.restGain.sets)} of a set at full strength: under a whole set, so today is a go.`
      : `Waiting gains ${sets1(r.plan.restGain.sets)} sets at full strength this week.`
    : null;
  const e = r.energy;
  const todayE = e.today != null ? ` Today ${e.today}${e.usual != null ? `, your usual ${e.usual}` : ''}.` : '';
  const energy = e.status === 'active'
    ? `Energy moves the number: your sessions track it (${e.n} sessions).${todayE}`
    : e.status === 'learning'
      ? `Energy is learning (${e.n} sessions): it moves nothing until it clearly predicts your sessions.${todayE}`
      : `Energy moves nothing yet: it starts learning after 3 sessions with it logged (${e.n} so far).${todayE}`;
  const s = tileSession(r);
  const pain = (s?.ready.lifts ?? []).filter((l) => l.pain >= 0.05).sort((a, b) => b.pain - a.pain)
    .map((l) => `${l.exercise}: ${Math.round(100 * l.pain)}% chance it hurts, its sets count that much less`);
  const volume: VolumeRow[] = (r.plan?.volume ?? []).filter((v) => v.band[1] > 0)
    .map((v) => ({ muscle: v.muscle, done: v.done, planned: v.planned, band: v.band, text: `${sets1(v.planned)} of ${v.band[0]}–${v.band[1]}` }));
  return {
    verdict: r.verdict.label, because: because(r), gain, muscles, source: r.source.label,
    energy, systemic: sys ? SYSTEMIC[sys.verdict] : 'Not enough history yet to read a trend',
    pain: pain.length ? pain : ['No pain risk in this session'], volume,
  };
}
