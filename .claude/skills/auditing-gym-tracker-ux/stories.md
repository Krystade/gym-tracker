# User stories: how the app is actually used

One owner, training alone or with one or two partners on the same phone. iPhone 13 mini (375×812), one hand, often sweaty, in a loud gym with patchy signal. Every story is a walkthrough: do the steps in the app, at 375×812, against the synthetic fixture, and measure.

For each step record: taps, keystrokes, scrolls, screens visited, whether the next action was visible without scrolling, and anything you had to *read* to know what to do next. A step that needs reading the manual (or this file) to find is a finding.

Budgets are targets, not facts about the current app. Exceeding one is a finding; its severity depends on how often the story runs (frequency multiplies everything).

---

## 1. One session (runs 3–5× a week; every second counts)

**S1. Walk in and start.** Open the app at the gym. See today's planned day, which lift is first, and what weight/reps to do on it.
- Budget: 0 taps to see the first lift's target; ≤1 tap to start logging it.
- Watch for: plan hidden behind a screen, target shown only after opening a lift, stale day (yesterday's plan).

**S2. Log a set between sets.** Rest is 1–3 minutes. Enter weight and reps for set N, matching or adjusting the suggestion.
- Budget: repeating the suggested set = 1 tap. Changing one number = ≤3 interactions. Never more than one keyboard open.
- Watch for: fields not prefilled from the target/last set, keyboard covering the save button, tap targets < 44 pt, focus lost after save, the logged set not visibly confirmed.

**S3. Fix a typo'd set.** Logged 801 instead of 80, or the wrong lift. Correct or delete it.
- Budget: ≤3 taps to edit, undo available after delete.
- Watch for: no undo, destructive action without confirmation or recovery, edit mode hard to find.

**S4. Machine is taken.** The planned lift's equipment is busy. Swap to an equivalent, or skip it and come back.
- Budget: ≤2 taps to see swap options; the swap keeps the session's muscle targets.
- Watch for: swaps that ignore the active gym's gear, skip with no way back, plan order lost.

**S5. Partner turn.** A partner does a set on the same phone; switch to them, log, switch back.
- Budget: ≤1 tap to switch person; it must be impossible to miss whose set is being logged.
- Watch for: active person not obvious at the logging field, switch resets scroll/plan, logging to the wrong person.

**S6. Short on time.** Only 20 minutes today. Get a time-boxed session without picking lifts.
- Budget: ≤3 taps from Today to a ready plan; minutes estimate visible.
- Watch for: the feature being undiscoverable, no indication of what the plan is based on.

**S7. Finish.** Done training. Know the session is saved and how it went (PRs, volume vs last time).
- Budget: no explicit "save" required; a summary visible without hunting.
- Watch for: no closure, wins buried in Stats, uncertainty whether data persisted.

**S8. Pain or a bad day.** Something hurts or energy is low. Record it and have today adjust.
- Budget: energy 1–5 = 1 tap. Pain note ≤4 taps.
- Watch for: forms with optional fields that look required, no visible effect on the plan.

## 2. A day (things that happen outside the workout)

**D1. Morning weigh-in.** Enter body weight before training, fast.
- Budget: ≤3 interactions from app open.

**D2. Forgot to log in the gym.** At home, add yesterday's or today's sets after the fact, from memory or from a notes app.
- Budget: reach a past day ≤3 taps; pasting a notes block parses without manual cleanup for common formats.
- Watch for: past-day logging confused with today, parse errors without a reason, duplicate imports.

**D3. Check something mid-day.** "What did I bench last time?" Find a single lift's last session and best.
- Budget: ≤3 taps from anywhere.

## 3. A week (planning and review)

**W1. Plan the week.** Set days per week and session length; get a program built around the active gym.
- Budget: first-time setup ≤2 minutes with defaults; rebuilding keeps history.
- Watch for: jargon (RIR, tonnage, double pulley) without explanation, settings scattered across screens, rebuild that silently changes things.

**W2. Am I on track?** See sessions done vs goal and which muscle groups are behind this week.
- Budget: answerable on one screen without scrolling past unrelated content.

**W3. Training at a different gym.** Switch active gym; the plan and swaps respect that gym's equipment.
- Budget: ≤2 taps to switch; obvious which gym is active when logging.

## 4. A month (progress and motivation)

**M1. Is it working?** See strength trend for the main lifts and body-weight trend.
- Budget: charts readable at 375 px; trend direction obvious in under 5 s; a table alternative exists.
- Watch for: dual axes, unlabeled units, charts with one point, too many series.

**M2. Adjust priorities.** Shift emphasis (e.g. more back, less arms) and see the program respond.
- Budget: change is reversible and its effect is shown before or right after applying.

**M3. Progress photos.** Take/compare monthly photos by pose.
- Budget: compare two dates of the same pose ≤3 taps. Privacy of photos is explicit.

**M4. Back up.** Make sure data is safe (private sync / export).
- Budget: last-backup time visible; restore path discoverable; status of sync honest (no silent failures).

## 5. A year (history and trust)

**Y1. Year in review.** Total sessions, PRs, body-weight change, most-trained lifts.
- Budget: reachable without exporting to a spreadsheet.

**Y2. Long history performance.** With a year+ of data (≈200 sessions, ≈8000 sets) every screen still renders fast and lists stay navigable.
- Budget: screen switch < 300 ms on device class; History searchable or grouped.

**Y3. New phone / reinstall.** Move everything to a new device.
- Budget: one documented path, ≤5 steps, no data loss, verifiable afterwards.

**Y4. Retire or rename a lift.** An exercise name changes or a lift is dropped; history stays coherent.
- Budget: merge/rename without losing the lift's history or charts.

---

## Running the stories

- Seed state with the synthetic fixture (see SKILL.md). Never real data.
- Run S1–S8 first: they run most often, so their friction outranks everything else.
- A story you cannot complete at all is severity 4 regardless of frequency.
- If the app lacks the feature a story needs, that is a finding ("not supported"), scored by how often the story would run — not a reason to skip it.
