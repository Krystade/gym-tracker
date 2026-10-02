# Audit fixes: plan (2 Oct 2026)

Source: a swarm audit of HEAD 70073f1 by 8 parallel read-only auditors, all on synthetic data. It found 3 Critical, 24 Important and about 40 Polish items. The triage (not committed) is in `.superpowers/audit-2026-10-02.md` in the main checkout.

## Decisions from Jack (2 Oct)
- **Set form:** the order is Weight/Reps, RIR chips, then **Add set**. Flags, pain, "Did this earlier?" and Note fold behind a **More** chip, which opens automatically when one of them is in use. On past days the time field stays visible.
- **Midnight:** keep logging to the workout's day until its last set is more than 3 hours old. The "Logging to" banner shows while that is happening.
- **Re-import:** ask before an import changes sets (or body days) already in the log. Brand-new rows import without asking.
- **Scope:** everything, including polish.

## How it runs
- The work happens in the worktree `../gym-tracker-audit` on branch `audit-fixes`, because another session is fixing a test flake in the main checkout. When that session is done, the branch merges into `main`.
- **Each pair:**
  1. A Sonnet implementer works from a brief. It does TDD, a mutation check and the full suites.
  2. A fresh Sonnet auditor reviews it.
  3. The orchestrator fixes what the auditor finds, runs the suites and commits with explicit paths.
- Tests run on the audit Playwright config, port 4400, against the worktree's own `dist/`.

## Pairs (in order)
| # | Items | Area |
|---|---|---|
| P1 | C1 two open copies overwrite sets; C3 duplicate CSV rows collapse | sets store, db, csv |
| P2 | C2 re-import asks first (sets and body); I19 import result styling and wording | DataScreen, db |
| P3 | I1 midnight keeps the workout's day; I14 the past-day choice clears on profile switch | App shell |
| P4 | I6 set form order and More; I12 "Later than now" shown as an error, and only blocks a changed time; double-tap guard; When label | SetForm |
| P5 | I5 edit form scrolls into view and marks its row; I10 weight field clipping; Last line and e1RM unit; delete "set 0" guard | ExerciseCard, steppers |
| P6 | I7 plan card placement and scroll to the new card; I8 plan row alignment; I11 past-day banner, and an empty past day hides its plan | TodayScreen, TodayPlan |
| P7 | I9 swap picker title and reasons; picker placeholder and bold "Add" row | ExercisePicker, SwapSuggestions |
| P8 | I2 holds (suggestion range, Exercise screen tiles, hold detection); I13 time-budget note shows after a build and says what to do | suggest, progression, ExerciseScreen, ProgramScreen |
| P9 | I15 History (summary layout, warm-ups and pain, open marker, short dates) | HistoryScreen, format |
| P10 | I16 Exercise screen (chart placement, gridlines, units, readout; tiles; test banner) | ExerciseScreen, LineChart |
| P11 | I17 Stats (muscle volume, calendar, body chart taps, redundant tiles, chart axes) | StatsScreen, charts |
| P12 | I18 profile bar chips; I20 Program editor (layout, remove/undo, rebuild wording) | ProfileBar, ProgramScreen |
| P13 | I3 sync 422 retry and single-transaction delete; I4 `.gitignore` gaps | sync, db, gitignore |
| P14 | I21–I24 design system (contrast, tap feedback, focus, landscape insets, spacing, disabled primary) | styles.css |
| P15 | Polish: type, radius and colour tokens; Stats tiles; Photos, Data, Gyms and Paste screen polish | styles, screens |
| P16 | Polish: domain edges (UTC today in buildProgram, pain names, empty program, rep-range validation, enteredAt for never-timed sets); People card hints | domain, PeopleCard |
