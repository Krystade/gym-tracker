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

**Target device: iPhone 13 mini (iOS Safari, 375×812 CSS px, notch and home
indicator).** Every screen is designed and checked at that size first:
`viewport-fit=cover`, `env(safe-area-inset-*)` padding, tap targets ≥ 44 px,
inputs ≥ 16 px font (so iOS does not zoom on focus), no horizontal scroll,
`100dvh` rather than `100vh`. Installed via Safari → Share → Add to Home
Screen. Note: the installed app's storage is separate from Safari's — history
must be imported from inside the installed app.

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
   - Data screen: import standard CSV, export CSV (via the iOS share sheet,
     `navigator.share({ files })`, falling back to a download link), persisted-storage status,
     build stamp, set counts.
   - Installable, works offline.
2. **Progressive overload.** RIR logging UI polish, estimated RIR, per-exercise
   rep ranges and increments, "next target" on each card, PR celebration.
3. **Analytics.** Muscle-contribution matrix; weekly effective sets per muscle
   against priority-tier targets; tonnage and e1RM trends; calendar heat map,
   streaks, sessions per week.
   - **Estimated rep maxes:** e1RM and e6RM (any eNRM) per exercise, with trend.
   - **Calibration tests:** a "test day" mode logs an actual AMRAP or rep-max
     set on a schedule (e.g. every 4–6 weeks per key lift). Each test is
     compared to the prediction at that date; the per-exercise error fits a
     personal correction to the estimator (Epley vs Brzycki blend, plus a
     bias), so the estimates get more accurate over time. The app shows the
     prediction accuracy history.
4. **Program.** Priority tiers → a weekly plan sized to ~12–16 sets/session;
   "today's workout" with skip/swap; adherence tracking.
5. **Variants, joint & back care.** Swap suggestions ranked by muscle-vector
   similarity; pain flags carry a body region (e.g. elbow, lower back) and a
   0–3 severity; per-region analytics by exercise and load; suggestions steer
   away from exercises that repeatedly draw pain flags. A back-resilience block
   (core-stability and hinge-pattern work, tracked like any exercise, with
   hold-time sets) can be slotted into the program. Not medical advice — the
   app records and surfaces patterns; it doesn't diagnose.
6. **Body weight & MyFitnessPal.** Manual weigh-ins and a trend line; MFP data
   via its CSV export or an unofficial local script, both ending in a file
   import. A spike decides the route before build.
7. **Progress photos.** Captured via `<input capture>`, stored only in
   IndexedDB, never uploaded; timeline and side-by-side compare aligned to body
   weight.
8. **Private sync.** Optional push/pull of the standard CSV to `gym-data` via a
   fine-grained token the user pastes in; replaces manual export as the backup.

9. **Paste from notes.** Paste a free-text workout log straight from the
   Notes app (date lines, then `Exercise: 85x11 70x12 note…` lines). Every
   line is shown parsed before anything is saved; a line that doesn't parse,
   or parses wrongly, is fixed by editing its text in place, and an
   unrecognised exercise name is mapped once to a known one (remembered on the
   device). Days already in the log are flagged and left out by default.
10. **Gym inventory & a better builder.** Each gym lists the equipment it has
    (plus per-exercise exclusions and additions, e.g. lifts you know that need
    nothing listed); the builder and swap suggestions only use what the active
    gym can do. Priority 3–4 muscles together get a capped share of weekly
    sets (default 20 %), so the plan is spent on what you prioritised.
11. **Profiles.** Several people on one phone (e.g. a training partner) with a
    one-tap switch. Each profile has its own log, priorities, program, body
    weight and photos; gyms are shared. Private backup goes to the same repo,
    each extra profile under its own folder.
12. **Exercise suggestions & data for later modelling.** Opening any exercise
    (Lifts, its search, or its name on Today) shows what to do next — sets ×
    reps @ weight with a one-line reason, plus a warm-up ramp for heavier
    lifts — above its full history, with "Log it today". Sets come from
    today's program slot, else the working sets done last session, else 3.
    Every logged set also records, automatically, what was suggested
    (weight, reps, sets), the active gym and its time; one tap a day records
    energy 1–5. All of it is in the backup CSVs, so a future model can learn
    from suggested vs. done. No new manual fields beyond energy.
13. **Workout time & late entries.** A workout's length is measured from its
    first set to its last (no start/stop). Program days and today's plan show
    an estimate learned from your own set-to-set and between-lift times
    (research defaults until there's history), today's plan shows when you'll
    finish, and the builder can build to minutes per session. A forgotten set
    can be added later — to today or any earlier day, via a day switcher on
    Today or "Add to this day" in History — with an optional "when", which the
    app pre-fills from the unusually long gap between that day's sets. Sets
    added later record when they were entered, apart from when they were done.

**Wishlist (not scheduled):** a friends list showing other people's activity.
It needs a shared server or a shared repo, which conflicts with the
on-device privacy model — designed only after profiles exist, and opt-in per
person.
Also: **linked phones** — a profile kept in step across two phones (e.g. your
partner's profile on your phone and hers), so a change on one shows on the
other. Builds on the private backup's per-profile folders; needs a way for
both phones to reach the same data without sharing one person's token.


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
- Playwright (headless, iPhone 13 mini device profile: 375×812, WebKit, touch): add exercise → log sets → reload →
  sets persist; import sample CSV → history and chart render.
- Visual check: headless WebKit screenshots at 375×812 with simulated safe-area
  insets, plus a check that `scrollWidth <= clientWidth` on every screen; read as PNG before calling a
  screen done.
- After deploy: `gh run list`, and confirm the served bundle has the new build
  stamp.
