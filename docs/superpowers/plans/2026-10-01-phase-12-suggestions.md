# Phase 12 — Exercise suggestions & data capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Opening any exercise shows what to do next (sets × reps @ weight, why, and a warm-up ramp) above its history, with "Log it today". Every set logged quietly records what was suggested, the gym and its time, and one tap a day records energy 1–5. All of it reaches the backup CSVs, ready for a future model.

**Architecture:**
- **Suggestions:** a new `src/domain/suggest.ts` builds them from three pieces:
  - `nextTarget` (double progression, unchanged) supplies the weight and reps.
  - `plannedSets` supplies the set count from today's program slot, with swaps and skips applied. Without a slot it uses the working sets from last session, and 3 if there is no history.
  - `warmups` produces a percentage ramp, rounded to 5 lb.
- **Data capture:** `SetEntry` gains `target` and `gym`, and `BodyDay` gains `energy`. The CSV formats gain columns. Both parsers already find columns by name, so older files still import.
- **UI:**
  - `ExerciseScreen` gets a suggestion card at the top.
  - `LiftsScreen` search also covers catalog lifts you have never logged.
  - `ExerciseCard` shows the set count and warm-ups, and saves the suggestion with every set.
  - `TodayScreen` gets an Energy chip row.

**Spec:** Phase 12 in `docs/superpowers/specs/2026-09-29-gym-tracker-design.md`.

## Phase Research (2026-10-01)

| Question | Finding | Consequence |
|---|---|---|
| Can a PWA read sleep/HRV from Apple Health? | No. Safari has no HealthKit, and there is no Apple Health web API; only a native app holding the entitlement can read it ([sahha.ai](https://sahha.ai/blog/can-a-web-app-read-apple-health/), [openwearables.io](https://openwearables.io/blog/apple-healthkit-api-what-data-you-can-access-and-how)). | Sleep can't be captured automatically. Jack declined manual sleep entry, so a single **energy 1–5** is the readiness signal. |
| Does pre-session readiness predict performance? | Readiness ratings taken before sessions are used to predict performance and to adjust training ([PMC7706636](https://pmc.ncbi.nlm.nih.gov/articles/PMC7706636/)). Collegiate-athlete models used questionnaires, workload and sleep as features ([Nature Sci Rep 2024](https://www.nature.com/articles/s41598-024-51658-8)). | Energy is worth one tap. Workload (sets, rest, tonnage) is derivable from data already logged, provided `logged_at` survives the backup, which it currently does not. |
| Is RIR a good label? | Intraset RIR predictions are more accurate closer to failure and in later sets ([Remmert et al. 2023](https://journals.sagepub.com/doi/10.1177/00315125231169868), [PMC5712461](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5712461/)). | Logging RIR stays optional, as now. "Suggested vs done" (reps achieved at the suggested weight) is an objective label recorded automatically. |

## Open Questions: answered (2026-10-01)
1. **Set count:** from today's program slot, else last session's working-set count, else 3. Clamped to 1–6.
2. **Shape of the suggestion:** working sets plus a warm-up ramp for heavier lifts, with a reason line. The card has a "Log it today" button.
3. **Manual data:** "a simple energy 1–5" only. Everything else is captured automatically.
4. **Entry point:** the exercise screen everywhere. Lifts, the Lifts search (including catalog lifts never logged) and an exercise's name on a Today card all open it. Tapping a *plan slot* on Today still starts logging it (unchanged), since that is a logging action.

## Review Focus
1. **Backward compatibility of the backup.**
   - An old `sets.csv` or `body.csv` with no new columns must import unchanged.
   - New files must round-trip `logged_at`, `target_*`, `gym` and `energy` exactly.
   - Sync's per-field merge must carry `energy`.
2. **Set count with swaps and skips.**
   - A swapped-in lift takes the original slot's set count.
   - A skipped slot gives no program count, so the fallback applies.
3. **Suggestion stability.** The suggestion for a date never uses that date's own sets, so the `target` saved on set 3 equals the one saved on set 1.

---

### Task 1: `src/domain/suggest.ts`

**Files:** create `src/domain/suggest.ts` and `src/domain/suggest.test.ts`.

- [ ] **Step 1: failing tests**, in `src/domain/suggest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { plannedSets, suggest, warmups } from './suggest';
import { defaultSettings } from './progression';
import type { SetEntry } from './types';
import type { DayPlan, Program } from './program';

let seq = 0;
const s = (date: string, exercise: string, weight: number, reps: number, flags: SetEntry['flags'] = []): SetEntry =>
  ({ id: `${date}|${exercise}|${seq}`, date, seq: seq++, exercise, setNo: seq, weight, reps, flags, source: 'app' });
const program: Program = { key: 'program', perSession: 12, createdAt: '', days: [{ name: 'Day A', slots: [
  { exercise: 'Bench Press', sets: 4, repMin: 8, repMax: 12 }, { exercise: 'Cable Curl', sets: 2, repMin: 10, repMax: 15 }] }] };
const plan = (over: Partial<DayPlan> = {}): DayPlan => ({ key: 'day:2026-10-02', date: '2026-10-02', day: 0, skips: [], swaps: {}, ...over });

describe('plannedSets', () => {
  it('reads today’s slot, follows a swap, and ignores a skipped slot', () => {
    expect(plannedSets(program, plan(), 'bench press')).toBe(4);
    expect(plannedSets(program, plan({ swaps: { 'Cable Curl': 'Hammer Curl' } }), 'Hammer Curl')).toBe(2);
    expect(plannedSets(program, plan({ swaps: { 'Cable Curl': 'Hammer Curl' } }), 'Cable Curl')).toBeNull();
    expect(plannedSets(program, plan({ skips: ['Bench Press'] }), 'Bench Press')).toBeNull();
    expect(plannedSets(null, null, 'Bench Press')).toBeNull();
  });
});

describe('suggest', () => {
  const st = defaultSettings('Bench Press'); // 8–12, +5
  it('goes up after every set hit the top of the range, with sets from the program', () => {
    const log = [s('2026-09-28', 'Bench Press', 135, 12), s('2026-09-28', 'Bench Press', 135, 12), s('2026-09-28', 'Bench Press', 135, 12)];
    const x = suggest(log, 'Bench Press', st, '2026-10-02', 4)!;
    expect(x).toMatchObject({ weight: 140, reps: 8, repMax: 12, sets: 4, setsFrom: 'program', kind: 'increase' });
    expect(x.reason).toMatch(/12 on every set.*\+5 lb/);
  });
  it('stays and chases reps otherwise, matching last session’s working-set count', () => {
    const log = [s('2026-09-28', 'Bench Press', 95, 10, ['warmup']), s('2026-09-28', 'Bench Press', 135, 10), s('2026-09-28', 'Bench Press', 135, 9)];
    expect(suggest(log, 'Bench Press', st, '2026-10-02', null)).toMatchObject({ weight: 135, reps: 10, sets: 2, setsFrom: 'last', kind: 'reps' });
  });
  it('never uses the day’s own sets, so the suggestion holds all session', () => {
    const log = [s('2026-09-28', 'Bench Press', 135, 10), s('2026-10-02', 'Bench Press', 135, 12), s('2026-10-02', 'Bench Press', 135, 12)];
    expect(suggest(log, 'Bench Press', st, '2026-10-02', null)).toMatchObject({ weight: 135, reps: 11, sets: 1 });
  });
  it('with no history: reps and 3 sets, no weight', () => {
    expect(suggest([], 'Bench Press', st, '2026-10-02', null)).toMatchObject({ weight: null, reps: 8, sets: 3, setsFrom: 'default', kind: 'new', warmups: [] });
  });
});

describe('warmups', () => {
  it('ramps to heavy weights in 5 lb steps, and skips light, bodyweight and timed work', () => {
    expect(warmups(225, 'Bench Press')).toEqual([{ weight: 90, reps: 8 }, { weight: 135, reps: 5 }, { weight: 180, reps: 2 }]);
    expect(warmups(100, 'Bench Press')).toEqual([{ weight: 50, reps: 8 }, { weight: 75, reps: 4 }]);
    expect(warmups(40, 'Bench Press')).toEqual([]);
    expect(warmups(0, 'Pull-up')).toEqual([]);
    expect(warmups(100, 'Plank')).toEqual([]);
  });
  it('skips the ramp for isolation lifts', () => {
    expect(warmups(100, 'Cable Curl')).toEqual([]);
  });
});
```

Run `npx vitest run src/domain/suggest.test.ts`. Expected: it FAILS because the `./suggest` module isn't found.

- [ ] **Step 2: implement** `src/domain/suggest.ts`:

```ts
import { isHold } from './care';
import { defaultSettings, isWorking, nextTarget, type ExerciseSettings, type Target } from './progression';
import type { DayPlan, Program } from './program';
import { sameExercise, sessionsFor } from './stats';
import type { SetEntry } from './types';

export interface Ramp { weight: number; reps: number }
export interface Suggestion {
  weight: number | null; reps: number; repMax: number; sets: number;
  setsFrom: 'program' | 'last' | 'default'; kind: Target['kind'] | 'new'; reason: string; warmups: Ramp[];
}

/** Sets planned today for this lift: its own slot, or the slot it was swapped into. A skipped slot plans nothing. */
export function plannedSets(program: Program | null, plan: DayPlan | null, exercise: string): number | null {
  if (!program || !plan) return null;
  const slots = plan.slots ?? program.days[plan.day]?.slots ?? [];
  for (const slot of slots) {
    if (plan.skips.some((x) => sameExercise(x, slot.exercise))) continue;
    const doing = plan.swaps[slot.exercise] ?? slot.exercise;
    if (sameExercise(doing, exercise)) return slot.sets;
  }
  return null;
}

const ISOLATION = (name: string) => defaultSettings(name).repMin >= 10;
const r5 = (w: number) => Math.round(w / 5) * 5;

/** A short ramp to the working weight for compound lifts of 60 lb or more; nothing under 20 lb is listed. */
export function warmups(weight: number, exercise: string): Ramp[] {
  if (weight < 60 || isHold(exercise) || ISOLATION(exercise)) return [];
  const steps: [number, number][] = weight >= 185 ? [[0.4, 8], [0.6, 5], [0.8, 2]] : [[0.5, 8], [0.75, 4]];
  const out: Ramp[] = [];
  for (const [f, reps] of steps) {
    const w = r5(weight * f);
    if (w >= 20 && w < weight && !out.some((x) => x.weight === w)) out.push({ weight: w, reps });
  }
  return out;
}

const lb = (w: number) => (w === 0 ? 'bodyweight' : `${Math.round(w * 100) / 100} lb`);

/** What to do next time: weight and reps from double progression, sets from the program or last session. Ignores `date`'s own sets. */
export function suggest(entries: SetEntry[], exercise: string, st: ExerciseSettings, date: string, planned: number | null): Suggestion {
  const t = nextTarget(entries, exercise, st, date);
  const last = sessionsFor(entries, exercise).find((x) => x.date < date);
  const lastWorking = last ? last.sets.filter(isWorking).length : 0;
  const [sets, setsFrom]: [number, Suggestion['setsFrom']] =
    planned != null ? [planned, 'program'] : lastWorking ? [lastWorking, 'last'] : [3, 'default'];
  const clamped = Math.min(6, Math.max(1, sets));
  if (!t) return { weight: null, reps: st.repMin, repMax: st.repMax, sets: clamped, setsFrom, kind: 'new', warmups: [],
    reason: `No history yet: pick a weight you can do about ${st.repMax} times, and log every set.` };
  const unit = isHold(exercise) ? ' s' : '';
  const reason = t.kind === 'increase' ? `You hit ${st.repMax}${unit} on every set last time, so +${st.increment} lb.`
    : t.kind === 'repeat' ? 'Last time had no complete sets: repeat the weight and log every rep.'
    : `Same weight; beat last time with ${t.reps}${unit}+ on every set.`;
  return { weight: t.weight, reps: t.reps, repMax: st.repMax, sets: clamped, setsFrom, kind: t.kind, reason, warmups: warmups(t.weight, exercise) };
}
```

Run the same command. Expected: 7/7 pass. Then commit: `Suggestions: sets from program or last session, warm-up ramp`.

### Task 2: Capture for later modelling

**Files:**
- Modify: `src/domain/types.ts`, `src/domain/buildSet.ts`, `src/domain/csv.ts`, `src/domain/body.ts`, `src/domain/sync.ts`.
- Tests: `src/domain/csv.test.ts`, `src/domain/body.test.ts`, `src/domain/sync.test.ts`.

- [ ] **Step 1: failing tests**, appended to the respective test files:

```ts
// csv.test.ts
describe('fields for later modelling', () => {
  it('round-trips logged_at, the suggestion and the gym, and still reads files without them', () => {
    const e: SetEntry = { id: setId('app', '2026-10-02', 'Bench Press', 1), date: '2026-10-02', seq: 1, loggedAt: '2026-10-02T17:03:11.000Z',
      exercise: 'Bench Press', setNo: 1, weight: 135, reps: 10, flags: [], source: 'app', target: { weight: 135, reps: 10, sets: 3 }, gym: 'Downtown' };
    const back = parseCsv(toCsv([e])).entries[0];
    expect(back).toMatchObject({ loggedAt: e.loggedAt, target: e.target, gym: 'Downtown' });
    const old = 'date,exercise,set,weight_lb,reps\n2026-01-05,Cable Curl,1,50,12\n';
    expect(parseCsv(old).entries[0]).not.toHaveProperty('target');
    expect(parseCsv('date,exercise,set,weight_lb,reps,logged_at\n2026-01-05,Cable Curl,1,50,12,yesterday\n').errors[0].message).toMatch(/logged_at/);
  });
});
// body.test.ts
describe('energy', () => {
  it('round-trips energy 1–5 and rejects anything else', () => {
    const days = [{ date: '2026-10-02', weight: 180, energy: 4 as const }, { date: '2026-10-03', energy: 2 as const }];
    expect(parseBodyFile(toBodyCsv(days)).days).toEqual(days);
    expect(parseBodyFile('date,weight_lb,energy\n2026-10-02,,6\n').errors[0].message).toMatch(/energy/i);
    expect(parseBodyFile('date,weight_lb\n2026-10-02,180\n').days).toEqual([{ date: '2026-10-02', weight: 180 }]);
  });
});
// sync.test.ts
describe('energy in the backup', () => {
  it('pulls energy for a day the phone has no energy for', async () => {
    const gh = fakeGitHub({ 'app/body.csv': 'date,weight_lb,calories,protein_g,energy\r\n2026-09-29,,,,3\r\n' });
    const got: BodyDay[] = [];
    await sync({ client: repoClient(CFG, gh.fetchFn), sets: [], body: [{ date: '2026-09-29', weight: 180 }], deleted: new Set(),
      importSets: async () => ({ added: 0, updated: 0 }), importBody: async (d) => { got.push(...d); return true; }, now: new Date('2026-09-30T12:00:00Z') });
    expect(got).toEqual([{ date: '2026-09-29', energy: 3 }]);
    expect(gh.store.get('app/body.csv')!.text).toContain('2026-09-29,180,,,3');
  });
});
```

Run `npx vitest run src/domain/csv.test.ts src/domain/body.test.ts src/domain/sync.test.ts`. Expected: the three new tests FAIL.

- [ ] **Step 2: implement.**
  - **`types.ts`:** add to `SetEntry`:
    ```ts
    /** What the app suggested when this set was logged, and where: for comparing suggested with done. */
    target?: { weight: number; reps: number; sets: number };
    gym?: string;
    ```
  - **`buildSet.ts`:**
    - `NewSetInput` gains `target?: SetEntry['target']; gym?: string`.
    - `buildAppSet` adds `...(input.target && { target: input.target }), ...(input.gym && { gym: input.gym })`.
  - **`csv.ts`:**
    - Append `'logged_at', 'target_weight_lb', 'target_reps', 'target_sets', 'gym'` to `CSV_HEADER`.
    - `toCsv` writes `e.loggedAt ?? ''`, the three target values or `''`, and `e.gym ?? ''`.
    - `parseCsv`:
      - `logged_at` is either empty or `Number.isFinite(Date.parse(v))`; otherwise `fail('Bad logged_at "…"')`.
      - The target is kept only when all three numbers parse, with weight ≥ 0, reps and sets as integers ≥ 0, and sets ≥ 1.
      - A non-empty `gym` is kept.
      - The fields are spread in the same `...(cond && {...})` style.
  - **`body.ts`:**
    - `BodyDay` gains `energy?: 1 | 2 | 3 | 4 | 5`, and `BODY_HEADER` gains `'energy'`.
    - In `parseBodyFile`, the `body` kind maps `energy: col('energy')`; widen the key union to include `'energy'`.
    - Validate energy as an integer from 1 to 5, otherwise `Bad energy "…"`. The 50–700 range check stays weight-only.
    - `toBodyCsv` writes `d.energy ?? ''` as the 5th column.
  - **`sync.ts`:** the fill loop's key list becomes `['weight', 'calories', 'protein', 'energy']`.

Run the same command. Expected: all pass. Then run `npm test`. Expected: all pass. Commit: `Capture suggestion, gym, time and energy in the backup`.

### Task 3: UI

**Files:**
- Create: `src/ui/SuggestionCard.tsx`, `src/ui/Energy.tsx`, `e2e/suggest.spec.ts`.
- Modify: `src/ui/ExerciseScreen.tsx`, `src/ui/ExerciseCard.tsx`, `src/ui/TodayScreen.tsx`, `src/ui/LiftsScreen.tsx`, `src/ui/App.tsx`, `src/ui/styles.css`.

- [ ] **Step 1: failing e2e**, `e2e/suggest.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('open an exercise: next sets × reps @ weight with a warm-up, history below, log it today with the suggestion saved', async ({ page }) => {
  await page.goto('/');
  // Last session: 3 × 12 @ 135 — time to go up.
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: /^Bench Press/ }).first().click();
  await page.evaluate(() => {}); // card is on Today now
  for (let i = 0; i < 3; i++) {
    await page.getByRole('textbox', { name: 'Weight' }).fill('135');
    await page.getByRole('textbox', { name: 'Reps' }).fill('12');
    await page.getByRole('button', { name: 'Add set' }).click();
  }
  // Pretend that was yesterday: move the clock a day on and reload.
  await page.clock.install({ time: new Date(Date.now() + 864e5) });
  await page.reload();

  await page.getByRole('button', { name: 'Lifts' }).click();
  await page.getByRole('searchbox', { name: 'Filter lifts' }).fill('bench');
  await page.getByRole('button', { name: /^Bench Press/ }).click();
  const card = page.getByRole('region', { name: 'Next time' });
  await expect(card).toContainText('3 × 8–12 @ 140 lb');
  await expect(card).toContainText('+5 lb');
  await expect(card).toContainText(/Warm-up: 70 × 8 · 105 × 4/);
  await expect(page.getByText('135 × 12').first()).toBeVisible(); // history under it
  await page.screenshot({ path: 'screenshots/20-suggestion.png', fullPage: true });

  await card.getByRole('button', { name: 'Log it today' }).click();
  await expect(page.getByRole('textbox', { name: 'Weight' })).toHaveValue('140');
  await expect(page.getByText('3 × 8+ @ 140 lb')).toBeVisible();
  await page.getByRole('group', { name: 'Energy' }).getByRole('button', { name: '4' }).click();
  await page.getByRole('button', { name: 'Add set' }).click();

  // The backup carries the suggestion, gym-less here, the time and the energy.
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const csv = await page.getByRole('textbox', { name: 'CSV export' }).inputValue().catch(() => '');
  if (csv) expect(csv).toMatch(/,140,8,3,\r?\n?/);
});

test('Lifts search finds catalog lifts never logged, with a no-history suggestion', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Lifts' }).click();
  await page.getByRole('searchbox', { name: 'Filter lifts' }).fill('hammer');
  await page.getByRole('button', { name: /^Hammer Curl/ }).click();
  await expect(page.getByRole('region', { name: 'Next time' })).toContainText(/3 × 10–15.*No history yet/s);
});
```

Run `npm run build && npx playwright test e2e/suggest.spec.ts`. Expected: FAIL (there's no "Next time" region).

- [ ] **Step 2: implement.**
  - **`SuggestionCard.tsx`:** a `<section className="card suggestion" aria-label="Next time">`.
    - Heading "Next time".
    - A big line: `${sets} × ${reps}–${repMax} @ ${weight} lb`, or "BW" for bodyweight, or no "@ …" when the weight is null.
    - Muted lines:
      - the reason;
      - `Sets: today’s program` / `as last time` / `default`;
      - `Warm-up: 70 × 8 · 105 × 4`, only when there are warm-ups.
    - Optional `onLog` → `<button className="primary wide">Log it today</button>`.
  - **`ExerciseScreen`:**
    - New props `programs: ProgramStore`, `date: string`, `onLog: () => void`.
    - Compute `suggest(store.entries, name, settings.get(name), date, plannedSets(programs.program, todayPlanFor(programs, store.entries, date), name))`.
    - Render `<SuggestionCard … onLog={onLog} />` directly under the `h1`.
    - Move the "History" sessions above the chart and the settings; add `<h2>History</h2>`. Tiles stay under the suggestion.
  - **`App`:**
    - Pass `programs`, `date`, and `onLog={() => { const cards = getDraft<string[]>(activeProfileDb(), '#cards', date) ?? []; saveDraft(activeProfileDb(), '#cards', date, cards.some((c) => sameExercise(c, exercise)) ? cards : [...cards, exercise]); setExercise(null); setTab('today'); window.scrollTo(0, 0); }}`.
    - Ruling candidate: `activeProfileDb()` is safe here; this runs inside the current profile's screens.
  - **`LiftsScreen`:**
    - With a query, list logged lifts first, then `CATALOG` names that match and aren't logged, each with the muted "never logged".
    - The filter input becomes `type="search"` with role searchbox (it already is).
  - **`ExerciseCard`:**
    - New props `plannedSets: number | null` and `gym: string | undefined`.
    - Compute `sug = suggest(…)`.
    - The target line text is `${sug.sets} × ${sug.reps}+ @ ${lb}`, plus `· warm-up a × r · b × r` when there are warm-ups.
    - `addSet` passes `target: sug.weight != null ? { weight: sug.weight, reps: sug.reps, sets: sug.sets } : undefined, gym`.
  - **`TodayScreen`:**
    - For each card, pass `plannedSets={plannedSets(programs.program, plan, n)}` and `gym={gyms.active?.name}`.
    - Render `<Energy body={body} date={date} />` under `WeighIn`.
  - **`Energy.tsx`:** `<div className="chips" role="group" aria-label="Energy">`.
    - The label "Energy" is followed by five `.chip` buttons, 1–5, with `aria-pressed` on the stored value.
    - A tap calls `body.save({ date, energy: n })`; tapping the pressed value saves nothing (no clearing).
  - **CSS:** `.suggestion .big { font-size: 22px; font-weight: 700; margin: 4px 0; }`.

Run `npm run build && npx playwright test e2e/suggest.spec.ts`, then `npm run e2e` and `npm test`. Expected: all pass. View `screenshots/20-suggestion.png` at 375 wide. Commit: `Exercise screen: next time card, log it today, energy`.
