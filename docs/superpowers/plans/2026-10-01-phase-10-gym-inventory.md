# Phase 10 — Gym Inventory & Builder Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The builder only programs exercises the current gym can do, prefers lifts the user knows, and stops spending the week on low-priority muscles.

**Architecture:**
- **Domain `src/domain/equipment.ts`:** the equipment list, the gear each catalog exercise needs (any-of alternatives), and `available(gym, known)`.
- **`Gym` records:** stored in a shared `gyms` config entry (shared across profiles once Phase 11 lands), along with the active gym id.
- **`buildProgram`:**
  - takes `available: Set<string>` and `known: Set<string>`;
  - adds a capped low-priority share (profile `lowShare`, default 0.2);
  - draws on a per-muscle candidate list instead of one fixed fallback.
- **Swap suggestions:** filtered by the same set.
- **UI:** a "Gyms" screen (Program → Gyms) with an equipment checklist, a DB max, and per-exercise Exclude / "I can do this here".

**Spec:** Phase 10 in the design spec.

## Phase Research (2026-10-01)

| Question | Finding | Consequence |
|---|---|---|
| Why the plans had too many low-priority exercises | Every tier-4 muscle has a lower target of 2 sets/week, and the builder gives every muscle below its lower target a dedicated pair. 7 tier-4 muscles × 2 = 14 sets, about 45 % of a 2×16 week. Tier 3 adds 6 more muscles × ≥2. | The cap applies to dedicated sets for tiers 3–4 combined (Jack chose a capped share). Indirect volume from compounds still counts toward their targets. |
| Why it picked machines from the old gym | `primaryExercise` scores by history alone, and the history is from the old gym. `DEFAULT_PICK` is a single fallback per muscle. | Candidates are filtered by `available`. Ranking: known *and* available by history score, then available catalog lifts by a fixed per-muscle preference order. |
| Equipment granularity | Gym equipment lists (commercial gyms) name machines by movement (leg press, leg extension, seated/lying leg curl, pec deck, …), plus cable stations and free weights. | About 30 equipment ids. Exercises needing several pieces of gear list them all; alternatives are any-of. |
| Exercises outside the catalog (custom names from history) | Their gear is unknown. | Treated as available only when they're in the gym's "I can do this here" list, or when the gym has no exclusions and they were logged at this gym (`gymId` on new sets). *Default: unknown-gear exercises need an explicit tick.* |

## Open Questions — answered (Jack: "Both", "Capped share")

1. **Inventory model:** equipment checklist per gym, then per-exercise Exclude (e.g. a cable stack too weak for a lift) and Include (e.g. a lift needing nothing listed).
2. **Cap:** dedicated sets for tiers 3–4 ≤ `lowShare` × weekly sets. The default is 20 %, editable on the Program screen. When the cap binds, tier 3 is ranked before tier 4 as usual.
3. **Several gyms:** yes, with one active. The switch is a chip on the Program screen and in the Today plan header. New sets record `gymId`, a new optional `SetEntry` field. It's left out of the CSV in this phase; an export column comes later if needed.
4. **"Exercises I know":** anything in the history, plus anything ticked "I can do this here". The builder prefers known lifts. It only picks an unknown catalog lift when no known lift for that muscle is available, and marks it "new to you" in the plan.
5. **First run:** with no gyms, a "Set up your gym" card on the Program screen. Building without a gym keeps the old behaviour, with everything available.

## Review Focus

1. **The builder never programs an unavailable exercise.** It falls back to leaving a muscle short and says so. Pinned in Task 2.
2. **The cap holds for any days/perSession combination**, and tier 1–2 targets are filled first. Pinned in Task 2 with a property-style loop.
3. **Swaps respect the gym.** Pinned in Task 3.

---

### Task 1: `src/domain/equipment.ts`

```ts
export const EQUIPMENT = ['barbell', 'squat rack', 'flat bench', 'incline bench', 'dumbbells', 'cable stack', 'dual cable', 'smith machine', 'leg press',
  'leg extension', 'seated leg curl', 'lying leg curl', 'chest press machine', 'pec deck', 'shoulder press machine', 'lateral raise machine',
  'row machine', 'lat pulldown', 'pull-up bar', 'dip station', 'seated calf machine', 'standing calf machine', 'glute press', 'hip thrust bench',
  'hip abduction machine', 'hip adduction machine', 'back extension bench', 'ab crunch machine', 'preacher bench', 'biceps curl machine',
  'triceps machine', 'torso rotation machine', 'decline bench', 'captain’s chair', 'plates'] as const;
export type Equipment = (typeof EQUIPMENT)[number];
export interface Gym { id: string; name: string; equipment: Equipment[]; maxDumbbell?: number; exclude: string[]; include: string[] }
export const NEEDS: Record<string, Equipment[][]>   // every CATALOG name → alternatives, each an all-of list; [] = bodyweight, nothing needed
export function canDo(gym: Gym | null, exercise: string): boolean | null  // null = unknown gear (not in catalog), unless included/excluded
export function availableSet(gym: Gym | null, names: string[]): Set<string>
```

**Tests:**
- Every CATALOG name has a `NEEDS` entry (a coverage test, like the muscle one).
- Exclude beats the gear check, and include beats unknown gear.
- No gym means everything is available.
- A "dumbbells" gym can do DB lifts, and a cable lift needs `cable stack`.

### Task 2: Builder

- `buildProgram(profile, entries, opts, now, ctx?: { available?: Set<string>; known?: Set<string> })`.
- **`candidates(m, entries, today, ctx)`:**
  - known and available exercises that train `m` directly, ranked by the existing history score;
  - then available catalog lifts in `PREFERENCE[m]` order (replacing `DEFAULT_PICK`, with 3–5 per muscle).
- **Selection:** the builder uses the first candidate, and moves to the next when that exercise hits the weekly cap.
- **Cap:** before taking a pair for a tier-3/4 muscle, the builder checks `low + 2 ≤ lowShare × days × dayCap`. If the check fails, all tier-3/4 muscles are saturated.
- **Profile:** `lowShare` (default 0.2). `parseProfileJson` accepts it.
- **Tests:**
  - Seed synthetic tiers (several muscles in every tier) and check that dedicated tier-3/4 sets are at most 20 % across days 1–5 and perSession 8–20.
  - Tier-1 muscles reach their lower target before any tier-4 set is placed.
  - With `available` excluding the history's favourite, the builder picks the next candidate and never an excluded exercise.
  - An unknown catalog lift is chosen only when no known one is available, and it is returned in `program.newToYou`.

### Task 3: Swaps and Today

- `swapSuggestions(exercise, entries, today, limit, available?)` filters by `available`.
- The ExercisePicker shows unavailable exercises after a divider, labelled "Not at <gym>".
- **Test:** suggestions exclude unavailable exercises.

### Task 4: Storage and UI

- **Storage:** a `gyms` config entry `{ key: 'gyms', gyms: Gym[]; active?: string }` with get/put in db.ts and a `useGyms` hook.
- **Gyms screen:**
  - a list of gyms with "Add gym";
  - per gym: name, an equipment checklist grouped (free weights / cables / machines / benches & stations), and a "Dumbbells up to … lb" field;
  - "Exercises here": a searchable list of catalog plus history names, each with a can/can't/unknown badge and an Exclude or "I can do this here" toggle.
- **Program screen:**
  - the active gym chip and the low-priority share stepper (0–50 %, step 5);
  - "new to you" tags on slots;
  - the "Set up your gym" card when there are no gyms.
- **e2e `e2e/gyms.spec.ts`:**
  - Create a gym without a leg press, build, and assert no slot needs a leg press.
  - Exclude a lift and rebuild; it's gone.
  - Include a custom lift, and it can be chosen.
  - Screenshots `16-gyms.png` and `17-program-gym.png`.
