import { MUSCLES, type Muscle } from './muscles';

export type Tier = 1 | 2 | 3 | 4;
export interface Profile { key: 'profile'; tiers: Record<Muscle, Tier>; weeklyGoal: number; targets: Record<Tier, [number, number]>; lowShare?: number; /** Tiers whose targets were set by hand; the rest fit the week (see domain/targets). */ custom?: Tier[];
  /** Cardio's priority: weekly minutes from CARDIO_TARGETS. Unset means 4 (none planned). */ cardioTier?: Tier;
  /** What the training is for (owner, 2026-10-20): unset means 'size', the default for growth. See goalOf. */ goal?: TrainingGoal }
/** Share of weekly sets the builder may spend on priority 3–4 muscles while priority 1–2 still need sets. */
export const DEFAULT_LOW_SHARE = 0.2;

/**
 * Weekly fractional sets per muscle by priority (owner, 2026-10-20). (a) Priority 1–2 grow: more sets grow more with no clear
 * plateau below ~20 a week (Pelland 2026, Sports Med 56:481) and at least 10 a week (Currier 2026, ACSM position stand, MSSE
 * 58:851: hypertrophy ✔, 5 reviews, n=2,267). Priority 3 keeps: about a third of the volume holds size and strength (Bickel
 * 2011, MSSE 43:1177; Spiering 2021, JSCR 35:1449). Priority 4 [0, 0]: excluded, nothing planned (c). A profile keeps the ranges
 * it saved by hand (custom); only the fitted ones follow these.
 */
export const DEFAULT_TARGETS: Record<Tier, [number, number]> = { 1: [12, 20], 2: [10, 14], 3: [4, 6], 4: [0, 0] };
/** The defaults before 2026-10-20: how a profile saved without `custom` is read (targets.customTiers), so its meaning stays. */
export const LEGACY_TARGETS: Record<Tier, [number, number]> = { 1: [12, 16], 2: [8, 12], 3: [5, 8], 4: [2, 5] };

export type TrainingGoal = 'size' | 'strength';
/**
 * 'size' (the default, recommended for growth): growth is about equal from ~5 to ~30 reps near failure (a: Currier 2026, load ✖
 * for hypertrophy, 8 reviews, n=5,340), so the ranges stay where reps are easy to judge. 'strength': barbell compounds default to
 * 5–8 reps, the ≥ 80 % 1RM loads strength responds to (a: Currier 2026, load ✔ for strength, QoE 79 %, 6 reviews, n=6,574). A
 * lift's own range, set on its page, wins either way.
 */
export const goalOf = (p: Pick<Profile, 'goal'> | null | undefined): TrainingGoal => (p?.goal === 'strength' ? 'strength' : 'size');

export const defaultProfile = (): Profile => ({
  key: 'profile', weeklyGoal: 2, targets: { ...DEFAULT_TARGETS },
  tiers: Object.fromEntries(MUSCLES.map((m) => [m, 3])) as Record<Muscle, Tier>,
});

export const targetFor = (p: Profile, m: Muscle): [number, number] => p.targets[p.tiers[m]];
export const status = (sets: number, [lo, hi]: [number, number]): 'under' | 'on' | 'over' => (sets < lo ? 'under' : sets > hi ? 'over' : 'on');

const isTier = (n: unknown): n is Tier => n === 1 || n === 2 || n === 3 || n === 4;

export function parseProfileJson(text: string): { profile: Profile } | { error: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { error: 'Not valid JSON' }; }
  const o = raw as { type?: unknown; tiers?: Record<string, unknown>; weeklyGoal?: unknown; targets?: Record<string, unknown>; lowShare?: unknown; cardioTier?: unknown; goal?: unknown };
  if (o?.type !== 'gym-tracker-profile') return { error: 'Not a gym-tracker profile file' };
  const p = defaultProfile();
  for (const [m, t] of Object.entries(o.tiers ?? {})) {
    if (!(MUSCLES as readonly string[]).includes(m)) return { error: `Unknown muscle "${m}"` };
    if (!isTier(t)) return { error: `Tier for ${m} must be 1-4` };
    p.tiers[m as Muscle] = t;
  }
  if (o.weeklyGoal != null) {
    if (typeof o.weeklyGoal !== 'number' || o.weeklyGoal < 1 || o.weeklyGoal > 7) return { error: 'weeklyGoal must be 1-7' };
    p.weeklyGoal = o.weeklyGoal;
  }
  for (const [k, v] of Object.entries(o.targets ?? {})) {
    const t = Number(k);
    if (!isTier(t) || !Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === 'number' && n >= 0) || v[0] > v[1]) return { error: `Bad target for tier ${k}` };
    p.targets[t] = [v[0], v[1]];
  }
  if (o.lowShare != null) {
    if (typeof o.lowShare !== 'number' || o.lowShare < 0 || o.lowShare > 0.5) return { error: 'lowShare must be 0–0.5' };
    p.lowShare = o.lowShare;
  }
  if (o.goal != null) {
    if (o.goal !== 'size' && o.goal !== 'strength') return { error: 'goal must be size or strength' };
    p.goal = o.goal;
  }
  if (o.cardioTier != null) {
    if (!isTier(o.cardioTier)) return { error: 'cardioTier must be 1-4' };
    p.cardioTier = o.cardioTier;
  }
  return { profile: p };
}
