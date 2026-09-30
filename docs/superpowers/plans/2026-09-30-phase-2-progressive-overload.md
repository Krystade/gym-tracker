# Phase 2 — Progressive Overload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every exercise card tells you what to do today (same weight and beat last time's reps, or go up), estimates RIR for sets where you didn't log it, lets you set rep range and increment per exercise, and celebrates PRs the moment you log one.

**Architecture:** A pure `src/domain/progression.ts` (settings defaults, RIR estimate, next target, PR detection) with unit tests; IndexedDB bumps to v2 with a `settings` store (migration keeps every set); a `useSettings` hook; UI changes confined to `ExerciseCard`, `SetForm` (seed), `ExerciseScreen` (settings editor, estimated RIR). No personal data enters the repo.

**Tech Stack:** unchanged from Phase 1.

**Spec:** `docs/superpowers/specs/2026-09-29-gym-tracker-design.md` (Phase 2 + "Estimates").

## Phase Research (2026-09-30)

| Question | Finding | Consequence |
|---|---|---|
| How reliable is self-reported RIR? | Experienced lifters under-predict reps to failure by ~1–2, novices by ~4–5; accuracy improves below ~12 reps. ([Accuracy in predicting RIR, 2025](https://efsupit.ro/images/stories/november2025/Art%20262.pdf), [Validity of RIR, 2025](https://www.sciencedirect.com/science/article/pii/S053155652500213X)) | Estimated RIR is always shown as `~n`, never overwrites a logged value, and is clamped 0–5. |
| Double progression rules? | Keep the load until all working sets reach the top of the range, then add the smallest practical increment; reps fall back toward the bottom and rebuild. ([MesoStrength](https://mesostrength.com/blog/double-progression), [JPS](https://www.jpshealthandfitness.com.au/the-utility-of-dynamic-autoregulated-double-progression/)) | `nextTarget` implements exactly this. |
| Rep ranges for isolation work? | Isolation lifts need wider ranges (10–20) because one dumbbell jump can be 15–30%. ([Legion](https://legionathletics.com/isolation-exercise-progress/), [RP](https://rpstrength.com/blogs/articles/progressing-for-hypertrophy)) | Defaults: isolation 10–15, compound 8–12; user-editable per exercise. |
| Proximity to failure for hypertrophy? | Similar growth near-but-not-at failure; 1–2 RIR most sets, last isolation set 0–1. | "Go up" requires top-of-range on all working sets; if RIR is known it must be ≤ 2 (otherwise the reps were too easy to count as a real top). |
| Better 1RM equation? | 2026 study (303,494 near-failure sets): Epley under-estimates at light loads; weight-dependent formula `1RM = w·(1 + (r−1)^0.85 / (−2.55 + 4.58·ln w))`, w in kg. ([arXiv 2603.17495](https://arxiv.org/abs/2603.17495)) | Deferred to Phase 3 calibration (the spec's estimator blend); Phase 2 keeps Epley so estimates and charts stay consistent. |

## Open Questions — answered by default (user asked for no interruptions)

1. Default rep ranges → isolation 10–15, compound 8–12, by exercise-name keywords; editable.
2. Default increment → 5 lb for everything; editable per exercise (e.g. 2.5).
3. What counts as "working sets" → sets without `warmup` or `partial`, at the session's top weight.
4. PR definition → a set whose e1RM beats every earlier set of that exercise, or more reps than ever at that weight (or heavier). Shown as an inline banner in the card, not a modal.

## Global Constraints

- All Phase 1 constraints (privacy, iPhone 13 mini sizing, CSV format, e1RM definition) still hold.
- IndexedDB upgrade must preserve all existing sets (v1 → v2).
- Estimated values are visibly marked `~` and never written into `SetEntry.rir`.

## Review Focus

1. **Upgrade with data already on the phone** — v1 database with sets opens as v2 with all sets intact. Pinned: Task 2 db test.
2. **Exercise with only bodyweight/partial/warmup history** — no target crash; target falls back to "match last time". Pinned: Task 1 test.
3. **Mixed weights in the last session** (ramping 60→80→100) — target uses the top working weight only. Pinned: Task 1 test.
4. **Very light weights** (5 lb lateral raise) — RIR estimate stays in 0–5, increments never produce negative or silly targets. Pinned: Task 1 test.
5. **Logging on a day that already has sets for the exercise** — target is computed from the previous session, not today's. Pinned: Task 1 test.

---

## File Structure

```
src/domain/progression.ts        settings defaults, estimateRir, nextTarget, prCheck
src/domain/progression.test.ts
src/db/db.ts                     v2: settings store (+ migration test in db.test.ts)
src/state/useSettings.ts         load/save per-exercise settings
src/ui/ExerciseCard.tsx          target line, ~RIR on rows, PR banner, seeded form
src/ui/ExerciseScreen.tsx        settings editor, ~RIR on rows
src/ui/SetRow.tsx                shared set-row content (card + detail) incl. ~RIR
src/ui/App.tsx                   pass settings down
e2e/progression.spec.ts
```

---

### Task 1: Progression domain

**Files:** Create `src/domain/progression.ts`, `src/domain/progression.test.ts`

**Interfaces:**
- Consumes: `SetEntry`, `e1rm`, `sessionsFor`, `sameExercise`, `normalizeName`
- Produces:
  - `interface ExerciseSettings { key: string; repMin: number; repMax: number; increment: number }`
  - `settingsKey(name: string): string` (normalized lowercase)
  - `defaultSettings(name: string): ExerciseSettings`
  - `isWorking(s: SetEntry): boolean`
  - `priorE1rm(entries: SetEntry[], exercise: string, beforeDate: string): number | null` (max e1RM over the last 3 sessions before the date)
  - `estimateRir(set: SetEntry, sessionSets: SetEntry[], prior: number | null): number | null`
  - `interface Target { kind: 'increase' | 'reps' | 'repeat'; weight: number; reps: number; last: SetEntry[]; text: string }`
  - `nextTarget(entries: SetEntry[], exercise: string, settings: ExerciseSettings, date: string): Target | null`
  - `interface PrResult { e1rm: boolean; reps: boolean }`; `prCheck(entries: SetEntry[], set: SetEntry): PrResult`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { defaultSettings, estimateRir, isWorking, nextTarget, prCheck, priorE1rm, settingsKey } from './progression';

let seq = 0;
const s = (date: string, setNo: number, weight: number, reps: number | null, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `t|${date}|curl|${setNo}|${seq}`, date, seq: seq++, exercise: 'Curl', setNo, weight, reps, flags: [], source: 't', ...over,
});
const S = { key: 'curl', repMin: 8, repMax: 12, increment: 5 };

describe('settings', () => {
  it('defaults isolation lifts to 10-15 and compounds to 8-12', () => {
    expect(defaultSettings('Incline DB Curl')).toMatchObject({ repMin: 10, repMax: 15, increment: 5 });
    expect(defaultSettings('Cable Pushdown')).toMatchObject({ repMin: 10, repMax: 15 });
    expect(defaultSettings('Bench Press')).toMatchObject({ repMin: 8, repMax: 12 });
    expect(settingsKey('  Bench   press ')).toBe('bench press');
  });
});

describe('isWorking', () => {
  it('excludes warmups and partials', () => {
    expect(isWorking(s('d', 1, 50, 10))).toBe(true);
    expect(isWorking(s('d', 1, 50, 10, { flags: ['warmup'] }))).toBe(false);
    expect(isWorking(s('d', 1, 50, null, { flags: ['partial'] }))).toBe(false);
  });
});

describe('nextTarget', () => {
  it('says go up when every working set at the top weight hit the top of the range', () => {
    const e = [s('2026-01-01', 1, 30, 12), s('2026-01-01', 2, 30, 12), s('2026-01-01', 3, 30, 13)];
    expect(nextTarget(e, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'increase', weight: 35, reps: 8 });
  });
  it('holds weight and asks for one more rep otherwise, using the weakest set', () => {
    const e = [s('2026-01-01', 1, 30, 12), s('2026-01-01', 2, 30, 10), s('2026-01-01', 3, 30, 7)];
    expect(nextTarget(e, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'reps', weight: 30, reps: 8 });
  });
  it('goes up at the top of the range even when logged RIR says there was more left', () => {
    const e = [s('2026-01-01', 1, 30, 12, { rir: 4 }), s('2026-01-01', 2, 30, 12)];
    expect(nextTarget(e, 'Curl', S, '2026-01-08')?.kind).toBe('increase');
  });
  it('uses only the top working weight of a ramping session and ignores warmups', () => {
    const e = [s('2026-01-01', 1, 20, 15, { flags: ['warmup'] }), s('2026-01-01', 2, 60, 12), s('2026-01-01', 3, 80, 12), s('2026-01-01', 4, 100, 9)];
    expect(nextTarget(e, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'reps', weight: 100, reps: 10 });
  });
  it('ignores sets logged today and uses the previous session', () => {
    const e = [s('2026-01-01', 1, 30, 12), s('2026-01-01', 2, 30, 12), s('2026-01-08', 1, 35, 6)];
    expect(nextTarget(e, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'increase', weight: 35 });
  });
  it('repeats last time when there are no working sets, and returns null with no history', () => {
    const e = [s('2026-01-01', 1, 0, 15, { flags: ['bodyweight'] }), s('2026-01-01', 2, 0, 12, { flags: ['bodyweight'] })];
    expect(nextTarget(e, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'reps', weight: 0, reps: 13 });
    expect(nextTarget([s('2026-01-01', 1, 40, null, { flags: ['partial'] })], 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'repeat', weight: 40 });
    expect(nextTarget([], 'Curl', S, '2026-01-08')).toBeNull();
  });
  it('caps rep targets at the top of the range', () => {
    const e = [s('2026-01-01', 1, 30, 12), s('2026-01-01', 2, 30, 11)];
    expect(nextTarget(e, 'Curl', S, '2026-01-08')).toMatchObject({ kind: 'reps', reps: 12 });
  });
});

describe('estimateRir', () => {
  it('estimates from prior e1RM, clamped 0..5', () => {
    // prior e1RM 40 → at 30 lb Epley predicts 10 reps; 8 done → ~2
    expect(estimateRir(s('d', 1, 30, 8), [], 40)).toBe(2);
    expect(estimateRir(s('d', 1, 30, 12), [], 40)).toBe(0);
    expect(estimateRir(s('d', 1, 5, 12), [], 40)).toBe(5);
  });
  it('treats a set followed by a 3+ rep drop at the same weight as near failure', () => {
    const a = s('d', 1, 30, 10), b = s('d', 2, 30, 6);
    expect(estimateRir(a, [a, b], 60)).toBe(1);
  });
  it('returns null when RIR was logged, or for bodyweight/partial, or without any prior', () => {
    expect(estimateRir(s('d', 1, 30, 8, { rir: 2 }), [], 40)).toBeNull();
    expect(estimateRir(s('d', 1, 0, 8, { flags: ['bodyweight'] }), [], 40)).toBeNull();
    expect(estimateRir(s('d', 1, 30, 8), [], null)).toBeNull();
  });
});

describe('priorE1rm and prCheck', () => {
  const e = [s('2026-01-01', 1, 30, 10), s('2026-01-08', 1, 35, 8), s('2026-01-15', 1, 30, 12)];
  it('takes the best of the last three sessions before the date', () => {
    expect(priorE1rm(e, 'Curl', '2026-01-15')).toBeCloseTo(35 * (1 + 8 / 30), 5);
    expect(priorE1rm(e, 'Curl', '2026-01-01')).toBeNull();
  });
  it('flags e1RM PRs and rep PRs at a weight', () => {
    const pr = s('2026-01-22', 1, 35, 10);
    expect(prCheck([...e, pr], pr)).toEqual({ e1rm: true, reps: true });
    const repOnly = s('2026-01-22', 2, 30, 13);
    expect(prCheck([...e, repOnly], repOnly)).toEqual({ e1rm: false, reps: true });
    const none = s('2026-01-22', 3, 30, 9);
    expect(prCheck([...e, none], none)).toEqual({ e1rm: false, reps: false });
  });
});
```

Ruling (in the plan): a logged RIR of 3+ at the top of the range means the weight is too light, which argues *for* going up, so `nextTarget` ignores RIR. The spec's "at RIR ≤ 2" guarded against grinding past the range, which double progression already prevents.

- [ ] **Step 2: Run** `npx vitest run src/domain/progression.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/domain/progression.ts
import { normalizeName } from './ids';
import { e1rm, sessionsFor } from './stats';
import type { SetEntry } from './types';

export interface ExerciseSettings { key: string; repMin: number; repMax: number; increment: number }

export const settingsKey = (name: string): string => normalizeName(name).toLowerCase();

const ISOLATION = /(curl|raise|fly|flye|extension|pushdown|push down|kickback|crunch|calf|face pull|rear delt|shrug|pec deck|pull-in|pullover|wrist|leg raise|sit-up|rotation|abduction|adduction)/i;

export function defaultSettings(name: string): ExerciseSettings {
  const iso = ISOLATION.test(name);
  return { key: settingsKey(name), repMin: iso ? 10 : 8, repMax: iso ? 15 : 12, increment: 5 };
}

export const isWorking = (s: SetEntry): boolean => !s.flags.includes('warmup') && !s.flags.includes('partial') && s.reps != null;

export function priorE1rm(entries: SetEntry[], exercise: string, beforeDate: string): number | null {
  const vals = sessionsFor(entries, exercise).filter((x) => x.date < beforeDate).slice(0, 3)
    .flatMap((x) => x.sets.map(e1rm)).filter((v): v is number => v != null);
  return vals.length ? Math.max(...vals) : null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Estimated reps in reserve for a set without a logged RIR; null when it can't be estimated. */
export function estimateRir(set: SetEntry, sessionSets: SetEntry[], prior: number | null): number | null {
  if (set.rir != null || set.reps == null || set.weight <= 0 || set.flags.includes('bodyweight') || set.flags.includes('partial')) return null;
  const next = sessionSets.find((x) => x.setNo === set.setNo + 1 && x.weight === set.weight && x.reps != null);
  if (next && set.reps - (next.reps as number) >= 3) return 1;
  if (prior == null) return null;
  const predicted = set.weight >= prior ? 1 : 30 * (prior / set.weight - 1);
  return clamp(Math.round(predicted - set.reps), 0, 5);
}

export interface Target { kind: 'increase' | 'reps' | 'repeat'; weight: number; reps: number; last: SetEntry[]; text: string }

const lb = (w: number) => (w === 0 ? 'BW' : `${Math.round(w * 100) / 100} lb`);

export function nextTarget(entries: SetEntry[], exercise: string, st: ExerciseSettings, date: string): Target | null {
  const last = sessionsFor(entries, exercise).find((x) => x.date < date);
  if (!last) return null;
  const working = last.sets.filter(isWorking);
  if (!working.length) {
    const w = Math.max(...last.sets.map((x) => x.weight));
    return { kind: 'repeat', weight: w, reps: st.repMin, last: last.sets, text: `Repeat ${lb(w)} and log every rep` };
  }
  const top = Math.max(...working.map((x) => x.weight));
  const atTop = working.filter((x) => x.weight === top);
  const minReps = Math.min(...atTop.map((x) => x.reps as number));
  if (top > 0 && minReps >= st.repMax) {
    const w = top + st.increment;
    return { kind: 'increase', weight: w, reps: st.repMin, last: last.sets, text: `Go up: ${lb(w)} × ${st.repMin}+` };
  }
  // Bodyweight has no weight to add, so its rep target is not capped by the range.
  const reps = top === 0 ? minReps + 1 : Math.min(minReps + 1, st.repMax);
  return { kind: 'reps', weight: top, reps, last: last.sets, text: `${lb(top)} × ${reps}+ on every set` };
}

export interface PrResult { e1rm: boolean; reps: boolean }

export function prCheck(entries: SetEntry[], set: SetEntry): PrResult {
  const earlier = entries.filter((x) => x.id !== set.id && x.exercise.toLowerCase() === set.exercise.toLowerCase()
    && (x.date < set.date || (x.date === set.date && x.seq < set.seq)));
  const v = e1rm(set);
  const best = Math.max(-Infinity, ...earlier.map(e1rm).filter((n): n is number => n != null));
  const repsBest = Math.max(-Infinity, ...earlier.filter((x) => x.weight >= set.weight && x.reps != null && !x.flags.includes('warmup')).map((x) => x.reps as number));
  return {
    e1rm: v != null && earlier.length > 0 && v > best,
    reps: set.reps != null && earlier.length > 0 && !set.flags.includes('warmup') && set.reps > repsBest,
  };
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `Progression: targets, estimated RIR, PR detection`.

---

### Task 2: Settings storage (IndexedDB v2) and hook

**Files:** Modify `src/db/db.ts`, `src/db/db.test.ts`; Create `src/state/useSettings.ts`

**Interfaces:**
- Produces: `getAllSettings(): Promise<ExerciseSettings[]>`, `putSettings(s: ExerciseSettings): Promise<void>`; `useSettings(): { get(name: string): ExerciseSettings; save(s: ExerciseSettings): Promise<void> }`

- [ ] **Step 1: Failing tests** (append to `db.test.ts`)

```ts
import { openDB } from 'idb';
import { getAllSettings, putSettings } from './db';

describe('db v2', () => {
  it('upgrades a v1 database without losing sets', async () => {
    const v1 = await openDB('gym-tracker', 1, { upgrade(d) { d.createObjectStore('sets', { keyPath: 'id' }).createIndex('date', 'date'); } });
    await v1.put('sets', { id: 'a', date: '2026-01-01', seq: 0, exercise: 'Curl', setNo: 1, weight: 30, reps: 10, flags: [], source: 's' });
    v1.close();
    expect(await getAllSets()).toHaveLength(1);
    expect(await getAllSettings()).toEqual([]);
  });
  it('stores settings by key', async () => {
    await putSettings({ key: 'curl', repMin: 6, repMax: 10, increment: 2.5 });
    await putSettings({ key: 'curl', repMin: 8, repMax: 12, increment: 2.5 });
    expect(await getAllSettings()).toEqual([{ key: 'curl', repMin: 8, repMax: 12, increment: 2.5 }]);
  });
});
```

- [ ] **Step 2: Run** → FAIL (`getAllSettings` missing).

- [ ] **Step 3: Implement** — `openDB('gym-tracker', 2, { upgrade(d, oldVersion) { if (oldVersion < 1) { …sets store… } if (oldVersion < 2) d.createObjectStore('settings', { keyPath: 'key' }); } })`, plus:

```ts
export const getAllSettings = async (): Promise<ExerciseSettings[]> => (await db()).getAll('settings');
export const putSettings = async (s: ExerciseSettings): Promise<void> => { await (await db()).put('settings', s); };
```

```ts
// src/state/useSettings.ts
import { useCallback, useEffect, useState } from 'react';
import { getAllSettings, putSettings } from '../db/db';
import { defaultSettings, settingsKey, type ExerciseSettings } from '../domain/progression';

export function useSettings() {
  const [map, setMap] = useState<Map<string, ExerciseSettings>>(new Map());
  useEffect(() => { void getAllSettings().then((all) => setMap(new Map(all.map((s) => [s.key, s])))).catch(() => {}); }, []);
  const get = useCallback((name: string) => map.get(settingsKey(name)) ?? defaultSettings(name), [map]);
  const save = useCallback(async (s: ExerciseSettings) => { await putSettings(s); setMap((m) => new Map(m).set(s.key, s)); }, []);
  return { get, save };
}
export type SettingsStore = ReturnType<typeof useSettings>;
```

- [ ] **Step 4: Run** `npx vitest run` → PASS. **Step 5: Commit** `IndexedDB v2 settings store`.

---

### Task 3: UI — targets, ~RIR, PR banner, settings editor

**Files:** Create `src/ui/SetRow.tsx`, `e2e/progression.spec.ts`; Modify `ExerciseCard.tsx`, `ExerciseScreen.tsx`, `TodayScreen.tsx`, `App.tsx`, `styles.css`

**Interfaces:**
- Consumes: Task 1 + Task 2 exports.
- Produces: accessible names — `status` "Target" text on each card (`aria-label="Target"`), PR banner `role="status"` containing "PR", set rows show `~n RIR` with `title="Estimated"`; exercise screen has a group "Progression settings" with textboxes "Min reps", "Max reps", "Increment" and a button "Save settings".

- [ ] **Step 1: Failing e2e**

```ts
// e2e/progression.spec.ts
import { expect, test } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

test('target, estimated RIR, PR banner and settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();

  // Sample: last Cable Curl session 70×12, 80×8, 80×? → top working weight 80, weakest 8 → 80 lb × 9+
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  await expect(page.getByLabel('Target')).toContainText('80 lb × 9+');
  await expect(page.getByRole('textbox', { name: 'Weight' })).toHaveValue('80');
  await expect(page.getByRole('textbox', { name: 'Reps' })).toHaveValue('9');

  await page.getByRole('textbox', { name: 'Reps' }).fill('10');
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'PR' })).toBeVisible();

  await page.getByRole('button', { name: 'Cable Curl', exact: true }).click();
  await expect(page.getByTitle('Estimated').first()).toBeVisible();
  // A 6–8 range makes last session's weakest top set (8) the top of the range → go up by the increment.
  await page.getByRole('textbox', { name: 'Min reps' }).fill('6');
  await page.getByRole('textbox', { name: 'Max reps' }).fill('8');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(page.getByLabel('Target')).toContainText('Go up: 85 lb × 6+');
});
```

- [ ] **Step 2: Run** `npm run e2e -- e2e/progression.spec.ts` → FAIL (no Target).

- [ ] **Step 3: SetRow.tsx** (shared by card and detail)

```tsx
import type { SetEntry } from '../domain/types';
import { fmtSet } from '../domain/format';

export function SetRowContent({ s, estRir }: { s: SetEntry; estRir: number | null }) {
  return (
    <>
      <span className="set-no">{s.setNo}</span>
      <span>{fmtSet(s)}</span>
      {s.rir != null ? <span className="tag">RIR {s.rir}</span>
        : estRir != null && <span className="tag est" title="Estimated">~{estRir} RIR</span>}
      {s.flags.filter((f) => f !== 'bodyweight').map((f) => <span key={f} className={`tag ${f}`}>{f.replace('_', ' ')}</span>)}
      {s.note && <span className="note">{s.note}</span>}
    </>
  );
}
```

- [ ] **Step 4: ExerciseCard.tsx changes**
  - Props gain `settings: SettingsStore`.
  - `const st = settings.get(exercise); const target = nextTarget(store.entries, exercise, st, date); const prior = priorE1rm(store.entries, exercise, date);`
  - Seed: `const seed = today.at(-1); initial = seed ? {weight: seed.weight, reps: seed.reps ?? st.repMin, …} : target ? { weight: target.weight, reps: target.reps, flags: last-session double_pulley } : { weight: 0, reps: st.repMin, flags: [] }`.
  - Under the header: `{target && <p className="target" aria-label="Target">🎯 {target.text}</p>}` (replace the emoji with a small inline SVG target icon to avoid emoji rendering differences; class `target` in accent colour).
  - Rows: `<SetRowContent s={s} estRir={estimateRir(s, today, prior)} />` inside the existing button.
  - PR banner: state `const [pr, setPr] = useState<string | null>(null)`; on add success, `const r = prCheck([...store.entries, e], e)`; if `r.e1rm` → `PR! New best e1RM ${Math.round(e1rm(e)!)} lb`; else if `r.reps` → `Rep PR at ${fmtWeight(e.weight)} lb`; render `<p role="status" className="pr">{pr}</p>` above the form; clear it after 6 s (`setTimeout`), and when the form is next submitted.
  - `store.add` must return the entry (it does) so the PR check sees it.

- [ ] **Step 5: ExerciseScreen.tsx changes**
  - Rows use `SetRowContent` with `estimateRir(x, session.sets, priorE1rm(store.entries, name, session.date))`.
  - Settings editor card after the tiles:

```tsx
function SettingsEditor({ name, settings }: { name: string; settings: SettingsStore }) {
  const cur = settings.get(name);
  const [min, setMin] = useState(String(cur.repMin));
  const [max, setMax] = useState(String(cur.repMax));
  const [inc, setInc] = useState(String(cur.increment));
  const [saved, setSaved] = useState(false);
  const vMin = Number(min), vMax = Number(max), vInc = Number(inc);
  const valid = Number.isInteger(vMin) && Number.isInteger(vMax) && vMin >= 1 && vMax >= vMin && vMax <= 50 && vInc > 0 && vInc <= 50;
  return (
    <section className="card" role="group" aria-label="Progression settings">
      <p className="muted small">Double progression: stay at a weight until every working set reaches max reps, then add the increment.</p>
      <div className="settings-grid">
        <label>Min reps<input aria-label="Min reps" inputMode="numeric" value={min} onChange={(e) => { setMin(e.target.value); setSaved(false); }} /></label>
        <label>Max reps<input aria-label="Max reps" inputMode="numeric" value={max} onChange={(e) => { setMax(e.target.value); setSaved(false); }} /></label>
        <label>Increment (lb)<input aria-label="Increment" inputMode="decimal" value={inc} onChange={(e) => { setInc(e.target.value.replace(',', '.')); setSaved(false); }} /></label>
      </div>
      <button className="wide" disabled={!valid} onClick={async () => { await settings.save({ key: cur.key, repMin: vMin, repMax: vMax, increment: vInc }); setSaved(true); }}>
        {saved ? 'Saved' : 'Save settings'}
      </button>
    </section>
  );
}
```
  Rendered as `<SettingsEditor key={name} name={name} settings={settings} />`. (Accessible name of the button while unsaved is "Save settings".)

- [ ] **Step 6: App/TodayScreen** — `const settings = useSettings();` in App; pass to `TodayScreen` → `ExerciseCard`, and to `ExerciseScreen`.

- [ ] **Step 7: styles.css additions**

```css
.target { color: var(--accent); font-weight: 600; margin: 6px 0; display: flex; align-items: center; gap: 6px; }
.tag.est { font-style: italic; }
.pr { background: var(--accent); color: var(--accent-ink); font-weight: 700; border-radius: 10px; padding: 10px 12px; margin: 8px 0; }
.settings-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.settings-grid label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
```

- [ ] **Step 8: Run** full `npx vitest run` and `npm run e2e` → PASS; add the target card and the settings editor to `e2e/screens.spec.ts` shots (they already appear in `1-today` and `5-exercise`); read the PNGs at 375×812 and fix anything cramped.

- [ ] **Step 9: Commit and push** `Targets, estimated RIR, PR banner, per-exercise settings`; confirm the Pages deploy and the served bundle contains `Save settings`.
