# Phase 4 — Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the priority profile into a small, repeatable weekly program (default 2 full-body days × 14 sets — well under the 30–40 sets that burned the user out), show "today's workout" on the Today screen with skip and swap, and track adherence.

**Architecture:** Pure `src/domain/program.ts` (build, volume, next day, adherence) unit-tested; IndexedDB v4 adds a `program` store holding the program (`key: 'program'`) and per-date day plans (`key: 'day:YYYY-MM-DD'`). UI: a Program screen (from a button on Today), a "Today's plan" card on Today, an adherence tile on Stats.

**Spec:** `docs/superpowers/specs/2026-09-29-gym-tracker-design.md` (Phase 4: "Priority tiers → a weekly plan sized to ~12–16 sets/session; today's workout with skip/swap; adherence tracking").

## Phase Research (2026-09-30)

| Question | Finding | Consequence |
|---|---|---|
| How many days? | Volume-equated, frequency has little effect on hypertrophy; ≥2×/week per muscle was favoured in the earlier meta-analysis. ([Schoenfeld 2019, PubMed 30558493](https://pubmed.ncbi.nlm.nih.gov/30558493/), [Schoenfeld 2016](https://www.researchgate.net/publication/301578131_Effects_of_Resistance_Training_Frequency_on_Measures_of_Muscle_Hypertrophy_A_Systematic_Review_and_Meta-Analysis)) | Full-body days, every chosen exercise on every day → each muscle hit 2×/week at the default of 2 days. Days/week follows the profile's sessions goal. |
| Session size | Pelland: no detectable extra benefit past ~11 fractional sets per muscle per session (Phase 3 research). User reports 30–40 sets was unsustainable. | Default 14 sets/session (spec range 12–16), editable 8–20. Cap 4 sets of one exercise per day. |
| Order | Order does not change hypertrophy; strength gains favour what is done first. ([Nunes 2021](https://onlinelibrary.wiley.com/doi/abs/10.1080/17461391.2020.1733672)) | Order by priority tier: the user's priority muscles go first while fresh. |
| Which exercise per muscle | The user's own history is the best predictor of what they will actually do. | Per muscle, pick the most-logged exercise that trains it directly (vector 1); fall back to a catalog default. |

## Open Questions — answered by default

1. Allocation fills each muscle's tier *lower* target first (weighted by tier: 4/3/2/1), then tops up toward the upper targets while budget remains. With 28 weekly sets, tier 4 may get nothing — correct for "legs are priority 4"; the Program screen shows it plainly.
2. One exercise per muscle; variety comes from swap (Phase 5 ranks swaps by similarity).
3. Rotation: the next day is the one after the last day that had logged sets; the user can switch days on the card.
4. Skip/swap are per date and persist across reloads (a workout survives the phone locking).
5. Adherence = logged working sets of planned (or swapped-in) exercises ÷ planned sets, over plan days in the last 4 weeks.

## Global Constraints

Phase 1–3 constraints hold. DB v3 → v4 keeps all stores. Nothing personal in fixtures. 375×812 screenshots checked, including the clipping assertion.

## Review Focus

1. **No history, no profile** — build still returns a sensible program from catalog defaults with neutral tiers. Pinned: Task 1 test.
2. **Budget never exceeded** — total sets per day ≤ perSession; no exercise > 4 sets/day. Pinned: Task 1 test.
3. **Swapped exercise counts toward adherence**; skipped slot counts as planned-not-done. Pinned: Task 1 test.
4. **Day rotation across weeks with gaps** — next day after a 3-week break is still the next in rotation. Pinned: Task 1 test.
5. **Upgrade v3 → v4** keeps sets, settings and profile. Pinned: Task 2 test.

---

## File Structure

```
src/domain/program.ts / .test.ts   Slot, ProgramDay, Program, DayPlan, primaryExercise, buildProgram, programVolume, nextDay, adherence
src/db/db.ts                       v4 'program' store: getProgram, putProgram, getDayPlans, putDayPlan
src/state/useProgram.ts            { program, plans, save, savePlan }
src/ui/ProgramScreen.tsx           build form, days, sets steppers, remove/add, volume vs targets
src/ui/TodayPlan.tsx               today's plan card: day chips, slots with done/planned, Skip, Swap
src/ui/TodayScreen.tsx, App.tsx, StatsScreen.tsx (adherence tile), styles.css
e2e/program.spec.ts
```

---

### Task 1: Program domain

**Interfaces — Produces:**
```ts
interface Slot { exercise: string; sets: number; repMin: number; repMax: number }
interface ProgramDay { name: string; slots: Slot[] }
interface Program { key: 'program'; days: ProgramDay[]; perSession: number; createdAt: string }
interface DayPlan { key: string /* 'day:YYYY-MM-DD' */; date: string; day: number; skips: string[]; swaps: Record<string, string> }
DEFAULT_PICK: Record<Muscle, string>
primaryExercise(m: Muscle, entries: SetEntry[]): string
buildProgram(profile: Profile, entries: SetEntry[], opts: { days: number; perSession: number }, now: Date): Program
programVolume(p: Program): Record<Muscle, number>          // weekly fractional sets = one pass of every day
nextDay(p: Program, plans: DayPlan[], entries: SetEntry[], today: string): number
adherence(p: Program, plans: DayPlan[], entries: SetEntry[], since: string, today: string): { planned: number; done: number }
```

- [ ] **Step 1: Failing tests** (`program.test.ts`) — cases:
  - no history + neutral profile, 2 days × 14: 2 days named "Day A"/"Day B", each ≤ 14 sets, every slot 1–4 sets, every exercise in `CATALOG`, total ≥ 26.
  - tiers Biceps/Triceps/Abs = 1, rest 4: the first slot of Day A trains a tier-1 muscle directly; biceps weekly volume ≥ triceps' lower bound order (all three tier-1 muscles reach ≥ 8 weekly fractional sets); quads get fewer sets than biceps.
  - history pick: with 10 logged sets of "Bayesian Cable Curl" and 2 of "DB Curl", `primaryExercise('Biceps')` = "Bayesian Cable Curl"; with none, `DEFAULT_PICK.Biceps`.
  - 3 days × 10: three days, each ≤ 10.
  - `programVolume`: a hand-built program with Lat Pulldown 3 sets/day × 2 days → Lats 6, Biceps 3.
  - `nextDay`: no plans → 0; a plan for day 0 on 2026-09-01 with sets logged that date → 1; that plus 3-week gap → still 1; plan with no logged sets is ignored.
  - `adherence`: plan day 0 on 2026-09-29 with slots Cable Curl 3 / Cable Pushdown 3; logged 2 curls + 3 sets of the swap target "Rope Pushdown" (swaps {Cable Pushdown: Rope Pushdown}) → { planned: 6, done: 5 }; add a skip of Cable Curl → planned 6, done 3 (skipped counts as planned, not done); warm-ups don't count.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** per the design above (greedy allocation, round-robin day distribution, ordering by best tier then weekly sets). **Step 4: PASS. Step 5: Commit** `Program domain`.

### Task 2: Storage (IndexedDB v4) + `useProgram`

- [ ] db test: v3 database with a set, a setting and a profile opens as v4 with all three intact and `getProgram()` undefined; `putDayPlan` twice for the same date keeps one. → FAIL → implement (`if (oldVersion < 4) createObjectStore('program', { keyPath: 'key' })`; `getDayPlans` = all keys starting `day:`) → PASS → commit `IndexedDB v4 program store`.

### Task 3: UI

- [ ] **e2e first** (`e2e/program.spec.ts`): import sample CSV → Today → "Program" → Days 2, Sets per session 14 → "Build program" → headings "Day A" and "Day B" visible, a "Weekly volume" section → Back → Today shows "Today's plan · Day A" region; tap "Skip" on its second slot → reload → that slot shows "Skipped"; tap the first slot's name → its exercise card appears and after "Add set" the slot shows "1/…"; no horizontal overflow.
- [ ] ProgramScreen: form (Days per week 1–6, Sets per session 8–20), Build/Rebuild (Rebuild confirms), days as cards with each slot `name · sets × repMin–repMax` and −/+ set steppers (1–6) and a remove button (aria-label `Remove <name>`), per-day "Add exercise" via `ExercisePicker` (3 sets, default rep range); "Weekly volume" card reusing `MuscleBars` with `programVolume`.
- [ ] TodayPlan: shown when a program exists; day chips (A/B/…) default `nextDay`; list of slots with `done/planned` (working sets of the exercise or its swap today), "Skip"/"Undo", "Swap" (opens picker; the replacement shows "for <original>"). Tapping the name opens that exercise's card (TodayScreen `extra`). Saving any change writes the `DayPlan`.
- [ ] Stats: tile "Program, 4 weeks" = `done/planned` sets as %, "—" with no program.
- [ ] Screens spec: add `7-program` (Program screen) and the Today plan card to `1-today`; read PNGs; clipping assertion must pass.
- [ ] Run all; commit and push `Program: build, today's plan with skip/swap, adherence`; confirm deploy.
