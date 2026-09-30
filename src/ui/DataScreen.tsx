import { useEffect, useState } from 'react';
import type { SetsStore } from '../state/useSets';
import { parseCsv, toCsv, type CsvError } from '../domain/csv';
import { exerciseNames, sessionsByDate } from '../domain/stats';
import { localDate } from '../domain/ids';
import { plural } from '../domain/format';

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
        <p>{plural(store.entries.length, 'set')} · {plural(sessions.length, 'session')} · {plural(exerciseNames(store.entries).length, 'lift')}</p>
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
