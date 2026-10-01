import { useEffect, useState } from 'react';
import type { SetsStore } from '../state/useSets';
import type { ProfileStore } from '../state/useProfile';
import type { BodyStore } from '../state/useBody';
import type { SyncStore } from '../state/useSync';
import { SyncCard } from './SyncCard';
import { PeopleCard } from './PeopleCard';
import type { PeopleStore } from '../state/usePeople';
import { parseBodyFile, toBodyCsv, type CsvKind } from '../domain/body';
import { parseProfileJson } from '../domain/profile';
import { parseAliasesJson } from '../domain/notes';
import { getAliases, putAliases } from '../db/db';
import { parseCsv, toCsv, type CsvError } from '../domain/csv';
import { exerciseNames, sessionsByDate } from '../domain/stats';
import { localDate } from '../domain/ids';
import { plural } from '../domain/format';

const KIND: Partial<Record<CsvKind, string>> = { body: 'Body data', 'mfp-weight': 'MyFitnessPal weight', 'mfp-nutrition': 'MyFitnessPal nutrition' };

export function DataScreen({ store, profile, body, sync, people, onOpenPaste }: { store: SetsStore; profile: ProfileStore; body: BodyStore; sync: SyncStore; people: PeopleStore; onOpenPaste: () => void }) {
  const [bodyMsgs, setBodyMsgs] = useState<{ ok: boolean; text: string }[]>([]);
  const [result, setResult] = useState<{ added: number; updated: number; errors: CsvError[] } | null>(null);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => { void navigator.storage?.persisted?.().then(setPersisted); }, []);
  const sessions = sessionsByDate(store.entries);

  async function onFiles(files: File[]) {
    setResult(null); setProfileMsg(null); setBodyMsgs([]);
    for (const f of files) await onFile(f);
  }

  async function onFile(file: File) {
    let text: string;
    try { text = await file.text(); } catch (e) { setResult({ added: 0, updated: 0, errors: [{ row: 0, message: `Could not read the file: ${String(e)}` }] }); return; }
    if (/\.json$/i.test(file.name)) {
      const al = parseAliasesJson(text);
      if (al) {
        try { await putAliases({ ...(await getAliases()), ...al.aliases }); } catch (e) { setProfileMsg({ ok: false, text: `Saving the name mappings failed: ${String(e)}` }); return; }
        setProfileMsg({ ok: true, text: `Name mappings imported: ${Object.keys(al.aliases).length}${al.skipped ? ` (${al.skipped} skipped)` : ''}` });
        return;
      }
      const r = parseProfileJson(text);
      if ('error' in r) { setProfileMsg({ ok: false, text: r.error }); return; }
      try { await profile.save(r.profile); } catch (e) { setProfileMsg({ ok: false, text: `Saving the profile failed: ${String(e)}` }); return; }
      const n = Object.values(r.profile.tiers).filter((t) => t !== 3).length;
      setProfileMsg({ ok: true, text: `Profile imported: ${n} muscles prioritised` });
      return;
    }
    const b = parseBodyFile(text);
    if (KIND[b.kind]) {
      const ok = b.days.length > 0 && (await body.importDays(b.days));
      const skipped = b.errors.length ? ` · ${plural(b.errors.length, 'row')} skipped (row ${b.errors.slice(0, 5).map((e) => e.row).join(', ')})` : '';
      setBodyMsgs((m) => [...m, { ok, text: `${KIND[b.kind]}: ${plural(b.days.length, 'day')}${skipped}` }]);
      return;
    }
    const { entries, errors } = parseCsv(text, file.name.replace(/\.csv$/i, ''));
    const r = await store.importEntries(entries);
    if (r) setResult({ ...r, errors });
  }

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
      <h1>Data</h1>
      <section className="card">
        <p>{plural(store.entries.length, 'set')} · {plural(sessions.length, 'session')} · {plural(exerciseNames(store.entries).length, 'lift')}</p>
        {sessions.length > 0 && <p className="muted">{sessions.at(-1)!.date} → {sessions[0].date}</p>}
        <p className={persisted === false ? 'warn' : 'muted'}>
          {persisted ? 'Storage is persistent.' : persisted === false ? 'Storage not marked persistent — export a backup regularly.' : 'Storage status unknown.'}
        </p>
      </section>
      <section className="card">
        <label className="button primary wide">Import CSV
          <input type="file" multiple accept=".csv,.json,text/csv,application/json" hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void onFiles(fs); }} />
        </label>
        <button className="wide" onClick={onOpenPaste}>Paste from notes</button>
        <p className="muted small">History CSV, a name-mappings or priority profile .json, body.csv, or MyFitnessPal’s export (unzip it in Files, then pick Measurement-Summary and Nutrition-Summary together).</p>
        {bodyMsgs.map((m) => <p key={m.text} role="status" className={m.ok ? '' : 'warn'}>{m.text}</p>)}
        {profileMsg && <p role="status" className={profileMsg.ok ? '' : 'warn'}>{profileMsg.text}</p>}
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
        <button className="wide" onClick={() => void exportBody()} disabled={!body.days.length}>Export body CSV</button>
        {bodyFallback && (bodyFallback.startsWith('Copied')
          ? <p className="muted" role="status">{bodyFallback}</p>
          : <textarea className="csv" aria-label="Body CSV export" readOnly value={bodyFallback} onFocus={(e) => e.currentTarget.select()} />)}
      </section>
      <SyncCard sync={sync} newestSet={sessions[0]?.date ?? null} />
      <PeopleCard people={people} />
      <p className="muted small">Build {__BUILD_ID__} · {__BUILT_AT__.slice(0, 16).replace('T', ' ')} UTC</p>
    </>
  );
}
