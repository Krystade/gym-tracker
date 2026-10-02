# Phase 13 — Workout time & late entries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:**
- **Workout length** is measured automatically.
- **Estimates:** program days and today's plan show an estimated length, with a finish time once you've started.
- **Build to a time:** the builder can build to "minutes per session".
- **Late sets** can be added to today or any earlier day, with an optional "when" that the app pre-fills.

**Architecture:**
- **`src/domain/timing.ts`** (new, pure):
  - `paces` learns your per-lift set-to-set time and your time to switch lifts from the timestamps already logged.
  - `estimateSeconds` / `estimateDayMinutes` estimate a list of slots.
  - `sessionMinutes` measures a logged day.
  - `suggestTime` picks a "when" for a late set.
  - `perSessionForMinutes` turns a time budget into sets per session, by building and estimating.
- **`SetEntry`:**
  - Gains `enteredAt`, set only when a set was added late.
  - `loggedAt` becomes the time it was *done*, which is absent if unknown.
  - The CSV gains an `entered_at` column.
- **UI:**
  - Today gets a day switcher (‹ date ›) and a past-day banner.
  - History days get "Add to this day".
  - The set form gets "Did this earlier?", which opens a When field pre-filled with the suggestion. On a past day the field is always open.
  - Program days and today's plan get "≈ N min"; History day summaries get the measured length.
  - The builder gains a Sets/Minutes switch.

**Spec:** Phase 13 in `docs/superpowers/specs/2026-09-29-gym-tracker-design.md`.

## Phase Research (2026-10-02)

| Question | Finding | Consequence |
|---|---|---|
| Typical rest between sets | A 2024 Bayesian meta-analysis found a small hypertrophy benefit for rests over 60 s and no appreciable difference beyond 90 s ([Frontiers 2024](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1429789/full)). Common practice is 2–3 min on compound lifts and 1–2 min on isolation lifts ([House of Hypertrophy](https://houseofhypertrophy.com/rest-intervals-for-building-muscle/)). | Default set-to-set times, used before your own data exists: **180 s for compound lifts, 120 s for isolation lifts** (each is a set plus its rest). There's also a **120 s** switch between lifts and **60 s** per warm-up set. |
| What the app already records | Live sets store `loggedAt` (ISO time) and `seq` (epoch ms). Pasted and imported sets have no time. | Your own paces come from live-logged days only. Untimed sets are left out of all timing. |
| Platform | Nothing new. Timing is computed from stored timestamps, so iOS background limits don't matter (no timers run). | No research needed beyond the above. |

## Open Questions: answered (2026-10-02)
1. **Where to backfill:** both. A day switcher on Today, plus "Add to this day" on each History day, which jumps to Today on that day.
2. **Time of a late set:** "an optional guess", pre-filled by the app at "a time that makes sense, like between two sets where the spacing is too different". Rules:
   - The largest gap between that day's timed sets is used if it is more than twice the day's median gap and at least 2 min longer than it; the suggestion is its midpoint.
   - Otherwise the suggestion is one typical set after the last set, but never later than now.
   - With no timed sets that day, nothing is suggested.
   - Clearing the field means "unknown".
3. **Measuring a workout:** automatic, from the first to the last timed set plus one typical set.
4. **Estimates:** shown, **and** the builder can build to minutes per session.

## Review Focus
1. **Timing never counts a late set without a time.** Sets with `enteredAt` and no `loggedAt` are invisible to `paces`, `sessionMinutes` and `suggestTime`. A guessed time *is* used: it is your estimate.
2. **Late sets land on the chosen day with correct order and ids.**
   - `setNo` is still `max + 1` for that day and lift; the id is unchanged in form.
   - `seq` follows the guessed time, so History and the session show it in the right place.
3. **Back-compatible CSV.** Old files import unchanged. `entered_at` round-trips, and a set with no `loggedAt` stays without one.
4. **`perSessionForMinutes` respects the budget.** Every day of the returned program is estimated at or under the budget, or the result is the floor of 8.

---

### Task 1: `src/domain/timing.ts`

**Files:** create `src/domain/timing.ts` and `src/domain/timing.test.ts`.

- [ ] **Step 1: failing tests**, in `src/domain/timing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_PACE, estimateSeconds, paces, perSessionForMinutes, perSetSeconds, sessionMinutes, suggestTime } from './timing';
import type { SetEntry } from './types';
import type { Program } from './program';

let n = 0;
const at = (date: string, hhmm: string, exercise = 'Bench Press', timed = true): SetEntry => ({
  id: `x${n}`, date, seq: n++, exercise, setNo: n, weight: 100, reps: 10, flags: [], source: 'app',
  ...(timed && { loggedAt: new Date(`${date}T${hhmm}:00`).toISOString() }),
});

describe('paces', () => {
  it('learns per-lift set-to-set time and the switch between lifts, from timed sets only', () => {
    const day = ['18:00', '18:02', '18:04', '18:06'].map((t) => at('2026-09-28', t));
    const curls = ['18:10', '18:11:30'.slice(0, 5)].map((t) => at('2026-09-28', t, 'Cable Curl'));
    const p = paces([...day, ...curls, at('2026-09-28', '23:00', 'Cable Curl', false)]);
    expect(perSetSeconds(p, 'Bench Press')).toBe(120);
    expect(p.transition).toBe(240);
    // Fewer than 3 samples: the default for the kind of lift.
    expect(perSetSeconds(p, 'Cable Curl')).toBe(DEFAULT_PACE.isolation);
    expect(perSetSeconds(p, 'Squat')).toBe(DEFAULT_PACE.compound);
  });
  it('ignores gaps over 10 min within a lift and over 15 min between lifts', () => {
    const p = paces([at('2026-09-28', '18:00'), at('2026-09-28', '18:30'), at('2026-09-28', '19:00', 'Cable Curl')]);
    expect(p.transition).toBe(DEFAULT_PACE.transition);
  });
});

describe('estimates', () => {
  it('adds sets, switches between lifts and warm-ups', () => {
    const p = paces([]);
    // 3 bench (180 s) + 2 curls (120 s) + 1 switch (120 s) + 2 warm-ups (60 s)
    expect(estimateSeconds([{ exercise: 'Bench Press', sets: 3 }, { exercise: 'Cable Curl', sets: 2 }], p, (ex) => (ex === 'Bench Press' ? 2 : 0)))
      .toBe(3 * 180 + 2 * 120 + 120 + 2 * 60);
  });
  it('measures a session from first to last timed set plus one typical set', () => {
    const log = [at('2026-09-28', '18:00'), at('2026-09-28', '18:40', 'Cable Curl'), at('2026-09-28', '23:59', 'Cable Curl', false)];
    expect(sessionMinutes(log, '2026-09-28', paces([]))).toBe(42); // 40 min + 120 s curl
    expect(sessionMinutes([at('2026-09-28', '18:00')], '2026-09-28', paces([]))).toBeNull();
  });
  it('picks the most sets per session whose every day fits the minutes', () => {
    const build = (per: number): Program => ({ key: 'program', perSession: per, createdAt: '', days: [{ name: 'A', slots: [{ exercise: 'Bench Press', sets: per, repMin: 8, repMax: 12 }] }] });
    const est = (d: Program['days'][number]) => d.slots[0].sets * 3; // 3 min a set
    expect(perSessionForMinutes(45, build, est)).toBe(15);
    expect(perSessionForMinutes(10, build, est)).toBe(8); // floor
  });
});

describe('suggestTime', () => {
  const now = new Date('2026-09-28T20:00:00');
  it('suggests the middle of an unusually long gap', () => {
    const day = ['18:00', '18:02', '18:04', '18:14', '18:16'].map((t) => at('2026-09-28', t));
    expect(suggestTime(day, '2026-09-28', 'Bench Press', paces(day), now)).toBe('18:09');
  });
  it('otherwise one typical set after the last, but never after now', () => {
    const day = ['18:00', '18:02', '18:04'].map((t) => at('2026-09-28', t));
    expect(suggestTime(day, '2026-09-28', 'Bench Press', paces(day), now)).toBe('18:06');
    expect(suggestTime(day, '2026-09-28', 'Bench Press', paces(day), new Date('2026-09-28T18:05:00'))).toBe('18:05');
  });
  it('suggests nothing for a day without timed sets', () => {
    expect(suggestTime([at('2026-09-28', '18:00', 'Bench Press', false)], '2026-09-28', 'Bench Press', paces([]), now)).toBeNull();
  });
});
```

Run `npx vitest run src/domain/timing.test.ts`. Expected: it FAILS because the module isn't found.

- [ ] **Step 2: implement** `src/domain/timing.ts`:

```ts
import { defaultSettings, settingsKey } from './progression';
import { sameExercise } from './stats';
import type { Program, ProgramDay } from './program';
import type { SetEntry } from './types';

/** Seconds, until your own data takes over: a set plus its rest, a switch between lifts, a warm-up set. */
export const DEFAULT_PACE = { compound: 180, isolation: 120, transition: 120, warmup: 60 } as const;
const MAX_SAME = 10 * 60, MAX_SWITCH = 15 * 60, MIN_SAMPLES = 3;

const secs = (e: SetEntry) => Date.parse(e.loggedAt!) / 1000;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** One day's sets that have a time, in the order they were done. Sets added later without a time are left out. */
export const timedDay = (entries: SetEntry[], date: string): SetEntry[] =>
  entries.filter((e) => e.date === date && e.loggedAt).sort((a, b) => secs(a) - secs(b));

export interface Paces { perSet: Map<string, number>; transition: number }

/** Your pace from timed days: per lift, the median time from one set to the next (≤ 10 min); between lifts, the median switch (≤ 15 min). */
export function paces(entries: SetEntry[]): Paces {
  const same = new Map<string, number[]>(), sw: number[] = [];
  for (const date of new Set(entries.filter((e) => e.loggedAt).map((e) => e.date))) {
    const day = timedDay(entries, date);
    for (let i = 1; i < day.length; i++) {
      const gap = secs(day[i]) - secs(day[i - 1]);
      if (gap <= 0) continue;
      if (sameExercise(day[i].exercise, day[i - 1].exercise)) {
        if (gap <= MAX_SAME) { const k = settingsKey(day[i].exercise); same.set(k, [...(same.get(k) ?? []), gap]); }
      } else if (gap <= MAX_SWITCH) sw.push(gap);
    }
  }
  const perSet = new Map([...same].filter(([, xs]) => xs.length >= MIN_SAMPLES).map(([k, xs]) => [k, median(xs)]));
  return { perSet, transition: sw.length >= MIN_SAMPLES ? median(sw) : DEFAULT_PACE.transition };
}

export const perSetSeconds = (p: Paces, exercise: string): number =>
  p.perSet.get(settingsKey(exercise)) ?? (defaultSettings(exercise).repMin >= 10 ? DEFAULT_PACE.isolation : DEFAULT_PACE.compound);

/** A list of lifts and sets, in seconds: every set, a switch between lifts, and `warmups(ex)` warm-up sets each. */
export function estimateSeconds(slots: { exercise: string; sets: number }[], p: Paces, warmups: (ex: string) => number = () => 0): number {
  const work = slots.reduce((a, s) => a + s.sets * perSetSeconds(p, s.exercise) + warmups(s.exercise) * DEFAULT_PACE.warmup, 0);
  return work + Math.max(0, slots.length - 1) * p.transition;
}

/** How long a logged day took: first to last timed set, plus one typical set for the last. Null with fewer than 2 timed sets. */
export function sessionMinutes(entries: SetEntry[], date: string, p: Paces): number | null {
  const day = timedDay(entries, date);
  if (day.length < 2) return null;
  return Math.round((secs(day.at(-1)!) - secs(day[0]) + perSetSeconds(p, day.at(-1)!.exercise)) / 60);
}

/**
 * A "when" for a set entered late, as HH:MM: the middle of the day's unusually long gap (over twice the median and 2 min longer),
 * else one typical set after the last timed set, never after `now`. Null when the day has no timed sets.
 */
export function suggestTime(entries: SetEntry[], date: string, exercise: string, p: Paces, now: Date): string | null {
  const day = timedDay(entries, date);
  if (!day.length) return null;
  const gaps = day.slice(1).map((e, i) => [secs(day[i]), secs(e)] as const);
  if (gaps.length >= 2) {
    const typical = median(gaps.map(([a, b]) => b - a));
    const [a, b] = gaps.reduce((x, y) => (y[1] - y[0] > x[1] - x[0] ? y : x));
    if (b - a > Math.max(2 * typical, typical + 120)) return hhmm(new Date(((a + b) / 2) * 1000));
  }
  const next = Math.min((secs(day.at(-1)!) + perSetSeconds(p, exercise)) * 1000, now.getTime());
  return hhmm(new Date(next));
}

/** The most sets per session (8–20) whose every day `est`imates within `minutes`; 8 if none fits. */
export function perSessionForMinutes(minutes: number, build: (per: number) => Program, est: (day: ProgramDay) => number): number {
  for (let per = 20; per > 8; per--) if (Math.max(...build(per).days.map(est)) <= minutes) return per;
  return 8;
}
```

Run the same command. Expected: all pass. Commit: `Timing: paces, estimates, session length, late-set time`.

### Task 2: Late sets in the data model

**Files:**
- Modify: `src/domain/types.ts`, `src/domain/buildSet.ts`, `src/domain/csv.ts`.
- Tests: `src/domain/buildSet.test.ts` (create it if missing) and `src/domain/csv.test.ts`.

- [ ] **Step 1: failing tests:**

```ts
// buildSet.test.ts
import { describe, expect, it } from 'vitest';
import { buildAppSet } from './buildSet';

describe('late sets', () => {
  const now = new Date('2026-10-02T19:30:00');
  const input = { date: '2026-10-01', exercise: 'Bench Press', weight: 135, reps: 8, flags: [] };
  it('a live set is done when entered', () => {
    const e = buildAppSet([], { ...input, date: '2026-10-02' }, now);
    expect(e).toMatchObject({ loggedAt: now.toISOString(), seq: now.getTime() });
    expect(e).not.toHaveProperty('enteredAt');
  });
  it('a late set with a guessed time is ordered by that time and remembers when it was entered', () => {
    const when = new Date('2026-10-01T18:09:00');
    expect(buildAppSet([], { ...input, at: when }, now)).toMatchObject({ date: '2026-10-01', loggedAt: when.toISOString(), seq: when.getTime(), enteredAt: now.toISOString() });
  });
  it('a late set with no time has none', () => {
    const e = buildAppSet([], { ...input, at: null }, now);
    expect(e).not.toHaveProperty('loggedAt');
    expect(e.enteredAt).toBe(now.toISOString());
  });
});
// csv.test.ts
describe('late sets in the CSV', () => {
  it('round-trips entered_at and keeps an untimed set untimed', () => {
    const e: SetEntry = { id: setId('app', '2026-10-01', 'Bench Press', 1), date: '2026-10-01', seq: 1, exercise: 'Bench Press', setNo: 1,
      weight: 135, reps: 8, flags: [], source: 'app', enteredAt: '2026-10-02T02:30:00.000Z' };
    const back = parseCsv(toCsv([e])).entries[0];
    expect(back.enteredAt).toBe(e.enteredAt);
    expect(back).not.toHaveProperty('loggedAt');
  });
});
```

Run `npx vitest run src/domain/buildSet.test.ts src/domain/csv.test.ts`. Expected: the new tests FAIL.

- [ ] **Step 2: implement.**
  - **`types.ts`:**
    - Above `loggedAt`, add the comment `/** When the set was done (a guess for one entered late); absent if unknown. */`.
    - Add `/** When a late set was entered; absent for sets logged as they were done. */ enteredAt?: string;`.
  - **`buildSet.ts`:**
    - `NewSetInput` gains `/** When it was done, for a set entered late: a time, or null for unknown. Absent: now. */ at?: Date | null;`.
    - In `buildAppSet`:
      ```ts
      const late = input.at !== undefined;
      const done = late ? input.at : now;
      // … in the returned object, replacing `seq: now.getTime(), loggedAt: now.toISOString(),`:
      seq: (done ?? now).getTime(),
      ...(done && { loggedAt: done.toISOString() }),
      ...(late && { enteredAt: now.toISOString() }),
      ```
  - **`csv.ts`:**
    - Append `'entered_at'` to `CSV_HEADER`; `toCsv` writes `e.enteredAt ?? ''` last.
    - `parseCsv` reads `entered_at` with the same `Date.parse` check as `logged_at` (`Bad entered_at "…"`), and spreads `...(enteredAt && { enteredAt })`.

Run the same command, then `npm test`. Expected: all pass. Commit: `Late sets: done time vs entered time, entered_at in the CSV`.

### Task 3: UI

**Files:**
- Modify: `src/ui/App.tsx`, `src/ui/TodayScreen.tsx`, `src/ui/HistoryScreen.tsx`, `src/ui/SetForm.tsx`, `src/ui/ExerciseCard.tsx`, `src/ui/TodayPlan.tsx`, `src/ui/ProgramScreen.tsx`, `src/ui/styles.css`.
- Create: `e2e/time.spec.ts`.

- [ ] **Step 1: failing e2e**, `e2e/time.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

const logBench = async (page: import('@playwright/test').Page, weight: string, reps: string) => {
  await page.getByRole('textbox', { name: 'Weight' }).fill(weight);
  await page.getByRole('textbox', { name: 'Reps' }).fill(reps);
  await page.getByRole('button', { name: 'Add set' }).click();
};

test('a forgotten set goes into yesterday at the suggested time, and the workout length is measured', async ({ page }) => {
  // Yesterday: sets at 18:00, 18:02, 18:04, then a 10-min gap, then 18:14 and 18:16.
  await page.clock.install({ time: new Date('2026-10-01T18:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  for (const t of ['18:00', '18:02', '18:04', '18:14', '18:16']) {
    await page.clock.setFixedTime(new Date(`2026-10-01T${t}:00`));
    await logBench(page, '135', '10');
  }
  // Today: open yesterday from History and add the set that was forgotten in the gap.
  await page.clock.setFixedTime(new Date('2026-10-02T09:00:00'));
  await page.reload();
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText(/Thu, Oct 1, 2026 · 1 exercise · 5 sets · 18 min/)).toBeVisible();
  await page.getByRole('button', { name: 'Add to this day' }).click();
  await expect(page.getByText('Logging to Thu, Oct 1, 2026')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'When' })).toHaveValue('18:09');
  await logBench(page, '135', '9');
  await expect(page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem')).toHaveCount(6);
  await page.screenshot({ path: 'screenshots/22-late-set.png', fullPage: true });
  // The day switcher goes back to today.
  await page.getByRole('button', { name: 'Back to today' }).click();
  await expect(page.getByRole('heading', { name: 'Fri, Oct 2, 2026' })).toBeVisible();
  await expect(page.getByText(/Logging to/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByRole('heading', { name: 'Thu, Oct 1, 2026' })).toBeVisible();
});

test('a set entered a few minutes late today can take an earlier time', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await logBench(page, '135', '10');
  await page.clock.setFixedTime(new Date('2026-10-02T18:12:00'));
  await expect(page.getByRole('textbox', { name: 'When' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Did this earlier?' }).click();
  await expect(page.getByRole('textbox', { name: 'When' })).toHaveValue('18:03');
  await logBench(page, '135', '9');
  await expect(page.getByRole('textbox', { name: 'When' })).toHaveCount(0); // closes again after saving
});

test('the builder builds to minutes, and program days show their length', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByRole('button', { name: 'Minutes', exact: true }).click();
  await page.getByRole('textbox', { name: 'Minutes per session' }).fill('45');
  await page.getByRole('button', { name: 'Build program' }).click();
  const heads = await page.getByRole('heading', { name: /^Day [A-Z] · \d+ sets · ≈ \d+ min$/ }).allInnerTexts();
  expect(heads.length).toBeGreaterThan(0);
  for (const h of heads) expect(Number(/≈ (\d+) min/.exec(h)![1])).toBeLessThanOrEqual(45);
  await page.screenshot({ path: 'screenshots/23-program-minutes.png', fullPage: true });
});
```

Run `npm run build && npx playwright test e2e/time.spec.ts`. Expected: all three FAIL.

- [ ] **Step 2: implement.**
  - **`App.tsx`:**
    - `Shell` adds `const [logDay, setLogDay] = useState<string | null>(null);` to `nav`. The Nav type gains `logDay` and `setLogDay`.
    - TodayScreen receives `date={logDay ?? date}`, `today={date}` and `onDay={(d) => setLogDay(d === date ? null : d)}`.
    - HistoryScreen gets `onAddTo={(d) => { setLogDay(d); setTab('today'); window.scrollTo(0, 0); }}`.
    - Tapping the Today tab sets `logDay` to null.
  - **`TodayScreen.tsx`:**
    - New props `today: string` and `onDay: (d: string) => void`.
    - The header becomes:
      ```tsx
      <div className="today-head">
        <div className="day-switch">
          <button className="mini" aria-label="Previous day" onClick={() => onDay(addDays(date, -1))}>‹</button>
          <h1>{fmtDate(date)}</h1>
          <button className="mini" aria-label="Next day" disabled={date >= today} onClick={() => onDay(addDays(date, 1))}>›</button>
        </div>
        <button onClick={onOpenProgram}>Program</button>
      </div>
      {date < today && <p className="card note-card past-day">Logging to {fmtDate(date)} <button className="mini" onClick={() => onDay(today)}>Back to today</button></p>}
      ```
    - The empty-state text becomes `date < today ? 'Nothing logged that day.' : 'Nothing logged yet today.'`.
    - Pass `today` to every `ExerciseCard`.
    - In `TodayPlan`, add an estimate line: `≈ {minutes} min` for the plan's day (`estimateSeconds(day slots minus skips with swaps, paces(entries), warmupCount)/60`, rounded). Once the day has a timed set, also show `· started {HH:MM} · ends ≈ {HH:MM}`; the end is the first timed set plus the estimate.
  - **`HistoryScreen.tsx`:**
    - New prop `onAddTo: (date: string) => void`.
    - The summary appends `· {m} min` when `sessionMinutes(store.entries, s.date, p)` isn't null (`p = paces(store.entries)`, memoised on entries).
    - Each `day-body` ends with `<button className="wide" onClick={() => onAddTo(s.date)}>Add to this day</button>`.
  - **`SetForm.tsx`:**
    - New optional prop `when?: { suggested: string | null; always: boolean }`; `SetFormValue` gains `at?: string | null` (HH:MM, or null for unknown).
    - State: `const [whenOpen, setWhenOpen] = useState(!!when?.always)` and `const [time, setTime] = useState(when?.suggested ?? '')`.
    - When `when` is set and `!whenOpen`, render a `<button type="button" className="chip">Did this earlier?</button>` that opens it. On opening, `setTime(when.suggested ?? '')` takes the suggestion as of now.
    - When open, render `<label className="when">When <input type="time" aria-label="When" value={time} onChange={(e) => setTime(e.target.value)} /></label>` and `<span className="muted small">{when.suggested ? 'Suggested from the gap between sets' : 'Leave empty if you don’t know'}</span>`.
    - Submit includes `...(whenOpen && { at: time || null })`. After a successful submit, if `!when.always`, close it again.
  - **`ExerciseCard.tsx`:**
    - New prop `today: string`; `p = useMemo(() => paces(store.entries), [store.entries])`.
    - Pass `when={{ suggested: suggestTime(store.entries, date, exercise, p, new Date()), always: date < today }}` to the new-set form only.
    - `addSet` converts it: `...(v.at !== undefined && { at: v.at ? new Date(`${date}T${v.at}:00`) : null })`, and strips `at` from what it spreads into `store.add`.
  - **`ProgramScreen.tsx`:**
    - A Sets/Minutes chip pair above the inputs (`role="group" aria-label="Session size"`), stored in `useState<'sets' | 'minutes'>`.
    - In minutes mode, the second input is `Minutes per session` (20–150, default 60).
    - Build: `perSession = mode === 'minutes' ? perSessionForMinutes(mins, (per) => buildProgram(…, { days: d, perSession: per }, …), dayMinutes) : s`, then build with it.
    - The day heading becomes `{day.name} · {N} sets · ≈ {dayMinutes(day)} min`, where `dayMinutes = (day) => Math.round(estimateSeconds(day.slots, pace, warmupCount) / 60)`, `pace = paces(entries)`, and `warmupCount = (ex) => warmups(suggest(entries, ex, settings-for-ex, today, null).weight ?? 0, ex).length`.
      - Ruling candidate: ProgramScreen has no settings store, so use `defaultSettings(ex)`. That changes only the warm-up count, not the weight.
  - **CSS:**
    - `.day-switch { display: flex; align-items: center; gap: 4px; }`
    - `.day-switch h1 { margin: 4px 0 12px; font-size: 22px; }`
    - `.past-day { display: flex; justify-content: space-between; align-items: center; gap: 8px; }`
    - `.when { display: flex; align-items: center; gap: 8px; } .when input { min-height: 44px; font-size: 16px; }`

Run `npm run build && npx playwright test e2e/time.spec.ts`, then `npm run e2e` and `npm test`. Expected: all pass. View screenshots 22 and 23 at 375 wide. Commit: `Late sets from Today and History, workout length, build to minutes`.
