---
name: auditing-gym-tracker-ux
description: Use when the Gym Tracker's UX, flows, layout or usability need reviewing, critiquing or tearing apart, when the owner says it "works but feels bad", or before planning a UX fix round for this app.
---

# Auditing Gym Tracker UX

## Overview

An unguided audit reads the code, glances at a screenshot or two, and returns believable taste ("cluttered", "too many taps") ordered by gut feel. LLM heuristic evaluations are known to hallucinate issues (Guerino et al. 2025, arXiv 2506.16345). Human ones already run 9–46% false alarms (MeasuringU). This skill makes the audit **story-driven, measured, and adversarially verified**. Every finding is something a second agent reproduced from evidence.

Files in this directory:
- `stories.md`: walkthroughs at five horizons (session, day, week, month, year), each with budgets.
- `standards.md`: the checklist, with thresholds and sources. Section A (gym-logging heuristics) outranks generic heuristics.
- `harness.mjs`: headless WebKit at 375×812 with a synthetic fixture, counted `tap`/`type`, and `shot` and `measure()` (targets under 44/24, type scale, spacing scale, low contrast).

## Rules that hold for every agent

- Headless WebKit only. No visible windows, no audio. Seed only with `harness.mjs` (synthetic). Never read the private data repo or real exports.
- Write outputs only under `.superpowers/ux-audit/` (git-ignored). Never edit `src/` or `e2e/`; this skill finds and plans, it doesn't fix.
- **A screenshot you didn't look at is not evidence.** Read every PNG you cite.
- **Code reading generates hypotheses; only the running app confirms them.** A finding sourced from code alone is marked `hypothesis` and must be reproduced before it can rank.
- Fixes that rely on platform features must work in an iOS home-screen PWA. There's no Vibration API and no Live Activities; check `standards.md` E.

## Pipeline and model tiers

Run it as a Workflow when the user opted into multi-agent orchestration, otherwise as Agent calls in this order. Tiers follow "use cheaper models where adequate, but don't cheap out".

| Stage | Who | Model | Output |
|---|---|---|---|
| 1. Walk | one agent per story group: S1–S4, S5–S8, D+W, M+Y | Sonnet | Evidence file per story: `report.json` from the harness, PNGs, `measure()` dumps, notes of what was read before each action |
| 2. Critique | one agent per story group, reading that group's evidence plus `standards.md` (it may re-drive the harness) | strongest | Findings in the contract below |
| 3. Verify | one skeptic per finding, told to **refute**; it reproduces with the harness from the finding's steps alone | strongest | `{ reproduced, measured, refuted_because?, severity }` |
| 4. Synthesize | one agent over the verified set | strongest | The report below |

Walk states to cover: `history: 'none'` (first run), `'month'` with and without `program: true`, and `'year'` (for Y2 performance and long lists). Story groups run in parallel; findings verify as soon as their critique lands (pipeline, no barrier).

## Finding contract (every field required, or the finding is dropped)

```
id:            S2-03
story:         S2                       # a story ID from stories.md; no story → "untasked", severity capped at 1
standard:      G1                       # one standards.md ID
observed:      "Repeating the target set took 1 tap; changing reps by 1 took 2 (reps +, Add set)"
evidence:      [.superpowers/ux-audit/S2/after-save.png, report.json step 4]   # files you opened
measured:      { taps: 2, budget: 1, scrolls: 0 }   # numbers, not adjectives
frequency:     per-set | per-session | per-day | per-week | rare
impact:        1-3                      # how hard to overcome
persistence:   1-3                      # does it keep costing once learned
severity:      0-4                      # Nielsen; mean of verifier ratings in stage 3
fix:           "Concrete change, naming the component (e.g. SetForm.tsx Stepper step)"
fix_effect:    { taps: 2 → 1 }          # expected metric change
confidence:    reproduced | hypothesis
```

Words like "cluttered", "cognitive load" or "confusing" are only allowed next to a number: an M-operator count, text blocks read before acting, controls of equal weight, or pixels scrolled.

## Ranking

`priority = severity × frequency weight (per-set 4, per-session 3, per-day 2, per-week 1.5, rare 1)`, then the effort quadrant (quick win / strategic / nice-to-have / avoid). Effort is estimated by reading the source. The per-set loop (S2) dominates by construction; that is intended.

## Report (stage 4 output, in this order)

1. Top 10 by priority: one line each, with the before/after metric.
2. Story scorecard: every story, pass/fail against its budget, measured numbers.
3. Fix plan grouped into batches (quick wins in the logging loop first), each with the questions the owner must answer before building. Ask only what the code can't answer.
4. Refuted findings, one line each with the reason. The owner sees what was dropped.
5. Not covered: stories or states not walked, and why.

## Common mistakes

| Mistake | Correction |
|---|---|
| Auditing one card on an empty day | Walk a full session (≥3 lifts × 3 sets) on a built program, plus first-run and year-of-data states |
| Claiming tap counts from code | Count with `h.tap`; quote `report.json` |
| Ranking by how bad it looks | Rank by priority formula; frequency multiplies |
| Listing an unverified guess "for completeness" | It goes in "Not covered" or as a hypothesis in stage 3, never in the top 10 |
| Suggesting haptics or OS rest notifications | Not available to an iOS PWA; propose a visible state instead |
| Stopping at the planned set count | Also log past the plan (5+ sets on one lift) and move through every planned lift; layout drift shows up there |
| Treating an auto-accepted dialog as "not observed" | The harness records every `confirm()`: `counts.dialogs` and `act: 'dialog'` steps are evidence |
| Claiming keyboard behaviour from headless | Headless shows no iOS keyboard; mark keyboard claims `hypothesis` and cite the code (`autoFocus`, `inputmode`) |
| Generic Nielsen pass first | Section A of `standards.md` first, then Nielsen |
