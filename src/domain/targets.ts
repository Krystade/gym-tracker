import { muscleVector } from './muscles';
import { DEFAULT_TARGETS, type Profile, type Tier } from './profile';
import { isWorking } from './progression';
import type { SetEntry } from './types';

const TIERS: Tier[] = [1, 2, 3, 4];
const WINDOW_DAYS = 56; // the last 8 weeks say how you train now
const FALLBACK_PER_SESSION = 15;
const MIN_SESSIONS = 4; // fewer logged sessions than this say little about a normal one
/** Fractional muscle-sets one set gives (direct 1, indirect ½) when there's no history to measure it. */
export const FALLBACK_YIELD = 1.5;

const since = (today: string) => new Date(Date.parse(`${today}T00:00:00Z`) - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
const recent = (entries: SetEntry[], today: string) => { const from = since(today); return entries.filter((e) => e.date >= from && e.date <= today && isWorking(e)); };

export interface Budget { sessions: number; perSession: number; sets: number }

/** Sets a week: your sessions-per-week goal × sets per session (the program's, else your recent median over 4+ sessions, else 15). */
export function weeklyBudget(p: Profile, program: { perSession: number } | null, entries: SetEntry[], today: string): Budget {
  let perSession = program?.perSession;
  if (!perSession) {
    const perDay = new Map<string, number>();
    for (const e of recent(entries, today)) perDay.set(e.date, (perDay.get(e.date) ?? 0) + 1);
    const xs = [...perDay.values()].sort((a, b) => a - b);
    perSession = xs.length >= MIN_SESSIONS ? (xs.length % 2 ? xs[(xs.length - 1) / 2] : Math.round((xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2)) : FALLBACK_PER_SESSION;
  }
  return { sessions: p.weeklyGoal, perSession, sets: p.weeklyGoal * perSession };
}

/** The muscle-sets one of your sets gives on average lately (a press counts for chest, triceps and delts). */
export function setYield(entries: SetEntry[], today: string): number {
  const vs = recent(entries, today).map((e) => muscleVector(e.exercise)).filter((v) => v != null);
  if (!vs.length) return FALLBACK_YIELD;
  return vs.reduce((a, v) => a + Object.values(v).reduce((x, y) => x + (y ?? 0), 0), 0) / vs.length;
}

/** Tiers whose ranges were set by hand. A profile saved before `custom` existed: the tiers that differ from the defaults. */
export function customTiers(p: Profile): Tier[] {
  if (p.custom) return p.custom;
  return TIERS.filter((t) => p.targets[t][0] !== DEFAULT_TARGETS[t][0] || p.targets[t][1] !== DEFAULT_TARGETS[t][1]);
}

const half = (n: number) => Math.round(n * 2) / 2;
const mid = ([lo, hi]: [number, number]) => (lo + hi) / 2;

export interface Fitted { targets: Record<Tier, [number, number]>; scale: number; custom: Tier[] }

/**
 * Weekly targets that fit the week: hand-set tiers keep their ranges and are paid for first; the rest scale the default
 * ranges by one factor, so priority order holds and every muscle at its midpoint about fills the week.
 */
export function fitTargets(p: Profile, budget: Budget, yieldPerSet: number): Fitted {
  const custom = customTiers(p);
  const count = (t: Tier) => Object.values(p.tiers).filter((x) => x === t).length;
  const capacity = budget.sets * yieldPerSet;
  const paid = custom.reduce((a, t) => a + count(t) * mid(p.targets[t]), 0);
  const want = TIERS.filter((t) => !custom.includes(t)).reduce((a, t) => a + count(t) * mid(DEFAULT_TARGETS[t]), 0);
  const scale = want ? Math.min(1, Math.max(0, capacity - paid) / want) : 1;
  const targets = Object.fromEntries(TIERS.map((t) => {
    if (custom.includes(t)) return [t, p.targets[t]];
    const lo = half(DEFAULT_TARGETS[t][0] * scale);
    return [t, [lo, Math.max(half(DEFAULT_TARGETS[t][1] * scale), lo, 1)]];
  })) as Record<Tier, [number, number]>;
  return { targets, scale, custom };
}
