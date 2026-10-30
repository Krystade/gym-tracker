import { useCallback, useEffect, useState } from 'react';
import { MAIN, type Person, type ProfileDb } from '../db/db';
import { useDb, useProfileId } from './profileDb';
import { backupDue, backupName, fromB64, mergeBackup, parseBackup, toB64, toBackup, unbackedPhotos, type Backup, type BackupMark, type BackupPhoto } from '../domain/backup';
import { phoneApply } from '../cloud/sync';
import { readBuddyMeta } from '../cloud/meta';
import { localDate } from '../domain/ids';
import { plural } from '../domain/format';
import { replacedChanged } from './useReplaced';
import type { PhotosStore } from './usePhotos';

/** A profile's backup (domain/backup), from its database: the log in one read, then each photo's images, one photo at a time. */
export async function exportBackup(db: ProfileDb, person: string, at: Date): Promise<Backup> {
  const [log, buddies, metas] = await Promise.all([db.getSyncSnapshot(), readBuddyMeta(db), db.getPhotoMetas()]);
  const photos: BackupPhoto[] = [];
  for (const meta of metas) {
    const [full, thumb] = await Promise.all([db.getPhotoBlob(meta.id, 'full'), db.getPhotoBlob(meta.id, 'thumb')]);
    if (!full || !thumb) continue;
    const b64 = async (b: Blob) => toB64(new Uint8Array(await b.arrayBuffer()));
    photos.push({ meta, type: full.type || 'image/jpeg', full: await b64(full), thumb: await b64(thumb) });
  }
  return toBackup({ person, at, ...log, buddies, photos });
}

/** What a restore brought in, and the last backup as it stands after it. `skipped`: parts of the file that didn't read. */
export interface Restored { sets: number; removed: number; body: number; buddies: number; photos: number; held: number; skipped: number; mark: BackupMark | null }

/**
 * Merges a backup into a profile's database (domain/backup mergeBackup): the log through db applySynced, so what it replaces is
 * kept first (Replaced by sync) and nothing changed here meanwhile is overwritten; then each photo this phone hasn't got, by id
 * (one taken here for that day and pose stays). The file counts as the last backup when it's newer than the one marked.
 */
export async function restoreBackup(db: ProfileDb, b: Backup, skipped: number, now: number, after: { log?: () => unknown; replaced?: () => unknown } = {}): Promise<Restored> {
  const [log, buddies] = await Promise.all([db.getSyncSnapshot(), readBuddyMeta(db)]);
  const m = mergeBackup({ ...log, buddies }, b, now);
  const { importSets, deleteIds, importBody } = m.taken;
  const { taken } = importSets.length || deleteIds.length || importBody.length ? await phoneApply(db, after).applyMonth({ sets: log.sets, body: log.body }, m.taken, now) : m;
  const pulled = Object.keys(m.buddies).length ? (await db.applySyncedMeta(buddies, m.buddies, [])).pulled : 0;
  const have = new Set((await db.getPhotoMetas()).map((p) => p.id));
  let photos = 0;
  for (const p of b.photos) {
    if (have.has(p.meta.id)) continue;
    let images: Blob[];
    try { images = [p.full, p.thumb].map((x) => new Blob([fromB64(x)], { type: p.type })); } catch { skipped++; continue; }
    await db.putPhoto(p.meta, images[0], images[1]);
    photos++;
  }
  let mark = (await db.getBackupMark()) ?? null;
  if (Number.isFinite(Date.parse(b.at)) && b.at > (mark?.at ?? '')) { mark = { ...mark, at: b.at, photos: b.photos.length }; await db.putBackupMark(mark); }
  return { sets: taken.importSets.length, removed: taken.deleteIds.length, body: taken.importBody.length, buddies: pulled, photos, held: m.held, skipped, mark };
}

function restoredText(r: Restored): string {
  const got = [r.sets && plural(r.sets, 'set'), r.body && plural(r.body, 'body day'), r.photos && plural(r.photos, 'photo'), r.buddies && 'buddies'].filter(Boolean);
  const notes = [r.removed && `${plural(r.removed, 'set')} removed, deleted where the backup was made`, r.held && `${plural(r.held, 'set')} held back, already in your log from another import`,
    r.skipped && `${plural(r.skipped, 'item')} couldn’t be read`].filter(Boolean);
  return `${got.length ? `Restored ${got.join(', ')}` : 'Nothing new: it’s all here already'}${notes.length ? `. ${notes.join('; ')}` : ''}.`;
}
const size = (n: number) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(1)} MB`);

/**
 * Saves a file through the share sheet where it takes one (an installed iOS app ignores <a download>; Save to Files is in the
 * sheet), else as a download. 'tap': the sheet wants a tap of its own, the first having been spent while the file was built.
 */
export async function saveFile(file: File): Promise<'saved' | 'cancelled' | 'tap'> {
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return 'saved'; }
    catch (e) {
      const why = (e as Error).name;
      if (why === 'AbortError') return 'cancelled';
      if (why === 'NotAllowedError') return 'tap';
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'saved';
}

// Each profile's last backup, read once: every switch of person remounts the screens, and a read landing mid-keystroke would
// put a field's old value back (as db storagePersistence).
const marks = new Map<string, BackupMark | null>();

/**
 * The backup file of the profile on screen: Download, Restore, when the last backup was, and the nudge while photos pile up
 * without one. `after`: what to read again once a restore changed the log or the buddies.
 */
export function useBackup(person: Person, photos: PhotosStore, after: { log: () => unknown; buddies: () => unknown }) {
  const db = useDb(), id = useProfileId();
  const [mark, setMarkNow] = useState<BackupMark | null | undefined>(() => marks.get(id));
  const setMark = (m: BackupMark | null) => { marks.set(id, m); setMarkNow(m); };
  const [busy, setBusy] = useState<'download' | 'restore' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // A file built but not yet handed over: building took the tap's time, so the share sheet waits for another.
  const [ready, setReady] = useState<{ file: File; mark: BackupMark } | null>(null);
  useEffect(() => { if (!marks.has(id)) void db.getBackupMark().then((m) => setMark(m ?? null), () => setMark(null)); }, []);

  async function hand(file: File, made: BackupMark) {
    const r = await saveFile(file);
    setReady(r === 'tap' ? { file, mark: made } : null);
    if (r !== 'saved') { if (r === 'tap') setMsg({ ok: true, text: `Backup ready (${size(file.size)}).` }); return; }
    const next = { ...(await db.getBackupMark()), ...made };
    await db.putBackupMark(next);
    setMark(next);
    setMsg({ ok: true, text: `Saved ${file.name} (${size(file.size)}).` });
  }

  async function download() {
    setBusy('download'); setMsg(null); setReady(null);
    try {
      const at = new Date();
      const b = await exportBackup(db, person.name, at);
      const file = new File([JSON.stringify(b)], backupName(localDate(at), person.id === MAIN ? null : person.slug), { type: 'application/json' });
      await hand(file, { at: b.at, photos: b.photos.length });
    } catch (e) { setMsg({ ok: false, text: `Couldn’t make the backup: ${String(e)}` }); }
    finally { setBusy(null); }
  }
  /** The file already built, from a tap of its own (the share sheet is opened before anything is awaited). */
  const saveReady = () => { if (ready) void hand(ready.file, ready.mark).catch((e) => setMsg({ ok: false, text: `Couldn’t save the backup: ${String(e)}` })); };

  async function restore(file: File) {
    setBusy('restore'); setMsg(null); setReady(null);
    try {
      const r = parseBackup(await file.text());
      if ('error' in r) { setMsg({ ok: false, text: r.error }); return; }
      const who = r.backup.person;
      if (who && who !== person.name && !confirm(`This backup is ${who}’s. Restore it into ${person.name}’s log?`)) return;
      const out = await restoreBackup(db, r.backup, r.skipped, Date.now(), { log: after.log, replaced: replacedChanged });
      if (out.buddies) await after.buddies();
      if (out.photos) await photos.reload();
      setMark(out.mark);
      setMsg({ ok: true, text: restoredText(out) });
    } catch (e) { setMsg({ ok: false, text: `Restore failed: ${String(e)}` }); }
    finally { setBusy(null); }
  }

  async function snooze() {
    const next = { ...(await db.getBackupMark()), snoozed: new Date().toISOString() };
    setMark(next);
    await db.putBackupMark(next).catch(() => {});
  }
  /** What a screen showed of the last Download or Restore goes with it. */
  const clear = useCallback(() => { setMsg(null); setReady(null); }, []);

  const m = mark ?? null;
  return {
    mark, busy, msg, ready: ready != null, download, saveReady, restore, snooze, clear,
    /** Photos not in any backup yet; the nudge, once 3 have piled up since the last backup or Not now. */
    unbacked: unbackedPhotos(photos.metas, m), due: mark !== undefined && backupDue(photos.metas, m),
  };
}
export type BackupStore = ReturnType<typeof useBackup>;
