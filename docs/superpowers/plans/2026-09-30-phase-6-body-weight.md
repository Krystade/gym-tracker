# Phase 6 — Body Weight & MyFitnessPal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Log morning weigh-ins in two taps, see a smoothed trend and the weekly rate of change, and bring in MyFitnessPal's weight history and daily calories/protein from its CSV export — all on-device.

**Architecture:** Domain `body.ts` (types, CSV detection and parsing for MFP and a standard `body.csv`, trend, rate) unit-tested. IndexedDB v5 adds a `body` store keyed by date. `useBody` hook. UI: a weigh-in row on Today, a "Body weight" card on Stats, MFP/body CSV import and body CSV export on Data.

**Spec:** Phase 6 in `docs/superpowers/specs/2026-09-29-gym-tracker-design.md` ("MFP data via its CSV export or an unofficial local script, both ending in a file import. A spike decides the route before build.").

## Spike: which MFP route (2026-09-30)

| Route | Finding | Verdict |
|---|---|---|
| Official API | Closed to new developers since ~2019; portal says requests are not being accepted. ([myfitnesspalapi.com FAQ](https://myfitnesspalapi.com/faq/)) | No. |
| Unofficial scraper (`python-myfitnesspal`) | Logs in with the user's session cookies and scrapes; breaks when the site changes; would need Jack's credentials on a machine. ([GitHub](https://github.com/coddingtonbear/python-myfitnesspal)) | No: credentials handling and fragility for a daily-use feature. |
| CSV export | Web: Settings → Privacy & Data → Export. Emails a zip of CSVs: Measurement-Summary (Date, Weight, …), Nutrition-Summary (one row per meal: Date, Meal, Calories, …, Protein (g), …), Exercise-Summary. ([Digital Takeout Day](https://takeoutday.org/services/myfitnesspal), [Ladvien](https://ladvien.com/get-myfitness-pal-data-python/)) | **Yes.** Unzip in the Files app, pick the CSVs on the Data tab. Headers are matched by name, case-insensitively, so column order and extra columns don't matter. |

## Phase Research

| Question | Finding | Consequence |
|---|---|---|
| How to see a trend through daily water swings | Exponentially smoothed average, 10 % per day (Walker, *The Hacker's Diet*) — the standard "trend weight" used by Libra, Happy Scale, MacroFactor-style apps. | `trend()` = EMA with α = 0.1 per day, gaps advance the weight by α per missed day. |
| What rate is sensible | Bulking: ~0.25–0.5 % BW/week limits fat gain for trained lifters (Iraki et al. 2019, *Sports*). Cutting: 0.5–1 % BW/week preserves lean mass (Helms et al. 2014, JISSN). | Card shows 4-week rate in lb/week and % BW/week, labelled against those bands (maintaining / lean gain / fast gain / cutting / fast cut) with icon + word. Not advice; the bands are shown as context. |
| Protein | 1.6 g/kg/day captures most of the hypertrophy benefit (Morton et al. 2018 meta-analysis, BJSM). | If nutrition was imported: 7-day average protein vs 1.6 g/kg of trend weight. |

## Open Questions — answered by default

1. Units: lb everywhere (the app is lb). MFP weight is imported as-is (Jack logs lb).
2. One weigh-in per day; a later entry for the same date replaces it. Import merges by date: fields present in the file overwrite, absent fields are kept.
3. Weigh-in lives on Today (a single row that collapses to "Weighed 182.4 lb ✓" once done), not a new tab.
4. The zip is not opened in the browser: the Files app unzips; the Data picker accepts several CSVs at once.
5. Body data is exported as `body.csv` (`date,weight_lb,calories,protein_g`) and re-imports; Phase 8 syncs it.

## Review Focus

1. **MFP files with extra/reordered columns, blank weights, and multiple meals per day** import correctly (nutrition summed per day). Pinned: Task 1 tests.
2. **A sets CSV is never mistaken for body data or vice versa.** Pinned: `detectCsv` test.
3. **v4 → v5 upgrade keeps every store.** Pinned: Task 2 test.
4. **Trend with gaps** doesn't jump. Pinned: Task 1 test.

---

### Task 1: Domain `src/domain/body.ts`

```ts
export interface BodyDay { date: string; weight?: number; calories?: number; protein?: number }
export type CsvKind = 'sets' | 'body' | 'mfp-weight' | 'mfp-nutrition' | 'unknown'
detectCsv(text: string): CsvKind
parseBodyFile(text: string): { kind: CsvKind; days: BodyDay[]; errors: { row: number; message: string }[] }
toBodyCsv(days: BodyDay[]): string            // date,weight_lb,calories,protein_g
mergeBody(existing: BodyDay[], incoming: BodyDay[]): BodyDay[]
trend(days: BodyDay[]): { date: string; weight: number; trend: number }[]   // weigh-in days only, EMA α=0.1/day
rate(points, days = 28): { lbPerWeek: number; pctPerWeek: number } | null   // least squares over trend, needs ≥ 14 days span
rateBand(pct: number): { label: string; tone: 'ok' | 'warn' }
proteinCheck(days, trendWeight, today): { avg: number; target: number; days: number } | null   // last 7 days with protein
```
Tests: detect each kind from fixtures (sets header → 'sets'); MFP weight with extra columns and a blank weight row (skipped, not an error); nutrition with 3 meals on a day sums; body.csv round-trip; merge keeps fields not in the file; trend smooths a +3 lb spike to < +0.5; a 5-day gap moves the trend by 1−0.9⁵ of the difference; rate on a steady +0.5 lb/week series ≈ 0.5; band labels; protein avg and target (1.6 g/kg).

### Task 2: Storage

`db.ts` v5 `body` store (keyPath `date`); `getBody`, `putBody`, `putBodyMany`. `useBody` hook `{days, error, save(day), importDays(days)}`. Test: v4 database with sets/settings/profile/program survives the upgrade; body put/get.

### Task 3: UI

- Today: weigh-in row (`aria-label="Weigh-in"`): decimal input + Save; after saving shows the weight and Edit.
- Stats: "Body weight" card: line of trend with weigh-in dots (single amber series, dots muted), tiles Trend / 4-week rate (lb and %) / band word + icon; protein line if nutrition exists; table disclosure.
- Data: the file picker takes multiple files; each CSV is routed by `detectCsv`; messages name the kind ("MyFitnessPal weight: 42 days"). Export body CSV button.
- e2e `e2e/body.spec.ts`: weigh in on Today → Stats shows the Body weight card with that weight; import `mfp-weight.sample.csv` + `mfp-nutrition.sample.csv` → trend tile and protein line appear; export body CSV contains the dates. Screenshots at 375×812.
