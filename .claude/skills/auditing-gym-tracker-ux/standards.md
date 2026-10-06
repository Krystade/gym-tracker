# Standards checklist

Each item: the rule, how to measure it in headless WebKit at 375×812, and the source. Sources were spot-checked on 2026-10-06. Measure; do not eyeball.

## A. Gym-logging heuristics (domain; score these first, per S-story)

| # | Rule | Measure | Source |
|---|---|---|---|
| G1 | A set that matches the target or last time commits in **1 tap**; ≤3 when one value changes | Tap count from landing on the card to a stored set, values untouched | Strong ≈3 taps/≈10 s per set (repreturn.com/strong-app-review); Liftosaur "big checkmark" (liftosaur.com/features/workout-screen) |
| G2 | Empty fields commit as the shown target/last values, not 0 or an error | Leave inputs untouched, commit, read the stored set | Hevy (hevyapp.com/features/track-exercises) |
| G3 | Effort (RIR) and flags are optional and never block or look required | Commit without touching RIR; next-time suggestion still computed | Alpha: "RIR is optional" (alphaprogression.com/en/blog/alpha-progression-guide) |
| G4 | Last session's sets and the next target are visible on the logging card, no navigation | Read the card's text without tapping | NN/g recognition over recall (nngroup.com/articles/ten-usability-heuristics) |
| G5 | Plan-vs-done is readable at a glance: which lift is current, X/Y sets | 3 s look at a mid-session screenshot | Liftosaur thumbnail strip with 2/5 counts |
| G6 | Deviations (skip, swap, extra set, unplanned lift) cost ≤2 taps from the card; swap list is ranked by muscle/pattern and respects the gym's gear | Tap counts; first 3 swap suggestions share the target muscle | Alpha/Fitbod reviews; gymnoteplus.com/blog/hevy-vs-strong (opinion) |
| G7 | No modal or required prompt between the user and the next set | List every unrequested prompt during a full session; target 0 | RP / JEFIT App Store reviews |
| G8 | Saves are immediate, visible, and survive fast repeat taps, reloads and in-flight state updates | Tick sets <1 s apart, reload, count stored rows | JEFIT / RP reviews; this codebase's known mid-input setState pitfall |
| G9 | The view does not jump away after a tick | Scroll position and focused card before vs after the last planned set | Alpha review complaint |
| G10 | A rest timer, if present, is computed from a stored end time so backgrounding doesn't freeze it | Background the page (`visibilitychange`), advance the clock, return | Hevy/Alpha reviews. A PWA can't use Live Activities |

## B. Task cost (KLM / interaction cost)

- Count per task: taps (P+K), keystrokes, scrolls, **M** (decision points: one before each command choice, none when the next action is fully anticipated), and R (wait from tap to visual settle).
- KLM operators: K≈0.28 s, P≈1.1 s, H≈0.4 s, M≈1.35 s (Card, Moran & Newell; en.wikipedia.org/wiki/Keystroke-level_model). Use the totals comparatively, before vs after a fix, not as absolute predictions for touch.
- Interaction cost also includes reading and scrolling: record pixels scrolled and text blocks read before acting (nngroup.com/articles/interaction-cost-definition). Any per-set action that needs a scroll is a finding.
- Compare designs across tasks with the geometric mean of per-task time ratios (nngroup.com/articles/usability-metrics).

## C. Cognitive walkthrough: four questions per action (ixdf.org cognitive walkthrough)

1. Will the user try to do this? 2. Will they notice the control (it's in the viewport, labelled, not behind a fold)? 3. Will they connect the control's label to their goal? 4. After acting, do they see progress within 100 ms (DOM or screenshot diff)? Any "no" is a finding at that step.

## D. Nielsen's 10 heuristics (second pass, after A–C)

Status visibility · real-world match · user control and undo · consistency · error prevention · recognition over recall · flexibility and efficiency · minimalist design · error recovery · help (nngroup.com/articles/ten-usability-heuristics). One heuristic per finding. Heuristics are generic and unvalidated for this domain, so A comes first (uxpamagazine.org/nielsens-heuristic-evaluation).

- **Undo over confirm:** reversible actions (log, delete set, skip, swap) get an Undo that stays ≥5 s; confirm dialogs only for real data loss (an import overwrite), with verb labels, never OK/Cancel (nngroup.com/articles/confirmation-dialog).
- **Feedback timing:** <0.1 s feels instant, <1 s keeps flow, >10 s needs progress. Sync shows persistent last-synced/failed status (nngroup.com/articles/response-times-3-important-limits).
- **Progressive disclosure:** everything used per set is at level 1; at most 2 levels; a fold's label names its contents ("Flags & note", not "More") (nngroup.com/articles/progressive-disclosure).
- **Smart defaults:** prefill with the most likely value; defaults carry from set to set (nngroup.com/articles/the-power-of-defaults).

## E. Platform and accessibility floors (hard numbers)

| Rule | Threshold | Measure | Source |
|---|---|---|---|
| Target size | ≥24×24 CSS px or 24 px circle spacing (AA); **per-set controls ≥44×44** | `getBoundingClientRect` on every interactive node | WCAG 2.5.8; Apple 44 pt |
| Target spacing | ≥8 px between targets with different effects | Gaps between adjacent rects | Android 8 dp; Fitts |
| Text contrast | ≥4.5:1, ≥3:1 for ≥24 px or ≥18.5 px bold; no rounding up | Computed colour vs effective background | WCAG 1.4.3 |
| UI and state contrast | ≥3:1 for borders, selected chips, focus, chart marks | Computed colours / sampled pixels | WCAG 1.4.11 |
| Colour not alone | State readable in greyscale | Greyscale the screenshot | WCAG 1.4.1 |
| Focus not obscured | Focused input not hidden by the tab bar or keyboard; safe-area insets padded | Focus each input, check its rect vs the fixed bar | WCAG 2.4.11 |
| Numeric keyboard | `inputmode="decimal"` for weights, `"numeric"` for reps | Read attributes | MDN inputmode |
| Reduced motion | Non-essential animation off under `prefers-reduced-motion` | `emulateMedia({ reducedMotion: 'reduce' })` | WCAG 2.3.3 (AAA, best practice) |

### iOS / PWA specifics (iPhone 13 mini: 1 CSS px = 1 pt, ≈62 pt per cm)

- **Thumb targets:** 44 pt is ≈7 mm, Apple's floor. NN/g's 1 cm thumb minimum is ≈62 pt, and edge or corner targets need about 12 mm (≈75 pt) (nngroup.com/articles/touch-target-size; Hoober, uxmatters 2017). Apple pads bezeled controls by ≈12 pt.
- **One or two prominent (filled, accent) buttons per view.** Style marks the default, not size. Custom buttons need a press state (developer.apple.com HIG Buttons).
- **Tab bar:** navigation only, always shows the current section (including on sub-screens), single-word labels, ideally with icons (HIG Tab bars).
- **Alerts:** never for common or undoable actions, even destructive ones. Use verb titles ("Delete set"), and Cancel always cancels (HIG Alerts). The app has 6 `confirm()` calls (ExerciseCard delete set, gym delete, photo replace/delete, program rebuild, sync forget). Grade each as undoable or not.
- **Steppers:** for small changes around a clear default; pair with direct entry; make the step and unit explicit; ≈1 cm per +/- button (nngroup.com/articles/input-steppers).
- **Input font ≥16 px** or iOS Safari zooms on focus (the app's inputs use 16 px; keep it that way).
- **Type:** body 17 pt, floor 11 pt (HIG Typography). The app has 9 px and 11 px rules and about 12 distinct sizes, so check where they land (charts and legends). Fixed px ignores Dynamic Type; scaling to 200% is the WCAG 1.4.4 bar. Report it, but weight it below the per-set loop.
- **No haptics:** the Vibration API is unsupported on iOS Safari (caniuse.com/vibration), so every commit needs a visible confirmation.
- **Safe areas:** `viewport-fit=cover` + `max(12px, env(safe-area-inset-*))`; fixed bottom bars clear the home indicator (webkit.org/blog/7929).
- **Segmented controls:** ≤5 segments, equal width (HIG). Check RIR chips and the Plan/Quick chips.

## F. Layout and visual hierarchy

- **Glance budget 2–3 s:** the current lift, its target and set n/N are legible without scrolling or reading a sentence (nngroup.com/articles/smartwatch-interactions).
- **Key numbers are the largest type on the card**, in a regular-width face. Lowercase took 26% longer than uppercase and condensed 11.2% longer than regular for isolated words at a glance; keep uppercase to one- or two-word labels (nngroup.com/articles/glanceable-fonts, MIT AgeLab).
- **Hick:** ≤3–4 equal-weight controls around the log moment; one primary action per card (lawsofux.com/hicks-law).
- **Squint test:** blur the screenshot about 8 px; the first blobs should be the current values and the commit control (nngroup.com/articles/visual-hierarchy-ux-definition).
- **Type scale:** ≤3–4 distinct font sizes per screen; 2–3 text contrast levels.
- **Spacing:** values on a 4/8 px grid; about 6–8 distinct values is healthy, over 12 is a flag; gaps within a group visibly smaller than between groups, 1:2 or more (spec.fm/specifics/8-pt-grid; nngroup.com/articles/gestalt-proximity).
- **Density:** count exercise cards above the fold mid-session; charts and settings don't sit inline on Today (Fitbod "huge gaps" reviews).
- **Reach:** per-set controls in the bottom ~60% band; none in the top 25%; nothing destructive next to the commit control. Grip varies (49% one-handed, 36% cradled, 15% two-handed; n=1,333) and a third of one-handers use the left thumb, so don't hug the right edge (Hoober, uxmatters.com 2013).
- **Charts:** plain bars or lines with a labelled target and direct labels; stylised displays cost about 4.5 error points (pmc.ncbi.nlm.nih.gov/articles/PMC13448195); one axis; a table alternative.

## G. Onboarding and empty states

A fresh profile reaches its first logged set in ≤3 inputs. Every empty tab shows one clear next action, not blank axes (screensdesign.com Strong showcase; Hevy "routine or empty workout").

## H. Finishing and reward

Finishing a session shows PRs and the new next targets without drilling into Lifts (liftosaur.com/features/workout-screen; Alpha reviews).
