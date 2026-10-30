import { useEffect, useRef, useState } from 'react';
import type { SetsStore } from '../state/useSets';
import type { ProfileStore } from '../state/useProfile';
import type { BodyStore } from '../state/useBody';
import type { BackupStore } from '../state/useBackup';
import type { CloudStore } from '../state/useCloud';
import { BackupCard } from './BackupCard';
import { ReplacedList } from './ReplacedList';
import { useReplaced } from '../state/useReplaced';
import { parseBodyFile, stampDay, toBodyCsv, type CsvKind } from '../domain/body';
import { parseProfileJson } from '../domain/profile';
import { parseAliasesJson } from '../domain/notes';
import { useDb, useProfileId } from '../state/profileDb';
import { DuplicatesCard } from './DuplicatesCard';
import type { OverlapGroup } from '../domain/duplicates';
import { knownStoragePersistence, storagePersistence } from '../db/db';
import { parseCsv, toCsv, type CsvError } from '../domain/csv';
import { exerciseNames, sessionsByDate } from '../domain/stats';
import { localDate } from '../domain/ids';
import { fmtDay, plural } from '../domain/format';

const KIND: Partial<Record<CsvKind, string>> = { body: 'Body data', 'mfp-weight': 'MyFitnessPal weight', 'mfp-nutrition': 'MyFitnessPal nutrition' };

/**
 * More › Backup, import and export (IA plan A3): what the log holds and whether the phone keeps it, the backup file (Download and
 * Restore), Import (CSV, a profile or name-mappings .json, body and MyFitnessPal files), Paste from notes, Export, and duplicate imports.
 */
export function BackupScreen({ store, profile, body, backup, cloud, onOpenPaste }: {
  store: SetsStore; profile: ProfileStore; body: BodyStore; backup: BackupStore; cloud: CloudStore; onOpenPaste: () => void;
}) {
  const db = useDb();
  const profileId = useProfileId();
  const [bodyMsgs, setBodyMsgs] = useState<{ ok: boolean; text: string }[]>([]);
  const [result, setResult] = useState<{ added: number; updated: number; same: number; kept: boolean; held: number; errors: CsvError[] } | null>(null);
  const [ask, setAsk] = useState<{ what: string; changed: number; fresh: number } | { overlap: OverlapGroup[]; sets: number } | null>(null);
  const answer = useRef<((yes: boolean) => void) | null>(null);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null | undefined>(knownStoragePersistence);
  useEffect(() => { if (persisted === undefined) void storagePersistence().then(setPersisted); }, []);
  const sessions = sessionsByDate(store.entries);
  // What a restore or a sync replaced on this phone: here, under the backup file, when this person isn't the account's (else under Account).
  const replaced = useReplaced(store, body);

  async function onFiles(files: File[]) {
    setResult(null); setProfileMsg(null); setBodyMsgs([]);
    for (const f of files) await onFile(f);
  }

  async function onFile(file: File) {
    let text: string;
    try { text = await file.text(); } catch (e) { setResult({ added: 0, updated: 0, same: 0, kept: false, held: 0, errors: [{ row: 0, message: `Could not read the file: ${String(e)}` }] }); return; }
    if (/\.json$/i.test(file.name)) {
      // A backup file picked here: restored, as Restore from backup would.
      if (/^\s*\{"kind":"gym-tracker-backup"/.test(text)) { await backup.restore(file); return; }
      const al = parseAliasesJson(text);
      if (al) {
        try { await db.putAliases({ ...(await db.getAliases()), ...al.aliases }); } catch (e) { setProfileMsg({ ok: false, text: `Saving the name mappings failed: ${String(e)}` }); return; }
        setProfileMsg({ ok: true, text: `Name mappings imported: ${Object.keys(al.aliases).length}${al.skipped ? ` (${al.skipped} skipped)` : ''}` });
        return;
      }
      const r = parseProfileJson(text);
      if ('error' in r) { setProfileMsg({ ok: false, text: `Profile not imported: ${r.error}` }); return; }
      try { await profile.save(r.profile); } catch (e) { setProfileMsg({ ok: false, text: `Saving the profile failed: ${String(e)}` }); return; }
      const n = Object.values(r.profile.tiers).filter((t) => t !== 3).length;
      setProfileMsg({ ok: true, text: `Profile imported: ${n} muscles prioritised` });
      return;
    }
    const b = parseBodyFile(text);
    if (KIND[b.kind]) {
      const d = body.diff(b.days);
      const replace = d.changed.length > 0 && (await confirmReplace('day', d.changed.length, d.fresh.length));
      // Stamped as entered now, like a weigh-in typed in: another phone's older value for the day doesn't win them back in sync.
      const days = (replace ? [...d.fresh, ...d.changed] : d.fresh).map((x) => stampDay(x));
      const ok = b.days.length > 0 && (days.length === 0 || (await body.importDays(days)));
      const skipped = b.errors.length ? ` · ${plural(b.errors.length, 'row')} skipped (row ${b.errors.slice(0, 5).map((e) => e.row).join(', ')})` : '';
      const done = days.length === 0 && b.days.length > 0 ? 'nothing new' : plural(days.length, 'day');
      setBodyMsgs((m) => [...m, { ok, text: `${KIND[b.kind]}: ${done}${skipped}` }]);
      return;
    }
    const { entries, errors } = parseCsv(text, file.name.replace(/\.csv$/i, ''));
    const d = await store.diff(entries);
    const replace = d.changed.length > 0 && (await confirmReplace('set', d.changed.length, d.fresh.length));
    // A replaced set is an edit: stamped, so the other phone's older copy doesn't win it back in sync.
    const now = Date.now();
    // New sets on a day and lift the log already has from another import are held back unless added anyway, as the paste
    // screen does: two imports of one log would otherwise put every set in twice (domain/duplicates).
    const { held, groups } = d.overlap;
    const anyway = held.length > 0 && (await confirmOverlap(groups, held.length));
    const out = anyway ? new Set<string>() : new Set(held.map((e) => e.id));
    const fresh = d.fresh.filter((e) => !out.has(e.id));
    const list = replace ? [...fresh, ...d.changed.map((s) => ({ ...s, editedAt: now }))] : fresh;
    const r = list.length ? await store.importEntries(list) : { added: 0, updated: 0 };
    if (r) setResult({ ...r, same: d.same, kept: !replace && d.changed.length > 0, held: out.size, errors });
  }

  // A promise the confirm card's buttons settle, so a pick of several files asks about one file at a time.
  function confirmReplace(what: string, changed: number, fresh: number): Promise<boolean> {
    return new Promise((resolve) => { answer.current = resolve; setAsk({ what, changed, fresh }); });
  }
  function confirmOverlap(overlap: OverlapGroup[], sets: number): Promise<boolean> {
    return new Promise((resolve) => { answer.current = resolve; setAsk({ overlap, sets }); });
  }
  function choose(yes: boolean) { answer.current?.(yes); answer.current = null; setAsk(null); }

  const [fallback, setFallback] = useState<string | null>(null);
  const [bodyFallback, setBodyFallback] = useState<string | null>(null);

  // Installed iOS PWAs ignore <a download>, so: share sheet first, clipboard second, visible text last.
  async function exportCsv() { await share(toCsv(store.entries), `gym-log-${localDate(new Date())}.csv`, setFallback); }
  async function exportBody() { await share(toBodyCsv(body.days), `body-${localDate(new Date())}.csv`, setBodyFallback); }
  async function share(csv: string, name: string, setFallback: (s: string) => void) {
    const file = new File([csv], name, { type: 'text/csv' });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    } catch (e) { if ((e as Error).name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(csv); setFallback('Copied the CSV to the clipboard — paste it into Notes or Files.'); }
    catch { setFallback(csv); }
  }

  return (
    <>
      <section className="card" aria-label="Your log">
        <p>{plural(store.entries.length, 'set')} · {plural(sessions.length, 'session')} · {plural(exerciseNames(store.entries).length, 'lift')}</p>
        {sessions.length > 0 && <p className="muted">{fmtDay(sessions.at(-1)!.date, localDate(new Date()))} → {fmtDay(sessions[0].date, localDate(new Date()))}</p>}
        <p className={persisted === false ? 'warn' : 'muted'}>
          {persisted ? 'Storage is persistent.' : persisted === false ? 'Storage not marked persistent — download a backup regularly.' : 'Storage status unknown.'}
        </p>
      </section>
      <BackupCard backup={backup} replaced={cloud.mine ? undefined : <ReplacedList replaced={replaced} />} />
      <section className="card">
        {/* Off while the card asks, so a second pick can't leave the first file unanswered. */}
        <label className="button wide" aria-disabled={ask ? true : undefined}>Import CSV
          <input type="file" disabled={ask != null} multiple accept=".csv,.json,text/csv,application/json" hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void onFiles(fs); }} />
        </label>
        <button className="wide" onClick={onOpenPaste}>Paste from notes</button>
        <p className="muted small">History CSV, a name-mappings or priority profile .json, body.csv, or MyFitnessPal’s export (unzip it in Files, then pick Measurement-Summary and Nutrition-Summary together).</p>
        {ask && 'overlap' in ask && (
          <div role="alert" className="import-confirm">
            <p>{plural(ask.sets, 'set')} in this file {ask.sets === 1 ? 'is' : 'are'} on days and lifts your log already has from another import, most likely the same sets twice. They’re held back.</p>
            <ul className="overlap-list muted small">
              {ask.overlap.slice(0, 4).map((g) => <li key={`${g.date}|${g.exercise}|${g.source}`}>{fmtDay(g.date, localDate(new Date()))} · {g.exercise} ({plural(g.sets, 'set')}; in your log from {g.existingSource}{g.existing !== g.exercise ? ` as ${g.existing}` : ''})</li>)}
              {ask.overlap.length > 4 && <li>and {plural(ask.overlap.length - 4, 'more lift')}</li>}
            </ul>
            <div className="form-actions">
              <button onClick={() => choose(true)}>Add anyway</button>
              <button className="primary" autoFocus onClick={() => choose(false)}>Leave them out</button>
            </div>
          </div>
        )}
        {ask && !('overlap' in ask) && (
          <div role="alert" className="import-confirm">
            <p>This file changes {plural(ask.changed, ask.what)} already in your log{ask.fresh ? ` and adds ${plural(ask.fresh, `new ${ask.what}`)}` : ''}.</p>
            <div className="form-actions">
              <button className="primary" onClick={() => choose(true)}>Replace them</button>
              <button autoFocus onClick={() => choose(false)}>Only add new</button>
            </div>
          </div>
        )}
        {(bodyMsgs.length > 0 || profileMsg || result) && (
          <div className="import-result">
            {bodyMsgs.map((m) => <p key={m.text} role="status" className={m.ok ? 'ok' : 'warn'}>{m.ok ? '✓ ' : ''}{m.text}</p>)}
            {profileMsg && <p role="status" className={profileMsg.ok ? 'ok' : 'warn'}>{profileMsg.ok ? '✓ ' : ''}{profileMsg.text}</p>}
            {result && (
              <div role="status">
                {result.added + result.updated > 0
                  ? <p className="ok">✓ Imported {plural(result.added, 'new set')}{result.updated ? `, ${plural(result.updated, 'set')} updated` : ''}</p>
                  : result.errors.length > 0 || result.kept || result.held || !result.same ? <p className="warn">Nothing imported</p>
                  : <p className="muted">Nothing new: {plural(result.same, 'set')} already in your log</p>}
                {result.held > 0 && <p className="muted">{plural(result.held, 'set')} held back: already in your log from another import</p>}
                {result.errors.length > 0 && (<>
                  <p className="warn">{plural(result.errors.length, 'row')} skipped</p>
                  <ul className="errors">{result.errors.slice(0, 50).map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul>
                </>)}
              </div>
            )}
          </div>
        )}
        <button className="wide" onClick={() => void exportCsv()} disabled={!store.entries.length}>Export CSV</button>
        {fallback && (fallback.startsWith('Copied')
          ? <p className="muted" role="status">{fallback}</p>
          : <textarea className="csv" aria-label="CSV export" readOnly value={fallback} onFocus={(e) => e.currentTarget.select()} />)}
        <button className="wide" onClick={() => void exportBody()} disabled={!body.days.length}>Export body CSV</button>
        {bodyFallback && (bodyFallback.startsWith('Copied')
          ? <p className="muted" role="status">{bodyFallback}</p>
          : <textarea className="csv" aria-label="Body CSV export" readOnly value={bodyFallback} onFocus={(e) => e.currentTarget.select()} />)}
      </section>
      <DuplicatesCard store={store} profile={profileId} onBackup={exportCsv} />
    </>
  );
}
