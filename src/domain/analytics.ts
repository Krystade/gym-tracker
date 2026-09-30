import { muscleVector, MUSCLES, type Muscle } from './muscles';
import type { SetEntry } from './types';

const toDate = (d: string) => { const [y, m, day] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, day)); };
const fromDate = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: string, n: number): string => { const x = toDate(d); x.setUTCDate(x.getUTCDate() + n); return fromDate(x); };
export const weekStart = (d: string): string => addDays(d, -((toDate(d).getUTCDay() + 6) % 7));

const zero = (): Record<Muscle, number> => Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
const SESSION_CAP = 11;

export function weeklyMuscleSets(entries: SetEntry[], week: string): { sets: Record<Muscle, number>; unmapped: string[] } {
  const end = addDays(week, 7);
  const sets = zero();
  const unmapped = new Set<string>();
  const byDay = new Map<string, Record<Muscle, number>>();
  for (const e of entries) {
    if (e.date < week || e.date >= end || e.flags.includes('warmup')) continue;
    const v = muscleVector(e.exercise);
    if (!v) { unmapped.add(e.exercise); continue; }
    const day = byDay.get(e.date) ?? byDay.set(e.date, zero()).get(e.date)!;
    for (const [m, f] of Object.entries(v) as [Muscle, number][]) day[m] += f;
  }
  for (const day of byDay.values()) for (const m of MUSCLES) sets[m] += Math.min(day[m], SESSION_CAP);
  return { sets, unmapped: [...unmapped].sort() };
}

export interface WeekSummary { week: string; sessions: number; sets: number; tonnage: number }

export function weeklySummary(entries: SetEntry[], weeks: number, today: string): WeekSummary[] {
  const last = weekStart(today);
  const out: WeekSummary[] = Array.from({ length: weeks }, (_, i) => ({ week: addDays(last, -7 * (weeks - 1 - i)), sessions: 0, sets: 0, tonnage: 0 }));
  const idx = new Map(out.map((w, i) => [w.week, i]));
  const days = new Map<string, Set<string>>();
  for (const e of entries) {
    const i = idx.get(weekStart(e.date));
    if (i == null) continue;
    const w = out[i];
    if (!e.flags.includes('warmup')) w.sets += 1;
    if (e.weight > 0 && e.reps != null && !e.flags.includes('hold')) w.tonnage += e.weight * e.reps;
    (days.get(w.week) ?? days.set(w.week, new Set()).get(w.week)!).add(e.date);
  }
  for (const w of out) w.sessions = days.get(w.week)?.size ?? 0;
  return out;
}

/** Weeks in a row meeting the sessions goal. The in-progress week only counts once it is met; it never breaks a run. */
export function streak(summaries: WeekSummary[], goal: number): { current: number; best: number; thisWeekMet: boolean } {
  const thisWeekMet = (summaries.at(-1)?.sessions ?? 0) >= goal;
  const met = [...summaries.slice(0, -1).map((w) => w.sessions >= goal), ...(thisWeekMet ? [true] : [])];
  let best = 0, run = 0;
  for (const m of met) { run = m ? run + 1 : 0; best = Math.max(best, run); }
  return { current: run, best, thisWeekMet };
}

export function calendarDays(entries: SetEntry[], days: number, today: string): { date: string; sets: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries) if (!e.flags.includes('warmup')) counts.set(e.date, (counts.get(e.date) ?? 0) + 1);
  return Array.from({ length: days }, (_, i) => { const date = addDays(today, i - days + 1); return { date, sets: counts.get(date) ?? 0 }; });
}
