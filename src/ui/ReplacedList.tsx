import { useState } from 'react';
import { combine, sides } from '../domain/replaced';
import { fmtDay } from '../domain/format';
import { localDate } from '../domain/ids';
import type { ReplacedStore } from '../state/useReplaced';

/**
 * Under the account or the backup file: what a sync or a restore replaced on this phone, each with both copies side by side, to put this phone's back
 * (or combine the two) or dismiss. Nothing at all while there's nothing.
 */
export function ReplacedList({ replaced }: { replaced: ReplacedStore }) {
  const [busy, setBusy] = useState<string | null>(null);
  const { list } = replaced;
  if (!list.length) return null;
  const today = localDate(new Date());
  const act = async (key: string, f: () => Promise<void>) => { setBusy(key); try { await f(); } finally { setBusy(null); } };
  return (
    <div className="replaced" role="group" aria-labelledby="replaced-h">
      <h3 id="replaced-h">Replaced by sync ({list.length})</h3>
      <p className="muted small">A sync put another phone’s copy in place of this phone’s. Each is kept here for 30 days.</p>
      <ul className="replaced-list" aria-label="Replaced by sync">
        {list.map((r) => {
          const s = sides(r);
          const both = r.kind === 'set' && r.theirs && combine(r.mine, r.theirs);
          return (
            <li key={r.key}>
              <p className="replaced-what"><b>{s.what}</b> <span className="muted">· {fmtDay(r.date, today)}</span></p>
              <div className="replaced-pair">
                <p><span className="muted small">This phone had</span> {s.mine}</p>
                <p><span className="muted small">Synced copy</span> {s.theirs}</p>
              </div>
              <div className="replaced-actions">
                <button type="button" disabled={busy === r.key} onClick={() => void act(r.key, () => replaced.keep(r))}>Keep this phone’s</button>
                {both && <button type="button" disabled={busy === r.key} onClick={() => void act(r.key, () => replaced.keep(r, true))}>Combine</button>}
                <button type="button" disabled={busy === r.key} onClick={() => void act(r.key, () => replaced.dismiss(r))}>Dismiss</button>
              </div>
            </li>
          );
        })}
      </ul>
      {replaced.error && <p role="alert" className="warn">{replaced.error}</p>}
    </div>
  );
}
