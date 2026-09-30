# Gym Tracker — Design

Date: 2026-09-29 · Status: draft for review

A personal lifting log that installs to a phone as a PWA, logs sets faster
than a notes app, and turns the history into progressive-overload guidance and
analytics. Built in phases; Phase 1 must be usable the night it is written.

> This file lives in a **public** repo. It describes the app, never the
> user's data. Training history, priorities, injury notes, body weight and
> photos belong in the private `Krystade/gym-data` repo or on the device.

## Goals

1. Store every set (weight, reps, optional RIR, notes, flags) with no chance of
   losing a set mid-workout.
2. Track and suggest progressive overload per exercise.
3. Rich analytics and graphs — logging and seeing data is itself the
   motivation.
4. Keep all personal data private even though the code and site are public.

Non-goals: accounts, a backend server, social features, nutrition logging
(MyFitnessPal remains the food log).

## Privacy model

| Thing | Where it lives | Public? |
|---|---|---|
| App source, tests, synthetic fixtures (`*.sample.csv`) | `Krystade/gym-tracker` | yes |
| Built site | `krystade.github.io/gym-tracker/` | yes — an empty shell; shows only data on the viewing device |
| Live training data, body weight, photos | Phone IndexedDB (`navigator.storage.persist()` requested) | no |
| Standardized history CSVs, original spreadsheets, converter script, priority config | `Krystade/gym-data` (private) | no |

Guards:
- `.gitignore` excludes `data/`, `private/`, `*.csv` (except `*.sample.csv`),
  spreadsheets, images other than PNG/SVG icons, video, databases, and backup
  JSON.
- A test (`src/privacy.test.ts`) runs `git ls-files` and fails if any tracked
  file matches a personal-data pattern. It runs in CI, so a leak blocks the
  deploy.
- The app never makes network requests carrying user data. (Phase 8 sync to
  the private repo is the one deliberate exception, with a token the user
  pastes in.)

## Stack and hosting

Same shape as `lotus-tracker`: Vite + React + TypeScript, `vite-plugin-pwa`
(offline, installable, `autoUpdate`), Vitest, Playwright (headless). GitHub
Pages via `.github/workflows/deploy.yml` on push to `main`; CI runs `npm test`
then `npm run build`. `base: './'` (path-relative, like blackjack-trainer). A
build stamp is shown in-app. Storage via `idb` (thin IndexedDB wrapper).

## Data model

```ts
type Flag = 'bodyweight' | 'partial' | 'unsure' | 'pain' | 'double_pulley' | 'warmup';

interface SetEntry {
  id: string;          // uuid; for imports, a stable hash of source+row+set
  date: string;        // YYYY-MM-DD (local)
  loggedAt?: string;   // ISO timestamp for live-logged sets
  exercise: string;    // canonical exercise name
  asWritten?: string;  // original wording from the source
  setNo: number;       // 1-based within the exercise for that date
  weight: number;      // lb; 0 for bodyweight
  reps: number | null; // null when the source recorded a partial like "100x"
  rir?: number;        // logged reps in reserve
  flags: Flag[];
  note?: string;
  source: 'app' | string; // 'app' or an import label, e.g. 'xlsx-2025'
}

interface Exercise {
  name: string;          // canonical, unique
  aliases: string[];
  muscles?: Record<Muscle, number>; // 0..1 contribution; Phase 3
}
```

A session is the set of entries sharing a `date`.

### Standard CSV (import/export and the storage format in gym-data)

```
date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source
2026-01-02,Cable Pushdown,Pushdowns,1,110,12,,,,notes-2026
```

`flags` is `;`-separated. RFC 4180 quoting. Import is idempotent: rows dedupe on
`id`, so re-importing the same file adds nothing.

History conversion (spreadsheet + free-text notes → standard CSV) is a script
in the private repo, not this one, so the alias table and raw notes never touch
the public repo.

## Estimates

- **e1RM (Epley):** `w × (1 + reps/30)`; skipped for bodyweight, partial, or
  reps > 20.
- **Estimated RIR (Phase 2)** when not logged: from best recent e1RM,
  `predictedMaxReps(weight) − reps`, clamped 0–5, corrected by rep drop-off
  across same-weight sets (a drop of 3+ reps implies the earlier set was near
  failure). Shown as "~2" to distinguish it from a logged value.
- **Progression target (Phase 2):** double progression. Rep range per exercise
  (default 8–12). Once all working sets hit the top of the range at RIR ≤ 2,
  suggest the next weight increment (cable 5 lb, DB 5 lb, machine 5–10 lb);
  otherwise suggest the same weight, beating last time's reps.

## Phases

1. **Log & history (tonight).**
   - Today screen: add exercise (search + recents), per-exercise card showing
     last session's sets and best e1RM, weight/reps steppers pre-filled from
     the last set, optional RIR, note, flag toggles. Each "Add set" writes to
     IndexedDB immediately; delete and edit a set.
   - History screen: sessions by date, expandable.
   - Exercise screen: every set grouped by date, top-set e1RM line chart
     (hand-rolled SVG), best set, PR markers.
   - Data screen: import standard CSV, export CSV, persisted-storage status,
     build stamp, set counts.
   - Installable, works offline.
2. **Progressive overload.** RIR logging UI polish, estimated RIR, per-exercise
   rep ranges and increments, "next target" on each card, PR celebration.
3. **Analytics.** Muscle-contribution matrix; weekly effective sets per muscle
   against priority-tier targets; tonnage and e1RM trends; calendar heat map,
   streaks, sessions per week.
4. **Program.** Priority tiers → a weekly plan sized to ~12–16 sets/session;
   "today's workout" with skip/swap; adherence tracking.
5. **Variants & joint care.** Swap suggestions ranked by muscle-vector
   similarity; pain-flag analytics per exercise and load; suggestions steer away
   from exercises that repeatedly draw pain flags.
6. **Body weight & MyFitnessPal.** Manual weigh-ins and a trend line; MFP data
   via its CSV export or an unofficial local script, both ending in a file
   import. A spike decides the route before build.
7. **Progress photos.** Captured via `<input capture>`, stored only in
   IndexedDB, never uploaded; timeline and side-by-side compare aligned to body
   weight.
8. **Private sync.** Optional push/pull of the standard CSV to `gym-data` via a
   fine-grained token the user pastes in; replaces manual export as the backup.

Each phase gets its own plan; this spec is refined at the start of each.

## Error handling

- Storage write failures surface as a visible banner; the entry stays in the
  form so nothing is silently lost.
- A malformed import row is reported (line number and reason) and skipped; the
  rest imports.
- If persisted storage is denied, the Data screen warns and nudges an export.

## Testing

- Vitest: CSV parse/serialize round-trip (quoting, flags, nulls), import
  dedupe, e1RM, last-session and best-set selectors, the privacy guard.
- Playwright (headless, phone viewport): add exercise → log sets → reload →
  sets persist; import sample CSV → history and chart render.
- Visual check: headless screenshots at 390×844, read as PNG before calling a
  screen done.
- After deploy: `gh run list`, and confirm the served bundle has the new build
  stamp.
