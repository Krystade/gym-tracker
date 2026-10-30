import { useEffect, type ReactNode } from 'react';
import type { BackupStore } from '../state/useBackup';
import { plural } from '../domain/format';

/** Said by the Download button, and by the nudge on Photos. */
const ONLY_HERE = 'Photos live only on this phone. Deleting the app or clearing website data and cookies wipes them.';

/** Today by its time, another day by its date. */
const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? `today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
};

/** Download, or Save once a built file waits for a tap of its own (state/useBackup). */
function DownloadButton({ backup, className }: { backup: BackupStore; className?: string }) {
  if (backup.ready) return <button className={className} onClick={backup.saveReady}>Save backup file</button>;
  return <button className={className} disabled={backup.busy != null} onClick={() => void backup.download()}>{backup.busy === 'download' ? 'Preparing…' : 'Download backup'}</button>;
}

const Status = ({ msg }: { msg: BackupStore['msg'] }) => msg && <p role="status" className={msg.ok ? 'ok' : 'warn'}>{msg.ok ? '✓ ' : ''}{msg.text}</p>;

/**
 * More › Backup: the backup file (domain/backup), its Download and Restore, and when the last one was. `replaced`: what a
 * restore or a sync replaced on this phone, when no account shows it.
 */
export function BackupCard({ backup, replaced }: { backup: BackupStore; replaced?: ReactNode }) {
  useEffect(() => backup.clear, []);
  const { mark, unbacked, due, busy } = backup;
  const last = mark === undefined ? null
    : mark?.at ? `Last backup ${when(mark.at)} · ${plural(mark.photos ?? 0, 'photo')}${unbacked ? `, ${unbacked} new since` : ''}`
    : `No backup yet${unbacked ? ` · ${plural(unbacked, 'photo')} not in one` : ''}`;
  return (
    <section className="card" aria-labelledby="backup-h">
      <h2 id="backup-h">Backup file</h2>
      <p className="muted small">Sets, body log, buddies and progress photos in one file, to keep in Files or iCloud Drive.</p>
      <DownloadButton backup={backup} className="primary wide" />
      {last && <p className={due ? 'warn small' : 'muted small'}>{last}</p>}
      <p className="small">{ONLY_HERE}</p>
      <label className="button wide" aria-disabled={busy ? true : undefined}>{busy === 'restore' ? 'Restoring…' : 'Restore from backup'}
        <input type="file" accept=".json,application/json" hidden disabled={busy != null} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void backup.restore(f); }} />
      </label>
      <p className="muted small">Adds what the file has that this phone doesn’t. Nothing is doubled up.</p>
      <Status msg={backup.msg} />
      {replaced}
    </section>
  );
}

/** On Photos: one quiet line once 3 photos have piled up without a backup (domain/backup backupDue), with Download and Not now. */
export function BackupNudge({ backup }: { backup: BackupStore }) {
  useEffect(() => backup.clear, []);
  const { due, unbacked, ready, busy, msg } = backup;
  if (!due && !ready && !busy && !msg) return null;
  return (
    <div className="backup-nudge" role="group" aria-label="Backup">
      {due && <p className="small"><b>{plural(unbacked, 'photo')} not backed up.</b> {ONLY_HERE}</p>}
      {(due || ready || busy) && (
        <div className="form-actions">
          <DownloadButton backup={backup} className="primary" />
          {due && !ready && <button disabled={busy != null} onClick={() => void backup.snooze()}>Not now</button>}
        </div>
      )}
      <Status msg={msg} />
    </div>
  );
}
