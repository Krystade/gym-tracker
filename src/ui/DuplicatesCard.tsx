import { useMemo, useState } from 'react';
import type { SetsStore } from '../state/useSets';
import { findDuplicateImports, type DupField, type DuplicatePair } from '../domain/duplicates';
import { fmtDay, fmtSet, plural } from '../domain/format';
import { localDate } from '../domain/ids';
import type { SetEntry } from '../domain/types';

const BADGE: Partial<Record<string, string>> = { warmup: 'warm-up', pain: 'pain', unsure: '?', partial: 'partial', double_pulley: '2×pulley', hold: 'hold' };
const FIELD: Record<DupField, string> = { exercise: 'name', flags: 'tags', note: 'note', rir: 'RIR', pain: 'pain', tags: 'your tags', cardio: 'cardio' };

// The last removal, per profile, for Undo: kept for this visit to the app, through a trip to another tab.
const lastRemoved = new Map<string, SetEntry[]>();

function Copy({ e, label, differs }: { e: SetEntry; label: string; differs: DupField[] }) {
  const marked = (f: DupField) => (differs.includes(f) ? ' dupe-diff' : '');
  return (
    <p>
      <span className="muted small">{label} · {e.source}</span>
      <span className={marked('exercise').trim() || undefined}>{e.exercise} #{e.setNo}</span>
      <span>{fmtSet(e)} {e.flags.filter((f) => BADGE[f]).map((f) => <i key={f} className={`tag${marked('flags')}`}>{BADGE[f]}</i>)}
        {e.rir != null && <i className={`tag${marked('rir')}`}>RIR {e.rir}</i>}{e.painRegion && <i className={`tag pain${marked('pain')}`}>{e.painRegion}</i>}</span>
      {e.note && <span className={`small${marked('note')}`}>“{e.note}”</span>}
      {(e.tags ?? []).length > 0 && <span className={`small${marked('tags')}`}>{e.tags!.join(', ')}</span>}
    </p>
  );
}

/**
 * Data → Duplicate imports: sets two imports both brought in (a paste and a CSV of the same notes, say), found by
 * domain/duplicates. Shows how many and where, and every pair whose copies differ side by side; nothing changes until a
 * tap. Removing goes through the store's delete, so each set's tombstone syncs and every device drops it; Undo puts them back
 * stamped, so that wins in sync too. Nothing at all while there's nothing to show.
 */
export function DuplicatesCard({ store, profile, onBackup }: { store: SetsStore; profile: string; onBackup: () => Promise<void> }) {
  const found = useMemo(() => findDuplicateImports(store.entries), [store.entries]);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [backedUp, setBackedUp] = useState(false);
  const [removed, setRemoved] = useState<SetEntry[] | null>(() => lastRemoved.get(profile) ?? null);
  const [undone, setUndone] = useState<number | null>(null);
  const today = localDate(new Date());
  const n = found.pairs.length;
  if (!n && !removed && undone == null) return null;

  async function remove() {
    setBusy(true);
    const gone = found.pairs.map((p) => p.remove);
    if (await store.removeMany(gone.map((e) => e.id))) { lastRemoved.set(profile, gone); setRemoved(gone); setUndone(null); }
    setArmed(false); setBusy(false);
  }
  async function undo() {
    if (!removed) return;
    setBusy(true);
    if (await store.restoreMany(removed)) { lastRemoved.delete(profile); setUndone(removed.length); setRemoved(null); }
    setBusy(false);
  }
  const differing = found.pairs.filter((p) => p.differs.length);
  const sources = (ps: DuplicatePair[]) => [...new Set(ps.map((p) => `${p.remove.source} → ${p.keep.source}`))].join(', ');

  return (
    <>
      <h2>Duplicate imports</h2>
      <section className="card dupes" aria-label="Duplicate imports">
        {removed && (
          <div role="status" className="dupes-done">
            <p className="ok">✓ Removed {plural(removed.length, 'duplicate set')}. Every device that syncs drops them too.</p>
            <button className="wide" disabled={busy} onClick={() => void undo()}>Undo: put {plural(removed.length, 'set')} back</button>
          </div>
        )}
        {undone != null && !removed && <p role="status" className="muted">Put {plural(undone, 'set')} back.</p>}
        {n > 0 && (<>
          <p><b>{plural(n, 'set')}</b> came in twice, from two imports of the same {found.days.length === 1 ? 'day' : `${found.days.length} days`}.</p>
          <p className="muted small">{n - differing.length} {n - differing.length === 1 ? 'pair matches' : 'pairs match'} exactly{differing.length ? `; ${differing.length} differ, and the copy with more detail is kept` : ''}. Sets that are really repeated, like 3 × 100 × 12, all stay.</p>
          <details className="dupes-more">
            <summary>{plural(found.days.length, 'day')}</summary>
            <ul className="dupes-days" aria-label="Days imported twice">
              {found.days.map((d) => (
                <li key={d.date}>
                  <span><b>{fmtDay(d.date, today)}</b> <span className="muted small">{sources(d.pairs)}</span></span>
                  <span className="muted small">{plural(d.pairs.length, 'set')} · {d.lifts.join(', ')}</span>
                </li>
              ))}
            </ul>
          </details>
          {differing.length > 0 && (
            <details className="dupes-more">
              <summary>{differing.length} that differ</summary>
              <ul className="dupes-pairs" aria-label="Copies that differ">
                {differing.map((p) => (
                  <li key={p.remove.id}>
                    <p className="replaced-what"><b>{fmtDay(p.keep.date, today)}</b> <span className="muted small">· differs in {p.differs.map((f) => FIELD[f]).join(', ')}</span></p>
                    <div className="replaced-pair">
                      <Copy e={p.keep} label="Keep" differs={p.differs} />
                      <Copy e={p.remove} label="Remove" differs={p.differs} />
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <ol className="dupes-steps">
            <li>
              <span className="muted small">First, a copy of the whole log as it is now.</span>
              <button className="wide" disabled={busy} onClick={() => void onBackup().then(() => setBackedUp(true))}>{backedUp ? '✓ Backed up — again?' : 'Back up first (export CSV)'}</button>
            </li>
            <li>
              {!armed
                ? <button className="wide primary" disabled={busy} onClick={() => setArmed(true)}>Remove {plural(n, 'duplicate')}</button>
                : (
                  <div role="alert" className="import-confirm">
                    <p>Remove {plural(n, 'set')} from your log, here and on every device that syncs? Undo puts them back.</p>
                    <div className="form-actions">
                      <button className="primary" disabled={busy} onClick={() => void remove()}>Remove {n}</button>
                      <button autoFocus disabled={busy} onClick={() => setArmed(false)}>Cancel</button>
                    </div>
                  </div>
                )}
            </li>
          </ol>
        </>)}
      </section>
    </>
  );
}
