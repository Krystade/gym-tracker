# Phase 8 — Private Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One "Sync now" button that backs the phone's log and body data up to the private `gym-data` repo and pulls in anything newer from there (including the converter's `history.csv`), using a fine-grained token Jack pastes in once.

**Architecture:** Domain `sync.ts`: a small GitHub Contents client over an injected `fetch`, UTF-8 base64 helpers, and `sync()` which pulls, merges, and pushes. IndexedDB v7 adds a `config` store for the sync settings (token stays on the device). UI: a "Private backup" card on the Data tab. The one deliberate network exception in the spec: requests go only to `api.github.com`, only when Jack taps Sync, and carry only sets and body data — never photos, never the token anywhere else.

**Spec:** Phase 8 in `docs/superpowers/specs/2026-09-29-gym-tracker-design.md` ("Optional push/pull of the standard CSV to `gym-data` via a fine-grained token the user pastes in; replaces manual export as the backup.").

## Phase Research (2026-09-30)

| Question | Finding | Consequence |
|---|---|---|
| API | Contents API: `GET /repos/{o}/{r}/contents/{path}` returns base64 `content` + `sha` for files ≤ 1 MB (1–100 MB: `encoding: "none"`, use the raw media type). `PUT` needs `message`, base64 `content`, and `sha` when updating; writes must be serial (409 on clashes). ([GitHub docs](https://docs.github.com/en/rest/repos/contents)) | Serial GET→PUT per file; on 409/422-sha retry once after a fresh GET; raw fallback for > 1 MB. |
| Browser access | The REST API allows cross-origin requests with an `Authorization: Bearer` header (CORS). | Works from the static Pages site; no server. |
| Token | Fine-grained PAT, "Only select repositories: gym-data", Repository permissions → Contents: Read and write. Expiry up to a year. | Setup text says exactly this. 401 → "Token rejected or expired"; 403/404 → "Token can't see that repo — check its repository access and Contents permission". |
| Storage of the token | IndexedDB on the device; the app has no third-party scripts. It is never exported, logged, or shown after saving (field shows "saved", with Replace / Forget). | `config` store; exports never read it. |

## Open Questions — answered by default

1. Files: push `app/sets.csv` (standard CSV, every set on the phone) and `app/body.csv`. Pull those plus the converter's `history.csv`. The converter's files are never written by the app.
2. Merge: union by id (sets) and by date (body), exactly like file import. Deleting a set on the phone records its id as a tombstone (config store, key `deleted`); sync never imports a tombstoned id and pushes without it, so a deleted set doesn't come back from the backup or from `history.csv`.
3. Order: pull, merge locally, then push the merged state, so the backup is always a superset of both.
4. Commit messages: `Backup from phone <ISO timestamp>` — no data in messages.
5. No automatic sync in this phase; the card shows "Last synced …" and nudges when there are sets newer than the last sync.

## Review Focus

1. **The token never leaves except in the Authorization header to api.github.com**, is never exported, never rendered after saving. Pinned: Task 1 test on request shape; Task 3 e2e checks the export and the DOM.
2. **UTF-8 round-trips** (notes with "×", "’", emoji). Pinned: Task 1 test.
3. **A failed pull never pushes** (no overwrite of the backup with a partial state). Pinned: Task 1 test.
4. **v6 → v7 upgrade keeps every store.** Pinned: Task 2 test.

---

### Task 1: Domain `src/domain/sync.ts`

```ts
export interface SyncConfig { key: 'sync'; repo: string; token: string; branch: string; lastSync?: string }
export const toB64 = (text: string) => string;   export const fromB64 = (b64: string) => string   // UTF-8 safe
export function repoClient(cfg, fetchFn): { get(path): Promise<{ text: string; sha: string } | null>; put(path, text, sha, message): Promise<void> }
export class SyncError extends Error { kind: 'auth' | 'access' | 'network' | 'conflict' | 'other' }
export async function sync(deps: {
  client; sets(): SetEntry[]; body(): BodyDay[]; deleted: Set<string>;
  importSets(e: SetEntry[]): Promise<unknown>; importBody(d: BodyDay[]): Promise<unknown>; now: Date;
}): Promise<{ pulledSets: number; pulledBody: number; pushedSets: number; pushedBody: number }>
```
Tests with a fake fetch: request URL/headers (Bearer token, API version, only api.github.com); base64 UTF-8 round trip; 404 on get → null; put sends sha when updating, omits it when creating; 401/403/404/network map to SyncError kinds; 409 retries once with a fresh sha; `sync` pulls history.csv + app files, imports only new non-tombstoned ids, pushes merged state minus tombstones; a pull failure throws before any PUT.

### Task 2: Storage

v7 `config` store (keyPath `key`): `getSyncConfig`, `putSyncConfig`, `deleteSyncConfig`, `getTombstones`, `addTombstone` (called by `useSets.remove`). `useSync` hook: `{config, status, error, saveConfig, forget, run}`. Test: v6→v7 keeps sets/settings/profile/program/body/photos; config round trip and delete.

### Task 3: UI

Data tab "Private backup" card: repo (default `Krystade/gym-data`), token (password input; after saving shows "Token saved" + Replace + Forget), "Sync now", status line (last synced / result counts / error with the fix), setup steps for the token in a disclosure. e2e `e2e/sync.spec.ts` with `page.route('https://api.github.com/**')` mocked (no real network): save config with a fake token, sync pulls a sample history into the log and PUTs `app/sets.csv` + `app/body.csv` with the Bearer header; the token isn't in the DOM after saving and isn't in the CSV export; 401 shows the token message. Screenshot at 375×812.
