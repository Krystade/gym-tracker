import { addDays, streak, weekStart, weeklyMuscleSets, weeklySummary } from './analytics';
import { isCardio, isCardioEntry } from './cardio';
import { monthOf } from './cloud';
import { dayKinds, isWorking, KINDS, sessionOn, type Kind, type LiftDone } from './crew';
import { liftKey, normalizeName } from './ids';
import { resolveLift } from './lifts';
import { MUSCLES, muscleVector, type Muscle } from './muscles';
import { targetFor, type Profile } from './profile';
import { prIds, prKinds, prToast, type RecordKind } from './records';
import { byOrderDone, doneAt, e1rm, liftIndex, sessionsFor } from './stats';
import { stall, type Stall } from './rotation';
import type { SetEntry } from './types';

// Friends as a feed and Stats as answers (round 18): what each person did today, who's training now, each one's week against
// their own goal, and each one's change against their own start. Nothing here compares one person's loads with another's.

/** Live: the newest working set or cardio bout is under this old. Friends' lines are read again every 5 minutes at most. */
export const LIVE_MS = 20 * 60_000;
/** A set timed this far ahead of now still counts (a phone's clock a little fast); further, it's ignored. */
const AHEAD_MS = 5 * 60_000;
const DAY = 864e5;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);

/** Short names for a day's kinds on a card ("Push", "Arms & core + Cardio"). */
export const KIND_SHORT: Record<Kind, string> = { legs: 'Legs', push: 'Push', pull: 'Pull', core: 'Arms & core', cardio: 'Cardio' };

/** When the newest working set or cardio bout was done, if under LIVE_MS before `now`; else null. Sets with no time never count. */
export function liveSince(sets: readonly SetEntry[], now: number): number | null {
  let best = -Infinity;
  for (const e of sets) {
    if (!isWorking(e) && !isCardioEntry(e)) continue;
    const t = doneAt(e);
    if (Number.isNaN(t) || t > now + AHEAD_MS) continue;
    if (t > best) best = t;
  }
  return best >= now - LIVE_MS ? best : null;
}

const KIND_OF_MUSCLE: Record<Muscle, Exclude<Kind, 'cardio'>> = {
  Quads: 'legs', Hamstrings: 'legs', Glutes: 'legs', Calves: 'legs', Adductors: 'legs', Abductors: 'legs',
  Chest: 'push', Triceps: 'push', 'Front Delts': 'push', 'Side Delts': 'push',
  Lats: 'pull', 'Mid-Back': 'pull', 'Rear Delts': 'pull', Biceps: 'pull', Traps: 'pull',
  Abs: 'core', Forearms: 'core', Erectors: 'core',
};
const LIFT_KIND = new Map<string, Kind | null>();
/** What a lift trains most, as one of Crew's kinds (domain/crew dayKinds, for one lift); a cardio machine is cardio; unknown, null. */
export function liftKind(name: string): Kind | null {
  let k = LIFT_KIND.get(name);
  if (k !== undefined) return k;
  k = null;
  if (isCardio(name)) k = 'cardio';
  else {
    const v = muscleVector(name), score: Partial<Record<Kind, number>> = {};
    for (const [m, f] of Object.entries(v ?? {}) as [Muscle, number][]) score[KIND_OF_MUSCLE[m]] = (score[KIND_OF_MUSCLE[m]] ?? 0) + f;
    let top = 0;
    for (const kind of KINDS) if ((score[kind] ?? 0) > top) { top = score[kind]!; k = kind; }
  }
  if (LIFT_KIND.size > 2000) LIFT_KIND.clear();
  LIFT_KIND.set(name, k);
  return k;
}
/** A set's kind: cardio for a cardio bout, its lift's kind for a working set, null for a warm-up. */
export const setKind = (e: SetEntry): Kind | null => (isCardioEntry(e) ? 'cardio' : e.flags.includes('warmup') ? null : liftKind(e.exercise));

/** A ring's segments for a day's sets, in the order done: a working set's kind each (null: a lift no kind maps), a cardio bout one per 3 minutes. */
export function ringSets(day: readonly SetEntry[]): (Kind | null)[] {
  const out: (Kind | null)[] = [];
  for (const e of [...day].sort(byOrderDone)) {
    if (isCardioEntry(e)) for (let i = Math.max(1, Math.round((e.cardio?.seconds ?? 0) / 180)); i > 0; i--) out.push('cardio');
    else if (isWorking(e)) out.push(liftKind(e.exercise));
  }
  return out;
}

/** A ring's worth of working sets for someone: the median of their sessions before today (15 with under three), 6 to 30. */
export function usualSession(sets: readonly SetEntry[], today: string): number {
  const per = new Map<string, number>();
  for (const e of sets) if (e.date < today && isWorking(e)) per.set(e.date, (per.get(e.date) ?? 0) + 1);
  const xs = [...per.values()].sort((a, b) => a - b);
  if (xs.length < 3) return 15;
  const mid = xs.length >> 1, m = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return Math.min(30, Math.max(6, Math.round(m)));
}

/**
 * This week against their own goal, counted as their Stats counts it (domain/analytics): days with a working lift set, cardio-only
 * days beside them. `metToday`: today's session is the one that met it.
 */
export interface GoalWeek { sessions: number; cardioDays: number; goal: number; met: boolean; metToday: boolean }
export function goalWeek(sets: SetEntry[], today: string, goal: number): GoalWeek {
  const w = weeklySummary(sets, 1, today)[0];
  const met = w.sessions >= goal;
  const liftedToday = sets.some((e) => e.date === today && isWorking(e));
  return { sessions: w.sessions, cardioDays: w.cardioDays, goal, met, metToday: met && liftedToday && w.sessions - 1 < goal };
}

/** Weeks in a row meeting their goal over the `weeks` read (this one once met); `whole`: the run reaches back past what was read. */
export function weekStreak(sets: SetEntry[], today: string, goal: number, weeks: number): { current: number; best: number; whole: boolean } {
  const st = streak(weeklySummary(sets, weeks, today), goal);
  return { current: st.current, best: st.best, whole: st.current > 0 && st.current >= weeks - (st.thisWeekMet ? 0 : 1) };
}

/** One lift on a card: its top set, its kind, a PR among its sets, and whether it's the one being done right now. */
export interface CardLift extends LiftDone { key: string; kind: Kind | null; pr: boolean; now: boolean; miles?: number }
/**
 * A day as a card. `sets`: working lift sets; `minutes`: cardio. `kinds`: working sets per kind, cardio as its minutes ÷ 3 (domain/crew
 * weighs them so). `start`/`end`: the first and last set's times (NaN without times). `live`: a set under LIVE_MS old.
 */
export interface Card {
  date: string; lifts: CardLift[]; sets: number; minutes: number; prs: number; kinds: Partial<Record<Kind, number>>;
  start: number; end: number; live: boolean;
}
export function sessionCard(sets: readonly SetEntry[], date: string, prs: ReadonlySet<string>, now: number): Card | null {
  const day = sets.filter((e) => e.date === date);
  const s = sessionOn(day, date);
  if (!s) return null;
  const done = day.filter((e) => isWorking(e) || isCardioEntry(e)).sort(byOrderDone);
  const kinds: Partial<Record<Kind, number>> = {};
  let n = 0, seconds = 0, start = NaN, end = NaN, pr = 0;
  const prLifts = new Set<string>(), miles = new Map<string, number>();
  for (const e of done) {
    const k = setKind(e), key = e.exercise.toLowerCase();
    if (isCardioEntry(e)) {
      const sec = e.cardio?.seconds ?? 0;
      seconds += sec;
      kinds.cardio = (kinds.cardio ?? 0) + Math.max(1, Math.round(sec / 180));
      if (e.cardio?.miles) miles.set(key, (miles.get(key) ?? 0) + e.cardio.miles);
    } else {
      n++;
      if (k) kinds[k] = (kinds[k] ?? 0) + 1;
    }
    if (prs.has(e.id)) { pr++; prLifts.add(key); }
    const t = doneAt(e);
    if (!Number.isNaN(t)) { if (!(t >= start)) start = t; if (!(t <= end)) end = t; }
  }
  const live = liveSince(done, now) != null;
  // The lift of the newest set with a time, while live.
  const timed = done.filter((e) => !Number.isNaN(doneAt(e)));
  const nowKey = live && timed.length ? timed[timed.length - 1].exercise.toLowerCase() : null;
  const lifts = s.lifts.map((l): CardLift => {
    const key = l.exercise.toLowerCase(), m = miles.get(key);
    return { ...l, key, kind: liftKind(l.exercise), pr: prLifts.has(key), now: key === nowKey, ...(m != null && { miles: Math.round(m * 100) / 100 }) };
  });
  return { date, lifts, sets: n, minutes: Math.round(seconds / 60), prs: pr, kinds, start, end, live };
}

/**
 * A friend's PR sets: for a month whose document carries `prs` (written by their phone from its whole log), those; for the rest
 * (an older app wrote it), the sets that beat everything before them in what was read, which is "best in 8 weeks", not a PR.
 */
export function friendPrs(win: { sets: SetEntry[]; prs?: Record<string, string[]> }): Set<string> {
  const known = win.prs ?? {};
  const out = new Set<string>();
  for (const ids of Object.values(known)) for (const id of ids) out.add(id);
  if (win.sets.some((s) => !(monthOf(s.date) in known))) {
    const byId = new Map(win.sets.map((s) => [s.id, s]));
    for (const id of prIds(win.sets)) if (!(monthOf(byId.get(id)!.date) in known)) out.add(id);
  }
  return out;
}

/** A lift's change in e1RM over a span, against the person's own start. `from`/`to`: the best e1RM of the first and last two weeks. */
export interface Change { from: number; to: number; pct: number; delta: number; sessions: number; first: string; last: string }
/**
 * Their best e1RM in the two weeks from their first session of the lift in [from, to], against the best in the two weeks up to
 * their last: a percentage of their own start, so a newer lifter and a stronger one read on the same scale. Needs two sessions
 * two weeks apart or more, of weighted working sets.
 */
export function e1rmChange(entries: readonly SetEntry[], exercise: string, from: string, to: string): Change | null {
  const ss = sessionsFor(entries, exercise).filter((x) => x.date >= from && x.date <= to)
    .map((x) => ({ date: x.date, best: Math.max(-Infinity, ...x.sets.map(e1rm).filter((v): v is number => v != null)) }))
    .filter((x) => x.best > 0).reverse();
  if (ss.length < 2) return null;
  const first = ss[0].date, last = ss[ss.length - 1].date;
  if (days(first, last) < 14) return null;
  const a = Math.max(...ss.filter((x) => x.date <= addDays(first, 13)).map((x) => x.best));
  const b = Math.max(...ss.filter((x) => x.date >= addDays(last, -13)).map((x) => x.best));
  return { from: a, to: b, pct: ((b - a) / a) * 100, delta: b - a, sessions: ss.length, first, last };
}

/** What two people's lifts are matched by: the catalog lift a name counts as, else the name itself. */
const matchKey = (name: string) => resolveLift(name).lift?.name ?? liftKey(name);
/** Each lift's name as last written, by match key, among lifts done in [from, to]. */
function liftNames(entries: readonly SetEntry[], from: string, to: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const sets of liftIndex(entries).values()) {
    const inSpan = sets.filter((s) => s.date >= from && s.date <= to);
    if (!inSpan.length) continue;
    const k = matchKey(inSpan[0].exercise);
    if (!out.has(k)) out.set(k, normalizeName(inSpan[inSpan.length - 1].exercise));
  }
  return out;
}

/**
 * The lifts you and a friend both do, each with each one's own change (e1rmChange, in %) over the same span; the most trained
 * first. Only percentages leave here: nobody's loads are set against anybody else's.
 */
export function sharedChanges(mine: readonly SetEntry[], theirs: readonly SetEntry[], from: string, to: string, max = 5): { lift: string; me: number; them: number }[] {
  const a = liftNames(mine, from, to), b = liftNames(theirs, from, to);
  const rows: { lift: string; me: number; them: number; n: number }[] = [];
  for (const [k, name] of a) {
    const other = b.get(k);
    if (!other) continue;
    const me = e1rmChange(mine, name, from, to), them = e1rmChange(theirs, other, from, to);
    if (me && them) rows.push({ lift: name, me: me.pct, them: them.pct, n: me.sessions + them.sessions });
  }
  return rows.sort((x, y) => y.n - x.n || x.lift.localeCompare(y.lift)).slice(0, max).map(({ lift, me, them }) => ({ lift, me, them }));
}

/** The next round number on an e1RM: steps of 5 under 50, 10 under 150, else 25; `progress` along the step from the last one. */
export function milestone(v: number): { prev: number; next: number; progress: number } {
  const step = v < 50 ? 5 : v < 150 ? 10 : 25;
  const prev = Math.floor(v / step) * step;
  return { prev, next: prev + step, progress: (v - prev) / step };
}

/** The weighted lifts Stats follows: done in the last 4 weeks, the most sessions over 12 first, then the most recent. */
export function topLifts(entries: readonly SetEntry[], today: string, n = 4): string[] {
  const recent = addDays(today, -27), span = addDays(today, -83);
  const rows: { name: string; count: number; last: string }[] = [];
  for (const sets of liftIndex(entries).values()) {
    const dates = new Set<string>();
    let last = '', name = '';
    for (const s of sets) {
      if (s.date < span || s.date > today || e1rm(s) == null) continue;
      dates.add(s.date);
      if (s.date >= last) { last = s.date; name = s.exercise; }
    }
    if (dates.size && last >= recent) rows.push({ name: normalizeName(name), count: dates.size, last });
  }
  return rows.sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)).slice(0, n).map((r) => r.name);
}

/** How much of the training week is behind us on `today`: the days before it (Monday asks for nothing yet). */
export const weekPaceOf = (today: string) => days(weekStart(today), today) / 7;

/** A muscle behind where the week should be: its sets so far, its target range, and a lift of yours that works it most. */
export interface Behind { muscle: Muscle; sets: number; range: [number, number]; fix: string | null }
/** Muscles under their target and under the week's pace, the furthest behind first, `max` of them. */
export function behindMuscles(entries: SetEntry[], profile: Profile, today: string, max = 4): Behind[] {
  const pace = weekPaceOf(today);
  if (pace <= 0) return [];
  const { sets } = weeklyMuscleSets(entries, weekStart(today));
  return MUSCLES.map((m) => ({ muscle: m, sets: sets[m], range: targetFor(profile, m) }))
    .filter((b) => b.range[0] > 0 && b.sets < b.range[0] && b.sets < b.range[0] * pace)
    .sort((a, b) => a.sets / a.range[0] - b.sets / b.range[0] || MUSCLES.indexOf(a.muscle) - MUSCLES.indexOf(b.muscle))
    .slice(0, max)
    .map((b) => ({ ...b, fix: quickFix(entries, b.muscle, today) }));
}

/** Your own lift from the last 8 weeks that works `muscle` most (half a set or more per set), the most done, then the most recent. */
export function quickFix(entries: readonly SetEntry[], muscle: Muscle, today: string): string | null {
  const from = addDays(today, -55);
  let best: { name: string; w: number; n: number; last: string } | null = null;
  for (const sets of liftIndex(entries).values()) {
    const inSpan = sets.filter((s) => s.date >= from && s.date <= today && isWorking(s));
    if (!inSpan.length) continue;
    const name = inSpan[inSpan.length - 1].exercise;
    const w = muscleVector(name)?.[muscle] ?? 0;
    if (w < 0.5) continue;
    const n = new Set(inSpan.map((s) => s.date)).size, last = inSpan.reduce((a, s) => (s.date > a ? s.date : a), '');
    if (!best || w > best.w || (w === best.w && (n > best.n || (n === best.n && last > best.last)))) best = { name: normalizeName(name), w, n, last };
  }
  return best?.name ?? null;
}

/** The line under Stats' ring: what the rest of the week needs, said as an invitation, never a scolding. */
export function streakNudge({ sessions, goal, streak: run, today, trainedToday }: { sessions: number; goal: number; streak: number; today: string; trainedToday: boolean }): { lead: string; rest: string } {
  if (sessions >= goal) return { lead: 'Goal met.', rest: run >= 2 ? ` ${run} weeks in a row.` : ' Your streak starts here.' };
  const need = goal - sessions, dow = days(weekStart(today), today);
  const free = 6 - dow + (trainedToday ? 0 : 1);
  if (need <= free) return { lead: `${need} more session${need === 1 ? '' : 's'}`, rest: run + 1 >= 2 ? ` by Sunday makes it ${run + 1} weeks.` : ' by Sunday meets your goal.' };
  return { lead: `${sessions} of ${goal}`, rest: ' this week. A new week starts Monday.' };
}

/** Working lift sets this week so far, and last week's from its Monday to the same weekday. */
export function weekSets(entries: readonly SetEntry[], today: string): { sets: number; before: number } {
  const w = weekStart(today), lw = addDays(w, -7), lwEnd = addDays(lw, days(w, today));
  let sets = 0, before = 0;
  for (const e of entries) {
    if (!isWorking(e)) continue;
    if (e.date >= w && e.date <= today) sets++;
    else if (e.date >= lw && e.date <= lwEnd) before++;
  }
  return { sets, before };
}

/** PR sets from `from` to `to`. */
export function prsBetween(entries: SetEntry[], from: string, to: string): SetEntry[] {
  const kinds = prKinds(entries);
  return entries.filter((e) => kinds.has(e.id) && e.date >= from && e.date <= to);
}

/** The PR card on Stats: the newest PR of the last 7 days (an e1RM one first on its day), and what it moved. */
export interface PrCard { set: SetEntry; kinds: RecordKind[]; detail: string }
export function prCard(entries: SetEntry[], today: string): PrCard | null {
  const kinds = prKinds(entries), from = addDays(today, -6);
  const cands = entries.filter((e) => kinds.has(e.id) && e.date >= from && e.date <= today);
  if (!cands.length) return null;
  const e1 = (e: SetEntry) => (kinds.get(e.id)!.includes('e1rm') ? 1 : 0);
  const set = cands.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : e1(b) - e1(a) || byOrderDone(b, a)))[0];
  const k = kinds.get(set.id)!;
  const v = e1rm(set);
  if (k.includes('e1rm') && v != null) {
    const prior = Math.max(-Infinity, ...sessionsFor(entries, set.exercise).filter((x) => x.date < set.date).flatMap((x) => x.sets.map(e1rm)).filter((x): x is number => x != null));
    return { set, kinds: k, detail: prior > 0 ? `e1RM ${Math.round(v)} lb, up ${Math.round(v - prior)} lb on your best` : `e1RM ${Math.round(v)} lb` };
  }
  return { set, kinds: k, detail: prToast(entries, set)?.replace(/^PR! /, '') ?? 'A new record' };
}

/** A day on a friend's board: its kinds (one, or two close), its working sets (cardio: one per 3 min), and marks. */
export interface Tile { date: string; kinds: Kind[]; sets: number; pr: boolean; live: boolean; today: boolean; future: boolean }
/**
 * The last `weeks` weeks as rows, oldest first, each Monday to Sunday: this week's row runs past today (those tiles `future`).
 * `prs`: the PR set ids to star (a friend's, as their phone wrote them).
 */
export function board(sets: readonly SetEntry[], today: string, prs: ReadonlySet<string>, now: number, weeks = 8): Tile[][] {
  const start = addDays(weekStart(today), -7 * (weeks - 1));
  const byDay = new Map<string, SetEntry[]>();
  for (const e of sets) if (e.date >= start && e.date <= today) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => {
    const date = addDays(start, w * 7 + d), day = byDay.get(date) ?? [];
    return {
      date, kinds: dayKinds(day).kinds, sets: ringSets(day).length, pr: day.some((e) => prs.has(e.id)),
      live: date === today && liveSince(day, now) != null, today: date === today, future: date > today,
    };
  }));
}

/** The newest PR set of each lift among `prs`, newest first, at most `n`. */
export function recentPrs(sets: readonly SetEntry[], prs: ReadonlySet<string>, n = 3): SetEntry[] {
  const best = new Map<string, SetEntry>();
  for (const e of sets) {
    if (!prs.has(e.id)) continue;
    const k = liftKey(e.exercise), was = best.get(k);
    if (!was || e.date > was.date || (e.date === was.date && byOrderDone(e, was) > 0)) best.set(k, e);
  }
  return [...best.values()].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : byOrderDone(b, a))).slice(0, n);
}

/** A lift on Stats: each session's best e1RM over 12 weeks (oldest first), its latest top set, the change from your own start, a stall. */
export interface Trend { name: string; points: { date: string; v: number }[]; top: SetEntry; delta: number | null; stall: Stall | null }
export function liftTrend(entries: SetEntry[], name: string, today: string): Trend | null {
  const from = addDays(today, -83);
  const ss = sessionsFor(entries, name).filter((x) => x.date >= from && x.date <= today).reverse();
  const points: { date: string; v: number }[] = [];
  let top: SetEntry | null = null;
  for (const x of ss) {
    let best = -Infinity, set: SetEntry | null = null;
    for (const e of x.sets) { const v = e1rm(e); if (v != null && v > best) { best = v; set = e; } }
    if (set) { points.push({ date: x.date, v: best }); top = set; }
  }
  if (!top) return null;
  const ch = e1rmChange(entries, name, from, today);
  return { name, points, top, delta: ch ? ch.delta : null, stall: stall(entries, name, today) };
}
