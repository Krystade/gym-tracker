import { addDays, SESSION_CAP, weekStart } from './analytics';
import { isCardioEntry } from './cardio';
import { liftKey, normalizeName } from './ids';
import { liftFactsVersion, PATTERNS, resolveLift } from './lifts';
import { muscleVector, MUSCLES, type Muscle } from './muscles';
import { targetFor, type Profile } from './profile';
import type { DayPlan, Program } from './program';
import { isBarbellCompound, isWorking } from './progression';
import { prKinds } from './records';
import { daySets, e1rm, liftIndex, sameExercise, learnable } from './stats';
import { fitTargets, setYield, weeklyBudget } from './targets';
import type { SetEntry } from './types';
import { addedLoad, bodyShare } from './learn/bodyweight';
import { rate, rateBand, trend, type BodyDay } from './body';
import { POSES, SHOTS, type PhotoMeta } from './photos';
import { effective, togetherSteps, TOGETHER_IDS, type Seen, type TogetherCtx } from './together';

// Achievements (.superpowers/redesign/achievements/plan.md): facts about a log, never stored as earned. Like records
// (domain/records), each is worked out from the sets, the stored profile and the day plans, so an edit, a delete, a rename or a
// sync moves them with the log. What is stored is only the day each profile started counting (`since`, below).
//
// Rules (plan §3, owner 2026-10-21):
// - Everyone starts from 0 (plan Q1: no). Only sets logged on or after `since` (each profile's first run of a build with
//   achievements) count. A family that is defined against your past still measures against the whole log: a PR is a PR against
//   everything you've lifted, Moved up beats the 12 weeks before it, Back at it follows the days away before it. What came
//   before `since` is only ever that bar, never a set that counts.
// - Cumulative: nothing "in a row" that can be lost (Best run is a best ever), so a missed week takes nothing away.
// - Sets flagged pain or light never count toward the strength families (PRs, Three lifts up, Moved up, Plates, Bodyweight), so
//   an achievement never rewards pushing through pain. Attendance and volume count every set: flagging pain never costs a session.
// - Never read: energy, cycle, body weight, photos, pain region or severity, notes (but the assisted-weight note), nutrition.
//   Your body (owner 2026-10-29) is the one exception: its own families read weigh-ins and photo dates, never anything else, and
//   it's private like Together, so none of it leaves the phone.
// - Weekly targets are the ones Stats showed that day (the stored profile fitted to the 8 weeks up to it, as useFittedProfile
//   fits it), so a refit later never takes a week back. A changed weekly goal or priority does re-judge past weeks (plan Q10).

export type Tier = 'starter' | 'bronze' | 'silver' | 'gold' | 'platinum';
export const TIERS: readonly Tier[] = ['starter', 'bronze', 'silver', 'gold', 'platinum'];
export type Group = 'showing' | 'stronger' | 'muscle' | 'milestones' | 'explore' | 'together' | 'body';
export const GROUPS: readonly { id: Group; title: string; note?: string }[] = [
  { id: 'showing', title: 'Showing up' },
  { id: 'stronger', title: 'Getting stronger', note: 'against your own start' },
  { id: 'muscle', title: 'Building muscle' },
  { id: 'milestones', title: 'Milestones' },
  { id: 'explore', title: 'Exploring' },
  // You and your friends (plan §10, domain/together): only on your phone, never shared (owner Q6).
  { id: 'together', title: 'Together', note: 'you and your friends' },
  // Weigh-ins and photos (progress-photos plan, owner 2026-10-29): only on your phone, never shared.
  { id: 'body', title: 'Your body', note: 'only you see these' },
];
/**
 * The groups only you see, whatever the switches say: Together names who you trained with, Your body reads your weigh-ins and
 * photos. Neither ever leaves your phone (no summary, no feed chip, no friend's page).
 */
export const PRIVATE_GROUPS: ReadonlySet<Group> = new Set(['together', 'body']);
export const isPrivate = (g: string): boolean => PRIVATE_GROUPS.has(g as Group);
export interface Level { tier: Tier; at: number }
export interface Def {
  id: string; group: Group; title: string;
  /** What the number counts: "12 of 40 weeks". */ unit: string;
  /** One line: how it is earned, as the sheet says it. */ how: string;
  levels: readonly Level[];
  /** Earned again and again: one level, a count beside it. */ repeat?: true;
  /** One per lift (plates, bodyweight). */ perLift?: true;
  /** Only shown once the log can earn it: a program, a cardio set, a friend (signed in), or your own weigh-ins and photos. */ needs?: 'program' | 'cardio' | 'friends' | 'body';
}

const L = (...xs: [Tier, number][]): Level[] => xs.map(([tier, at]) => ({ tier, at }));
export const DEFS: readonly Def[] = [
  // Showing up
  { id: 'sessions', group: 'showing', title: 'Sessions', unit: 'sessions', how: 'Days with a working lift set', levels: L(['starter', 1], ['bronze', 10], ['silver', 50], ['gold', 150], ['platinum', 500]) },
  { id: 'goal-weeks', group: 'showing', title: 'Goal weeks', unit: 'weeks', how: 'Weeks you met your own weekly goal. Any weeks: they don’t need to be in a row', levels: L(['starter', 1], ['bronze', 4], ['silver', 12], ['gold', 40], ['platinum', 100]) },
  { id: 'best-run', group: 'showing', title: 'Best run', unit: 'weeks in a row', how: 'Your longest run of goal weeks. A best ever: a missed week never takes it away', levels: L(['bronze', 4], ['silver', 12], ['gold', 26], ['platinum', 52]) },
  { id: 'comeback', group: 'showing', title: 'Back at it', unit: 'times', how: 'A session after 14 days or more away', levels: L(['bronze', 1]), repeat: true },
  { id: 'plan-days', group: 'showing', title: 'Plan done', unit: 'days', how: 'Days you did every lift of the day’s plan, all its sets', levels: L(['bronze', 5], ['silver', 25], ['gold', 100], ['platinum', 300]), needs: 'program' },
  { id: 'light-week', group: 'showing', title: 'Rested well', unit: 'times', how: 'A light week taken, then training again the week after', levels: L(['bronze', 1]), repeat: true },
  // Getting stronger, against your own start
  { id: 'prs', group: 'stronger', title: 'PRs', unit: 'PRs', how: 'Sets that beat one of your own records (a lift’s first day never does)', levels: L(['starter', 1], ['bronze', 10], ['silver', 50], ['gold', 250], ['platinum', 750]) },
  { id: 'stronger', group: 'stronger', title: 'Three lifts up', unit: '% on three lifts', how: 'Three lifts each up this much on their own first two weeks (best e1RM, 6+ sessions)', levels: L(['bronze', 10], ['silver', 25], ['gold', 50], ['platinum', 100]) },
  { id: 'moved-up', group: 'stronger', title: 'Moved up', unit: 'steps', how: 'Sessions a lift’s working weight beat its last 12 weeks', levels: L(['bronze', 10], ['silver', 50], ['gold', 150], ['platinum', 400]) },
  // Building muscle (the size goal)
  { id: 'on-target', group: 'muscle', title: 'On target', unit: 'weeks', how: 'Weeks every top-priority muscle got its weekly sets', levels: L(['bronze', 2], ['silver', 8], ['gold', 26], ['platinum', 80]) },
  { id: 'every-muscle', group: 'muscle', title: 'Every muscle', unit: 'weeks', how: 'A week every muscle with a target got its sets', levels: L(['gold', 1]), repeat: true },
  { id: 'useful-sets', group: 'muscle', title: 'Sets that counted', unit: 'sets', how: 'Working sets while a muscle they train still had room in its weekly range', levels: L(['bronze', 100], ['silver', 500], ['gold', 2000], ['platinum', 5000]) },
  // Personal milestones: raw load, yours only, never ranked or summed
  { id: 'plates', group: 'milestones', title: 'Plates', unit: 'plates a side', how: 'A barbell lift at 135, 225, 315 and 405 lb: one to four plates a side', levels: L(['bronze', 1], ['silver', 2], ['gold', 3], ['platinum', 4]), perLift: true },
  { id: 'bodyweight', group: 'milestones', title: 'Bodyweight', unit: 'reps in a set', how: 'Pull-ups, chin-ups and dips at bodyweight: 1, then 5, 10 and 15 in one set', levels: L(['bronze', 1], ['silver', 5], ['gold', 10], ['platinum', 15]), perLift: true },
  // Exploring
  { id: 'new-lifts', group: 'explore', title: 'Lifts tried', unit: 'lifts', how: 'Different lifts with a working set', levels: L(['bronze', 10], ['silver', 25], ['gold', 45], ['platinum', 70]) },
  { id: 'patterns', group: 'explore', title: 'All six patterns', unit: 'weeks', how: 'A week with a horizontal and a vertical press and pull, a squat and a hinge', levels: L(['bronze', 1]), repeat: true },
  { id: 'cardio', group: 'explore', title: 'Cardio minutes', unit: 'minutes', how: 'Minutes on the cardio machines', levels: L(['bronze', 60], ['silver', 300], ['gold', 1000], ['platinum', 3000]), needs: 'cardio' },
  // Together (plan §10; owner 2026-10-22: these six, the tier pacing as is, revisited after 3 months of real data)
  { id: 'trained-together', group: 'together', title: 'Trained together', unit: 'sessions', how: 'Sessions you and a friend logged at a gym of the same name, at the same time, each as you trained', levels: L(['starter', 1], ['bronze', 5], ['silver', 20], ['gold', 60], ['platinum', 150]), needs: 'friends' },
  { id: 'gym-crew', group: 'together', title: 'Gym crew', unit: 'sessions', how: 'Sessions together with two friends or more at once, each as for Trained together', levels: L(['bronze', 1], ['silver', 5], ['gold', 20], ['platinum', 50]), needs: 'friends' },
  { id: 'same-week', group: 'together', title: 'Same week', unit: 'weeks', how: 'Weeks you and a friend both met your own weekly goals', levels: L(['bronze', 1], ['silver', 4], ['gold', 12], ['platinum', 40]), needs: 'friends' },
  { id: 'crew-streak', group: 'together', title: 'Crew streak', unit: 'weeks in a row', how: 'Your longest run of weeks you met your goal with a friend at theirs. A best ever: a missed week never takes it away', levels: L(['bronze', 4], ['silver', 12], ['gold', 26], ['platinum', 52]), needs: 'friends' },
  { id: 'crew-day', group: 'together', title: 'Crew day', unit: 'days', how: 'Days you and two friends or more all trained, anywhere', levels: L(['bronze', 1], ['silver', 10], ['gold', 40], ['platinum', 100]), needs: 'friends' },
  { id: 'full-house', group: 'together', title: 'Full house', unit: 'friends', how: 'The most friends who met their own weekly goal in a week you met yours. Each against their own goal', levels: L(['bronze', 2], ['silver', 3], ['gold', 5], ['platinum', 8]), needs: 'friends' },
  // Your body (owner 2026-10-29: these, no goal weight): the habit of weighing in and taking photos, never losing or gaining fast.
  { id: 'weigh-ins', group: 'body', title: 'Weigh-ins', unit: 'days', how: 'Days with a weigh-in', levels: L(['starter', 1], ['bronze', 10], ['silver', 50], ['gold', 150], ['platinum', 365]), needs: 'body' },
  { id: 'steady-weeks', group: 'body', title: 'Steady weeks', unit: 'weeks', how: 'Weeks with 3 weigh-ins or more in which your trend never read Fast cut or Fast gain. Steady, not fast', levels: L(['bronze', 2], ['silver', 8], ['gold', 26], ['platinum', 52]), needs: 'body' },
  { id: 'photo-days', group: 'body', title: 'Photo days', unit: 'days', how: 'Days with a front, side and back photo', levels: L(['starter', 1], ['bronze', 4], ['silver', 12], ['gold', 26], ['platinum', 52]), needs: 'body' },
  { id: 'photo-season', group: 'body', title: 'Photo season', unit: 'weeks', how: 'Weeks from your first photo day to your latest', levels: L(['bronze', 4], ['silver', 12], ['gold', 26], ['platinum', 52]), needs: 'body' },
  { id: 'flexed-relaxed', group: 'body', title: 'Flexed and relaxed', unit: 'times', how: 'A day with all six poses, relaxed and flexed', levels: L(['bronze', 1]), repeat: true, needs: 'body' },
];
export const DEF: ReadonlyMap<string, Def> = new Map(DEFS.map((d) => [d.id, d]));
/** The families that never count a pain- or light-flagged set (owner, 2026-10-21: kept). */
export const STRENGTH: readonly string[] = ['prs', 'stronger', 'moved-up', 'plates', 'bodyweight'];

/**
 * An unlock: the level reached, the day it was reached, the lift for a per-lift one, and the value then. A Together one: the
 * friends it was with (uids) and the gym, when the window still shows it. Neither ever leaves the phone (shareOf).
 */
export interface Unlock { id: string; level: number; tier: Tier; date: string; value: number; lift?: string; with?: string[]; gym?: string }
/** Where a family (per lift, for plates and bodyweight) stands: its value, the highest level reached (−1 none), the next level's number. */
export interface Track { id: string; value: number; level: number; next: number | null; lift?: string }
export interface Context {
  /** The stored profile, not the one fitted to today: its priorities, weekly goal and hand-set ranges (each day is fitted here). */
  profile: Profile;
  today: string;
  /** The first day that counts: this profile's first run of a build with achievements (owner, 2026-10-21). */
  since: string;
  plans?: readonly DayPlan[];
  program?: Program | null;
  /** Your friends' windows and the ledger (domain/together): the Together families. None: signed out, or a friend's log. */
  together?: TogetherCtx;
  /** Your weigh-ins and photos: Your body's families. None wherever a count or a summary leaves the phone (the recap, Compare). */
  body?: BodyCtx;
}
/** What Your body reads: each day's weight, and each photo's date, pose and variant (never the image). */
export interface BodyCtx { days: readonly BodyDay[]; photos: readonly Pick<PhotoMeta, 'date' | 'pose' | 'variant'>[] }

// ---- What counts ----

const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);
const days = (a: string, b: string) => Math.round((dayMs(b) - dayMs(a)) / 864e5);
const chrono = (a: SetEntry, b: SetEntry) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq || a.setNo - b.setNo);
/** A lifting set that is work: not a warm-up, not cardio. Attendance and volume count every one, pain and light included. */
export const lifted = (e: SetEntry) => !e.flags.includes('warmup') && !isCardioEntry(e);
/** A set that may count for strength: lifted, reps done, not a hold, and neither pain-flagged nor a light-week set. */
const earns = (e: SetEntry) => lifted(e) && e.reps != null && e.reps >= 1 && !e.flags.some((f) => f === 'partial' || f === 'hold' || f === 'pain' || f === 'light');
const goalOf = (p: Context['profile']) => Math.min(7, Math.max(1, Math.round(p.weeklyGoal) || 2));

/** A value that only goes up, as dated steps: the day it first reached each value (and, for Together, who with). */
export type Steps = { date: string; value: number; lift?: string; with?: string[]; gym?: string }[];

/** The days with a working lift set, oldest first: the sessions Stats and the weekly goal count (domain/analytics). */
function sessionDays(entries: readonly SetEntry[]): string[] {
  return [...new Set(entries.filter(lifted).map((e) => e.date))].sort();
}

function cumulative(dates: readonly string[]): Steps {
  return [...dates].sort().map((date, i) => ({ date, value: i + 1 }));
}

/** Each week that met the goal: its Monday, and the day the goal-th session made it. */
function goalWeekDays(sessions: readonly string[], goal: number): { week: string; date: string }[] {
  const byWeek = new Map<string, string[]>();
  for (const d of sessions) { const w = weekStart(d); (byWeek.get(w) ?? byWeek.set(w, []).get(w)!).push(d); }
  return [...byWeek].filter(([, ds]) => ds.length >= goal).map(([week, ds]) => ({ week, date: ds[goal - 1] })).sort((a, b) => a.week.localeCompare(b.week));
}

function bestRun(met: readonly { week: string; date: string }[]): Steps {
  const out: Steps = [];
  let run = 0, best = 0, prev = '';
  for (const m of met) {
    run = prev && addDays(prev, 7) === m.week ? run + 1 : 1;
    prev = m.week;
    if (run > best) { best = run; out.push({ date: m.date, value: best }); }
  }
  return out;
}

/** Sessions after 14 full days or more away. `all`: every session day, before `since` too (the days away are counted from them). */
function comebacks(all: readonly string[], since: string): Steps {
  const out: string[] = [];
  for (let i = 1; i < all.length; i++) if (all[i] >= since && days(all[i - 1], all[i]) - 1 >= 14) out.push(all[i]);
  return cumulative(out);
}

/** Days every non-skipped slot of the day's plan got its sets (each logged set used once, swaps followed). */
function planDays(entries: readonly SetEntry[], plans: readonly DayPlan[], program: Program | null | undefined, today: string): Steps {
  const out: string[] = [];
  for (const x of plans) {
    const slots = x.slots ?? program?.days[x.day]?.slots;
    if (x.date > today || !slots?.length) continue;
    // `entries` are from `since` on, so a plan from before it has none.
    const left = daySets(entries, x.date).filter((e) => !e.flags.includes('warmup'));
    if (!left.length) continue;
    let all = true, any = false;
    for (const slot of slots) {
      if (x.skips.includes(slot.exercise)) continue;
      any = true;
      const target = x.swaps[slot.exercise] ?? slot.exercise;
      for (let k = 0; k < slot.sets; k++) {
        const i = left.findIndex((e) => sameExercise(e.exercise, target));
        if (i < 0) { all = false; break; }
        left.splice(i, 1);
      }
      if (!all) break;
    }
    if (all && any) out.push(x.date);
  }
  return cumulative(out);
}

function lightWeeks(entries: readonly SetEntry[], sessions: readonly string[]): Steps {
  const light = new Set(entries.filter((e) => e.flags.includes('light')).map((e) => weekStart(e.date)));
  const firstIn = new Map<string, string>();
  for (const d of sessions) if (!firstIn.has(weekStart(d))) firstIn.set(weekStart(d), d);
  const out: string[] = [];
  for (const w of [...light].sort()) {
    const back = firstIn.get(addDays(w, 7));
    if (back && !light.has(addDays(w, 7))) out.push(back);
  }
  return cumulative(out);
}

/** PR sets from `since` on, judged against the whole log (records' one rule), never a pain-flagged or light one. */
function prSteps(entries: readonly SetEntry[], since: string, today: string): Steps {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const dates: string[] = [];
  for (const id of prKinds(entries as SetEntry[]).keys()) {
    const e = byId.get(id);
    if (e && e.date >= since && e.date <= today && !e.flags.includes('pain') && !e.flags.includes('light')) dates.push(e.date);
  }
  return cumulative(dates);
}

/** A weighted lift's sessions, oldest first: each day's best e1RM and its working weight (the median), from sets that earn. */
type WSession = { date: string; best: number; w: number };
const WS = new WeakMap<readonly SetEntry[], { today: string; v: WSession[] }>();
function weightedSessions(sets: readonly SetEntry[], today: string): WSession[] {
  const hit = WS.get(sets);
  if (hit?.today === today) return hit.v;
  const byDay = new Map<string, SetEntry[]>();
  for (const s of sets) if (earns(s) && s.weight > 0 && !s.flags.includes('bodyweight') && s.date <= today) (byDay.get(s.date) ?? byDay.set(s.date, []).get(s.date)!).push(s);
  const v = [...byDay].sort(([a], [b]) => a.localeCompare(b)).flatMap(([date, xs]) => {
    const es = xs.map(e1rm).filter((x): x is number => x != null);
    if (!es.length) return [];
    const ws = xs.map((x) => x.weight).sort((a, b) => a - b);
    return [{ date, best: Math.max(...es), w: ws[(ws.length - 1) >> 1] }];
  });
  WS.set(sets, { today, v });
  return v;
}

/** A lift counts toward Three lifts up from its STRONGER_MIN-th session, two weeks on from its first. */
export const STRONGER_MIN = 6;
/** A lift's change on its own start: the best e1RM in its last two weeks against its first two (feed e1rmChange's shape). */
export function liftGains(entries: readonly SetEntry[], today: string): { lift: string; date: string; pct: number }[] {
  entries = learnable(entries); // the log without sets marked not used (stats.learnable)
  const out: { lift: string; date: string; pct: number }[] = [];
  for (const [lift, sets] of byCatalog(entries)) {
    if (bodyShare(lift) != null) continue; // a bodyweight lift has no e1RM (records: item 14)
    const ss = weightedSessions(sets, today);
    if (ss.length < STRONGER_MIN) continue;
    const first = ss[0].date;
    const start = Math.max(...ss.filter((x) => x.date <= addDays(first, 13)).map((x) => x.best));
    for (let i = STRONGER_MIN - 1; i < ss.length; i++) {
      if (days(first, ss[i].date) < 14) continue; // still in its start window: it can't be up on it
      const from = addDays(ss[i].date, -13);
      let now = 0;
      for (let j = i; j >= 0 && ss[j].date >= from; j--) now = Math.max(now, ss[j].best);
      out.push({ lift, date: ss[i].date, pct: ((now - start) / start) * 100 });
    }
  }
  return out;
}
/** The gain three lifts have all reached (the third-best lift's best so far, whole %): one noisy lift can't earn it. */
export const STRONGER_LIFTS = 3;
function strongerSteps(entries: readonly SetEntry[], today: string): Steps {
  const best = new Map<string, number>(), out: Steps = [];
  let had = 0;
  for (const g of liftGains(entries, today).sort((a, b) => a.date.localeCompare(b.date))) {
    if (g.pct <= (best.get(g.lift) ?? 0)) continue;
    best.set(g.lift, g.pct);
    const third = Math.floor([...best.values()].sort((x, y) => y - x)[STRONGER_LIFTS - 1] ?? 0);
    if (third > had) { had = third; out.push({ date: g.date, value: third }); }
  }
  return out;
}

/** Sets grouped by the catalog lift their name counts as (a renamed or aliased lift is one lift), else by name. */
function byCatalog(entries: readonly SetEntry[]): Map<string, SetEntry[]> {
  const out = new Map<string, SetEntry[]>();
  for (const sets of liftIndex(entries).values()) {
    const name = normalizeName(sets[sets.length - 1].exercise);
    const k = resolveLift(name).lift?.name ?? name;
    (out.get(k) ?? out.set(k, []).get(k)!).push(...sets);
  }
  return out;
}

export const MOVED_UP_DAYS = 84;
/** Sessions from `since` on whose working weight beat the 12 weeks before them (before `since` too: that's the bar). */
function movedUpSteps(entries: readonly SetEntry[], since: string, today: string): Steps {
  const out: string[] = [];
  for (const sets of liftIndex(entries).values()) {
    const ss = weightedSessions(sets, today);
    for (let i = 1; i < ss.length; i++) {
      if (ss[i].date < since) continue;
      const from = addDays(ss[i].date, -MOVED_UP_DAYS);
      let top = -Infinity;
      for (let j = i - 1; j >= 0 && ss[j].date >= from; j--) top = Math.max(top, ss[j].w);
      if (top > -Infinity && ss[i].w > top) out.push(ss[i].date);
    }
  }
  return cumulative(out);
}

/**
 * The profile as Stats fitted it on a day: the stored one, its targets fitted to the 8 weeks up to that day (useFittedProfile's
 * weeklyBudget, setYield and fitTargets, over the working sets of those weeks). `all`: the whole log, so the fit sees before `since`.
 */
function fitter(all: readonly SetEntry[], ctx: Context): (day: string) => Profile {
  const work = all.filter(isWorking).sort(chrono);
  const at = (d: string) => { let lo = 0, hi = work.length; while (lo < hi) { const m = (lo + hi) >> 1; if (work[m].date < d) lo = m + 1; else hi = m; } return lo; };
  const memo = new Map<string, Profile>();
  return (day) => {
    let p = memo.get(day);
    if (p) return p;
    const win = work.slice(at(addDays(day, -57)), at(addDays(day, 1)));
    const fit = fitTargets(ctx.profile, weeklyBudget(ctx.profile, ctx.program ?? null, win, day), setYield(win, day));
    p = { ...ctx.profile, targets: fit.targets };
    memo.set(day, p);
    return p;
  };
}

/** Days within each week, oldest first, with each muscle's sets that day (capped at SESSION_CAP, as Stats counts them). */
function weekDays(entries: readonly SetEntry[]): Map<string, { date: string; sets: Record<Muscle, number> }[]> {
  const byDay = new Map<string, Record<Muscle, number>>();
  for (const e of entries) {
    if (!lifted(e)) continue;
    const v = muscleVector(e.exercise);
    if (!v) continue;
    const d = byDay.get(e.date) ?? byDay.set(e.date, Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>).get(e.date)!;
    for (const [m, f] of Object.entries(v) as [Muscle, number][]) d[m] += f;
  }
  const out = new Map<string, { date: string; sets: Record<Muscle, number> }[]>();
  for (const [date, sets] of [...byDay].sort(([a], [b]) => a.localeCompare(b))) {
    for (const m of MUSCLES) sets[m] = Math.min(sets[m], SESSION_CAP);
    const w = weekStart(date);
    (out.get(w) ?? out.set(w, []).get(w)!).push({ date, sets });
  }
  return out;
}

/** The muscles with a weekly target that day, and the top priority among them (the lowest tier number with one). */
function targeted(p: Profile): { all: Muscle[]; top: Muscle[] } {
  const all = MUSCLES.filter((m) => targetFor(p, m)[0] > 0);
  const best = Math.min(...all.map((m) => p.tiers[m]));
  return { all, top: all.filter((m) => p.tiers[m] === best) };
}

/** The day in each week the chosen muscles all reached their weekly low, by the week's running totals and that day's targets. */
function reachedDays(weeks: ReturnType<typeof weekDays>, fit: (day: string) => Profile, which: 'all' | 'top'): string[] {
  const out: string[] = [];
  for (const ds of weeks.values()) {
    const run = Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
    for (const d of ds) {
      for (const m of MUSCLES) run[m] += d.sets[m];
      const p = fit(d.date), ms = targeted(p)[which];
      if (ms.length && ms.every((m) => run[m] + 1e-9 >= targetFor(p, m)[0])) { out.push(d.date); break; }
    }
  }
  return out;
}

/** A set counts if a muscle it trains for at least half a set still had room under the top of that day's range that week. */
function usefulSteps(entries: readonly SetEntry[], fit: (day: string) => Profile): Steps {
  const xs = entries.filter(lifted).sort(chrono);
  const out: string[] = [];
  let week = '', run: Partial<Record<Muscle, number>> = {};
  for (const e of xs) {
    const w = weekStart(e.date);
    if (w !== week) { week = w; run = {}; }
    const v = muscleVector(e.exercise);
    if (!v) { out.push(e.date); continue; } // a lift the app can't place still counts: we can't say it had no room
    const p = fit(e.date);
    const room = (Object.entries(v) as [Muscle, number][]).some(([m, f]) => f >= 0.5 && (run[m] ?? 0) < targetFor(p, m)[1]);
    for (const [m, f] of Object.entries(v) as [Muscle, number][]) run[m] = (run[m] ?? 0) + f;
    if (room) out.push(e.date);
  }
  return cumulative(out);
}

/** Plates a side on a 45 lb bar: 135 is one, 225 two, 315 three, 405 four (and on, a plate per 90 lb). */
export const platesAt = (w: number): number => (w >= 135 ? Math.floor((w - 45) / 90) : 0);
/** The load that is `n` plates a side. */
export const plateLoad = (n: number): number => 45 + 90 * n;
/** Plate milestones: plates a side reached, per barbell compound, with a set that counts. */
function plateSteps(entries: readonly SetEntry[]): Steps {
  const out: Steps = [];
  for (const sets of liftIndex(entries).values()) {
    const name = normalizeName(sets[sets.length - 1].exercise);
    if (!isBarbellCompound(name)) continue;
    let have = 0;
    for (const s of [...sets].filter((x) => earns(x) && x.weight > 0 && !x.flags.includes('bodyweight')).sort(chrono)) {
      const n = platesAt(s.weight);
      if (n > have) { have = n; out.push({ date: s.date, value: n, lift: name }); }
    }
  }
  return out;
}

const BW = ['Pull-up', 'Chin-up', 'Forward-Lean Dips', 'Upright Dips'];
/** What a bodyweight milestone is named by: the two dips are one. */
const BW_GROUP: Record<string, string> = { 'Pull-up': 'Pull-up', 'Chin-up': 'Chin-up', 'Forward-Lean Dips': 'Dips', 'Upright Dips': 'Dips' };
/** New rep bests in one set at bodyweight (no weight added, no help), per lift. */
function bodyweightSteps(entries: readonly SetEntry[]): Steps {
  const out: Steps = [];
  const groups = new Map<string, SetEntry[]>();
  for (const sets of liftIndex(entries).values()) {
    const lift = resolveLift(normalizeName(sets[sets.length - 1].exercise)).lift?.name;
    if (lift && BW.includes(lift)) (groups.get(BW_GROUP[lift]) ?? groups.set(BW_GROUP[lift], []).get(BW_GROUP[lift])!).push(...sets);
  }
  for (const [name, sets] of groups) {
    let top = 0;
    for (const s of [...sets].filter((x) => earns(x) && addedLoad(x) === 0).sort(chrono)) {
      if (s.reps! <= top) continue;
      top = s.reps!;
      out.push({ date: s.date, value: top, lift: name });
    }
  }
  return out;
}

function newLiftSteps(entries: readonly SetEntry[]): Steps {
  const first = new Map<string, string>();
  for (const e of entries) {
    if (!lifted(e)) continue;
    const k = resolveLift(e.exercise).lift?.name ?? liftKey(e.exercise);
    if (!first.has(k) || e.date < first.get(k)!) first.set(k, e.date);
  }
  return cumulative([...first.values()]);
}

function patternWeeks(entries: readonly SetEntry[]): Steps {
  const seen = new Map<string, Map<string, string>>(); // week -> pattern -> first date
  for (const e of [...entries].filter(lifted).sort(chrono)) {
    const p = resolveLift(e.exercise).p;
    if (!p) continue;
    const w = weekStart(e.date);
    const m = seen.get(w) ?? seen.set(w, new Map()).get(w)!;
    if (!m.has(p)) m.set(p, e.date);
  }
  return cumulative([...seen.values()].filter((m) => m.size === PATTERNS.length).map((m) => [...m.values()].sort().at(-1)!));
}

function cardioSteps(entries: readonly SetEntry[]): Steps {
  const out: Steps = [];
  let min = 0;
  for (const e of [...entries].filter((x) => x.cardio).sort(chrono)) {
    min += e.cardio!.seconds / 60;
    out.push({ date: e.date, value: Math.floor(min) });
  }
  return out;
}

// ---- Your body (owner 2026-10-29) ----

/** Days with a weight, from `since` on. */
const weighInDays = (b: BodyCtx, since: string, today: string): string[] =>
  b.days.filter((d) => d.weight != null && d.date >= since && d.date <= today).map((d) => d.date);

/** A week needs this many weigh-ins to count as steady. */
export const STEADY_MIN = 3;
/**
 * Weeks over (Monday to Sunday, before `today`) with STEADY_MIN weigh-ins or more in which the trend's 4-week rate never read
 * Fast cut or Fast gain (domain/body rateBand), dated at the week's last weigh-in. A week the rate can't be read in yet (under two
 * weeks of weigh-ins) doesn't count. The trend reads the weigh-ins before `since` too: that's its bar, never a week that counts.
 */
function steadyWeeks(b: BodyCtx, since: string, today: string): Steps {
  const t = trend(b.days.filter((d) => d.date <= today));
  const byWeek = new Map<string, number[]>();
  t.forEach((p, i) => { if (p.date >= since) { const w = weekStart(p.date); (byWeek.get(w) ?? byWeek.set(w, []).get(w)!).push(i); } });
  const out: string[] = [];
  for (const [w, is] of byWeek) {
    if (is.length < STEADY_MIN || addDays(w, 6) >= today) continue;
    if (is.every((i) => { const r = rate(t.slice(0, i + 1)); return r != null && rateBand(r.pctPerWeek).tone === 'ok'; })) out.push(t[is.at(-1)!].date);
  }
  return cumulative(out);
}

/** Days from `since` on with every pose (either variant): a full set. `all`: every pose relaxed and flexed, the whole routine. */
function photoDays(b: BodyCtx, since: string, today: string, all = false): string[] {
  const by = new Map<string, Set<string>>();
  for (const p of b.photos) if (p.date >= since && p.date <= today) (by.get(p.date) ?? by.set(p.date, new Set()).get(p.date)!).add(`${p.pose}:${p.variant}`);
  return [...by].filter(([, got]) => (all ? SHOTS.every((s) => got.has(`${s.pose}:${s.variant}`)) : POSES.every((p) => got.has(`${p}:relaxed`) || got.has(`${p}:flexed`))))
    .map(([d]) => d).sort();
}

/** Whole weeks from the first photo day to each later one. */
const photoSeason = (ds: readonly string[]): Steps =>
  ds.map((date) => ({ date, value: Math.floor(days(ds[0], date) / 7) })).filter((x) => x.value > 0);

function bodySteps(b: BodyCtx | undefined, since: string, today: string): Record<string, Steps> {
  if (!b) return { 'weigh-ins': [], 'steady-weeks': [], 'photo-days': [], 'photo-season': [], 'flexed-relaxed': [] };
  const full = photoDays(b, since, today);
  return {
    'weigh-ins': cumulative(weighInDays(b, since, today)),
    'steady-weeks': steadyWeeks(b, since, today),
    'photo-days': cumulative(full),
    'photo-season': photoSeason(full),
    'flexed-relaxed': cumulative(photoDays(b, since, today, true)),
  };
}

// ---- Levels from steps ----

/** For one family's steps (per lift when the family is), every level crossed and the first day it was. */
function crossings(def: Def, steps: Steps): Unlock[] {
  const out: Unlock[] = [];
  const by = new Map<string, Steps>();
  for (const s of steps) { const k = def.perLift ? s.lift ?? '' : ''; (by.get(k) ?? by.set(k, []).get(k)!).push(s); }
  for (const xs of by.values()) {
    xs.sort((a, b) => a.date.localeCompare(b.date) || a.value - b.value);
    def.levels.forEach((lv, level) => {
      const hit = xs.find((x) => x.value >= lv.at);
      if (hit) out.push({ id: def.id, level, tier: lv.tier, date: hit.date, value: hit.value, ...(hit.lift && { lift: hit.lift }), ...(hit.with && { with: hit.with }), ...(hit.gym && { gym: hit.gym }) });
    });
  }
  return out;
}

export interface Achievements {
  unlocks: Unlock[];
  /** One per family, and one per lift for plates and bodyweight (once a lift has a step). */ tracks: Track[];
  /** For repeats: how many times. */ counts: Record<string, number>;
  /** Families the log can't earn yet (no program, no cardio): left off the sheet until it can. */ hidden: string[];
  /** For repeats: the day of each time, oldest first (Gym Buddies pays each one: domain/buddies/rewards). */ repeats: Record<string, string[]>;
}

/** The families Gym Buddies grows stats from (domain/buddies/stats): familySteps' own, without the costly rest. */
export function buddySteps(entries: readonly SetEntry[], ctx: Pick<Context, 'since' | 'today' | 'profile'>): Record<'sessions' | 'goal-weeks' | 'prs' | 'moved-up', Steps> {
  const { since, today } = ctx;
  const post = entries.filter((e) => e.date <= today && e.date >= since);
  const sessions = sessionDays(post);
  return {
    'sessions': cumulative(sessions),
    'goal-weeks': cumulative(goalWeekDays(sessions, goalOf(ctx.profile)).map((m) => m.date)),
    'prs': prSteps(entries, since, today),
    'moved-up': movedUpSteps(entries, since, today),
  };
}

/** Every family's steps, each from `since` on. The pure core: everything else is levels and words. */
export function familySteps(entries: readonly SetEntry[], ctx: Context): Record<string, Steps> {
  const { since, today } = ctx;
  const all = entries.filter((e) => e.date <= today);
  // Only sets on or after `since` count (owner, 2026-10-21). The whole log is read only where it is the bar (see the head).
  const post = all.filter((e) => e.date >= since);
  const sessions = sessionDays(post);
  const met = goalWeekDays(sessions, goalOf(ctx.profile));
  const weeks = weekDays(post);
  const fit = fitter(all, ctx);
  const seen = togetherOf(entries, ctx), tog = seen ? togetherSteps(seen) : null;
  return {
    'sessions': cumulative(sessions),
    'goal-weeks': cumulative(met.map((m) => m.date)),
    'best-run': bestRun(met),
    'comeback': comebacks(sessionDays(all), since),
    'plan-days': planDays(post, ctx.plans ?? [], ctx.program, today),
    'light-week': lightWeeks(post, sessions),
    'prs': prSteps(entries, since, today),
    'stronger': strongerSteps(post, today),
    'moved-up': movedUpSteps(entries, since, today),
    'on-target': cumulative(reachedDays(weeks, fit, 'top')),
    'every-muscle': cumulative(reachedDays(weeks, fit, 'all')),
    'useful-sets': usefulSteps(post, fit),
    'plates': plateSteps(post),
    'bodyweight': bodyweightSteps(post),
    'new-lifts': newLiftSteps(post),
    'patterns': patternWeeks(post),
    'cardio': cardioSteps(post),
    ...Object.fromEntries(TOGETHER_IDS.map((id) => [id, tog?.[id] ?? []])),
    ...bodySteps(ctx.body, since, today),
  };
}

/**
 * What counts toward Together (domain/together effective): your log, your start and goal, your friends' windows and the ledger.
 * Worked out once per log, context and day. Null with no friends' data (signed out, or a friend's log).
 */
const TOG = new WeakMap<readonly SetEntry[], { n: number; ctx: Context; v: Seen }>();
export function togetherOf(entries: readonly SetEntry[], ctx: Context): Seen | null {
  const t = ctx.together;
  if (!t) return null;
  const hit = TOG.get(entries);
  if (hit && hit.n === entries.length && hit.ctx.together === t && hit.ctx.today === ctx.today && hit.ctx.since === ctx.since && goalOf(hit.ctx.profile) === goalOf(ctx.profile)) return hit.v;
  const v = effective(entries, ctx.since, goalOf(ctx.profile), t, ctx.today);
  TOG.set(entries, { n: entries.length, ctx, v });
  return v;
}

const levelOf = (def: Def, value: number) => def.levels.reduce((a, lv, i) => (value >= lv.at ? i : a), -1);
const track = (def: Def, value: number, lift?: string): Track => {
  const level = levelOf(def, value);
  return { id: def.id, value, level, next: def.repeat ? null : def.levels[level + 1]?.at ?? null, ...(lift && { lift }) };
};

export function achievements(entries: readonly SetEntry[], ctx: Context): Achievements {
  const steps = familySteps(entries, ctx);
  const unlocks: Unlock[] = [], tracks: Track[] = [], counts: Record<string, number> = {}, hidden: string[] = [], repeats: Record<string, string[]> = {};
  for (const def of DEFS) {
    const xs = steps[def.id];
    unlocks.push(...crossings(def, xs));
    const value = xs.reduce((a, x) => Math.max(a, x.value), 0);
    if (def.perLift && xs.length) {
      const best = new Map<string, number>();
      for (const x of xs) best.set(x.lift!, Math.max(best.get(x.lift!) ?? 0, x.value));
      tracks.push(...[...best].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).map(([lift, v]) => track(def, v, lift)));
    } else tracks.push(track(def, value));
    if (def.repeat) { counts[def.id] = value; repeats[def.id] = xs.map((x) => x.date).sort(); }
    if (!value && ((def.needs === 'program' && !ctx.program) || (def.needs === 'cardio' && !entries.some(isCardioEntry))
      || (def.needs === 'friends' && !ctx.together?.friends.length) || (def.needs === 'body' && !ctx.body))) hidden.push(def.id);
  }
  unlocks.sort((a, b) => a.date.localeCompare(b.date) || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || a.id.localeCompare(b.id));
  return { unlocks, tracks, counts, hidden, repeats };
}

/**
 * achievements(), worked out once per log array and context: Today's cards, the finish card and Stats all read the same one.
 * The store never changes a log array in place (state/useSets), and the profile, program and plans are kept objects, so a hit
 * is the same answer. What a lift's name counts as can change too ("Works like…"): the lift facts' version is part of the key.
 */
const MEMO = new WeakMap<readonly SetEntry[], { n: number; f: number; ctx: Context; v: Achievements }>();
export function achievementsOf(entries: readonly SetEntry[], ctx: Context): Achievements {
  const hit = MEMO.get(entries);
  if (hit && hit.n === entries.length && hit.f === liftFactsVersion() && hit.ctx.today === ctx.today && hit.ctx.since === ctx.since
    && hit.ctx.profile === ctx.profile && hit.ctx.program === ctx.program && hit.ctx.plans === ctx.plans && hit.ctx.together === ctx.together && hit.ctx.body === ctx.body) return hit.v;
  const v = achievements(entries, ctx);
  MEMO.set(entries, { n: entries.length, f: liftFactsVersion(), ctx, v });
  return v;
}

export const unlockKey = (u: Pick<Unlock, 'id' | 'level' | 'lift'>) => `${u.id}:${u.level}${u.lift ? `:${liftKey(u.lift)}` : ''}`;
/** The unlocks in `after` that `before` hadn't (a set just saved): what the lift card says under its PR line. */
export function gained(before: Achievements, after: Achievements): Unlock[] {
  const had = new Set(before.unlocks.map(unlockKey));
  return after.unlocks.filter((u) => !had.has(unlockKey(u)));
}
/** A day's unlocks, highest tier first. */
export const unlockedOn = (a: Achievements, date: string): Unlock[] =>
  a.unlocks.filter((u) => u.date === date).sort((x, y) => TIERS.indexOf(y.tier) - TIERS.indexOf(x.tier) || DEFS.findIndex((d) => d.id === x.id) - DEFS.findIndex((d) => d.id === y.id));

/** Of several unlocks, only the highest level of each family (each lift, for a per-lift one), in the order given: a lift's
 *  first set at 315 is "3 plates a side", not that and 2 and 1 as well. */
export function highest(us: readonly Unlock[]): Unlock[] {
  const top = new Map<string, Unlock>();
  for (const u of us) { const k = `${u.id}:${u.lift ? liftKey(u.lift) : ''}`, t = top.get(k); if (!t || u.level > t.level) top.set(k, u); }
  const keep = new Set(top.values());
  return us.filter((u) => keep.has(u));
}

/** Achievements this week (Monday to `today`), each day's counted as its highest levels (highest): the weekly recap's number. */
export function weekCount(a: Achievements, today: string): number {
  const from = weekStart(today), byDay = new Map<string, Unlock[]>();
  for (const u of a.unlocks) if (u.date >= from && u.date <= today) (byDay.get(u.date) ?? byDay.set(u.date, []).get(u.date)!).push(u);
  return [...byDay.values()].reduce((n, us) => n + highest(us).length, 0);
}

/** The tracks closest to their next level (goal gradient: plan §2), closest first; repeats and maxed ones have none. */
export function closest(a: Achievements, n = 3): Track[] {
  return a.tracks.filter((t) => t.next != null && !a.hidden.includes(t.id))
    .map((t) => ({ t, f: t.value / t.next! }))
    .sort((x, y) => y.f - x.f || (x.t.next! - x.t.value) - (y.t.next! - y.t.value) || DEFS.findIndex((d) => d.id === x.t.id) - DEFS.findIndex((d) => d.id === y.t.id))
    .slice(0, n).map((x) => x.t);
}

// ---- Words ----

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
/** A level's number as said: "10 sessions", "4 in a row", "25%", "225 lb", "5 in a set", "60 min". */
export function amount(id: string, n: number): string {
  switch (id) {
    case 'sessions': return plural(n, 'session');
    case 'goal-weeks': case 'on-target': case 'patterns': case 'every-muscle': return plural(n, 'week');
    case 'best-run': return `${plural(n, 'week')} in a row`;
    case 'comeback': case 'light-week': return plural(n, 'time');
    case 'plan-days': return plural(n, 'plan day');
    case 'prs': return plural(n, 'PR');
    case 'stronger': return `${n}%`;
    case 'moved-up': return plural(n, 'step');
    case 'useful-sets': return plural(n, 'set');
    case 'plates': return `${plateLoad(n)} lb`;
    case 'bodyweight': return `${n} in a set`;
    case 'new-lifts': return plural(n, 'lift');
    case 'cardio': return `${n.toLocaleString('en-US')} min`;
    case 'trained-together': return plural(n, 'session');
    case 'gym-crew': return `${plural(n, 'session')} with 2+ friends`;
    case 'same-week': return plural(n, 'week');
    case 'crew-streak': return `${plural(n, 'week')} in a row`;
    case 'crew-day': return plural(n, 'day');
    case 'full-house': return plural(n, 'friend');
    case 'weigh-ins': return plural(n, 'weigh-in');
    case 'steady-weeks': case 'photo-season': return plural(n, 'week');
    case 'photo-days': return plural(n, 'photo day');
    case 'flexed-relaxed': return plural(n, 'time');
    default: return String(n);
  }
}
/** "@ana", "@ana and @sam", "@ana, @sam and @kai", "@ana, @sam and 2 more". */
export function andList(xs: readonly string[]): string {
  if (xs.length <= 2) return xs.join(' and ');
  if (xs.length === 3) return `${xs[0]}, ${xs[1]} and ${xs[2]}`;
  return `${xs[0]}, ${xs[1]} and ${xs.length - 2} more`;
}
/**
 * What an unlock means, in one line: "50 PRs", "Bench Press: 225 lb, 2 plates a side", "A session after 14+ days away". A
 * Together one names who with (`name`: a friend's uid as said, "@ana_lifts" or "a former friend"), on your phone only.
 */
export function unlockText(u: Unlock, name: (uid: string) => string = () => 'a friend'): string {
  const at = DEF.get(u.id)!.levels[u.level].at;
  const who = andList((u.with ?? []).map(name));
  switch (u.id) {
    case 'trained-together': return at === 1 && who ? `First session together: ${who}${u.gym ? `, ${u.gym}` : ''}` : `${amount(u.id, at)} together`;
    case 'gym-crew': return at === 1 && who ? `A session with ${who}${u.gym ? `, ${u.gym}` : ''}` : amount(u.id, at);
    case 'same-week': return at === 1 && who ? `You and ${who} both met your goals` : `${amount(u.id, at)} at goal with a friend`;
    case 'crew-streak': return `${amount(u.id, at)} at goal with a friend`;
    case 'crew-day': return at === 1 && who ? `You, ${who} all trained` : `${amount(u.id, at)} with two friends training`;
    case 'full-house': return (u.with?.length ?? 0) === at ? `${who} at goal in a week you met yours` : `${amount(u.id, at)} at goal in a week you met yours`;
    case 'sessions': return at === 1 ? 'Your first session' : amount(u.id, at);
    case 'goal-weeks': return at === 1 ? 'Your first goal week' : `${amount(u.id, at)} at your goal`;
    case 'prs': return at === 1 ? 'Your first PR' : amount(u.id, at);
    case 'comeback': return 'A session after 14+ days away';
    case 'light-week': return 'A light week, then back at it';
    case 'every-muscle': return 'Every muscle got its sets this week';
    case 'patterns': return 'All six movement patterns this week';
    case 'stronger': return `Three lifts up ${at}% on their start`;
    case 'on-target': return `${amount(u.id, at)} on target`;
    case 'plates': return `${u.lift}: ${amount(u.id, at)}, ${plural(at, 'plate')} a side`;
    case 'bodyweight': return `${u.lift}: ${amount(u.id, at)}`;
    case 'weigh-ins': return at === 1 ? 'Your first weigh-in' : amount(u.id, at);
    case 'steady-weeks': return `${amount(u.id, at)} at a steady rate`;
    case 'photo-days': return at === 1 ? 'Your first photo day' : amount(u.id, at);
    case 'photo-season': return `${amount(u.id, at)} since your first photos`;
    case 'flexed-relaxed': return 'All six poses, relaxed and flexed';
    default: return amount(u.id, at);
  }
}
export const tierWord = (t: Tier) => t[0].toUpperCase() + t.slice(1);

// ---- What friends see (plan §7, owner Q2–Q6 as recommended): the highest level of each family, per lift for a per-lift one, of
// the groups you show, in your Compare summary (domain/compare `ach`). No counts, no values beyond the level, no tracks.

/** One shared achievement: family id, level index, the day reached, the lift for a per-lift one. */
export interface SharedAch { i: string; l: number; d: string; n?: string }
/** At most this many in a summary (the rules hold it to the same). */
export const MAX_SHARED = 32;
const NAME_MAX = 60;

/** Your achievements as friends get them: groups in `hidden` left out; the highest level of each, newest first. */
export function shareOf(a: Achievements, hidden: readonly string[] = []): SharedAch[] {
  const top = new Map<string, Unlock>();
  for (const u of a.unlocks) {
    const g = DEF.get(u.id)!.group;
    if (isPrivate(g) || hidden.includes(g)) continue; // Together and Your body: never shared, whatever the switches say
    const k = `${u.id}:${u.lift ? liftKey(u.lift) : ''}`, t = top.get(k);
    if (!t || u.level > t.level || (u.level === t.level && u.date > t.date)) top.set(k, u);
  }
  return [...top.values()]
    .sort((x, y) => y.date.localeCompare(x.date) || y.level - x.level || x.id.localeCompare(y.id) || (x.lift ?? '').localeCompare(y.lift ?? ''))
    .slice(0, MAX_SHARED)
    .map((u) => ({ i: u.id, l: u.level, d: u.date, ...(u.lift && { n: Array.from(u.lift).slice(0, NAME_MAX).join('') }) }));
}

/**
 * A friend's shared achievements as unlocks, read as untrusted: an unknown family, a level it hasn't, a lift on a family that
 * isn't per lift (or none on one that is), or a bad day is dropped. Value 0: friends never get the number.
 */
export function unlocksOf(xs: readonly SharedAch[]): Unlock[] {
  const out: Unlock[] = [];
  for (const x of xs.slice(0, MAX_SHARED)) {
    const d = typeof x?.i === 'string' ? DEF.get(x.i) : undefined;
    if (x.n !== undefined && (typeof x.n !== 'string' || !x.n.trim() || Array.from(x.n).length > NAME_MAX)) continue;
    if (!d || isPrivate(d.group) || typeof x.d !== 'string' || !Number.isInteger(x.l) || x.l < 0 || x.l >= d.levels.length || !/^\d{4}-\d{2}-\d{2}$/.test(x.d) || !!d.perLift !== !!x.n) continue;
    out.push({ id: x.i, level: x.l, tier: d.levels[x.l].tier, date: x.d, value: 0, ...(x.n && { lift: x.n }) });
  }
  return out;
}

/**
 * Your achievements without the private groups: what anything that leaves the phone is worked out from (the points your buddies
 * show friends, domain/buddies/share), so Together's and Your body's rewards never show there either.
 */
export function withoutPrivate(a: Achievements): Achievements {
  const pub = (id: string) => !isPrivate(DEF.get(id)?.group ?? '');
  const keep = <T,>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).filter(([id]) => pub(id)));
  return { unlocks: a.unlocks.filter((u) => pub(u.id)), tracks: a.tracks.filter((t) => pub(t.id)), counts: keep(a.counts), hidden: a.hidden, repeats: keep(a.repeats) };
}

/** For a friend's feed card and page: silver and up only (owner Q6), so a new friend's first bronzes don't fill the feed. */
export const featured = (us: readonly Unlock[]): Unlock[] => us.filter((u) => TIERS.indexOf(u.tier) >= TIERS.indexOf('silver'));
