# Phase 3 — Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Stats tab that answers "am I training what I said matters?" — weekly fractional sets per muscle against priority-tier targets, sessions per week with a weekly streak, weekly tonnage, a training calendar — plus rep-max estimates (any N) that calibrate themselves from periodic test sets.

**Architecture:** Pure domain modules — `muscles.ts` (exercise → muscle contribution), `analytics.ts` (weekly aggregation, streaks, calendar), `profile.ts` (priority tiers, targets, JSON import), `estimators.ts` (Epley + weight-dependent formula, calibration from `test` sets) — each unit-tested. IndexedDB v3 adds a `profile` store. UI: a fifth tab "Stats" with four hand-rolled SVG charts following the dataviz method (single-series amber, status colours only with icon+label, tap readout, table view), and the exercise screen gains calibrated e1RM/eNRM and a "test due" nudge. The personal priority profile never enters the repo: it is imported from `profile.json` in the private repo or set in-app.

**Tech Stack:** unchanged.

**Spec:** `docs/superpowers/specs/2026-09-29-gym-tracker-design.md` (Phase 3).

## Phase Research (2026-09-30)

| Question | Finding | Consequence |
|---|---|---|
| How to count indirect volume? | Pelland et al. 2024/25 dose-response meta-regressions: the **fractional** method (direct set = 1, indirect = 0.5) had the strongest evidence; hypertrophy keeps rising with weekly fractional sets, with no detectable extra benefit past ~11 fractional sets per muscle per session. ([Sports Medicine / PubMed 41343037](https://pubmed.ncbi.nlm.nih.gov/41343037/), [SportRxiv preprint](https://sportrxiv.org/index.php/server/preprint/view/460)) | Muscle matrix uses 1 / 0.5 weights (the user's own half-fraction sheet already does); per-session cap of 11 fractional sets per muscle when counting. |
| Streak design | Daily-streak users disengage after the first miss far more often than users tracking weekly targets; weekly targets tolerate a bad day. ([habi.app stats](https://habi.app/insights/habit-tracker-statistics/), [Moore Momentum](https://mooremomentum.com/blog/why-most-habit-streaks-fail-and-how-to-build-ones-that-dont/)) | Streak = consecutive weeks meeting a sessions-per-week goal (default 2), current week counts once met or still in progress. |
| 1RM estimation at light loads | Weight-dependent formula (w in kg) `1RM = w·(1 + (r−1)^0.85 / (−2.55 + 4.58·ln w))` cut error 17–22% vs Epley/Brzycki; Epley under-estimates light isolation lifts. ([arXiv 2603.17495](https://arxiv.org/abs/2603.17495)) | Two estimators; per-exercise calibration picks the one with lower error against the user's own test sets and applies a bounded bias. Formula is only used for w ≥ 4 kg (denominator stays positive and sane); below that Epley. |
| Chart design | dataviz method: one series → no legend, amber accent; status colours (good `#0ca30c`, warning `#fab219`, critical `#d03b3b`) only with icon + label; thin marks, 4 px rounded bar ends, recessive axes; interactive readout; a table view. | Applied in Task 5. |

## Open Questions — answered by default (no interruptions requested)

1. Tier targets (weekly fractional sets): tier 1 = 12–16, tier 2 = 8–12, tier 3 = 5–8, tier 4 = 2–5. Editable.
2. Week starts Monday. Sessions-per-week goal defaults to 2 (sized for rebuilding the habit), editable.
3. Muscle list = the 18 columns of the user's matrix; "back" in the priorities means Lats + Mid-Back + Traps + Erectors; "legs" = Quads, Hamstrings, Glutes, Calves, Adductors, Abductors; Forearms go with tier 4.
4. A calibration test = a set flagged `test` done to failure (RIR 0). Due every 6 weeks per exercise that has ≥ 4 sessions in the last 8 weeks.

## Global Constraints

- All Phase 1–2 constraints hold. IndexedDB v2 → v3 keeps sets and settings.
- The priority profile is personal: never hard-coded with the user's tiers; defaults are neutral (all tier 3).
- Charts: single amber series on the card surface, status colour never alone, every chart has a tap readout and a "Table" disclosure, no dual axes, nothing wider than 375 px.

## Review Focus

1. **Sparse history** (one session, or a gap of months) — every chart renders an empty-state line instead of NaN/Infinity geometry. Pinned: Task 2 tests + Task 5 e2e empty state.
2. **Unknown exercise names** (anything typed in the picker) — keyword fallback assigns muscles; truly unknown → counted as "Unmapped", listed so it can be fixed. Pinned: Task 1 test.
3. **Double-counting a muscle in one session** (5 curls + 4 rows) — per-session cap of 11 fractional sets applied per muscle. Pinned: Task 2 test.
4. **Very light loads in the weight-dependent formula** (5 lb raise) — no negative/infinite e1RM. Pinned: Task 4 test.
5. **Week boundaries and the current partial week** — Sunday-night sessions land in the right Monday-start week; the in-progress week never breaks a streak. Pinned: Task 2 test.

---

## File Structure

```
src/domain/muscles.ts / .test.ts      MUSCLES, TIER_GROUPS, muscleVector(name)
src/domain/analytics.ts / .test.ts    weekStart, weeklyMuscleSets, weeklySummary, streak, calendarDays
src/domain/profile.ts / .test.ts      Profile, defaultProfile, targetFor, parseProfileJson
src/domain/estimators.ts / .test.ts   epley, weightDependent, calibrate, calibratedE1rm, weightForReps, testDue
src/domain/types.ts                   FLAGS += 'test'
src/db/db.ts                          v3 profile store
src/state/useProfile.ts
src/ui/StatsScreen.tsx                summary tiles, 4 charts, profile editor
src/ui/charts/BarChart.tsx, MuscleBars.tsx, Calendar.tsx, ChartTable.tsx
src/ui/ExerciseScreen.tsx             calibrated tiles, test-due nudge
src/ui/SetForm.tsx                    'Test' chip
src/ui/DataScreen.tsx                 import accepts profile .json
e2e/stats.spec.ts
```

---

### Task 1: Muscle map

**Files:** Create `src/domain/muscles.ts`, `src/domain/muscles.test.ts`

**Interfaces — Produces:** `MUSCLES` (18, ordered), `type Muscle`, `type Vector = Partial<Record<Muscle, number>>`, `muscleVector(name: string): Vector | null`, `MUSCLE_LABEL: Record<Muscle,string>`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import { muscleVector, MUSCLES } from './muscles';

describe('muscleVector', () => {
  it('has 18 muscles', () => { expect(MUSCLES).toHaveLength(18); });
  it('maps catalog names exactly, case/space-insensitively', () => {
    expect(muscleVector('Cable Pushdown')).toEqual({ Triceps: 1 });
    expect(muscleVector('  lat   pulldown ')).toEqual({ Lats: 1, 'Mid-Back': 0.5, Biceps: 0.5, Forearms: 0.5 });
    expect(muscleVector('Overhead Press')).toEqual({ 'Front Delts': 1, Triceps: 0.5, 'Side Delts': 0.5 });
  });
  it('falls back on keywords for unknown names', () => {
    expect(muscleVector('Spider Curl')).toEqual({ Biceps: 1 });
    expect(muscleVector('Rope Pushdown')).toEqual({ Triceps: 1 });
    expect(muscleVector('Egyptian Lateral Raise')).toEqual({ 'Side Delts': 1 });
    expect(muscleVector('Leg Curl Something')).toEqual({ Hamstrings: 1, Glutes: 0.5, Quads: 0.5 });
  });
  it('returns null for names it cannot place', () => {
    expect(muscleVector('Zercher Thing')).toBeNull();
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — the table is the user's half-fraction matrix (a generic training table, no personal data), corrected where a row was plainly mis-entered (Overhead Press and Arnold Press were scored as Chest 1.0; they are Front Delts 1.0), plus every name in `CATALOG`:

```ts
import { normalizeName } from './ids';

export const MUSCLES = ['Chest', 'Triceps', 'Biceps', 'Front Delts', 'Side Delts', 'Rear Delts', 'Lats', 'Mid-Back', 'Traps', 'Erectors',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs', 'Forearms', 'Adductors', 'Abductors'] as const;
export type Muscle = (typeof MUSCLES)[number];
export type Vector = Partial<Record<Muscle, number>>;
export const MUSCLE_LABEL: Record<Muscle, string> = Object.fromEntries(MUSCLES.map((m) => [m, m])) as Record<Muscle, string>;

const PRESS: Vector = { Chest: 1, Triceps: 0.5, 'Front Delts': 0.5 };
const OHP: Vector = { 'Front Delts': 1, Triceps: 0.5, 'Side Delts': 0.5 };
const ROW_MID: Vector = { 'Mid-Back': 1, Lats: 0.5, 'Rear Delts': 0.5, Biceps: 0.5, Forearms: 0.5 };
const ROW_LAT: Vector = { Lats: 1, 'Mid-Back': 0.5, 'Rear Delts': 0.5, Biceps: 0.5, Forearms: 0.5 };
const PULLDOWN: Vector = { Lats: 1, 'Mid-Back': 0.5, Biceps: 0.5, Forearms: 0.5 };
const SQUAT: Vector = { Quads: 1, Glutes: 0.5, Hamstrings: 0.5 };
const HINGE: Vector = { Hamstrings: 1, Glutes: 0.5, Erectors: 0.5 };
const LEGCURL: Vector = { Hamstrings: 1, Glutes: 0.5, Quads: 0.5 };
const B: Vector = { Biceps: 1 }, T: Vector = { Triceps: 1 }, A: Vector = { Abs: 1 }, SD: Vector = { 'Side Delts': 1 }, RD: Vector = { 'Rear Delts': 1 };

const TABLE: Record<string, Vector> = {
  'bench press': PRESS, 'incline bench press': PRESS, 'smith incline press': PRESS, 'smith flat press': PRESS, 'incline db press': PRESS,
  'flat db press': PRESS, 'machine chest press': PRESS, 'push-up': PRESS, 'weighted push-up': PRESS, 'close-grip push-up': { Triceps: 1, Chest: 0.5, 'Front Delts': 0.5 },
  'close-grip smith press': { Triceps: 1, Chest: 0.5, 'Front Delts': 0.5 }, 'close-grip bench press': { Triceps: 1, Chest: 0.5, 'Front Delts': 0.5 },
  'forward-lean dips': { Chest: 1, Triceps: 0.5, 'Front Delts': 0.5 }, 'upright dips': { Triceps: 1, Chest: 0.5, 'Front Delts': 0.5 }, dips: { Chest: 1, Triceps: 0.5, 'Front Delts': 0.5 },
  'machine chest fly': { Chest: 1 }, 'cable chest fly': { Chest: 1 }, 'low-to-high cable fly': { Chest: 1, 'Front Delts': 0.5 },
  'cable pushdown': T, 'rope pushdown': T, 'incline bench pushdown': T, 'overhead cable extension': T, 'overhead db triceps extension': T,
  skullcrusher: { Triceps: 1 }, 'db kickback': T, 'triceps press machine': T,
  'db curl': B, 'incline db curl': B, 'hammer curl': { Biceps: 1, Forearms: 0.5 }, 'cable curl': B, 'bayesian cable curl': B, 'preacher curl': B,
  'cross-body db curl': { Biceps: 1, Forearms: 0.5 }, 'machine biceps curl': B, 'reverse curl': { Forearms: 1, Biceps: 0.5 }, 'db reverse curl': { Forearms: 1, Biceps: 0.5 },
  'zottman curl': { Biceps: 1, Forearms: 0.5 }, 'wrist curl': { Forearms: 1 }, 'db wrist curl': { Forearms: 1 }, 'db reverse wrist curl': { Forearms: 1 },
  'farmer’s carry': { Forearms: 1, Traps: 0.5 }, 'plate pinch hold': { Forearms: 1 },
  'overhead press': OHP, 'overhead db press': OHP, 'machine shoulder press': OHP, 'arnold press': OHP,
  'db lateral raise': SD, 'cable lateral raise': SD, 'machine lateral raise': SD, 'front raise': { 'Front Delts': 1 },
  'face pull': { 'Rear Delts': 1, 'Mid-Back': 0.5, Traps: 0.5 }, 'cable rear delt fly': RD, 'reverse pec deck': RD,
  'lat pulldown': PULLDOWN, 'close-grip lat pulldown': PULLDOWN, 'lat pull-in': PULLDOWN, 'pull-up': PULLDOWN, 'chin-up': { Lats: 1, Biceps: 0.5, 'Mid-Back': 0.5, Forearms: 0.5 },
  'straight-arm pulldown': { Lats: 1 }, 'archer pull': { Lats: 1, 'Mid-Back': 0.5, Biceps: 0.5 },
  'seated cable row': ROW_MID, 'chest-supported row': ROW_MID, 'kneeling db row': ROW_MID, 'machine row': ROW_LAT,
  'cable crunch': A, 'ab crunch machine': A, 'decline sit-up': A, 'decline crunch (weighted)': A, 'hanging leg raise': A, 'supported leg raise': A, 'leg raise': A,
  'torso rotation machine': A, plank: A, 'side plank': { Abs: 1, Erectors: 0.5 }, 'bird dog': { Erectors: 1, Glutes: 0.5, Abs: 0.5 },
  'mcgill curl-up': A, 'dead bug': A, 'pallof press': A, 'back extension': { Erectors: 1, Glutes: 0.5, Hamstrings: 0.5 },
  'leg press': SQUAT, 'barbell squat': SQUAT, 'smith squat': SQUAT, 'bulgarian split squat': SQUAT, 'leg extension': { Quads: 1 },
  'seated leg curl': LEGCURL, 'lying leg curl': LEGCURL, 'romanian deadlift': HINGE, 'db romanian deadlift': HINGE,
  'hip thrust': { Glutes: 1, Hamstrings: 0.5 }, 'glute press': { Glutes: 1, Hamstrings: 0.5 }, 'cable kickback': { Glutes: 1, Hamstrings: 0.5 },
  'hip adduction machine': { Adductors: 1 }, 'hip abduction machine': { Abductors: 1 },
  'standing calf raise': { Calves: 1 }, 'seated calf raise': { Calves: 1 }, 'db calf raise': { Calves: 1 },
};

const KEYWORDS: [RegExp, Vector][] = [
  [/leg curl|ham curl|nordic/i, LEGCURL], [/wrist curl/i, { Forearms: 1 }], [/curl/i, B],
  [/pushdown|push down|kickback|skull|triceps? ext|french press/i, T],
  [/lateral raise|side raise|upright row/i, SD], [/rear delt|reverse fly|face pull/i, RD],
  [/pulldown|pull-up|pullup|chin/i, PULLDOWN], [/row/i, ROW_MID],
  [/fly|pec deck/i, { Chest: 1 }], [/bench|chest press|push-?up|dip/i, PRESS], [/overhead press|shoulder press|military/i, OHP],
  [/squat|leg press|lunge|step-?up/i, SQUAT], [/deadlift|good morning|hinge/i, HINGE], [/leg ext/i, { Quads: 1 }],
  [/calf/i, { Calves: 1 }], [/crunch|sit-?up|plank|leg raise|ab /i, A], [/hip thrust|glute/i, { Glutes: 1, Hamstrings: 0.5 }],
];

export function muscleVector(name: string): Vector | null {
  const key = normalizeName(name).toLowerCase();
  if (TABLE[key]) return TABLE[key];
  for (const [re, v] of KEYWORDS) if (re.test(key)) return v;
  return null;
}
```

Note: the keyword order matters (`leg curl` before `curl`, `wrist curl` before `curl`) — the test pins `Leg Curl Something` and `Spider Curl`.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `Muscle contribution map`.

---

### Task 2: Weekly analytics

**Files:** Create `src/domain/analytics.ts`, `src/domain/analytics.test.ts`

**Interfaces — Produces:**
- `weekStart(date: string): string` (Monday, YYYY-MM-DD)
- `addDays(date: string, n: number): string`
- `weeklyMuscleSets(entries: SetEntry[], week: string): { sets: Record<Muscle, number>; unmapped: string[] }` — fractional, working sets only (not `warmup`), per-session per-muscle cap 11
- `interface WeekSummary { week: string; sessions: number; sets: number; tonnage: number }`; `weeklySummary(entries, weeks: number, today: string): WeekSummary[]` (oldest first, including empty weeks, ending with the current week)
- `streak(summaries: WeekSummary[], goal: number): { current: number; best: number; thisWeekMet: boolean }`
- `calendarDays(entries, days: number, today: string): { date: string; sets: number }[]` (oldest first)

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { addDays, calendarDays, streak, weekStart, weeklyMuscleSets, weeklySummary } from './analytics';

let seq = 0;
const s = (date: string, exercise: string, weight: number, reps: number | null, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `t${seq}`, date, seq: seq++, exercise, setNo: 1, weight, reps, flags: [], source: 't', ...over,
});

describe('weeks', () => {
  it('starts weeks on Monday, including Sunday sessions in the previous week', () => {
    expect(weekStart('2026-09-28')).toBe('2026-09-28'); // Monday
    expect(weekStart('2026-10-04')).toBe('2026-09-28'); // Sunday
    expect(weekStart('2026-01-01')).toBe('2025-12-29'); // across a year
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('weeklyMuscleSets', () => {
  it('counts direct 1 and indirect 0.5, skips warmups, lists unmapped names', () => {
    const e = [
      s('2026-09-29', 'Cable Curl', 60, 12), s('2026-09-29', 'Cable Curl', 60, 12, { flags: ['warmup'] }),
      s('2026-09-30', 'Lat Pulldown', 100, 10), s('2026-09-30', 'Mystery Move', 10, 10),
      s('2026-10-06', 'Cable Curl', 60, 12),
    ];
    const r = weeklyMuscleSets(e, '2026-09-28');
    expect(r.sets.Biceps).toBe(1.5);
    expect(r.sets.Lats).toBe(1);
    expect(r.sets.Chest).toBe(0);
    expect(r.unmapped).toEqual(['Mystery Move']);
  });
  it('caps a muscle at 11 fractional sets per session', () => {
    const e = Array.from({ length: 14 }, () => s('2026-09-29', 'Cable Curl', 60, 12));
    expect(weeklyMuscleSets(e, '2026-09-28').sets.Biceps).toBe(11);
  });
});

describe('summary, streak, calendar', () => {
  const e = [
    s('2026-09-01', 'Bench Press', 100, 10), s('2026-09-03', 'Bench Press', 100, 10), // week of 8/31: 2 sessions
    s('2026-09-08', 'Bench Press', 100, 10), s('2026-09-10', 'Pull-up', 0, 8, { flags: ['bodyweight'] }), // 9/7: 2
    // 9/14: none
    s('2026-09-22', 'Bench Press', 100, 10), s('2026-09-24', 'Bench Press', 105, 8), // 9/21: 2
    s('2026-09-29', 'Bench Press', 100, 10), // 9/28 (current): 1
  ];
  it('fills empty weeks and sums tonnage without bodyweight', () => {
    const w = weeklySummary(e, 5, '2026-09-30');
    expect(w.map((x) => [x.week, x.sessions])).toEqual([['2026-08-31', 2], ['2026-09-07', 2], ['2026-09-14', 0], ['2026-09-21', 2], ['2026-09-28', 1]]);
    expect(w[1].tonnage).toBe(1000);
    expect(w[3].tonnage).toBe(1840);
  });
  it('counts a streak of weeks meeting the goal; the in-progress week does not break it', () => {
    const r = streak(weeklySummary(e, 5, '2026-09-30'), 2);
    expect(r).toEqual({ current: 1, best: 2, thisWeekMet: false });
  });
  it('returns zeroed results for no data', () => {
    expect(weeklySummary([], 3, '2026-09-30').every((x) => x.sessions === 0 && x.tonnage === 0)).toBe(true);
    expect(streak(weeklySummary([], 3, '2026-09-30'), 2)).toEqual({ current: 0, best: 0, thisWeekMet: false });
  });
  it('builds a calendar of set counts per day', () => {
    const c = calendarDays(e, 7, '2026-09-30');
    expect(c).toHaveLength(7);
    expect(c.at(-1)).toEqual({ date: '2026-09-30', sets: 0 });
    expect(c.find((d) => d.date === '2026-09-29')?.sets).toBe(1);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
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
    if (e.weight > 0 && e.reps != null) w.tonnage += e.weight * e.reps;
    (days.get(w.week) ?? days.set(w.week, new Set()).get(w.week)!).add(e.date);
  }
  for (const w of out) w.sessions = days.get(w.week)?.size ?? 0;
  return out;
}

export function streak(summaries: WeekSummary[], goal: number): { current: number; best: number; thisWeekMet: boolean } {
  const done = summaries.slice(0, -1).map((w) => w.sessions >= goal);
  const thisWeekMet = (summaries.at(-1)?.sessions ?? 0) >= goal;
  let best = 0, run = 0;
  for (const d of [...done, thisWeekMet]) { run = d ? run + 1 : 0; best = Math.max(best, run); }
  let current = 0;
  for (let i = done.length - 1; i >= 0 && done[i]; i--) current++;
  if (thisWeekMet) current++;
  // A failed in-progress week doesn't reset: `run` above treated it as a miss, so recompute best without it.
  if (!thisWeekMet) { best = 0; run = 0; for (const d of done) { run = d ? run + 1 : 0; best = Math.max(best, run); } }
  return { current, best, thisWeekMet };
}

export function calendarDays(entries: SetEntry[], days: number, today: string): { date: string; sets: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries) if (!e.flags.includes('warmup')) counts.set(e.date, (counts.get(e.date) ?? 0) + 1);
  return Array.from({ length: days }, (_, i) => { const date = addDays(today, i - days + 1); return { date, sets: counts.get(date) ?? 0 }; });
}
```

Check against the streak test: done weeks (8/31 ✓, 9/7 ✓, 9/14 ✗, 9/21 ✓); this week 1 < 2 → not met. current = 1 (9/21), best = 2 (8/31–9/7). ✓.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `Weekly analytics: muscle sets, summaries, streaks, calendar`.

---

### Task 3: Priority profile (+ IndexedDB v3)

**Files:** Create `src/domain/profile.ts`, `src/domain/profile.test.ts`, `src/state/useProfile.ts`; Modify `src/db/db.ts`, `src/db/db.test.ts`, `src/ui/DataScreen.tsx`

**Interfaces — Produces:**
- `type Tier = 1 | 2 | 3 | 4`; `interface Profile { key: 'profile'; tiers: Record<Muscle, Tier>; weeklyGoal: number; targets: Record<Tier, [number, number]> }`
- `defaultProfile(): Profile` (all tier 3, goal 2, targets `{1:[12,16],2:[8,12],3:[5,8],4:[2,5]}`)
- `targetFor(p: Profile, m: Muscle): [number, number]`; `status(sets: number, [lo, hi]): 'under' | 'on' | 'over'`
- `parseProfileJson(text: string): { profile: Profile } | { error: string }` — accepts `{ "type": "gym-tracker-profile", "tiers": { "<Muscle>": 1..4 }, "weeklyGoal"?: n, "targets"?: {...} }`; unknown muscles or tiers → error; missing muscles keep default tier 3.
- db: `getProfile(): Promise<Profile | undefined>`, `putProfile(p: Profile)`; `useProfile(): { profile: Profile; save(p: Profile): Promise<void> }`

- [ ] **Step 1: Failing tests** (`profile.test.ts`, plus a db v3 upgrade test mirroring Phase 2's)

```ts
import { describe, expect, it } from 'vitest';
import { defaultProfile, parseProfileJson, status, targetFor } from './profile';

describe('profile', () => {
  it('defaults to neutral tier 3 everywhere', () => {
    const p = defaultProfile();
    expect(new Set(Object.values(p.tiers))).toEqual(new Set([3]));
    expect(targetFor(p, 'Biceps')).toEqual([5, 8]);
    expect(p.weeklyGoal).toBe(2);
  });
  it('parses a profile file and keeps unspecified muscles at tier 3', () => {
    const r = parseProfileJson(JSON.stringify({ type: 'gym-tracker-profile', tiers: { Biceps: 1, 'Side Delts': 2, Quads: 4 }, weeklyGoal: 3 }));
    if (!('profile' in r)) throw new Error(r.error);
    expect(r.profile.tiers.Biceps).toBe(1);
    expect(r.profile.tiers.Chest).toBe(3);
    expect(r.profile.weeklyGoal).toBe(3);
    expect(targetFor(r.profile, 'Biceps')).toEqual([12, 16]);
  });
  it('rejects the wrong type, unknown muscles and bad tiers', () => {
    expect(parseProfileJson('{"type":"other"}')).toHaveProperty('error');
    expect(parseProfileJson('{"type":"gym-tracker-profile","tiers":{"Wings":1}}')).toHaveProperty('error');
    expect(parseProfileJson('{"type":"gym-tracker-profile","tiers":{"Biceps":7}}')).toHaveProperty('error');
    expect(parseProfileJson('not json')).toHaveProperty('error');
  });
  it('grades weekly sets against a target range', () => {
    expect(status(4, [5, 8])).toBe('under');
    expect(status(5, [5, 8])).toBe('on');
    expect(status(9, [5, 8])).toBe('over');
  });
});
```

db test: open v2 with a set and a setting, then `getProfile()` resolves `undefined` and both earlier stores still hold their rows.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/domain/profile.ts
import { MUSCLES, type Muscle } from './muscles';

export type Tier = 1 | 2 | 3 | 4;
export interface Profile { key: 'profile'; tiers: Record<Muscle, Tier>; weeklyGoal: number; targets: Record<Tier, [number, number]> }

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
  const o = raw as { type?: unknown; tiers?: Record<string, unknown>; weeklyGoal?: unknown; targets?: Record<string, unknown> };
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
  return { profile: p };
}
```

db v3: in `upgrade(d, oldVersion)`, `if (oldVersion < 3) d.createObjectStore('profile', { keyPath: 'key' });`; `getProfile = async () => (await db()).get('profile', 'profile')`; `putProfile = async (p) => { await (await db()).put('profile', p); }`.

`useProfile` mirrors `useSettings`: state initialised to `defaultProfile()`, replaced by the stored one on load; `save` writes then sets state.

DataScreen: the file input accepts `.csv,.json,text/csv,application/json`; if the name ends in `.json`, run `parseProfileJson` and on success `profileStore.save(profile)` and show "Profile imported: N muscles prioritised" (count of tiers ≠ 3); on error show the message in the status area. DataScreen gains a `profile` prop.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `Priority profile, IndexedDB v3, profile import`.

---

### Task 4: Estimators and calibration

**Files:** Create `src/domain/estimators.ts`, `src/domain/estimators.test.ts`; Modify `src/domain/types.ts` (`FLAGS` += `'test'`)

**Interfaces — Produces:**
- `type Formula = 'epley' | 'wd'`; `oneRm(f: Formula, weightLb: number, reps: number): number | null`
- `weightForReps(f: Formula, oneRmLb: number, reps: number): number` (inverse; bisection for `wd`)
- `interface Calibration { formula: Formula; factor: number; tests: number; errorPct: number | null }`
- `calibrate(entries: SetEntry[], exercise: string): Calibration` — default `{ formula: 'epley', factor: 1, tests: 0, errorPct: null }`
- `calibratedE1rm(entries, exercise, beforeDate?): number | null` — best of last 3 sessions under the calibrated formula × factor
- `testDue(entries, exercise, today: string): boolean`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { calibrate, calibratedE1rm, oneRm, testDue, weightForReps } from './estimators';

let seq = 0;
const s = (date: string, weight: number, reps: number, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `t${seq}`, date, seq: seq++, exercise: 'Curl', setNo: 1, weight, reps, flags: [], source: 't', ...over,
});

describe('oneRm', () => {
  it('matches Epley and the weight-dependent formula', () => {
    expect(oneRm('epley', 100, 10)).toBeCloseTo(133.33, 1);
    // 100 lb = 45.36 kg; wd factor = 1 + 9^0.85/(−2.55+4.58·ln 45.36) = 1 + 6.47/14.92
    expect(oneRm('wd', 100, 10)).toBeCloseTo(143.4, 0);
    expect(oneRm('wd', 100, 1)).toBe(100);
  });
  it('stays finite and positive at very light loads (falls back to Epley below 4 kg)', () => {
    const v = oneRm('wd', 5, 12)!;
    expect(Number.isFinite(v) && v > 5).toBe(true);
    expect(v).toBeCloseTo(oneRm('epley', 5, 12)!, 5);
  });
  it('rejects unusable sets', () => {
    expect(oneRm('epley', 0, 10)).toBeNull();
    expect(oneRm('wd', 100, 0)).toBeNull();
    expect(oneRm('wd', 100, 31)).toBeNull();
  });
  it('inverts both formulas', () => {
    expect(weightForReps('epley', 120, 6)).toBeCloseTo(100, 3);
    const w = weightForReps('wd', 143.4, 10);
    expect(oneRm('wd', w, 10)).toBeCloseTo(143.4, 1);
  });
});

describe('calibration', () => {
  it('defaults to uncalibrated Epley with no tests', () => {
    expect(calibrate([s('2026-01-01', 30, 10)], 'Curl')).toEqual({ formula: 'epley', factor: 1, tests: 0, errorPct: null });
  });
  it('learns a factor from test sets and prefers the formula with lower error', () => {
    // Training sets predict ~40 (Epley); the to-failure test at 30 lb went 16 reps (Epley 1RM 46) → Epley under-predicts by ~15%.
    const e = [s('2026-01-01', 30, 10), s('2026-01-08', 30, 10), s('2026-02-15', 30, 16, { flags: ['test'], rir: 0 })];
    const c = calibrate(e, 'Curl');
    expect(c.tests).toBe(1);
    expect(c.factor).toBeGreaterThan(1);
    expect(c.factor).toBeLessThanOrEqual(1.2);
    expect(calibratedE1rm(e, 'Curl', '2026-02-15')!).toBeGreaterThan(oneRm(c.formula, 30, 10)!);
  });
  it('flags a test as due after 6 weeks for a regularly trained lift', () => {
    const e = ['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07'].map((d) => s(d, 30, 10));
    expect(testDue(e, 'Curl', '2026-09-30')).toBe(true);
    expect(testDue([...e, s('2026-09-01', 30, 14, { flags: ['test'] })], 'Curl', '2026-09-30')).toBe(false);
    expect(testDue(e.slice(0, 2), 'Curl', '2026-09-30')).toBe(false);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
import { sameExercise, sessionsFor } from './stats';
import type { SetEntry } from './types';
import { addDays } from './analytics';

export type Formula = 'epley' | 'wd';
const KG = 0.45359237;

export function oneRm(f: Formula, w: number, r: number): number | null {
  if (!(w > 0) || !(r >= 1) || r > 30) return null;
  if (r === 1) return w;
  if (f === 'wd' && w * KG >= 4) return w * (1 + Math.pow(r - 1, 0.85) / (-2.55 + 4.58 * Math.log(w * KG)));
  return w * (1 + r / 30);
}

export function weightForReps(f: Formula, oneRmLb: number, r: number): number {
  if (r <= 1) return oneRmLb;
  let lo = 0.01, hi = oneRmLb;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if ((oneRm(f, mid, r) ?? 0) > oneRmLb) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}

const usable = (s: SetEntry) => s.reps != null && s.weight > 0 && !s.flags.some((f) => f === 'warmup' || f === 'partial' || f === 'bodyweight');

function rawE1rm(entries: SetEntry[], exercise: string, f: Formula, beforeDate: string): number | null {
  const vals = sessionsFor(entries, exercise).filter((x) => x.date < beforeDate).slice(0, 3)
    .flatMap((x) => x.sets.filter(usable).map((s) => oneRm(f, s.weight, s.reps as number))).filter((v): v is number => v != null);
  return vals.length ? Math.max(...vals) : null;
}

export interface Calibration { formula: Formula; factor: number; tests: number; errorPct: number | null }

export function calibrate(entries: SetEntry[], exercise: string): Calibration {
  const tests = entries.filter((s) => sameExercise(s.exercise, exercise) && s.flags.includes('test') && usable(s));
  if (!tests.length) return { formula: 'epley', factor: 1, tests: 0, errorPct: null };
  let best: Calibration | null = null;
  for (const f of ['epley', 'wd'] as Formula[]) {
    const ratios = tests.map((t) => {
      const predicted = rawE1rm(entries.filter((x) => !x.flags.includes('test')), exercise, f, t.date);
      const actual = oneRm(f, t.weight, t.reps as number);
      return predicted && actual ? actual / predicted : null;
    }).filter((v): v is number => v != null);
    if (!ratios.length) continue;
    const factor = Math.min(1.2, Math.max(0.8, ratios.reduce((a, b) => a + b, 0) / ratios.length));
    const errorPct = 100 * ratios.reduce((a, r) => a + Math.abs(r - 1), 0) / ratios.length;
    if (!best || errorPct < (best.errorPct ?? Infinity)) best = { formula: f, factor, tests: tests.length, errorPct };
  }
  return best ?? { formula: 'epley', factor: 1, tests: tests.length, errorPct: null };
}

export function calibratedE1rm(entries: SetEntry[], exercise: string, beforeDate = '9999-12-31'): number | null {
  const c = calibrate(entries, exercise);
  const raw = rawE1rm(entries, exercise, c.formula, beforeDate);
  return raw == null ? null : raw * c.factor;
}

export function testDue(entries: SetEntry[], exercise: string, today: string): boolean {
  const mine = entries.filter((s) => sameExercise(s.exercise, exercise));
  const recentDays = new Set(mine.filter((s) => s.date >= addDays(today, -56)).map((s) => s.date));
  if (recentDays.size < 4) return false;
  const lastTest = mine.filter((s) => s.flags.includes('test')).map((s) => s.date).sort().at(-1);
  return !lastTest || lastTest < addDays(today, -42);
}
```

Worked check for the calibration test: Epley prior = 30·(1+10/30) = 40; test Epley = 30·(1+16/30) = 46 → ratio 1.15. WD at 30 lb (13.6 kg): denominator −2.55+4.58·ln 13.6 = 9.40; prior = 30·(1+9^0.85/9.40) = 30·1.688 = 50.6; test = 30·(1+15^0.85/9.40) = 30·2.066 = 62.0 → ratio 1.225 (clamped 1.2), error 22.5% > Epley's 15% → Epley chosen, factor 1.15. `calibratedE1rm` before the test date = 40 × 1.15 = 46 > 40 ✓.

`FLAGS` gains `'test'` (the CSV parser accepts it automatically via `isFlag`).

- [ ] **Step 4: Run** `npx vitest run` → PASS. **Step 5: Commit** `Estimators with self-calibration from test sets`.

---

### Task 5: Stats screen, charts, exercise-screen estimates

**Files:** Create `src/ui/StatsScreen.tsx`, `src/ui/charts/BarChart.tsx`, `src/ui/charts/MuscleBars.tsx`, `src/ui/charts/Calendar.tsx`, `src/ui/charts/ChartTable.tsx`, `e2e/stats.spec.ts`; Modify `App.tsx` (5 tabs: Today, History, Lifts, Stats, Data), `ExerciseScreen.tsx`, `SetForm.tsx` (Test chip), `styles.css`, `e2e/screens.spec.ts` (add `6-stats`)

**Interfaces:**
- `BarChart({ label, points, format, goal? }: { label: string; points: { x: string; y: number }[]; format: (n: number) => string; goal?: number })` — vertical bars, 4 px rounded tops, optional dashed goal line, tap a bar → readout `<p aria-live="polite">`.
- `MuscleBars({ sets, profile })` — rows grouped by tier (headings "Priority 1" … "Priority 4"), each: label, horizontal bar of fractional sets on a 0–max scale with the target band drawn as a translucent-free *outlined* range (hairline rectangle), numeric value, status icon + word ("▲ over", "✓ on target", "▽ under") in status colours `#0ca30c`/`#fab219`/`#d03b3b` with the word in muted ink.
- `Calendar({ days })` — 16 weeks × 7 grid (Mon–Sun rows), cells 14 px with 3 px gaps, fill by set count on a 5-step amber ramp (`#2a2f3a` = 0, then `#5c4a1f`, `#8a6a24`, `#b98a2b`, `#f5b83d`), tap → readout "Tue Sep 29: 14 sets"; legend "less → more".
- `ChartTable({ caption, rows })` — `<details><summary>Table</summary><table>…` for every chart.
- Accessible names for e2e: tab "Stats"; headings "This week", "Muscle volume", "Sessions per week", "Weekly tonnage", "Calendar", "Priorities"; select per muscle labelled with the muscle name; number input "Sessions per week goal".

- [ ] **Step 1: Failing e2e** (`e2e/stats.spec.ts`)

```ts
import { expect, test } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

test('stats: empty state, then charts after import, and priorities edit', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Stats' }).click();
  await expect(page.getByText('No sessions yet')).toBeVisible();

  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await page.getByRole('button', { name: 'Stats' }).click();
  for (const h of ['This week', 'Muscle volume', 'Sessions per week', 'Weekly tonnage', 'Calendar', 'Priorities']) {
    await expect(page.getByRole('heading', { name: h })).toBeVisible();
  }
  await page.getByLabel('Biceps').selectOption('1');
  await expect(page.getByRole('heading', { name: 'Priority 1' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
```

Note: the sample data is from January 2026, so the 12-week charts show zeros — the page must still render headings (not the empty state) because history exists; the "This week" card says "0 of 2 sessions".

- [ ] **Step 2: Run** `npm run e2e -- e2e/stats.spec.ts` → FAIL (no Stats tab).

- [ ] **Step 3: Charts**

```tsx
// src/ui/charts/ChartTable.tsx
export function ChartTable({ caption, head, rows }: { caption: string; head: [string, string]; rows: [string, string][] }) {
  return (
    <details className="chart-table">
      <summary>Table</summary>
      <table><caption>{caption}</caption>
        <thead><tr><th>{head[0]}</th><th>{head[1]}</th></tr></thead>
        <tbody>{rows.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}</tbody>
      </table>
    </details>
  );
}
```

```tsx
// src/ui/charts/BarChart.tsx
import { useState } from 'react';

const W = 340, H = 150, L = 34, R = 6, T = 10, B = 22;

export function BarChart({ label, points, format, goal }: { label: string; points: { x: string; y: number }[]; format: (n: number) => string; goal?: number }) {
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(goal ?? 0, ...points.map((p) => p.y), 1);
  const bw = (W - L - R) / points.length;
  const Y = (v: number) => T + (1 - v / max) * (H - T - B);
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label}>
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="axis" />
        <text x={L - 6} y={T + 4} className="lbl" textAnchor="end">{format(max)}</text>
        <text x={L - 6} y={H - B} className="lbl" textAnchor="end">0</text>
        {goal != null && <line x1={L} x2={W - R} y1={Y(goal)} y2={Y(goal)} className="goal" />}
        {points.map((p, i) => {
          const x = L + i * bw + 1, h = Math.max(0, H - B - Y(p.y));
          return (
            <g key={p.x} onClick={() => setSel(i)}>
              <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
              {h > 0 && <path className={sel === i ? 'bar sel' : 'bar'} d={`M${x},${H - B} v${-(h - Math.min(4, h))} q0,${-Math.min(4, h)} ${Math.min(4, (bw - 2) / 2)},${-Math.min(4, h)} h${bw - 2 - 2 * Math.min(4, (bw - 2) / 2)} q${Math.min(4, (bw - 2) / 2)},0 ${Math.min(4, (bw - 2) / 2)},${Math.min(4, h)} v${h - Math.min(4, h)} z`} />}
            </g>
          );
        })}
        <text x={L} y={H - 6} className="lbl">{md(points[0].x)}</text>
        <text x={W - R} y={H - 6} className="lbl" textAnchor="end">{md(points.at(-1)!.x)}</text>
      </svg>
      <p className="readout" aria-live="polite">{sel == null ? 'Tap a bar for its value.' : `Week of ${md(points[sel].x)}: ${format(points[sel].y)}`}</p>
    </>
  );
}
```

```tsx
// src/ui/charts/MuscleBars.tsx
import { MUSCLES, type Muscle } from '../../domain/muscles';
import { status, targetFor, type Profile, type Tier } from '../../domain/profile';

const ICON = { under: '▽', on: '✓', over: '▲' } as const;
const WORD = { under: 'under', on: 'on target', over: 'over' } as const;

export function MuscleBars({ sets, profile }: { sets: Record<Muscle, number>; profile: Profile }) {
  const max = Math.max(...MUSCLES.map((m) => Math.max(sets[m], targetFor(profile, m)[1])), 1);
  const pct = (v: number) => `${(100 * v) / max}%`;
  return (
    <>
      {([1, 2, 3, 4] as Tier[]).map((tier) => {
        const ms = MUSCLES.filter((m) => profile.tiers[m] === tier);
        if (!ms.length) return null;
        return (
          <div key={tier} className="tier">
            <h3>Priority {tier}</h3>
            {ms.map((m) => {
              const [lo, hi] = targetFor(profile, m); const st = status(sets[m], [lo, hi]);
              return (
                <div key={m} className="mrow">
                  <span className="mname">{m}</span>
                  <span className="mtrack">
                    <span className="mband" style={{ left: pct(lo), width: pct(hi - lo) }} />
                    <span className="mbar" style={{ width: pct(sets[m]) }} />
                  </span>
                  <span className="mval">{sets[m] % 1 ? sets[m].toFixed(1) : sets[m]}</span>
                  <span className={`mstat ${st}`}><b aria-hidden>{ICON[st]}</b> {WORD[st]}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
```

```tsx
// src/ui/charts/Calendar.tsx
import { useState } from 'react';
import { fmtDate, plural } from '../../domain/format';

const STEPS = ['#2a2f3a', '#5c4a1f', '#8a6a24', '#b98a2b', '#f5b83d'];
const step = (n: number) => (n === 0 ? 0 : n < 6 ? 1 : n < 12 ? 2 : n < 20 ? 3 : 4);

export function Calendar({ days }: { days: { date: string; sets: number }[] }) {
  const [sel, setSel] = useState<string | null>(null);
  // Pad the front so the first column starts on Monday.
  const first = new Date(days[0].date + 'T00:00:00');
  const pad = (first.getDay() + 6) % 7;
  const cells = [...Array.from({ length: pad }, () => null), ...days];
  const cols = Math.ceil(cells.length / 7);
  const C = 14, G = 3;
  const picked = days.find((d) => d.date === sel);
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${cols * (C + G)} ${7 * (C + G)}`} width="100%" role="img" aria-label="Training calendar">
        {cells.map((d, i) => d && (
          <rect key={d.date} x={Math.floor(i / 7) * (C + G)} y={(i % 7) * (C + G)} width={C} height={C} rx={3}
            fill={STEPS[step(d.sets)]} className={sel === d.date ? 'cell sel' : 'cell'} onClick={() => setSel(d.date)} />
        ))}
      </svg>
      <p className="readout" aria-live="polite">{picked ? `${fmtDate(picked.date)}: ${plural(picked.sets, 'set')}` : 'Tap a day. Darker = fewer sets.'}</p>
      <div className="cal-legend" aria-hidden><span>less</span>{STEPS.map((c) => <i key={c} style={{ background: c }} />)}<span>more</span></div>
    </>
  );
}
```

- [ ] **Step 4: StatsScreen.tsx**

```tsx
import type { SetsStore } from '../state/useSets';
import type { ProfileStore } from '../state/useProfile';
import { calendarDays, streak, weekStart, weeklyMuscleSets, weeklySummary } from '../domain/analytics';
import { MUSCLES, type Muscle } from '../domain/muscles';
import type { Tier } from '../domain/profile';
import { fmtWeight, plural } from '../domain/format';
import { BarChart } from './charts/BarChart';
import { MuscleBars } from './charts/MuscleBars';
import { Calendar } from './charts/Calendar';
import { ChartTable } from './charts/ChartTable';

const k = (n: number) => (n >= 1000 ? `${fmtWeight(Math.round(n / 100) / 10)}k` : fmtWeight(Math.round(n)));

export function StatsScreen({ store, profile, today }: { store: SetsStore; profile: ProfileStore; today: string }) {
  const p = profile.profile;
  if (!store.entries.length) return (<><h1>Stats</h1><p className="muted">No sessions yet — log a workout or import your history.</p></>);
  const weeks = weeklySummary(store.entries, 12, today);
  const st = streak(weeklySummary(store.entries, 104, today), p.weeklyGoal);
  const thisWeek = weeks.at(-1)!;
  const muscle = weeklyMuscleSets(store.entries, weekStart(today));
  const lastWeek = weeklyMuscleSets(store.entries, weeks.at(-2)!.week);
  const days = calendarDays(store.entries, 16 * 7, today);
  return (
    <>
      <h1>Stats</h1>
      <section className="card">
        <h2>This week</h2>
        <div className="tiles">
          <div className="tile"><span>Sessions</span><b>{thisWeek.sessions} of {p.weeklyGoal}</b></div>
          <div className="tile"><span>Weekly streak</span><b>{plural(st.current, 'week')}</b></div>
          <div className="tile"><span>Sets</span><b>{thisWeek.sets}</b></div>
          <div className="tile"><span>Best streak</span><b>{plural(st.best, 'week')}</b></div>
        </div>
      </section>
      <section className="card">
        <h2>Muscle volume</h2>
        <p className="muted small">Fractional sets this week (direct 1, indirect ½) against your priority targets.</p>
        <MuscleBars sets={muscle.sets} profile={p} />
        {muscle.unmapped.length > 0 && <p className="muted small">Not counted (unknown muscles): {muscle.unmapped.join(', ')}</p>}
        <ChartTable caption="Fractional sets per muscle" head={['Muscle', 'This week / last week']}
          rows={MUSCLES.map((m) => [m, `${muscle.sets[m]} / ${lastWeek.sets[m]}`])} />
      </section>
      <section className="card">
        <h2>Sessions per week</h2>
        <BarChart label="Sessions per week, last 12 weeks" points={weeks.map((w) => ({ x: w.week, y: w.sessions }))} format={(n) => plural(n, 'session')} goal={p.weeklyGoal} />
        <ChartTable caption="Sessions per week" head={['Week of', 'Sessions']} rows={weeks.map((w) => [w.week, String(w.sessions)])} />
      </section>
      <section className="card">
        <h2>Weekly tonnage</h2>
        <BarChart label="Weekly tonnage in pounds, last 12 weeks" points={weeks.map((w) => ({ x: w.week, y: w.tonnage }))} format={(n) => `${k(n)} lb`} />
        <ChartTable caption="Weekly tonnage (lb)" head={['Week of', 'Tonnage']} rows={weeks.map((w) => [w.week, `${Math.round(w.tonnage)}`])} />
      </section>
      <section className="card">
        <h2>Calendar</h2>
        <Calendar days={days} />
      </section>
      <section className="card">
        <h2>Priorities</h2>
        <label className="goal-row">Sessions per week goal
          <input aria-label="Sessions per week goal" inputMode="numeric" value={p.weeklyGoal}
            onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 7) void profile.save({ ...p, weeklyGoal: n }); }} />
        </label>
        <div className="prio-grid">
          {MUSCLES.map((m) => (
            <label key={m}>{m}
              <select aria-label={m} value={p.tiers[m]} onChange={(e) => void profile.save({ ...p, tiers: { ...p.tiers, [m as Muscle]: Number(e.target.value) as Tier } })}>
                {[1, 2, 3, 4].map((t) => <option key={t} value={t}>Priority {t}</option>)}
              </select>
            </label>
          ))}
        </div>
      </section>
    </>
  );
}
```

- [ ] **Step 5: ExerciseScreen** — tiles become: "Est. 1RM" = `calibratedE1rm(entries, name)` (subtitle "calibrated · N tests · ±X%" or "Epley · no tests yet"), "Est. 6RM" = `weightForReps(c.formula, e1, 6)`, plus a row of chips 3/5/8/10/12 that switch the second tile to that N (state `n`, default 6; label "Est. {n}RM"). When `testDue(...)` → a note card: "Time for a test: pick a weight you can do ~8–12 times, go to failure with good form, tick Test." SetForm gains a `Test` chip (flag `test`); a test set is also marked `rir: 0` on submit if RIR is empty.

- [ ] **Step 6: styles.css**

```css
h2 { font-size: 17px; margin: 0 0 8px; }
h3 { font-size: 14px; margin: 12px 0 6px; color: var(--muted); font-weight: 600; }
.chart .bar { fill: var(--accent); }
.chart .bar.sel { fill: #ffd27a; }
.chart .goal { stroke: var(--muted); stroke-dasharray: 4 4; stroke-width: 1; }
.chart .cell.sel { stroke: var(--text); stroke-width: 1.5; }
.readout { font-size: 13px; color: var(--muted); min-height: 1.4em; }
.mrow { display: grid; grid-template-columns: 84px 1fr 30px 86px; align-items: center; gap: 6px; min-height: 28px; font-size: 13px; }
.mtrack { position: relative; height: 10px; background: var(--surface-2); border-radius: 5px; }
.mband { position: absolute; top: -3px; bottom: -3px; border: 1px solid var(--muted); border-radius: 4px; }
.mbar { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); border-radius: 5px; }
.mval { text-align: right; font-variant-numeric: tabular-nums; }
.mstat { color: var(--muted); white-space: nowrap; }
.mstat.under b { color: #d03b3b; } .mstat.on b { color: #0ca30c; } .mstat.over b { color: #fab219; }
.cal-legend { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
.cal-legend i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.chart-table summary { min-height: 44px; display: flex; align-items: center; color: var(--muted); font-size: 14px; cursor: pointer; }
.chart-table table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.chart-table td, .chart-table th { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--line); }
.prio-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.prio-grid label, .goal-row { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
.tabs { grid-template-columns: repeat(5, 1fr); }
.tabs button { font-size: 14px; padding: 0 4px; }
```

- [ ] **Step 7: Run** `npx vitest run`, `npm run e2e` → PASS; screenshot Stats (with the sample imported and the real history imported via the headless script) at 375×812, read the PNGs, fix collisions.

- [ ] **Step 8: Private profile** — in `gym-data` (never here), write `profile.json` in the format above from the priorities agreed in conversation, and commit it to the private repo only.

- [ ] **Step 9: Commit and push** `Stats tab: muscle volume, sessions, tonnage, calendar; calibrated estimates`; confirm deploy.
