# Phase 1 — Log & History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An installable, offline iPhone PWA that logs sets with instant persistence, imports/exports the standard CSV, and shows history, last-time, best set and an e1RM chart per exercise.

**Architecture:** Pure domain modules (`src/domain/*`: types, CSV, stats, set building) with unit tests; a thin IndexedDB layer (`src/db/db.ts`, via `idb`); a `useSets` hook holding all sets in memory (thousands of rows at most) and writing through to IndexedDB on every change; four screens behind a bottom tab bar. No backend. Personal data never enters this repo — the history conversion lives in the private `gym-data` repo (Task 9).

**Tech Stack:** Vite 8, React 19, TypeScript ~6.0, vite-plugin-pwa 1.3, idb 8, Vitest 4 (+ fake-indexeddb), Playwright (WebKit, iPhone 13 Mini profile).

**Spec:** `docs/superpowers/specs/2026-09-29-gym-tracker-design.md`

## Phase Research (2026-09-29)

Checked before planning; each finding is folded into the task named.

| Question | Finding | Consequence |
|---|---|---|
| Will iOS delete IndexedDB data? | Safari evicts origin storage under pressure or after weeks unused; **home-screen web apps are the documented exemption**; `navigator.storage.persist()` exists since Safari 17. ([magicbell](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide), [mobiloud](https://www.mobiloud.com/blog/progressive-web-apps-ios/)) | Install before importing (Task 9 hand-off); still request persistence and keep CSV export (Tasks 4, 7). |
| Does iOS 26 still need a manifest to install? | iOS 26 opens every Home Screen site as a web app; a manifest still sets name, icons, `standalone`. | Keep the manifest (Task 1). |
| Can an installed iOS PWA download a file? | **No**: anchor `download` links are silently ignored in standalone mode. Web Share with files works (Safari ≥ 15). File input picker works. ([oneminch/deadlines#118](https://github.com/oneminch/deadlines/pull/118), [firt.dev](https://firt.dev/notes/pwa-ios/)) | Export = share sheet first; fallback = copy CSV to clipboard, not a download (Task 7). |
| Is Playwright's "iPhone 13 Mini" the right size? | Its viewport is **375×629** (Safari with its toolbars). An installed app gets the full **375×812**. | Override the viewport to 375×812 in `playwright.config.ts`, keep the device's DPR 3, touch and WebKit (Task 5). |
| vite-plugin-pwa with Vite 8? | 1.3.0 peer-supports `vite ^8`. Icon generator is `@vite-pwa/assets-generator` 2.0 with a `pwa-assets.config.ts` + `minimal2023Preset`. | Task 1 versions and icon step. |

## Open Questions (answer before execution)

1. **Getting `history.csv` onto the phone.** Options: (a) I upload it to your Google Drive (connected here) and you pick it from Files → Google Drive; (b) you email it to yourself; (c) iCloud Drive on this PC. Default: (a).
2. **Weight steps.** Default ±5 lb on the stepper, typing allows any value (52.5 etc.). OK?
3. **Back-dating.** Phase 1 logs to *today* only; past sessions come in via import. OK?

## Global Constraints

- Public repo: no personal data in any tracked file, test, fixture or commit message; fixtures are synthetic and named `*.sample.csv`.
- Target device iPhone 13 mini: 375×812 CSS px; `viewport-fit=cover`; `env(safe-area-inset-*)` padding; tap targets ≥ 44 px; inputs ≥ 16 px font; no horizontal scroll; `100dvh` not `100vh`.
- Standard CSV header, exact: `date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source`; `flags` `;`-separated; RFC 4180 quoting.
- e1RM = Epley `w × (1 + reps/30)`; `reps === 1` → `w`; skipped for weight ≤ 0, reps null, reps > 20, or flags `bodyweight`/`partial`/`warmup`.
- Imports are idempotent (dedupe on `id`).
- Deploy: GitHub Pages from `main`; CI runs `npm test` then `npm run build`; `base: './'`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Fractional weights** (52.5, 27.5 lb) — must survive the stepper, IndexedDB and CSV round-trip unchanged. Pinned: Task 2 CSV test, Task 5 e2e.
2. **Partial / bodyweight sets** (`100x`, `0x15`) — stored, displayed as `100 × ?` / `BW × 15`, never produce an e1RM or break the chart. Pinned: Task 3 stats test.
3. **Name drift** (`"Skullcrushers "`, `cable curl` vs `Cable Curl`) — trimmed, and matched case-insensitively to the existing spelling so history stays unified. Pinned: Task 3 `buildAppSet` test.
4. **Re-importing the same file**, and notes containing commas, quotes or newlines — no duplicates, notes intact. Pinned: Task 2 CSV test, Task 4 db test, Task 7 e2e.
5. **App killed or reloaded mid-workout** — every set already written is there after reload. Pinned: Task 5 e2e.

---

## File Structure

```
.github/workflows/deploy.yml     CI: test → build → Pages
index.html                       iOS meta, viewport-fit=cover
vite.config.ts                   React + PWA + build stamp + vitest config
playwright.config.ts             WebKit iPhone 13 Mini against vite preview
tsconfig.json
public/icon.svg, pwa-*.png, maskable-*.png, apple-touch-icon-180x180.png
src/env.d.ts                     __BUILD_ID__/__BUILT_AT__ declarations
src/privacy.test.ts              fails if a personal-data file is tracked
src/domain/types.ts              SetEntry, Flag, FLAGS, isFlag
src/domain/ids.ts                normalizeName, setId, localDate
src/domain/csv.ts                toCsv, parseCsv, parseRows
src/domain/stats.ts              e1rm, estimateWeightForReps, sessions, lastSession, bestSet, e1rmSeries, currentE1rm, exerciseNames, canonicalName
src/domain/buildSet.ts           buildAppSet (id, setNo, seq, bodyweight flag)
src/domain/format.ts             fmtWeight, fmtSet, fmtDate
src/domain/catalog.ts            generic exercise names for the picker
src/db/db.ts                     IndexedDB access
src/state/useSets.ts             in-memory store + write-through
src/ui/App.tsx, styles.css, main.tsx
src/ui/TodayScreen.tsx, ExerciseCard.tsx, SetForm.tsx, ExercisePicker.tsx
src/ui/HistoryScreen.tsx, LiftsScreen.tsx, ExerciseScreen.tsx, LineChart.tsx
src/ui/DataScreen.tsx
e2e/fixtures/history.sample.csv
e2e/log.spec.ts, e2e/import.spec.ts, e2e/screens.spec.ts
```

---

### Task 1: Scaffold, privacy guard, CI

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/env.d.ts`, `src/main.tsx`, `src/ui/App.tsx` (placeholder shell), `src/privacy.test.ts`, `.github/workflows/deploy.yml`, `public/icon.svg` + generated PNGs

**Interfaces:**
- Produces: `npm test` (vitest), `npm run build`, `npm run e2e`; globals `__BUILD_ID__: string`, `__BUILT_AT__: string`.

- [ ] **Step 1: package.json + install**

```json
{
  "name": "gym-tracker",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview --host",
    "test": "vitest run",
    "e2e": "playwright test"
  }
}
```

Run: `npm i react react-dom idb` then `npm i -D vite @vitejs/plugin-react typescript @types/react @types/react-dom vite-plugin-pwa vitest fake-indexeddb @playwright/test @types/node` then `npx playwright install webkit`.

- [ ] **Step 2: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 3: vite.config.ts**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 7) ?? `dev-${Date.now().toString(36)}`;
const BUILT_AT = new Date().toISOString();

export default defineConfig({
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __BUILT_AT__: JSON.stringify(BUILT_AT),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Gym Tracker',
        short_name: 'Gym',
        description: 'Personal lifting log',
        theme_color: '#0e1116',
        background_color: '#0e1116',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  server: { host: true, port: 5190 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: index.html, env.d.ts, main.tsx, placeholder App**

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0e1116" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Gym" />
    <link rel="icon" href="./icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="./apple-touch-icon-180x180.png" />
    <title>Gym Tracker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/env.d.ts`:
```ts
declare const __BUILD_ID__: string;
declare const __BUILT_AT__: string;
```

`src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/ui/App.tsx` (replaced in Task 5): `export default function App() { return <main>Gym Tracker</main>; }`
`src/ui/styles.css`: empty for now.

- [ ] **Step 5: Icon**

`public/icon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#0e1116"/>
  <g fill="#f5b83d">
    <rect x="96" y="236" width="320" height="40" rx="8"/>
    <rect x="120" y="168" width="44" height="176" rx="12"/>
    <rect x="348" y="168" width="44" height="176" rx="12"/>
    <rect x="72" y="200" width="36" height="112" rx="10"/>
    <rect x="404" y="200" width="36" height="112" rx="10"/>
  </g>
</svg>
```

`pwa-assets.config.ts`:
```ts
import { defineConfig, minimal2023Preset as preset } from '@vite-pwa/assets-generator/config';
export default defineConfig({ preset, images: ['public/icon.svg'] });
```

Run: `npm i -D @vite-pwa/assets-generator && npx pwa-assets-generator`. Expected in `public/`: `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, `favicon.ico`. Read `pwa-512x512.png` and `apple-touch-icon-180x180.png` to confirm they look right.

- [ ] **Step 6: Write the privacy guard test**

`src/privacy.test.ts`:
```ts
import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/** Personal data (history, weight, photos, spreadsheets, backups) must never be tracked in this public repo. */
export const FORBIDDEN = [
  /(^|\/)(data|private|gym-data|exports)\//i,
  /\.(csv|tsv|xlsx?|xlsm|ods|numbers|jpe?g|heic|heif|webp|mov|mp4|sqlite|db)$/i,
  /(^|\/)gym-backup[^/]*\.json$/i,
];
export const ALLOWED = [/\.sample\.csv$/i];

export function violations(paths: string[]): string[] {
  return paths.filter((p) => FORBIDDEN.some((re) => re.test(p)) && !ALLOWED.some((re) => re.test(p)));
}

describe('privacy guard', () => {
  it('flags personal-data paths and allows samples', () => {
    expect(violations(['data/x.json', 'log.csv', 'me.JPG', 'Workout Log.xlsx', 'gym-backup-1.json'])).toHaveLength(5);
    expect(violations(['e2e/fixtures/history.sample.csv', 'public/pwa-192x192.png', 'src/domain/csv.ts'])).toEqual([]);
  });

  it('no tracked file looks like personal data', () => {
    const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(violations(tracked)).toEqual([]);
  });
});
```

- [ ] **Step 7: Run and mutation-check the guard**

Run: `npx vitest run src/privacy.test.ts` → PASS.
Then prove it can fail: `echo x > leak.csv && git add -f leak.csv && npx vitest run src/privacy.test.ts` → FAIL listing `leak.csv`; then `git rm -q --cached leak.csv && rm leak.csv`.

- [ ] **Step 8: CI workflow** — `.github/workflows/deploy.yml` identical to lotus-tracker's except `branches: [main]`.

- [ ] **Step 9: Build and commit**

Run: `npm run build` → succeeds, `dist/manifest.webmanifest` exists.
```bash
git add -A && git commit -m "Scaffold PWA, privacy guard, Pages deploy"
```

---

### Task 2: Domain types, ids, CSV

**Files:**
- Create: `src/domain/types.ts`, `src/domain/ids.ts`, `src/domain/csv.ts`
- Test: `src/domain/csv.test.ts`

**Interfaces:**
- Produces:
  - `FLAGS`, `type Flag`, `isFlag(s: string): s is Flag`, `interface SetEntry`
  - `normalizeName(name: string): string`, `setId(source: string, date: string, exercise: string, setNo: number): string`, `localDate(d: Date): string`
  - `CSV_HEADER`, `toCsv(entries: SetEntry[]): string`, `parseCsv(text: string, defaultSource?: string): { entries: SetEntry[]; errors: CsvError[] }`, `interface CsvError { row: number; message: string }`, `compareEntries(a, b): number`

- [ ] **Step 1: types.ts and ids.ts**

```ts
// src/domain/types.ts
export const FLAGS = ['bodyweight', 'partial', 'unsure', 'pain', 'double_pulley', 'warmup'] as const;
export type Flag = (typeof FLAGS)[number];
export const isFlag = (s: string): s is Flag => (FLAGS as readonly string[]).includes(s);

export interface SetEntry {
  /** Deterministic: `${source}|${date}|${exercise lowercased}|${setNo}` — re-imports overwrite rather than duplicate. */
  id: string;
  date: string; // YYYY-MM-DD, local
  /** Ordering within a date: import row index, or epoch ms for live-logged sets. */
  seq: number;
  loggedAt?: string;
  exercise: string;
  asWritten?: string;
  setNo: number;
  weight: number; // lb, 0 = bodyweight
  reps: number | null; // null = partial / not recorded
  rir?: number;
  flags: Flag[];
  note?: string;
  source: string; // 'app' or an import label
}
```

```ts
// src/domain/ids.ts
export const normalizeName = (name: string): string => name.trim().replace(/\s+/g, ' ');

export const setId = (source: string, date: string, exercise: string, setNo: number): string =>
  `${source}|${date}|${normalizeName(exercise).toLowerCase()}|${setNo}`;

export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
```

- [ ] **Step 2: Write failing CSV tests**

```ts
// src/domain/csv.test.ts
import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv, CSV_HEADER } from './csv';
import type { SetEntry } from './types';

const base: Omit<SetEntry, 'id' | 'setNo' | 'seq'> = {
  date: '2026-01-05', exercise: 'Cable Curl', weight: 60, reps: 12, flags: [], source: 'sample',
};
const mk = (setNo: number, over: Partial<SetEntry> = {}): SetEntry => ({
  ...base, setNo, seq: setNo, id: `sample|2026-01-05|cable curl|${setNo}`, ...over,
});

describe('csv', () => {
  it('writes the exact header', () => {
    expect(toCsv([]).split('\r\n')[0]).toBe(CSV_HEADER.join(','));
  });

  it('round-trips decimals, nulls, flags, rir and awkward notes', () => {
    const entries = [
      mk(1, { weight: 52.5, rir: 2 }),
      mk(2, { reps: null, flags: ['partial', 'unsure'] }),
      mk(3, { weight: 0, reps: 15, flags: ['bodyweight'], note: 'felt "easy", then\nhard', asWritten: 'Cable curls ' }),
    ];
    const { entries: back, errors } = parseCsv(toCsv(entries));
    expect(errors).toEqual([]);
    expect(back.map(({ seq: _s, ...e }) => e)).toEqual(entries.map(({ seq: _s, ...e }) => e));
  });

  it('keeps session order through export', () => {
    const a = mk(1, { exercise: 'Zottman Curl', id: 'x|1', seq: 1 });
    const b = mk(1, { exercise: 'Bench Press', id: 'x|2', seq: 2 });
    const { entries } = parseCsv(toCsv([b, a]));
    expect(entries.map((e) => e.exercise)).toEqual(['Zottman Curl', 'Bench Press']);
  });

  it('reports bad rows with their row number and keeps the good ones', () => {
    const text = [
      CSV_HEADER.join(','),
      '2026-01-05,Cable Curl,,1,60,12,,,,s',
      '01/05/26,Cable Curl,,2,60,12,,,,s',
      '2026-01-05,Cable Curl,,3,sixty,12,,,,s',
      '2026-01-05,Cable Curl,,4,60,12,,sparkly,,s',
      '2026-01-05,,,5,60,12,,,,s',
    ].join('\n');
    const { entries, errors } = parseCsv(text);
    expect(entries).toHaveLength(1);
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5, 6]);
  });

  it('accepts a BOM, LF endings, missing optional columns and defaults the source', () => {
    const text = '\uFEFFdate,exercise,set,weight_lb,reps\n2026-02-01, Lat Pulldown ,1,100,12\n';
    const { entries, errors } = parseCsv(text, 'upload');
    expect(errors).toEqual([]);
    expect(entries[0]).toMatchObject({ exercise: 'Lat Pulldown', source: 'upload', id: 'upload|2026-02-01|lat pulldown|1' });
  });

  it('rejects a file without the required columns', () => {
    const { entries, errors } = parseCsv('foo,bar\n1,2\n');
    expect(entries).toEqual([]);
    expect(errors[0]).toMatchObject({ row: 1 });
  });
});
```

- [ ] **Step 3: Run** `npx vitest run src/domain/csv.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement csv.ts**

```ts
// src/domain/csv.ts
import { normalizeName, setId } from './ids';
import { isFlag, type Flag, type SetEntry } from './types';

export const CSV_HEADER = ['date', 'exercise', 'as_written', 'set', 'weight_lb', 'reps', 'rir', 'flags', 'note', 'source'] as const;
const REQUIRED = ['date', 'exercise', 'set', 'weight_lb', 'reps'];

export interface CsvError { row: number; message: string }

export const compareEntries = (a: SetEntry, b: SetEntry): number =>
  a.date.localeCompare(b.date) || a.seq - b.seq || a.setNo - b.setNo;

const esc = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(entries: SetEntry[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const e of [...entries].sort(compareEntries)) {
    lines.push(
      [e.date, e.exercise, e.asWritten ?? '', String(e.setNo), String(e.weight), e.reps == null ? '' : String(e.reps),
        e.rir == null ? '' : String(e.rir), e.flags.join(';'), e.note ?? '', e.source].map(esc).join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/** RFC 4180 rows; quoted fields may contain commas, quotes ("") and newlines. */
export function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const num = (s: string): number | null => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));

export function parseCsv(text: string, defaultSource = 'import'): { entries: SetEntry[]; errors: CsvError[] } {
  const rows = parseRows(text.replace(/^\uFEFF/, ''));
  const errors: CsvError[] = [];
  const entries: SetEntry[] = [];
  if (rows.length === 0) return { entries, errors: [{ row: 1, message: 'Empty file' }] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) return { entries, errors: [{ row: 1, message: `Missing columns: ${missing.join(', ')}` }] };
  const col = (r: string[], name: string) => { const i = header.indexOf(name); return i < 0 ? '' : (r[i] ?? ''); };

  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    if (r.every((f) => f.trim() === '')) return;
    const fail = (message: string) => errors.push({ row: rowNo, message });
    const date = col(r, 'date').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(`Bad date "${date}" (want YYYY-MM-DD)`);
    const exercise = normalizeName(col(r, 'exercise'));
    if (!exercise) return fail('Missing exercise');
    const setNo = num(col(r, 'set'));
    if (setNo == null || !Number.isInteger(setNo) || setNo < 1) return fail(`Bad set number "${col(r, 'set')}"`);
    const weight = num(col(r, 'weight_lb'));
    if (weight == null || weight < 0) return fail(`Bad weight "${col(r, 'weight_lb')}"`);
    const repsRaw = col(r, 'reps');
    const reps = repsRaw.trim() === '' ? null : num(repsRaw);
    if (repsRaw.trim() !== '' && (reps == null || !Number.isInteger(reps) || reps < 0)) return fail(`Bad reps "${repsRaw}"`);
    const rirRaw = col(r, 'rir');
    const rir = rirRaw.trim() === '' ? undefined : num(rirRaw);
    if (rir === null || (rir !== undefined && (rir < 0 || rir > 10))) return fail(`Bad RIR "${rirRaw}"`);
    const flagParts = col(r, 'flags').split(';').map((f) => f.trim()).filter(Boolean);
    const bad = flagParts.filter((f) => !isFlag(f));
    if (bad.length) return fail(`Unknown flag "${bad.join(';')}"`);
    const source = col(r, 'source').trim() || defaultSource;
    const asWritten = col(r, 'as_written');
    const note = col(r, 'note');
    entries.push({
      id: setId(source, date, exercise, setNo),
      date, seq: i, exercise, setNo, weight, reps, source,
      flags: flagParts as Flag[],
      ...(rir !== undefined && { rir }),
      ...(asWritten !== '' && { asWritten }),
      ...(note !== '' && { note }),
    });
  });
  return { entries, errors };
}
```

Note: `seq` on import is the row index, so `toCsv` (sorted by date, seq) preserves the original order within a day; live sets use epoch ms and so sort after same-day imports.

- [ ] **Step 5: Run** `npx vitest run src/domain/csv.test.ts` → PASS.

- [ ] **Step 6: Commit** `git add src/domain && git commit -m "Domain types and standard CSV"`

---

### Task 3: Stats, set building, formatting

**Files:**
- Create: `src/domain/stats.ts`, `src/domain/buildSet.ts`, `src/domain/format.ts`, `src/domain/catalog.ts`
- Test: `src/domain/stats.test.ts`

**Interfaces:**
- Consumes: `SetEntry`, `Flag`, `setId`, `normalizeName` (Task 2)
- Produces:
  - `e1rm(s: SetEntry): number | null`; `estimateWeightForReps(e1: number, reps: number): number`
  - `interface Session { date: string; sets: SetEntry[] }`
  - `sessionsFor(entries, exercise): Session[]` (newest first; sets by setNo)
  - `sessionsByDate(entries): Session[]` (newest first; sets by seq, setNo)
  - `lastSession(entries, exercise, beforeDate): Session | null`
  - `bestSet(entries, exercise): { set: SetEntry; e1rm: number } | null`
  - `interface SeriesPoint { date: string; e1rm: number; pr: boolean }`; `e1rmSeries(entries, exercise): SeriesPoint[]` (oldest first); `currentE1rm(series): number | null` (max of last 3 points)
  - `exerciseNames(entries): string[]` (most recently used first); `canonicalName(entries, name): string`; `sameExercise(a, b): boolean`
  - `interface NewSetInput { date: string; exercise: string; weight: number; reps: number | null; rir?: number; flags: Flag[]; note?: string }`; `buildAppSet(existing: SetEntry[], input: NewSetInput, now: Date): SetEntry`
  - `fmtWeight(w: number): string`, `fmtSet(s: SetEntry): string`, `fmtDate(iso: string): string`
  - `CATALOG: string[]`

- [ ] **Step 1: Write failing tests**

```ts
// src/domain/stats.test.ts
import { describe, expect, it } from 'vitest';
import type { SetEntry } from './types';
import { bestSet, canonicalName, currentE1rm, e1rm, e1rmSeries, estimateWeightForReps, exerciseNames, lastSession, sessionsByDate, sessionsFor } from './stats';
import { buildAppSet } from './buildSet';
import { fmtSet, fmtWeight } from './format';

let seq = 0;
const s = (date: string, exercise: string, setNo: number, weight: number, reps: number | null, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `t|${date}|${exercise.toLowerCase()}|${setNo}`, date, seq: seq++, exercise, setNo, weight, reps, flags: [], source: 't', ...over,
});

describe('e1rm', () => {
  it('uses Epley, and w for a single', () => {
    expect(e1rm(s('2026-01-01', 'Bench', 1, 100, 10))).toBeCloseTo(133.33, 1);
    expect(e1rm(s('2026-01-01', 'Bench', 1, 100, 1))).toBe(100);
  });
  it('skips bodyweight, partial, warmup, zero weight and >20 reps', () => {
    expect(e1rm(s('d', 'x', 1, 0, 15, { flags: ['bodyweight'] }))).toBeNull();
    expect(e1rm(s('d', 'x', 1, 100, null, { flags: ['partial'] }))).toBeNull();
    expect(e1rm(s('d', 'x', 1, 100, 10, { flags: ['warmup'] }))).toBeNull();
    expect(e1rm(s('d', 'x', 1, 50, 25))).toBeNull();
  });
  it('inverts for an N-rep weight', () => {
    expect(estimateWeightForReps(120, 6)).toBeCloseTo(100, 5);
    expect(estimateWeightForReps(120, 1)).toBe(120);
  });
});

describe('sessions', () => {
  const data = [
    s('2026-01-01', 'Curl', 1, 25, 12), s('2026-01-01', 'Curl', 2, 30, 8),
    s('2026-01-08', 'curl ', 1, 30, 10), s('2026-01-08', 'Bench', 1, 100, 8),
    s('2026-01-15', 'Curl', 1, 30, null, { flags: ['partial'] }),
  ];
  it('groups by exercise case-insensitively, newest first', () => {
    expect(sessionsFor(data, 'CURL').map((x) => x.date)).toEqual(['2026-01-15', '2026-01-08', '2026-01-01']);
  });
  it('finds the last session strictly before a date', () => {
    expect(lastSession(data, 'Curl', '2026-01-08')?.date).toBe('2026-01-01');
    expect(lastSession(data, 'Curl', '2026-01-01')).toBeNull();
  });
  it('picks the best set by e1RM, ignoring partials', () => {
    expect(bestSet(data, 'Curl')?.set).toMatchObject({ date: '2026-01-08', weight: 30, reps: 10 });
  });
  it('builds a series with PR markers and skips e1RM-less days', () => {
    const series = e1rmSeries(data, 'Curl');
    expect(series.map((p) => [p.date, p.pr])).toEqual([['2026-01-01', true], ['2026-01-08', true]]);
    expect(currentE1rm(series)).toBeCloseTo(40, 5);
    expect(currentE1rm([])).toBeNull();
  });
  it('lists exercise names most-recent first with one spelling each', () => {
    expect(exerciseNames(data)).toEqual(['Curl', 'Bench']);
  });
  it('groups all sets by date', () => {
    expect(sessionsByDate(data).map((x) => [x.date, x.sets.length])).toEqual([['2026-01-15', 1], ['2026-01-08', 2], ['2026-01-01', 2]]);
  });
});

describe('buildAppSet', () => {
  const existing = [s('2026-02-01', 'Cable Curl', 1, 60, 12, { source: 'app', id: 'app|2026-02-01|cable curl|1' })];
  const now = new Date('2026-02-01T20:00:00Z');
  it('reuses the existing spelling, trims, and numbers the next set', () => {
    const e = buildAppSet(existing, { date: '2026-02-01', exercise: '  cable   curl ', weight: 52.5, reps: 10, flags: [] }, now);
    expect(e).toMatchObject({ exercise: 'Cable Curl', setNo: 2, id: 'app|2026-02-01|cable curl|2', weight: 52.5, source: 'app', seq: now.getTime() });
    expect(canonicalName(existing, 'CABLE CURL')).toBe('Cable Curl');
    expect(canonicalName(existing, 'New Thing ')).toBe('New Thing');
  });
  it('flags zero weight as bodyweight', () => {
    expect(buildAppSet([], { date: '2026-02-01', exercise: 'Pull-up', weight: 0, reps: 8, flags: [] }, now).flags).toEqual(['bodyweight']);
  });
});

describe('format', () => {
  it('formats weights and sets', () => {
    expect(fmtWeight(52.5)).toBe('52.5');
    expect(fmtWeight(60)).toBe('60');
    expect(fmtSet(s('d', 'x', 1, 0, 15))).toBe('BW × 15');
    expect(fmtSet(s('d', 'x', 1, 100, null))).toBe('100 × ?');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/domain/stats.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/domain/stats.ts
import { normalizeName } from './ids';
import type { SetEntry } from './types';

const key = (name: string) => normalizeName(name).toLowerCase();
export const sameExercise = (a: string, b: string) => key(a) === key(b);

export function e1rm(s: SetEntry): number | null {
  if (s.weight <= 0 || s.reps == null || s.reps < 1 || s.reps > 20) return null;
  if (s.flags.some((f) => f === 'bodyweight' || f === 'partial' || f === 'warmup')) return null;
  return s.reps === 1 ? s.weight : s.weight * (1 + s.reps / 30);
}

export const estimateWeightForReps = (e1: number, reps: number): number => (reps <= 1 ? e1 : e1 / (1 + reps / 30));

export interface Session { date: string; sets: SetEntry[] }

function group(entries: SetEntry[]): Session[] {
  const by = new Map<string, SetEntry[]>();
  for (const e of entries) (by.get(e.date) ?? by.set(e.date, []).get(e.date)!).push(e);
  return [...by.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, sets]) => ({ date, sets }));
}

export const sessionsFor = (entries: SetEntry[], exercise: string): Session[] =>
  group(entries.filter((e) => sameExercise(e.exercise, exercise))).map((x) => ({ ...x, sets: [...x.sets].sort((a, b) => a.setNo - b.setNo) }));

export const sessionsByDate = (entries: SetEntry[]): Session[] =>
  group(entries).map((x) => ({ ...x, sets: [...x.sets].sort((a, b) => a.seq - b.seq || a.setNo - b.setNo) }));

export const lastSession = (entries: SetEntry[], exercise: string, beforeDate: string): Session | null =>
  sessionsFor(entries, exercise).find((x) => x.date < beforeDate) ?? null;

export function bestSet(entries: SetEntry[], exercise: string): { set: SetEntry; e1rm: number } | null {
  let best: { set: SetEntry; e1rm: number } | null = null;
  for (const e of entries) {
    if (!sameExercise(e.exercise, exercise)) continue;
    const v = e1rm(e);
    if (v != null && (!best || v > best.e1rm)) best = { set: e, e1rm: v };
  }
  return best;
}

export interface SeriesPoint { date: string; e1rm: number; pr: boolean }

export function e1rmSeries(entries: SetEntry[], exercise: string): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let top = -Infinity;
  for (const x of [...sessionsFor(entries, exercise)].reverse()) {
    const vals = x.sets.map(e1rm).filter((v): v is number => v != null);
    if (!vals.length) continue;
    const v = Math.max(...vals);
    out.push({ date: x.date, e1rm: v, pr: v > top });
    top = Math.max(top, v);
  }
  return out;
}

export const currentE1rm = (series: SeriesPoint[]): number | null =>
  series.length ? Math.max(...series.slice(-3).map((p) => p.e1rm)) : null;

/** One display spelling per exercise (the most recent), most recently used first. */
export function exerciseNames(entries: SetEntry[]): string[] {
  const latest = new Map<string, SetEntry>();
  for (const e of entries) {
    const k = key(e.exercise);
    const cur = latest.get(k);
    if (!cur || e.date > cur.date || (e.date === cur.date && e.seq > cur.seq)) latest.set(k, e);
  }
  return [...latest.values()].sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq).map((e) => normalizeName(e.exercise));
}

export const canonicalName = (entries: SetEntry[], name: string): string =>
  exerciseNames(entries).find((n) => sameExercise(n, name)) ?? normalizeName(name);
```

```ts
// src/domain/buildSet.ts
import { setId } from './ids';
import { canonicalName, sameExercise } from './stats';
import type { Flag, SetEntry } from './types';

export interface NewSetInput { date: string; exercise: string; weight: number; reps: number | null; rir?: number; flags: Flag[]; note?: string }

export function buildAppSet(existing: SetEntry[], input: NewSetInput, now: Date): SetEntry {
  const exercise = canonicalName(existing, input.exercise);
  const setNo = 1 + Math.max(0, ...existing.filter((e) => e.date === input.date && sameExercise(e.exercise, exercise)).map((e) => e.setNo));
  const flags: Flag[] = input.weight === 0 && !input.flags.includes('bodyweight') ? ['bodyweight', ...input.flags] : [...input.flags];
  return {
    id: setId('app', input.date, exercise, setNo),
    date: input.date, seq: now.getTime(), loggedAt: now.toISOString(),
    exercise, setNo, weight: input.weight, reps: input.reps, flags, source: 'app',
    ...(input.rir !== undefined && { rir: input.rir }),
    ...(input.note?.trim() && { note: input.note.trim() }),
  };
}
```

```ts
// src/domain/format.ts
import type { SetEntry } from './types';

export const fmtWeight = (w: number): string => String(Math.round(w * 100) / 100);
export const fmtSet = (s: SetEntry): string => `${s.weight === 0 ? 'BW' : fmtWeight(s.weight)} × ${s.reps ?? '?'}`;
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
```

```ts
// src/domain/catalog.ts — generic exercise names offered by the picker (no user data).
export const CATALOG: string[] = [
  // Chest
  'Bench Press', 'Incline Bench Press', 'Smith Incline Press', 'Smith Flat Press', 'Incline DB Press', 'Flat DB Press',
  'Machine Chest Press', 'Machine Chest Fly', 'Cable Chest Fly', 'Low-to-High Cable Fly', 'Forward-Lean Dips', 'Push-up', 'Weighted Push-up',
  // Triceps
  'Cable Pushdown', 'Rope Pushdown', 'Overhead Cable Extension', 'Overhead DB Triceps Extension', 'Skullcrusher', 'Close-Grip Bench Press',
  'DB Kickback', 'Cable Kickback', 'Triceps Press Machine', 'Upright Dips',
  // Biceps / forearms
  'DB Curl', 'Incline DB Curl', 'Hammer Curl', 'Cable Curl', 'Bayesian Cable Curl', 'Preacher Curl', 'Cross-Body DB Curl',
  'Machine Biceps Curl', 'Reverse Curl', 'Wrist Curl', 'Farmer’s Carry', 'Plate Pinch Hold',
  // Shoulders
  'Overhead Press', 'Machine Shoulder Press', 'Arnold Press', 'DB Lateral Raise', 'Cable Lateral Raise', 'Machine Lateral Raise',
  'Front Raise', 'Face Pull', 'Cable Rear Delt Fly', 'Reverse Pec Deck',
  // Back
  'Lat Pulldown', 'Close-Grip Lat Pulldown', 'Lat Pull-In', 'Pull-up', 'Chin-up', 'Seated Cable Row', 'Machine Row',
  'Chest-Supported Row', 'Kneeling DB Row', 'Archer Pull', 'Straight-Arm Pulldown',
  // Abs / core / back health
  'Cable Crunch', 'Ab Crunch Machine', 'Decline Sit-up', 'Hanging Leg Raise', 'Supported Leg Raise', 'Torso Rotation Machine',
  'Plank', 'Side Plank', 'Bird Dog', 'McGill Curl-Up', 'Dead Bug', 'Back Extension', 'Pallof Press',
  // Legs
  'Leg Press', 'Leg Extension', 'Seated Leg Curl', 'Lying Leg Curl', 'Romanian Deadlift', 'DB Romanian Deadlift', 'Barbell Squat',
  'Smith Squat', 'Bulgarian Split Squat', 'Hip Thrust', 'Glute Press', 'Hip Adduction Machine', 'Hip Abduction Machine',
  'Standing Calf Raise', 'Seated Calf Raise',
];
```

- [ ] **Step 4: Run** `npx vitest run src/domain` → PASS.
- [ ] **Step 5: Commit** `git add src/domain && git commit -m "Stats, set building, formatting"`

---

### Task 4: IndexedDB layer and useSets

**Files:**
- Create: `src/db/db.ts`, `src/state/useSets.ts`
- Test: `src/db/db.test.ts`

**Interfaces:**
- Consumes: `SetEntry` (Task 2), `buildAppSet`, `NewSetInput` (Task 3)
- Produces:
  - `getAllSets(): Promise<SetEntry[]>`, `putSet(e: SetEntry): Promise<void>`, `deleteSet(id: string): Promise<void>`, `putMany(entries: SetEntry[]): Promise<{ added: number; updated: number }>`, `requestPersistence(): Promise<boolean | null>`, `resetDbForTests(): void`
  - `useSets(): { entries: SetEntry[]; loading: boolean; error: string | null; add(input: NewSetInput): Promise<SetEntry | null>; update(e: SetEntry): Promise<boolean>; remove(id: string): Promise<boolean>; importEntries(list: SetEntry[]): Promise<{ added: number; updated: number }> }`

- [ ] **Step 1: Failing test**

```ts
// src/db/db.test.ts
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteSet, getAllSets, putMany, putSet, resetDbForTests } from './db';
import { parseCsv } from '../domain/csv';

const CSV = 'date,exercise,set,weight_lb,reps,note,source\n2026-01-05,Cable Curl,1,52.5,12,"a, ""b""",s\n2026-01-05,Cable Curl,2,60,,,s\n';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetDbForTests(); });

describe('db', () => {
  it('imports idempotently and preserves values', async () => {
    const { entries } = parseCsv(CSV);
    expect(await putMany(entries)).toEqual({ added: 2, updated: 0 });
    expect(await putMany(entries)).toEqual({ added: 0, updated: 2 });
    const all = await getAllSets();
    expect(all).toHaveLength(2);
    expect(all.find((e) => e.setNo === 1)).toMatchObject({ weight: 52.5, note: 'a, "b"' });
    expect(all.find((e) => e.setNo === 2)?.reps).toBeNull();
  });
  it('puts and deletes single sets', async () => {
    const [e] = parseCsv(CSV).entries;
    await putSet(e);
    await deleteSet(e.id);
    expect(await getAllSets()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/db` → FAIL.

- [ ] **Step 3: Implement db.ts**

```ts
// src/db/db.ts
import { openDB, type IDBPDatabase } from 'idb';
import type { SetEntry } from '../domain/types';

const STORE = 'sets';
let dbp: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  return (dbp ??= openDB('gym-tracker', 1, {
    upgrade(d) {
      d.createObjectStore(STORE, { keyPath: 'id' }).createIndex('date', 'date');
    },
  }));
}

export const resetDbForTests = () => { dbp = null; };
export const getAllSets = async (): Promise<SetEntry[]> => (await db()).getAll(STORE);
export const putSet = async (e: SetEntry): Promise<void> => { await (await db()).put(STORE, e); };
export const deleteSet = async (id: string): Promise<void> => { await (await db()).delete(STORE, id); };

export async function putMany(entries: SetEntry[]): Promise<{ added: number; updated: number }> {
  const tx = (await db()).transaction(STORE, 'readwrite');
  const existing = new Set((await tx.store.getAllKeys()) as string[]);
  let added = 0;
  for (const e of entries) { if (!existing.has(e.id)) added++; existing.add(e.id); void tx.store.put(e); }
  await tx.done;
  return { added, updated: entries.length - added };
}

export async function requestPersistence(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  return (await navigator.storage.persisted()) || navigator.storage.persist();
}
```

Note: within one file, duplicate ids count once as added (the second becomes an update) — `existing.add` handles that.

- [ ] **Step 4: Implement useSets.ts**

```ts
// src/state/useSets.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteSet, getAllSets, putMany, putSet } from '../db/db';
import { buildAppSet, type NewSetInput } from '../domain/buildSet';
import type { SetEntry } from '../domain/types';

export function useSets() {
  const [entries, setEntries] = useState<SetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef(entries);
  ref.current = entries;

  const reload = useCallback(async () => {
    try { setEntries(await getAllSets()); setError(null); }
    catch (e) { setError(`Could not read saved sets: ${String(e)}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const fail = (what: string, e: unknown) => { setError(`${what} failed — nothing was lost from the form. ${String(e)}`); };

  const add = useCallback(async (input: NewSetInput): Promise<SetEntry | null> => {
    const e = buildAppSet(ref.current, input, new Date());
    try { await putSet(e); } catch (err) { fail('Saving the set', err); return null; }
    setEntries((xs) => [...xs.filter((x) => x.id !== e.id), e]);
    setError(null);
    return e;
  }, []);

  const update = useCallback(async (e: SetEntry): Promise<boolean> => {
    try { await putSet(e); } catch (err) { fail('Saving the change', err); return false; }
    setEntries((xs) => xs.map((x) => (x.id === e.id ? e : x)));
    return true;
  }, []);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try { await deleteSet(id); } catch (err) { fail('Deleting', err); return false; }
    setEntries((xs) => xs.filter((x) => x.id !== id));
    return true;
  }, []);

  const importEntries = useCallback(async (list: SetEntry[]) => {
    const result = await putMany(list);
    await reload();
    return result;
  }, [reload]);

  return { entries, loading, error, add, update, remove, importEntries };
}
export type SetsStore = ReturnType<typeof useSets>;
```

- [ ] **Step 5: Run** `npx vitest run` → PASS (all).
- [ ] **Step 6: Commit** `git add src && git commit -m "IndexedDB storage and useSets store"`

---

### Task 5: App shell and Today logging

**Files:**
- Create: `src/ui/App.tsx` (replace), `src/ui/styles.css`, `src/ui/TodayScreen.tsx`, `src/ui/ExerciseCard.tsx`, `src/ui/SetForm.tsx`, `src/ui/ExercisePicker.tsx`, `playwright.config.ts`, `e2e/log.spec.ts`
- Modify: `src/main.tsx` (call `requestPersistence()` once on load)

**Interfaces:**
- Consumes: `SetsStore` (Task 4); `lastSession`, `bestSet`, `exerciseNames`, `sameExercise` (Task 3); `fmtSet`, `fmtWeight`, `fmtDate`; `CATALOG`; `localDate`
- Produces: `App` with tabs `today | history | lifts | data`; `openExercise(name: string)` callback prop passed to screens; accessible names used by e2e: button "Add exercise", searchbox "Search exercises", button `Add “<name>”`, textbox "Weight", textbox "Reps", button "Add set", list "Sets for <exercise>".

- [ ] **Step 1: playwright.config.ts**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  // The device profile's 375×629 is Safari-with-toolbars; the installed app gets the full 375×812.
  use: { ...devices['iPhone 13 Mini'], viewport: { width: 375, height: 812 }, baseURL: 'http://localhost:4190/' },
  webServer: { command: 'npm run build && npx vite preview --port 4190 --strictPort', url: 'http://localhost:4190/', reuseExistingServer: false, timeout: 180_000 },
});
```

- [ ] **Step 2: Failing e2e**

```ts
// e2e/log.spec.ts
import { expect, test } from '@playwright/test';

test('log sets on today, survive a reload, no horizontal scroll', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Zercher Curl');
  await page.getByRole('button', { name: 'Add “Zercher Curl”' }).click();

  await page.getByRole('textbox', { name: 'Weight' }).fill('52.5');
  await page.getByRole('textbox', { name: 'Reps' }).fill('12');
  await page.getByRole('button', { name: 'Add set' }).click();
  await page.getByRole('textbox', { name: 'Reps' }).fill('10');
  await page.getByRole('button', { name: 'Add set' }).click();

  const sets = page.getByRole('list', { name: 'Sets for Zercher Curl' });
  await expect(sets.getByRole('listitem')).toHaveText([/52\.5 × 12/, /52\.5 × 10/]);

  await page.reload();
  await expect(page.getByRole('list', { name: 'Sets for Zercher Curl' }).getByRole('listitem')).toHaveCount(2);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
```

Run: `npx playwright test e2e/log.spec.ts` → FAIL (no "Add exercise").

- [ ] **Step 3: styles.css**

```css
:root {
  --sat: env(safe-area-inset-top, 0px);
  --sab: env(safe-area-inset-bottom, 0px);
  --bg: #0e1116; --surface: #171b22; --surface-2: #212733; --line: #2c3442;
  --text: #e9edf3; --muted: #9aa5b4; --accent: #f5b83d; --accent-ink: #1a1305;
  --danger: #ef6b6b; --warn: #f0a24a; --pain: #ef6b6b; --ok: #5fcf8f;
  color-scheme: dark;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
  -webkit-text-size-adjust: 100%;
}
*, *::before, *::after { box-sizing: border-box; min-width: 0; }
html, body { margin: 0; background: var(--bg); color: var(--text); overflow-x: hidden; }
body { -webkit-tap-highlight-color: transparent; overscroll-behavior-y: none; }
h1 { font-size: 22px; margin: 4px 0 12px; }
p { margin: 6px 0; }
.muted { color: var(--muted); }
.small { font-size: 13px; }
.warn { color: var(--warn); }

.app { min-height: 100dvh; display: flex; flex-direction: column; }
.screen { flex: 1; padding: calc(var(--sat) + 12px) 16px calc(var(--sab) + 84px); }
.banner { position: sticky; top: 0; z-index: 5; padding: calc(var(--sat) + 8px) 16px 8px; background: var(--danger); color: #fff; font-weight: 600; }

.tabs {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 4;
  display: grid; grid-template-columns: repeat(4, 1fr);
  padding-bottom: var(--sab); background: rgba(14, 17, 22, 0.94);
  border-top: 1px solid var(--line); backdrop-filter: blur(12px);
}
.tabs button { min-height: 56px; background: none; border: 0; color: var(--muted); font-size: 15px; font-weight: 600; }
.tabs button[aria-current='page'] { color: var(--accent); }

button, .button {
  min-height: 44px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--line);
  background: var(--surface-2); color: var(--text); font: inherit; font-size: 16px; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer;
}
button:disabled { opacity: 0.45; }
.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.danger { color: var(--danger); }
.wide { width: 100%; margin-top: 12px; }
.link { background: none; border: 0; padding: 0; color: var(--text); font-size: 18px; font-weight: 700; justify-content: flex-start; text-align: left; }

input, select, textarea {
  font: inherit; font-size: 16px; min-height: 44px; width: 100%; padding: 0 12px;
  border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--text);
}
input:focus { outline: 2px solid var(--accent); outline-offset: 0; }

.card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 12px; margin-bottom: 12px; }
.card-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 8px; }
.card-head .muted { font-size: 13px; }

.sets { list-style: none; margin: 8px 0; padding: 0; display: grid; gap: 6px; }
.set-row {
  width: 100%; justify-content: flex-start; flex-wrap: wrap; text-align: left; font-weight: 500;
  background: var(--bg); padding: 8px 12px; min-height: 44px;
}
.set-no { color: var(--muted); width: 1.5em; }
.tag { font-size: 12px; padding: 2px 6px; border-radius: 6px; background: var(--surface-2); color: var(--muted); }
.tag.pain { color: var(--pain); }
.tag.unsure, .tag.partial { color: var(--warn); }
.note { flex-basis: 100%; font-size: 13px; color: var(--muted); padding-left: 1.5em; overflow-wrap: anywhere; }

.set-form { display: grid; gap: 10px; margin-top: 8px; }
.steppers { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.stepper { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
.stepper > div { display: grid; grid-template-columns: 44px 1fr 44px; gap: 4px; }
.stepper input { text-align: center; font-size: 20px; font-weight: 700; padding: 0 4px; }
.stepper button { padding: 0; font-size: 22px; }
.chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 44px; }
.chip-label { font-size: 13px; color: var(--muted); margin-right: 2px; }
.chip { min-height: 36px; padding: 0 12px; border-radius: 18px; font-size: 14px; font-weight: 600; }
.chip[aria-pressed='true'] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.form-actions { display: flex; gap: 8px; }
.form-actions .primary { flex: 1; }

.picker-head { display: grid; grid-template-columns: 1fr auto; gap: 8px; position: sticky; top: 0; padding-top: 4px; background: var(--bg); z-index: 2; }
.picker-list { list-style: none; padding: 0; margin: 12px 0 0; display: grid; gap: 6px; }
.picker-list button { width: 100%; justify-content: flex-start; text-align: left; font-weight: 500; }

.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
.tile { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
.tile b { display: block; font-size: 22px; }
.tile span { font-size: 12px; color: var(--muted); }

.chart { display: block; }
.chart .axis { stroke: var(--line); }
.chart .lbl { fill: var(--muted); font-size: 11px; }
.chart .line { stroke: var(--accent); stroke-width: 2.5; stroke-linejoin: round; }
.chart .pt { fill: var(--surface); stroke: var(--accent); stroke-width: 2; }
.chart .pt.pr { fill: var(--accent); }

details.day { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; margin-bottom: 10px; }
details.day > summary { min-height: 48px; padding: 12px; font-weight: 600; list-style: none; cursor: pointer; }
details.day > summary::-webkit-details-marker { display: none; }
.day-body { padding: 0 12px 12px; display: grid; gap: 6px; }
.row-button { width: 100%; flex-direction: column; align-items: flex-start; text-align: left; padding: 8px 12px; font-weight: 500; }
.row-button b { font-weight: 700; }
.row-button .muted { font-size: 13px; }

.errors { font-size: 13px; color: var(--warn); padding-left: 18px; }
textarea.csv { min-height: 160px; padding: 8px; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
```

- [ ] **Step 4: SetForm.tsx**

```tsx
import { useState } from 'react';
import type { Flag } from '../domain/types';

export interface SetFormValue { weight: number; reps: number | null; rir?: number; flags: Flag[]; note?: string }
const TOGGLES: [Flag, string][] = [['pain', 'Pain'], ['unsure', 'Unsure'], ['warmup', 'Warm-up'], ['double_pulley', '2× pulley']];

function Stepper({ label, value, onChange, step, mode }: { label: string; value: string; onChange: (v: string) => void; step: number; mode: 'decimal' | 'numeric' }) {
  const bump = (d: number) => { const n = Number(value) || 0; onChange(String(Math.max(0, Math.round((n + d) * 100) / 100))); };
  return (
    <label className="stepper">
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`${label} down`} onClick={() => bump(-step)}>−</button>
        <input aria-label={label} inputMode={mode} value={value} onChange={(e) => onChange(e.target.value.replace(',', '.'))} />
        <button type="button" aria-label={`${label} up`} onClick={() => bump(step)}>+</button>
      </div>
    </label>
  );
}

export function SetForm({ initial, submitLabel, onSubmit, onDelete, onCancel }: {
  initial: SetFormValue; submitLabel: string;
  onSubmit: (v: SetFormValue) => Promise<boolean>; onDelete?: () => void; onCancel?: () => void;
}) {
  const [weight, setWeight] = useState(String(initial.weight));
  const [reps, setReps] = useState(initial.reps == null ? '' : String(initial.reps));
  const [rir, setRir] = useState<number | undefined>(initial.rir);
  const [flags, setFlags] = useState<Flag[]>(initial.flags.filter((f) => f !== 'bodyweight'));
  const [note, setNote] = useState(initial.note ?? '');
  const w = Number(weight);
  const r = reps.trim() === '' ? null : Number(reps);
  const valid = weight.trim() !== '' && Number.isFinite(w) && w >= 0 && (r === null || (Number.isInteger(r) && r >= 0 && r < 1000));

  async function submit() {
    if (!valid) return;
    const ok = await onSubmit({ weight: w, reps: r, rir, flags: r === null && !flags.includes('partial') ? [...flags, 'partial'] : flags, note: note.trim() || undefined });
    if (ok) { setNote(''); setFlags((f) => f.filter((x) => x === 'double_pulley')); setRir(undefined); }
  }

  return (
    <form className="set-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="steppers">
        <Stepper label="Weight" value={weight} onChange={setWeight} step={5} mode="decimal" />
        <Stepper label="Reps" value={reps} onChange={setReps} step={1} mode="numeric" />
      </div>
      <div className="chips" role="group" aria-label="RIR">
        <span className="chip-label">RIR</span>
        {[0, 1, 2, 3, 4].map((n) => (
          <button type="button" key={n} className="chip" aria-pressed={rir === n} onClick={() => setRir(rir === n ? undefined : n)}>{n === 4 ? '4+' : n}</button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="Flags">
        {TOGGLES.map(([f, label]) => (
          <button type="button" key={f} className="chip" aria-pressed={flags.includes(f)} onClick={() => setFlags(flags.includes(f) ? flags.filter((x) => x !== f) : [...flags, f])}>{label}</button>
        ))}
      </div>
      <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="form-actions">
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
        {onDelete && <button type="button" className="danger" onClick={onDelete}>Delete</button>}
        <button type="submit" className="primary" disabled={!valid}>{submitLabel}</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: ExerciseCard.tsx**

```tsx
import { useState } from 'react';
import type { SetsStore } from '../state/useSets';
import { bestSet, lastSession, sameExercise } from '../domain/stats';
import { fmtDate, fmtSet, fmtWeight } from '../domain/format';
import type { SetEntry } from '../domain/types';
import { SetForm, type SetFormValue } from './SetForm';

export function ExerciseCard({ exercise, date, store, onOpen }: { exercise: string; date: string; store: SetsStore; onOpen: (name: string) => void }) {
  const [editing, setEditing] = useState<SetEntry | null>(null);
  const today = store.entries.filter((e) => e.date === date && sameExercise(e.exercise, exercise)).sort((a, b) => a.setNo - b.setNo);
  const last = lastSession(store.entries, exercise, date);
  const best = bestSet(store.entries, exercise);
  const seed = today.at(-1) ?? last?.sets[0];
  const initial: SetFormValue = { weight: seed?.weight ?? 0, reps: seed?.reps ?? 10, flags: seed?.flags.includes('double_pulley') ? ['double_pulley'] : [] };

  return (
    <section className="card">
      <header className="card-head">
        <button className="link" onClick={() => onOpen(exercise)}>{exercise}</button>
        {best && <span className="muted">Best {fmtSet(best.set)} · e1RM {fmtWeight(Math.round(best.e1rm))}</span>}
      </header>
      {last && <p className="muted">Last ({fmtDate(last.date)}): {last.sets.map(fmtSet).join(' · ')}</p>}
      <ol className="sets" aria-label={`Sets for ${exercise}`}>
        {today.map((s) => (
          <li key={s.id}>
            <button className="set-row" onClick={() => setEditing(s)}>
              <span className="set-no">{s.setNo}</span>
              <span>{fmtSet(s)}</span>
              {s.rir != null && <span className="tag">RIR {s.rir}</span>}
              {s.flags.filter((f) => f !== 'bodyweight').map((f) => <span key={f} className={`tag ${f}`}>{f.replace('_', ' ')}</span>)}
              {s.note && <span className="note">{s.note}</span>}
            </button>
          </li>
        ))}
      </ol>
      {editing ? (
        <SetForm key={editing.id} initial={editing} submitLabel="Save"
          onCancel={() => setEditing(null)}
          onDelete={async () => { if (confirm(`Delete set ${editing.setNo}?`) && (await store.remove(editing.id))) setEditing(null); }}
          onSubmit={async (v) => { const ok = await store.update({ ...editing, ...v, flags: v.weight === 0 ? ['bodyweight', ...v.flags] : v.flags }); if (ok) setEditing(null); return ok; }} />
      ) : (
        <SetForm key={`new-${today.length}`} initial={initial} submitLabel="Add set"
          onSubmit={async (v) => (await store.add({ date, exercise, ...v })) != null} />
      )}
    </section>
  );
}
```

(The `key` on the add form resets it after each set so it re-seeds from the set just logged.)

- [ ] **Step 6: ExercisePicker.tsx**

```tsx
import { useState } from 'react';
import { CATALOG } from '../domain/catalog';
import { normalizeName } from '../domain/ids';
import { sameExercise } from '../domain/stats';

export function ExercisePicker({ recent, onPick, onCancel }: { recent: string[]; onPick: (name: string) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const query = normalizeName(q);
  const all = [...recent, ...CATALOG.filter((c) => !recent.some((r) => sameExercise(r, c)))];
  const matches = query ? all.filter((n) => n.toLowerCase().includes(query.toLowerCase())) : all;
  const exact = matches.some((n) => sameExercise(n, query));
  return (
    <div className="picker">
      <div className="picker-head">
        <input type="search" aria-label="Search exercises" placeholder="Search or type a new exercise" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={onCancel}>Cancel</button>
      </div>
      <ul className="picker-list">
        {query && !exact && <li><button className="primary" onClick={() => onPick(query)}>Add “{query}”</button></li>}
        {matches.slice(0, 60).map((n) => <li key={n}><button onClick={() => onPick(n)}>{n}{recent.includes(n) && <span className="muted"> · logged</span>}</button></li>)}
      </ul>
    </div>
  );
}
```

- [ ] **Step 7: TodayScreen.tsx**

```tsx
import { useState } from 'react';
import type { SetsStore } from '../state/useSets';
import { exerciseNames, sameExercise } from '../domain/stats';
import { fmtDate } from '../domain/format';
import { ExerciseCard } from './ExerciseCard';
import { ExercisePicker } from './ExercisePicker';

export function TodayScreen({ store, date, onOpen }: { store: SetsStore; date: string; onOpen: (name: string) => void }) {
  const [picking, setPicking] = useState(false);
  const [extra, setExtra] = useState<string[]>([]);
  const logged = exerciseNames(store.entries.filter((e) => e.date === date)).reverse();
  const cards = [...logged, ...extra.filter((x) => !logged.some((l) => sameExercise(l, x)))];

  if (picking) return <ExercisePicker recent={exerciseNames(store.entries)} onCancel={() => setPicking(false)}
    onPick={(n) => { setExtra((xs) => [...xs, n]); setPicking(false); }} />;

  return (
    <>
      <h1>{fmtDate(date)}</h1>
      {cards.length === 0 && <p className="muted">Nothing logged yet today.</p>}
      {cards.map((n) => <ExerciseCard key={n.toLowerCase()} exercise={n} date={date} store={store} onOpen={onOpen} />)}
      <button className="primary wide" onClick={() => setPicking(true)}>Add exercise</button>
    </>
  );
}
```

(`exerciseNames` orders most recent first; reversed gives today's exercises in the order they were started.)

- [ ] **Step 8: App.tsx** — tabs Today/History/Lifts/Data; `const [exercise, setExercise] = useState<string | null>(null)`; when set, render `ExerciseScreen` (Task 6) instead of the tab. `date` = `localDate(new Date())`, recomputed on `visibilitychange` so a session left open past midnight rolls over. Show `store.error` in a `role="alert"` banner. For this task, History/Lifts/Data render a `<p>` placeholder, replaced in Tasks 6–7. `main.tsx` calls `void requestPersistence()`.

```tsx
import { useEffect, useState } from 'react';
import { useSets } from '../state/useSets';
import { localDate } from '../domain/ids';
import { TodayScreen } from './TodayScreen';

type Tab = 'today' | 'history' | 'lifts' | 'data';
const TABS: [Tab, string][] = [['today', 'Today'], ['history', 'History'], ['lifts', 'Lifts'], ['data', 'Data']];

export default function App() {
  const store = useSets();
  const [tab, setTab] = useState<Tab>('today');
  const [exercise, setExercise] = useState<string | null>(null);
  const [date, setDate] = useState(() => localDate(new Date()));
  useEffect(() => {
    const onVis = () => setDate(localDate(new Date()));
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  const open = (name: string) => { setExercise(name); window.scrollTo(0, 0); };

  return (
    <div className="app">
      {store.error && <div role="alert" className="banner">{store.error}</div>}
      <main className="screen">
        {store.loading ? <p className="muted">Loading…</p>
          : tab === 'today' ? <TodayScreen store={store} date={date} onOpen={open} />
          : <p className="muted">Coming in the next task.</p>}
      </main>
      <nav className="tabs" aria-label="Sections">
        {TABS.map(([t, label]) => (
          <button key={t} aria-current={tab === t && !exercise ? 'page' : undefined} onClick={() => { setTab(t); setExercise(null); }}>{label}</button>
        ))}
      </nav>
    </div>
  );
}
```

- [ ] **Step 9: Run** `npx playwright test e2e/log.spec.ts` → PASS; `npx vitest run` → PASS; `npx tsc --noEmit` → clean.
- [ ] **Step 10: Commit** `git add -A && git commit -m "Today screen: log, edit and delete sets"`

---

### Task 6: History, Lifts and Exercise screens with e1RM chart

**Files:**
- Create: `src/ui/HistoryScreen.tsx`, `src/ui/LiftsScreen.tsx`, `src/ui/ExerciseScreen.tsx`, `src/ui/LineChart.tsx`, `e2e/fixtures/history.sample.csv`
- Modify: `src/ui/App.tsx` (route history/lifts and `exercise`)
- Test: `e2e/import.spec.ts` (written in Task 7, which provides the import path); this task's check is Step 5's visual pass.

**Interfaces:**
- Consumes: `sessionsByDate`, `sessionsFor`, `exerciseNames`, `e1rmSeries`, `currentE1rm`, `bestSet`, `estimateWeightForReps`, `SeriesPoint`, formatters
- Produces: `LineChart({ points }: { points: SeriesPoint[] })` rendering `<svg role="img" aria-label="Estimated 1RM over time">` with one `<circle>` per point; `ExerciseScreen({ name, store, onBack })`.

- [ ] **Step 1: Sample fixture** `e2e/fixtures/history.sample.csv` (synthetic):

```
date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source
2026-01-05,Cable Curl,,1,60,12,,,,sample
2026-01-05,Cable Curl,,2,70,10,2,,"felt good, strong",sample
2026-01-05,Pull-up,,1,0,8,,bodyweight,,sample
2026-01-12,Cable Curl,,1,70,12,,,,sample
2026-01-12,Cable Curl,,2,80,8,,pain,"elbow ""twinge""",sample
2026-01-12,Cable Curl,,3,80,,,partial,,sample
```

- [ ] **Step 2: LineChart.tsx** — SVG `viewBox="0 0 340 180"`, `width="100%"`; x by date (ms), y from min..max e1RM padded 5%; `<polyline>` in accent; `<circle r=4>` per point, PR points filled gold with `r=5`; text labels: max and min y at left, first and last date (short `M/D`) along the bottom; fewer than 2 points → `<p className="muted">Log this lift on two days to see a trend.</p>` (still render the single point value).

```tsx
import type { SeriesPoint } from '../domain/stats';
import { fmtWeight } from '../domain/format';

const W = 340, H = 180, L = 36, R = 8, T = 10, B = 24;
const t = (d: string) => new Date(d + 'T00:00:00').getTime();
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export function LineChart({ points }: { points: SeriesPoint[] }) {
  if (points.length < 2) return <p className="muted">Log this lift on two days to see a trend.</p>;
  const xs = points.map((p) => t(p.date)), ys = points.map((p) => p.e1rm);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const pad = (Math.max(...ys) - Math.min(...ys)) * 0.05 || 5;
  const [y0, y1] = [Math.min(...ys) - pad, Math.max(...ys) + pad];
  const X = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const Y = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Estimated 1RM over time">
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="axis" />
      <text x={L - 4} y={T + 4} className="lbl" textAnchor="end">{fmtWeight(Math.round(y1))}</text>
      <text x={L - 4} y={H - B} className="lbl" textAnchor="end">{fmtWeight(Math.round(y0))}</text>
      <text x={L} y={H - 6} className="lbl">{md(points[0].date)}</text>
      <text x={W - R} y={H - 6} className="lbl" textAnchor="end">{md(points.at(-1)!.date)}</text>
      <polyline className="line" fill="none" points={points.map((p) => `${X(t(p.date))},${Y(p.e1rm)}`).join(' ')} />
      {points.map((p) => <circle key={p.date} cx={X(t(p.date))} cy={Y(p.e1rm)} r={p.pr ? 5 : 4} className={p.pr ? 'pt pr' : 'pt'}><title>{`${p.date}: ${Math.round(p.e1rm)}`}</title></circle>)}
    </svg>
  );
}
```

- [ ] **Step 3: ExerciseScreen.tsx**

```tsx
import type { SetsStore } from '../state/useSets';
import { bestSet, currentE1rm, e1rmSeries, estimateWeightForReps, sessionsFor } from '../domain/stats';
import { fmtDate, fmtSet, fmtWeight } from '../domain/format';
import { LineChart } from './LineChart';

const lb = (n: number) => fmtWeight(Math.round(n));

export function ExerciseScreen({ name, store, onBack }: { name: string; store: SetsStore; onBack: () => void }) {
  const sessions = sessionsFor(store.entries, name);
  const series = e1rmSeries(store.entries, name);
  const current = currentE1rm(series);
  const best = bestSet(store.entries, name);
  return (
    <>
      <button onClick={onBack}>‹ Back</button>
      <h1>{name}</h1>
      <div className="tiles">
        <div className="tile"><span>Est. 1RM</span><b>{current ? lb(current) : '—'}</b></div>
        <div className="tile"><span>Est. 6RM</span><b>{current ? lb(estimateWeightForReps(current, 6)) : '—'}</b></div>
        <div className="tile"><span>Best set{best ? ` · ${best.set.date}` : ''}</span><b>{best ? fmtSet(best.set) : '—'}</b></div>
        <div className="tile"><span>Sessions</span><b>{sessions.length}</b></div>
      </div>
      <section className="card">
        <LineChart points={series} />
        {series.length > 1 && <p className="muted small">Best estimated 1RM per session · PRs filled</p>}
      </section>
      {sessions.map((s) => (
        <section className="card" key={s.date}>
          <p><b>{fmtDate(s.date)}</b></p>
          <ol className="sets">
            {s.sets.map((x) => (
              <li key={x.id} className="set-row">
                <span className="set-no">{x.setNo}</span>
                <span>{fmtSet(x)}</span>
                {x.rir != null && <span className="tag">RIR {x.rir}</span>}
                {x.flags.filter((f) => f !== 'bodyweight').map((f) => <span key={f} className={`tag ${f}`}>{f.replace('_', ' ')}</span>)}
                {x.note && <span className="note">{x.note}</span>}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
```

(Read-only rows reuse `.set-row` styling on the `<li>`; editing happens on Today.)

- [ ] **Step 4: HistoryScreen.tsx and LiftsScreen.tsx**

```tsx
// src/ui/HistoryScreen.tsx
import type { SetsStore } from '../state/useSets';
import { sessionsByDate, sameExercise } from '../domain/stats';
import { fmtDate, fmtSet } from '../domain/format';
import type { SetEntry } from '../domain/types';

function byExercise(sets: SetEntry[]): [string, SetEntry[]][] {
  const out: [string, SetEntry[]][] = [];
  for (const s of sets) {
    const g = out.find(([n]) => sameExercise(n, s.exercise));
    if (g) g[1].push(s); else out.push([s.exercise, [s]]);
  }
  return out.map(([n, xs]) => [n, xs.sort((a, b) => a.setNo - b.setNo)]);
}

export function HistoryScreen({ store, onOpen }: { store: SetsStore; onOpen: (name: string) => void }) {
  const sessions = sessionsByDate(store.entries);
  if (!sessions.length) return (<><h1>History</h1><p className="muted">No history yet — import it from the Data tab.</p></>);
  return (
    <>
      <h1>History</h1>
      {sessions.map((s, i) => {
        const groups = byExercise(s.sets);
        return (
          <details className="day" key={s.date} open={i === 0}>
            <summary>{fmtDate(s.date)} · {groups.length} exercises · {s.sets.length} sets</summary>
            <div className="day-body">
              {groups.map(([name, sets]) => (
                <button key={name} className="row-button" onClick={() => onOpen(name)}>
                  <b>{name}</b>
                  <span className="muted">{sets.map(fmtSet).join(', ')}</span>
                  {sets.filter((x) => x.note).map((x) => <span key={x.id} className="muted">“{x.note}”</span>)}
                </button>
              ))}
            </div>
          </details>
        );
      })}
    </>
  );
}
```

```tsx
// src/ui/LiftsScreen.tsx
import { useState } from 'react';
import type { SetsStore } from '../state/useSets';
import { exerciseNames, sessionsFor } from '../domain/stats';
import { fmtDate } from '../domain/format';

export function LiftsScreen({ store, onOpen }: { store: SetsStore; onOpen: (name: string) => void }) {
  const [q, setQ] = useState('');
  const names = exerciseNames(store.entries).filter((n) => n.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <h1>Lifts</h1>
      <input type="search" aria-label="Filter lifts" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="day-body" style={{ padding: '12px 0' }}>
        {names.map((n) => {
          const s = sessionsFor(store.entries, n);
          return (
            <button key={n} className="row-button" onClick={() => onOpen(n)}>
              <b>{n}</b>
              <span className="muted">{s.length} sessions · last {fmtDate(s[0].date)}</span>
            </button>
          );
        })}
        {!names.length && <p className="muted">No lifts yet.</p>}
      </div>
    </>
  );
}
```

App routing (replace the `<main>` body in `App.tsx`):
```tsx
{store.loading ? <p className="muted">Loading…</p>
  : exercise ? <ExerciseScreen name={exercise} store={store} onBack={() => setExercise(null)} />
  : tab === 'today' ? <TodayScreen store={store} date={date} onOpen={open} />
  : tab === 'history' ? <HistoryScreen store={store} onOpen={open} />
  : tab === 'lifts' ? <LiftsScreen store={store} onOpen={open} />
  : <DataScreen store={store} />}
```
(`DataScreen` arrives in Task 7; until then keep the placeholder `<p>` in that last branch.)

- [ ] **Step 5: Run** `npx tsc --noEmit` and `npx vitest run` → clean/PASS. Commit: `git add -A && git commit -m "History, lifts and exercise detail with e1RM chart"`

---

### Task 7: Data screen — import, export, storage status

**Files:**
- Create: `src/ui/DataScreen.tsx`, `e2e/import.spec.ts`
- Modify: `src/ui/App.tsx` (route `data`)

**Interfaces:**
- Consumes: `parseCsv`, `toCsv`, `SetsStore.importEntries`, `sessionsByDate`, `exerciseNames`, `localDate`
- Produces: accessible names: file input label "Import CSV", button "Export CSV", status text `Imported N new, M updated` and `K rows skipped` with a list of `Row R: message`.

- [ ] **Step 1: Failing e2e**

```ts
// e2e/import.spec.ts
import { expect, test } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');

test('import is idempotent and feeds history, lifts and chart', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText('Imported 6 new, 0 updated')).toBeVisible();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await expect(page.getByText('Imported 0 new, 6 updated')).toBeVisible();

  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText(/2026/).first()).toBeVisible();
  await expect(page.getByText('elbow "twinge"')).toBeAttached();

  await page.getByRole('button', { name: 'Lifts' }).click();
  await page.getByRole('button', { name: /Cable Curl/ }).click();
  const chart = page.getByRole('img', { name: 'Estimated 1RM over time' });
  await expect(chart.locator('circle')).toHaveCount(2);
  await expect(page.getByText('80 × ?')).toBeVisible();
});
```

Run → FAIL.

- [ ] **Step 2: DataScreen.tsx**

```tsx
import { useEffect, useState } from 'react';
import type { SetsStore } from '../state/useSets';
import { parseCsv, toCsv, type CsvError } from '../domain/csv';
import { exerciseNames, sessionsByDate } from '../domain/stats';
import { localDate } from '../domain/ids';

export function DataScreen({ store }: { store: SetsStore }) {
  const [result, setResult] = useState<{ added: number; updated: number; errors: CsvError[] } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => { void navigator.storage?.persisted?.().then(setPersisted); }, []);
  const sessions = sessionsByDate(store.entries);

  async function onFile(file: File) {
    const { entries, errors } = parseCsv(await file.text(), file.name.replace(/\.csv$/i, ''));
    const r = await store.importEntries(entries);
    setResult({ ...r, errors });
  }

  const [fallback, setFallback] = useState<string | null>(null);

  // Installed iOS PWAs ignore <a download>, so: share sheet first, clipboard second, visible text last.
  async function exportCsv() {
    const csv = toCsv(store.entries);
    const file = new File([csv], `gym-log-${localDate(new Date())}.csv`, { type: 'text/csv' });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    } catch (e) { if ((e as Error).name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(csv); setFallback('Copied the CSV to the clipboard — paste it into Notes or Files.'); }
    catch { setFallback(csv); }
  }

  return (
    <>
      <h1>Data</h1>
      <section className="card">
        <p>{store.entries.length} sets · {sessions.length} sessions · {exerciseNames(store.entries).length} lifts</p>
        {sessions.length > 0 && <p className="muted">{sessions.at(-1)!.date} → {sessions[0].date}</p>}
        <p className={persisted === false ? 'warn' : 'muted'}>
          {persisted ? 'Storage is persistent.' : persisted === false ? 'Storage not marked persistent — export a backup regularly.' : 'Storage status unknown.'}
        </p>
      </section>
      <section className="card">
        <label className="button primary wide">Import CSV
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
        </label>
        {result && (
          <div role="status">
            <p>Imported {result.added} new, {result.updated} updated</p>
            {result.errors.length > 0 && (<>
              <p className="warn">{result.errors.length} rows skipped</p>
              <ul className="errors">{result.errors.slice(0, 50).map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul>
            </>)}
          </div>
        )}
        <button className="wide" onClick={() => void exportCsv()} disabled={!store.entries.length}>Export CSV</button>
        {fallback && (fallback.startsWith('Copied')
          ? <p className="muted" role="status">{fallback}</p>
          : <textarea className="csv" aria-label="CSV export" readOnly value={fallback} onFocus={(e) => e.currentTarget.select()} />)}
      </section>
      <p className="muted small">Build {__BUILD_ID__} · {__BUILT_AT__.slice(0, 16).replace('T', ' ')} UTC</p>
    </>
  );
}
```

Note: import source label = file name, so re-importing the same file dedupes, and importing a different export of the same data from the app keeps its `source` column (`app`) and dedupes against live sets.

- [ ] **Step 3: Run** `npx playwright test` → PASS (both specs).
- [ ] **Step 4: Commit** `git add -A && git commit -m "Data screen: CSV import/export and storage status"`

---

### Task 8: iPhone 13 mini visual pass, then deploy

**Files:**
- Create: `e2e/screens.spec.ts`
- Modify: `src/ui/styles.css` as needed from the review

- [ ] **Step 1: Screenshot spec** — imports the sample, simulates the notch and home indicator by setting `--sat: 47px; --sab: 34px` on `document.documentElement`, and saves full-page PNGs of Today (with an exercise card open and one set logged), History, Lifts, the Cable Curl exercise screen and Data to `screenshots/*.png` (gitignored). Asserts no horizontal overflow on each and that every visible `button`, `input`, and `label.button` has a bounding box height ≥ 44 (chips ≥ 36).

```ts
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'history.sample.csv');
async function check(page: Page, name: string) {
  await page.evaluate(() => { document.documentElement.style.setProperty('--sat', '47px'); document.documentElement.style.setProperty('--sab', '34px'); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const small = await page.evaluate(() => [...document.querySelectorAll('button:not(.chip), input:not([type=file]), label.button')]
    .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height < 44).length);
  expect(small).toBe(0);
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
}

test('screens at iPhone 13 mini size', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByLabel('Import CSV').setInputFiles(FIXTURE);
  await check(page, '4-data');
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await check(page, '0-picker');
  await page.getByRole('button', { name: 'Cable Curl' }).first().click();
  await page.getByRole('button', { name: 'Add set' }).click();
  await check(page, '1-today');
  await page.getByRole('button', { name: 'History' }).click();
  await check(page, '2-history');
  await page.getByRole('button', { name: 'Lifts' }).click();
  await check(page, '3-lifts');
  await page.getByRole('button', { name: /Cable Curl/ }).click();
  await check(page, '5-exercise');
});
```

- [ ] **Step 2: Run** `npx playwright test e2e/screens.spec.ts` → PASS; then **Read each PNG** and fix anything cramped, clipped, low-contrast or overlapping the notch/home bar; re-run until clean.

- [ ] **Step 3: Full verification** — `npx tsc --noEmit`, `npx vitest run`, `npx playwright test`, `npm run build`; then `grep -c "Estimated 1RM over time" dist/assets/index-*.js` ≥ 1; `git ls-files | grep -Ei '\.(csv|xlsx?)$'` prints only `e2e/fixtures/history.sample.csv`.

- [ ] **Step 4: Commit, create the public repo, enable Pages, push**

```bash
git add -A && git commit -m "iPhone 13 mini layout pass"
gh repo create Krystade/gym-tracker --public --source . --remote origin
gh api -X POST repos/Krystade/gym-tracker/pages -f build_type=workflow
git push -u origin main
```

- [ ] **Step 5: Confirm the deploy** — `gh run list -L 1` shows success; `curl -s https://krystade.github.io/gym-tracker/` contains `Gym Tracker`; fetch the served `assets/index-*.js` and confirm it contains the commit's short SHA (the build stamp).

---

### Task 9 (private repo): convert history to the standard CSV

Runs entirely in `C:\Users\jackp\projects\gym-data` → private `Krystade/gym-data`. Nothing from this task is copied into `gym-tracker`.

- [ ] **Step 1: Create the repo** — `mkdir gym-data`, `git init -b main`, repo-local identity as in gym-tracker; `gh repo create Krystade/gym-data --private --source . --remote origin`. Copy in `originals/Workout Log (1).xlsx`, `originals/Build Workouts.xlsx`, and `originals/notes-2026.txt` (the free-text 2026 log, verbatim).

- [ ] **Step 2: Write the failing parser tests** — `test_convert.py` (pytest; `pip install pytest openpyxl`):

```python
from convert import parse_sets, parse_notes, parse_cell, flags_for

def test_sets_with_inline_note_attach_to_preceding_set():
    s = parse_sets("90x10 75x11 lighter to fix form 75x11")
    assert [(x["weight"], x["reps"]) for x in s] == [(90, 10), (75, 11), (75, 11)]
    assert s[1]["note"] == "lighter to fix form"

def test_comma_separated_decimal_and_partial():
    s = parse_sets("42.5x11, 50x11, 90x")
    assert [(x["weight"], x["reps"]) for x in s] == [(42.5, 11), (50, 11), (90, None)]
    assert "partial" in s[2]["flags"]

def test_bodyweight_and_question_mark():
    s = parse_sets("0x8, 100x8?")
    assert s[0]["flags"] == ["bodyweight"]
    assert "unsure" in s[1]["flags"]

def test_pain_words_flag_pain():
    assert "pain" in flags_for("felt it in my elbow")
    assert flags_for("felt good") == []

def test_notes_dates_skips_and_names():
    text = "1/5/26\nSeated Row\t90x10 75x11\nFace Pull\tSkip\n2/9\nPushdowns: 50x15, 70x10\nWalk: 2 miles\n"
    rows, unparsed = parse_notes(text)
    assert {(r["date"], r["as_written"]) for r in rows} == {("2026-01-05", "Seated Row"), ("2026-02-09", "Pushdowns")}
    assert unparsed == ["Walk: 2 miles"]

def test_xlsx_cells():
    assert parse_cell("55×12") == (55, 12, [], None)
    assert parse_cell(15.0) == (0, 15, ["bodyweight"], None)
    assert parse_cell("60×63s") == (60, None, ["partial"], "63s hold")
```

Run: `python -m pytest -q` → FAIL (no `convert`).

- [ ] **Step 3: `convert.py`**

```python
"""Convert the 2025 spreadsheet and the 2026 notes log to the gym-tracker standard CSV."""
import csv, re, sys
from datetime import datetime
import openpyxl

HEADER = ["date", "exercise", "as_written", "set", "weight_lb", "reps", "rir", "flags", "note", "source"]
SET_RE = re.compile(r"(\d+(?:\.\d+)?)\s*[x×]\s*(\d*)(\??)")
PAIN_RE = re.compile(r"\b(pain|hurt|hurts|discomfort|elbow)\b", re.I)
UNSURE_RE = re.compile(r"\b(unsure|idk|not sure)\b", re.I)
RIR_RE = re.compile(r"(\d)\s*-?\s*(\d)?\s*rir", re.I)

# Every observed spelling → canonical name. Filled in by running the script: it lists unmapped names.
ALIASES: dict[str, str] = {}

def canonical(name: str) -> str:
    key = re.sub(r"\s+", " ", name).strip()
    return ALIASES.get(key.lower(), key)

def flags_for(note: str) -> list[str]:
    out = []
    if PAIN_RE.search(note): out.append("pain")
    if UNSURE_RE.search(note): out.append("unsure")
    return out

def num(s: str) -> float | int:
    f = float(s)
    return int(f) if f.is_integer() else f

def parse_sets(text: str) -> list[dict]:
    """'90x10 75x11 note text 75x11' → sets; text after a set (until the next set) is that set's note."""
    matches = list(SET_RE.finditer(text))
    sets = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        note = text[m.end():end].strip(" ,;.")
        weight, reps = num(m.group(1)), (int(m.group(2)) if m.group(2) else None)
        flags = []
        if weight == 0: flags.append("bodyweight")
        if reps is None: flags.append("partial")
        if m.group(3) == "?": flags.append("unsure")
        flags += [f for f in flags_for(note) if f not in flags]
        rir = RIR_RE.search(note)
        sets.append({"weight": weight, "reps": reps, "flags": flags, "note": note,
                     "rir": int(rir.group(1)) if rir else None})  # "2-3 RIR" → 2, the conservative end
    return sets

DATE_RE = re.compile(r"^(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?$")
LINE_RE = re.compile(r"^(?P<name>[^:\t]+?)\s*(?::|\t)\s*(?P<rest>.*)$")

def parse_notes(text: str, default_year: int = 2026) -> tuple[list[dict], list[str]]:
    rows, unparsed, date = [], [], None
    double_pulley: set[str] = set()
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.lower() == "new gym log": continue
        d = DATE_RE.match(line)
        if d:
            y = int(d.group(3)) if d.group(3) else default_year
            date = f"{y + 2000 if y < 100 else y:04d}-{int(d.group(1)):02d}-{int(d.group(2)):02d}"
            continue
        m = LINE_RE.match(line)
        if not m or date is None:
            unparsed.append(line); continue
        name, rest = m.group("name").strip(), m.group("rest").strip()
        if rest.lower() == "skip": continue
        sets = parse_sets(rest)
        if not sets:
            unparsed.append(line); continue
        ex = canonical(name)
        if "double pulley" in rest.lower(): double_pulley.add(ex)
        for i, s in enumerate(sets, 1):
            if ex in double_pulley: s["flags"].append("double_pulley")
            rows.append({"date": date, "exercise": ex, "as_written": name, "set": i, **s, "source": "notes-2026"})
    return rows, unparsed

def parse_cell(v) -> tuple:
    """A spreadsheet set cell → (weight, reps, flags, note)."""
    if isinstance(v, (int, float)): return (0, int(v), ["bodyweight"], None)
    s = str(v).strip()
    t = re.match(r"^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+)\s*s$", s)
    if t: return (num(t.group(1)), None, ["partial"], f"{t.group(2)}s hold")
    m = re.match(r"^(\d+(?:\.\d+)?)\s*[x×]\s*(\d*)$", s)
    if not m: raise ValueError(f"unparsed cell {s!r}")
    w, r = num(m.group(1)), (int(m.group(2)) if m.group(2) else None)
    flags = (["bodyweight"] if w == 0 else []) + (["partial"] if r is None else [])
    return (w, r, flags, None)

def parse_xlsx(path: str) -> tuple[list[dict], list[str]]:
    ws = openpyxl.load_workbook(path, data_only=True)["master workout log"]
    rows, problems = [], []
    for n, r in enumerate(ws.iter_rows(min_row=2, values_only=True), 2):
        if not r[2] or not isinstance(r[0], datetime): continue
        date, name = r[0].strftime("%Y-%m-%d"), str(r[2]).strip()
        cells = [c for c in r[3:7] if c not in (None, "")]
        note = str(r[7]).strip() if len(r) > 7 and r[7] else ""
        out = []
        for c in cells:
            try: w, reps, flags, cnote = parse_cell(c)
            except ValueError as e: problems.append(f"row {n}: {e}"); continue
            out.append({"weight": w, "reps": reps, "flags": flags, "note": cnote or "", "rir": None})
        if out and note:
            out[-1]["note"] = "; ".join(x for x in (out[-1]["note"], note) if x)
            out[-1]["flags"] += [f for f in flags_for(note) if f not in out[-1]["flags"]]
        for i, s in enumerate(out, 1):
            rows.append({"date": date, "exercise": canonical(name), "as_written": name, "set": i, **s, "source": "xlsx-2025"})
    return rows, problems

def write(rows: list[dict], path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\r\n")
        w.writerow(HEADER)
        for r in rows:
            w.writerow([r["date"], r["exercise"], r["as_written"], r["set"], r["weight"],
                        "" if r["reps"] is None else r["reps"], "" if r["rir"] is None else r["rir"],
                        ";".join(r["flags"]), r["note"], r["source"]])

if __name__ == "__main__":
    xrows, xprob = parse_xlsx("originals/Workout Log (1).xlsx")
    nrows, nprob = parse_notes(open("originals/notes-2026.txt", encoding="utf-8").read())
    rows = xrows + nrows
    for label, rs in (("xlsx-2025", xrows), ("notes-2026", nrows)):
        print(f"{label}: {len(rs)} sets, {len({r['date'] for r in rs})} days")
    for p in xprob + [f"notes: {l}" for l in nprob]: print("UNPARSED", p)
    names = sorted({r["exercise"] for r in rows})
    print(f"{len(names)} canonical exercises:"); [print("  ", n) for n in names]
    write(rows, "history.csv")
    print("wrote history.csv")
    sys.exit(1 if xprob else 0)
```

- [ ] **Step 4: Run tests** `python -m pytest -q` → PASS. Mutation check: break `SET_RE` (drop `×`) and confirm `test_xlsx_cells` fails; restore from a scratchpad copy.

- [ ] **Step 5: Build the alias table** — run `python convert.py`, read the printed canonical list, and fill `ALIASES` (lowercased key → canonical) so each movement has exactly one name, using `CATALOG` spellings where one exists (e.g. every pushdown variant → `Cable Pushdown`; keep genuinely different movements like `Rope Pushdown` separate). Re-run until the list has no near-duplicates and there are no `UNPARSED` lines other than cardio.

- [ ] **Step 6: Run, eyeball, commit, push** — `python convert.py` → `history.csv` (expect 54 days for xlsx-2025); spot-check five sessions against the originals, including one with an inline note and one with a partial set; import `history.csv` into the built app via Playwright once to prove it parses with zero skipped rows; commit and push to the private repo.

- [ ] **Step 7: Hand-off** — the user imports `history.csv` from **inside the installed home-screen app** (Files → the CSV; e.g. via iCloud Drive or AirDrop), not Safari.
