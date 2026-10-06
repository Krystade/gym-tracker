import { defaultSettings, settingsKey } from './progression';
import { sameExercise } from './stats';
import { addDays } from './analytics';
import type { Program, ProgramDay } from './program';
import type { SetEntry } from './types';

/** Seconds, until your own data takes over: a set plus its rest, a switch between lifts, a warm-up set. */
export const DEFAULT_PACE = { compound: 180, isolation: 120, transition: 120, warmup: 60 } as const;
const MAX_SAME = 10 * 60, MAX_SWITCH = 15 * 60, MIN_SAMPLES = 3;

const secs = (e: SetEntry) => Date.parse(e.loggedAt!) / 1000;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** One day's sets that have a time, in the order they were done. Sets added later without a time are left out. */
export const timedDay = (entries: SetEntry[], date: string): SetEntry[] =>
  entries.filter((e) => e.date === date && e.loggedAt).sort((a, b) => secs(a) - secs(b));

export interface Paces { perSet: Map<string, number>; transition: number }

/** Your pace from timed days: per lift, the median time from one set to the next (≤ 10 min); between lifts, the median switch (≤ 15 min). */
export function paces(entries: SetEntry[]): Paces {
  const same = new Map<string, number[]>(), sw: number[] = [];
  for (const date of new Set(entries.filter((e) => e.loggedAt).map((e) => e.date))) {
    const day = timedDay(entries, date);
    for (let i = 1; i < day.length; i++) {
      const gap = secs(day[i]) - secs(day[i - 1]);
      if (gap <= 0) continue;
      if (sameExercise(day[i].exercise, day[i - 1].exercise)) {
        if (gap <= MAX_SAME) { const k = settingsKey(day[i].exercise); same.set(k, [...(same.get(k) ?? []), gap]); }
      } else if (gap <= MAX_SWITCH) sw.push(gap);
    }
  }
  const perSet = new Map([...same].filter(([, xs]) => xs.length >= MIN_SAMPLES).map(([k, xs]) => [k, median(xs)]));
  return { perSet, transition: sw.length >= MIN_SAMPLES ? median(sw) : DEFAULT_PACE.transition };
}

export const perSetSeconds = (p: Paces, exercise: string): number =>
  p.perSet.get(settingsKey(exercise)) ?? (defaultSettings(exercise).repMin >= 10 ? DEFAULT_PACE.isolation : DEFAULT_PACE.compound);

/** A list of lifts and sets, in seconds: every set, a switch between lifts, and the warm-up of the first lift that has one (`warmups(ex)` sets). */
export function estimateSeconds(slots: { exercise: string; sets: number }[], p: Paces, warmups: (ex: string) => number = () => 0): number {
  const warm = slots.map((s) => warmups(s.exercise)).find((n) => n > 0) ?? 0; // only the session's first compound warms up
  const work = warm * DEFAULT_PACE.warmup + slots.reduce((a, s) => a + s.sets * perSetSeconds(p, s.exercise), 0);
  return work + Math.max(0, slots.length - 1) * p.transition;
}

/** How long a logged day took: first to last timed set, plus one typical set for the last. Null with fewer than 2 timed sets. */
export function sessionMinutes(entries: SetEntry[], date: string, p: Paces): number | null {
  const day = timedDay(entries, date);
  if (day.length < 2) return null;
  return Math.round((secs(day.at(-1)!) - secs(day[0]) + perSetSeconds(p, day.at(-1)!.exercise)) / 60);
}

/**
 * A "when" for a set entered late, as HH:MM: the middle of the day's unusually long gap (over twice the median and 2 min longer),
 * else one of the day's typical gaps after the last timed set (the long-run pace if it has one set), never after `now`. Null when the day has no timed sets.
 */
export function suggestTime(entries: SetEntry[], date: string, exercise: string, p: Paces, now: Date): string | null {
  const day = timedDay(entries, date);
  if (!day.length) return null;
  const gaps = day.slice(1).map((e, i) => [secs(day[i]), secs(e)] as const);
  // The day's own spacing beats the long-run pace for "one more set".
  const typical = gaps.length ? median(gaps.map(([a, b]) => b - a)) : perSetSeconds(p, exercise);
  if (gaps.length >= 2) {
    const [a, b] = gaps.reduce((x, y) => (y[1] - y[0] > x[1] - x[0] ? y : x));
    if (b - a > Math.max(2 * typical, typical + 120)) return hhmm(new Date(((a + b) / 2) * 1000));
  }
  const next = Math.min((secs(day.at(-1)!) + typical) * 1000, now.getTime());
  return hhmm(new Date(next));
}

/** The day a workout belongs to: past midnight, the previous day while its last timed set is under `hours` old. */
export function sessionDay(entries: SetEntry[], today: string, now: Date, hours = 3): string {
  const last = entries.filter((e) => e.loggedAt).reduce<SetEntry | null>((a, e) => (!a || secs(e) > secs(a) ? e : a), null);
  return last && last.date === addDays(today, -1) && now.getTime() - secs(last) * 1000 <= hours * 3600e3 ? last.date : today;
}

/** The most sets per session (8–20) whose every day `est`imates within `minutes`; 8 if none fits. */
export function perSessionForMinutes(minutes: number, build: (per: number) => Program, est: (day: ProgramDay) => number): number {
  for (let per = 20; per > 8; per--) if (Math.max(...build(per).days.map(est)) <= minutes) return per;
  return 8;
}
