# Phase 7 — Progress Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Take front/side/back progress photos from the app, keep them only on the phone, and compare any two dates side by side with the trend weight on each.

**Architecture:** Domain `photos.ts` (sizing, poses, grouping, default compare pair, weight at a date) unit-tested. IndexedDB v6 `photos` store holding downscaled JPEG blobs plus thumbnails. `usePhotos` hook. UI: a "Progress photos" card on Stats opens a Photos screen (capture, timeline, compare, delete). Photos never enter any CSV, export, or the Phase 8 sync.

**Spec:** Phase 7 in `docs/superpowers/specs/2026-09-29-gym-tracker-design.md` ("Captured via `<input capture>`, stored only in IndexedDB, never uploaded; timeline and side-by-side compare aligned to body weight.").

## Phase Research (2026-09-30)

| Question | Finding | Consequence |
|---|---|---|
| Capture on iOS | `<input type="file" accept="image/*" capture="environment">` opens the camera directly in Safari and installed PWAs; without `capture` the sheet offers library too. | Two buttons: "Take photo" (capture) and "From library" (no capture), so older photos can be added with their date. |
| Blobs in IndexedDB on Safari | Supported since Safari 14 (iOS 14); earlier WebKit could not store Blobs. | Store `Blob`s directly. |
| Size | A 12 MP iPhone JPEG is 2–4 MB; decoding into a canvas and re-encoding at 1600 px long edge, JPEG 0.85, gives ~250–400 KB. Orientation: WebKit applies EXIF orientation when drawing an `<img>` (image-orientation: from-image is the default). | Downscale via `<img>` → canvas → `toBlob('image/jpeg', 0.85)`; a 320 px thumbnail for the grid. HEIC from the library: Safari decodes it in `<img>` on iOS 17+, and the picker hands Safari JPEG ("Most Compatible") by default. |
| Consistency | Progress-photo guides agree: same pose, light, time of day, distance. | A one-line tip above capture; pose chips (Front, Side, Back); compare defaults to the same pose. |
| Eviction | Storage is already requested persistent (Data tab shows status). Photos are the largest data; if eviction happens they are lost. | Each photo has "Save to Photos" (share sheet) as the manual backup. They are deliberately excluded from sync. |

## Open Questions — answered by default

1. Poses: front, side, back. One photo per pose per date; retaking replaces it (confirm).
2. Date: capture → today; library → today by default, editable before saving (a date field).
3. Compare: two date pickers, default earliest vs latest date that has the chosen pose; each side shows date and trend weight within ±3 days ("—" if none).
4. Deleting a photo asks for confirmation; it is permanent.
5. No face blurring or cropping in this phase.

## Review Focus

1. **Nothing photo-related is ever serialised** into CSV/JSON exports or network requests. Pinned: grep in Task 3 and a test that exports contain no `data:`/blob text.
2. **v5 → v6 upgrade keeps every store** (including body). Pinned: Task 2 test.
3. **Retake replaces, doesn't duplicate** (id = `date:pose`). Pinned: Task 2 test.
4. **Object URLs are revoked** when thumbnails/compare images unmount (no leak across a long timeline).

---

### Task 1: Domain `src/domain/photos.ts`

```ts
export const POSES = ['front', 'side', 'back'] as const; export type Pose = (typeof POSES)[number]
export interface PhotoMeta { id: string; date: string; pose: Pose; width: number; height: number; addedAt: string }
export const photoId = (date: string, pose: Pose) => `${date}:${pose}`
fitSize(w, h, max): { width: number; height: number }            // keeps aspect, never upscales, integers
timeline(metas): { date: string; photos: PhotoMeta[] }[]          // newest date first, poses in POSES order
comparePair(metas, pose): [string, string] | null                 // earliest and latest dates with that pose, needs 2 dates
weightNear(date, points, days = 3): number | null                 // trend weight of the nearest point within ±days
```
Tests for each, including ties in `weightNear` (earlier wins) and `fitSize` for portrait/landscape/small.

### Task 2: Storage

`db.ts` v6 `photos` store (keyPath `id`, index `date`): `getPhotoMetas()` (no blobs, via cursor projecting fields), `getPhotoBlob(id, 'full' | 'thumb')`, `putPhoto(meta, full, thumb)`, `deletePhoto(id)`. `usePhotos` hook. Tests: v5→v6 upgrade keeps sets/settings/profile/program/body; put twice with the same id keeps one; delete; metas carry no blobs.

### Task 3: UI

- Stats: "Progress photos" card — count, latest date, "Open photos".
- Photos screen: tip line; pose chips; date field; "Take photo" / "From library" (hidden inputs); timeline grid of thumbnails by date with pose labels and trend weight; tap a photo → full view with "Save to Photos" and "Delete"; Compare section: pose chips, two date selects, two images side by side with date and weight.
- e2e `e2e/photos.spec.ts` with an in-memory generated PNG (no image file committed): add a front photo for two dates via "From library" with the date field, the timeline shows both, compare shows both dates, delete removes one. Export CSV text contains no `blob:`/`data:`. Screenshots at 375×812.
