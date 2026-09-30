# Phase 5 — Variants, Joint & Back Care Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Suggest swaps that train the same muscles and steer away from what has been hurting; record *where* pain is and how bad; show per-region patterns by exercise and load; add a back-resilience block (hold-time core work) that slots into the program. Not medical advice: the app records and surfaces patterns; it never diagnoses.

**Architecture:** Domain `care.ts` (similarity, swap ranking, pain report, holds, back block) unit-tested. `SetEntry` gains optional `painRegion` / `painSeverity`; the standard CSV gains two optional trailing columns (old files still import). Flag `hold` marks a set whose `reps` are seconds. UI: pain chips in the set form, suggestions in every swap/“similar” list, a “Joint & back care” card on Stats, “Add back-resilience block” on the Program screen.

**Spec:** Phase 5 in `docs/superpowers/specs/2026-09-29-gym-tracker-design.md`.

## Phase Research (2026-09-30)

| Question | Finding | Consequence |
|---|---|---|
| How much pain is acceptable while training through it? | Pain-monitoring model (Silbernagel 2007 RCT, now standard in tendon rehab): up to 5/10 during and after is acceptable if it settles by the next morning and isn't rising week to week. ([Silbernagel 2007](https://www.researchgate.net/publication/6497499_Continued_Sports_Activity_Using_a_Pain-Monitoring_Model_During_Rehabilitation_in_Patients_With_Achilles_Tendinopathy_A_Randomized_Controlled_Study)) | Severity scale 1–3 maps to it: 1 = mild (≤3/10), 2 = moderate (4–5/10, still inside the model), 3 = sharp (>5/10, over it). The care card shows the rule and flags regions whose weekly pain is rising. |
| Does core/motor-control work help non-specific low back pain? | Core stabilisation / motor-control exercise reduces pain and improves function vs minimal intervention (moderate-quality evidence). ([IJSPT 2022 review, PubMed 35949382](https://pubmed.ncbi.nlm.nih.gov/35949382/), [Macedo 2009, PubMed 19056854](https://pubmed.ncbi.nlm.nih.gov/19056854/)) | Back-resilience block: bird dog, side plank, McGill curl-up (hold-time sets), plus dead bug and Pallof press; tracked like any exercise. |
| How to rank swaps | Same muscles, similar emphasis → cosine similarity of muscle vectors. | Rank by similarity; penalise exercises with recent pain flags and, when a region hurts, exercises that load it (elbow: skullcrushers, overhead extensions, close-grip pressing, dips; lower back: RDLs, squats, back extensions). |

## Open Questions — answered by default

1. Regions: elbow, lower back, shoulder, wrist, knee, other. Left/right goes in the note.
2. Pain chips appear only once "Pain" is toggled; region defaults to the exercise's likeliest region (elbow for arm work, lower back for hinges/squats, shoulder for pressing/raises), severity defaults to 1.
3. "Recent" = last 60 days for swap penalties; the care card covers 8 weeks.
4. Hold exercises (plank, side plank, bird dog, dead bug, McGill curl-up, plate pinch hold) log seconds: the Reps field reads "Seconds" and the set gets the `hold` flag; holds never produce e1RM.
5. The converter (private repo) infers regions from notes (elbow / back / shoulder / wrist / knee) and regenerates `history.csv`.

## Review Focus

1. **Old CSVs and old IndexedDB rows** without pain fields import and render unchanged. Pinned: Task 1 csv test.
2. **Swap list never suggests the exercise itself or one that hurt recently above a pain-free equal.** Pinned: Task 1 test.
3. **Holds never feed e1RM, PRs, targets or tonnage.** Pinned: Task 1 test.
4. **Rising-pain detection** needs two consecutive weeks rising, not noise from one set. Pinned: Task 1 test.

---

### Task 1: Domain

**Produces:** `types.ts` — `FLAGS += 'hold'`, `REGIONS`, `type Region`, `SetEntry.painRegion?`, `SetEntry.painSeverity?: 1|2|3`. `csv.ts` — header gains `pain_region,pain_severity` (optional on import, validated). `care.ts`:
```ts
similarity(a: string, b: string): number                     // cosine of muscle vectors, 0..1
likelyRegion(exercise: string): Region
HOLD_EXERCISES: Set<string>; isHold(name): boolean
recentPain(entries, today, days = 60): Map<string /*exercise lower*/, { sets: number; regions: Set<Region> }>
swapSuggestions(exercise, entries, today, limit = 5): { name: string; score: number; why: string }[]
painReport(entries, today, weeks = 8): { region: Region; weekly: number[]; total: number; rising: boolean; byExercise: { exercise: string; sets: number; maxSeverity: number; avgWeight: number }[] }[]
BACK_BLOCK: Slot[]                                            // bird dog, side plank, McGill curl-up × 2 sets, 20–40 s
```
Tests: csv round-trip with and without pain columns; bad region/severity rejected; similarity(Cable Curl, DB Curl) = 1, (Cable Curl, Leg Press) = 0; swaps for Cable Pushdown exclude itself, rank Rope Pushdown above Skullcrusher when the elbow hurt recently, and rank a painful exercise below a pain-free equal; holds: `e1rm` null, `isWorking` false for targets? (hold sets excluded from `nextTarget`'s working sets and from tonnage); painReport weekly counts, `rising` only after two consecutive increases; likelyRegion(Skullcrusher) = elbow, (Romanian Deadlift) = lower back.

### Task 2: UI

- SetForm: when Pain is on, region chips (6) and severity chips "Mild / Moderate / Sharp" (aria-pressed); for hold exercises, the Reps stepper is labelled "Seconds" (step 5) and `hold` is added.
- Swap picker (Today plan) and Exercise screen: "Suggested swaps" list (name, a reason like "same muscles · no recent pain"), above the full picker list.
- Stats: "Joint & back care" card — per region with any pain in 8 weeks: weekly counts as a tiny bar row, "rising" warning (icon + word), top exercises with counts and average load; the pain-monitoring rule in one line; "Not medical advice".
- Program: "Add back-resilience block" button appends `BACK_BLOCK` to every day that lacks it.
- e2e `e2e/care.spec.ts`: log a set with Pain → Elbow → Moderate, see "elbow" tag; Stats shows "Joint & back care" with "Elbow"; Program → add block → "Bird Dog" in Day A; Exercise screen for Cable Curl shows "Suggested swaps" without "Cable Curl" itself.

### Task 3: Private converter (gym-data only)

- `convert.py`: `region_for(note)` keyword inference; write `pain_region` (severity left blank: unknown); test; regenerate `history.csv`; commit to gym-data only.
