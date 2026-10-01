# Phase 11 — Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Several people can be tracked on one phone, with a one-tap switch while training together. Everything personal is separate per profile, gyms are shared, and the private backup holds every profile.

**Architecture:**
- **One IndexedDB database per profile.** The existing `gym-tracker` is the first profile, so nothing is migrated. Others are `gym-tracker~<id>`.
- **A small shared database `gym-tracker-shared`** holds the profile list, the active profile id, gyms, and the sync repo and token.
- **`db.ts` gains `useProfileDb(name)`.** The module-level connection switches, and `App` remounts the profile subtree with `key={profileId}`.
- **Unsaved set-form drafts** are kept in a per-profile in-memory map, so switching mid-set loses nothing.
- **Sync:**
  - The first profile keeps `app/…` and still pulls `history.csv`.
  - Other profiles use `profiles/<slug>/sets.csv` and `profiles/<slug>/body.csv`, and pull no history.

**Spec:** Phase 11 in the design spec.

## Phase Research (2026-10-01)

| Question | Finding | Consequence |
|---|---|---|
| Several IndexedDB databases on iOS | Quota is per origin, shared by every database. Each `openDB` is independent. Safari has no limit on the number of databases that matters here. | One database per profile keeps every store's code unchanged. Switching closes the old connection. |
| Persisted storage | `navigator.storage.persist()` is per origin. | One request covers every profile. |
| Remount cost | Not measured yet; expected to be small (one read per store, about 2k sets). Task 1 times it in the e2e build. | Remounting on switch is fine. Drafts are the only state that needs to survive, so they live outside React. |

## Open Questions — answered (Jack: "Separate, same backup", "Quick switch")

1. **Separate per profile:** sets, settings, priorities, program, day plans, body, photos, tombstones and aliases.
2. **Shared:** gyms (Phase 10), the backup repo and token, and the profile list.
3. **Quick switch:**
   - A profile chip row sits in the top bar of every tab: one chip per profile, initials plus name, and a tap switches.
   - The active profile is outlined.
   - "Manage" (Data tab) adds, renames and deletes profiles. Deleting needs typing the name, because it deletes that profile's data.
4. **Naming:** the first profile is named "Me" until renamed. Names stay on the device and are not used in backup paths; the path uses a slug the user can see and edit when the profile is created.
5. **Photos:** per profile, on-device only, as before.

## Review Focus

1. **No cross-profile leak.** A set logged while profile B is active never lands in A's database, including a write in flight during a switch. Pinned in Task 1 (the db handle is captured per call) and Task 3 (e2e).
2. **Existing data is untouched.** The first profile opens the same `gym-tracker` v7 database. Pinned in Task 1.
3. **The backup paths can't collide.** The slug is validated as `[a-z0-9-]{1,30}`, unique, and not `app`. Pinned in Task 2.

---

### Task 1: Shared DB and profile switching in `db.ts`
- **Shared DB:** `gym-tracker-shared` v1 with a `kv` store, holding `profiles: {id, name, slug}[]`, `active`, `gyms`, and `sync` (moved here from the profile DB on first run; the old record is deleted only after the copy succeeds).
- **Profile switching:** `setProfileDb(id)` points the connection at `gym-tracker` (first profile) or `gym-tracker~<id>`. Every db function takes `const d = await db()` once.
- **Tests:**
  - The first profile reads existing v7 data.
  - A second profile starts empty.
  - A write started before a switch lands in the original DB.
  - Sync config migrates once.

### Task 2: Sync per profile
- `sync()` takes `paths: { sets, body, history? }`.
- `useSync` derives the paths from the active profile.
- **Tests:**
  - A second profile pushes to `profiles/<slug>/…` and never reads `history.csv`.
  - Slug validation.

### Task 3: UI
- **`ProfileBar`:** the chip row at the top. It shows only when there are 2+ profiles; with one profile it's hidden, and the Data tab offers "Add a person".
- **Drafts:** `drafts.ts` keeps a `Map<profileId|exercise, SetFormDraft>`, which SetForm reads on mount and writes on change.
- **Manage profiles** card on the Data tab.
- **e2e `e2e/profiles.spec.ts`:**
  - Add profile B and log a set as B; A's History doesn't show it.
  - Switch back to A mid-entry (typed reps, not saved), switch to B and back, and the typed value is still there.
  - Delete B with name confirmation.
  - Screenshot `18-profiles.png`.

### Wishlist (not in this plan): friends list
Recorded in the spec. It needs a shared backend (or a shared repo with per-person tokens), so it's designed after profiles ship, as an opt-in per person.
