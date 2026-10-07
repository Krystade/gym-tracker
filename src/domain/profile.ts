import { MUSCLES, type Muscle } from './muscles';

export type Tier = 1 | 2 | 3 | 4;
export interface Profile { key: 'profile'; tiers: Record<Muscle, Tier>; weeklyGoal: number; targets: Record<Tier, [number, number]>; lowShare?: number; /** Tiers whose targets were set by hand; the rest fit the week (see domain/targets). */ custom?: Tier[] }
/** Share of weekly sets the builder may spend on priority 3–4 muscles while priority 1–2 still need sets. */
export const DEFAULT_LOW_SHARE = 0.2;

export const DEFAULT_TARGETS: Record<Tier, [number, number]> = { 1: [12, 16], 2: [8, 12], 3: [5, 8], 4: [2, 5] };

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
  const o = raw as { type?: unknown; tiers?: Record<string, unknown>; weeklyGoal?: unknown; targets?: Record<string, unknown>; lowShare?: unknown };
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
  return { profile: p };
}
