import { useMemo, useState } from 'react';
import type { SetsStore } from '../state/useSets';
import { getPref, setPref } from '../state/prefs';
import { findPerSide, hasPerSide, totalOf, type PerSideSession } from '../domain/perSide';
import { markExcluded, toTotals } from '../domain/dayEdit';
import { fmtDay, fmtWeight, plural } from '../domain/format';
import { localDate } from '../domain/ids';
import type { SetEntry } from '../domain/types';

// More → Bar sets logged per side: a one-off review (domain/perSide). Bar sets from before the app, logged as the weight on
// each side, become the bar's total; old Smith machine sets are kept as logged and marked not used for learning or records; a
// session imported twice over loses its repeat. All through the store's own edit and delete (dayEdit, tombstones), stamped,
// so it syncs to every phone. One Apply, one Undo. Offered on More until applied or dismissed.

const PREF = 'per-side:done';
/** Whether More offers the review: something to review, and not yet applied or dismissed on this phone. */
export const perSideOffered = (entries: readonly SetEntry[], profile: string): boolean => !getPref(profile, PREF) && hasPerSide(findPerSide(entries));

// The last Apply, per profile, for Undo: kept for this visit to the app, through a trip to another tab.
const lastApplied = new Map<string, { before: SetEntry[]; removed: SetEntry[]; counts: [number, number, number] }>();

const key = (s: { exercise: string; date: string }) => `${s.date}|${s.exercise}`;
const sets = (xs: readonly SetEntry[], w: (e: SetEntry) => number = (e) => e.weight) => xs.map((e) => `${fmtWeight(w(e))} × ${e.reps ?? '?'}`).join(' · ');

export function PerSideReview({ store, profile, onBack }: { store: SetsStore; profile: string; onBack: () => void }) {
  const found = useMemo(() => findPerSide(store.entries), [store.entries]);
  const [flip, setFlip] = useState<Set<string>>(new Set()); // sessions ticked otherwise than proposed
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(() => lastApplied.get(profile) ?? null);
  const [undone, setUndone] = useState(false);
  const today = localDate(new Date());
  const ticked = (s: PerSideSession) => (s.reads === 'side') !== flip.has(key(s));
  const toggle = (s: PerSideSession) => setFlip((f) => { const n = new Set(f); if (n.has(key(s))) n.delete(key(s)); else n.add(key(s)); return n; });
  const convert = found.convert.filter(ticked).flatMap((s) => s.sets);
  const flagged = found.flag.flatMap((s) => s.sets);
  const gone = found.doubled.flatMap((d) => d.remove);
  const year = found.boundary?.slice(0, 4);

  async function apply() {
    setBusy(true);
    const before = [...convert, ...flagged];
    if (await store.updateMany([...toTotals(convert), ...markExcluded(flagged)]) && (!gone.length || await store.removeMany(gone.map((e) => e.id)))) {
      const done = { before, removed: gone, counts: [convert.length, flagged.length, gone.length] as [number, number, number] };
      lastApplied.set(profile, done); setApplied(done); setUndone(false);
      setPref(profile, PREF, 'applied');
    }
    setBusy(false);
  }
  async function undo() {
    if (!applied) return;
    setBusy(true);
    if (await store.updateMany(applied.before) && (!applied.removed.length || await store.restoreMany(applied.removed))) {
      lastApplied.delete(profile); setApplied(null); setUndone(true);
      setPref(profile, PREF, undefined);
    }
    setBusy(false);
  }
  function dismiss() { setPref(profile, PREF, 'dismissed'); onBack(); }

  if (applied) {
    const [c, f, r] = applied.counts;
    return (
      <section className="card perside" aria-label="Bar sets logged per side">
        <div role="status">
          <p className="ok">✓ Converted {plural(c, 'set')} to totals{f ? `, marked ${f} not used` : ''}{r ? `, removed ${plural(r, 'repeat')}` : ''}. Every device that syncs gets the same.</p>
          <button className="wide" disabled={busy} onClick={() => void undo()}>Undo: put {c + f + r === 1 ? 'it' : 'them'} back as logged</button>
        </div>
      </section>
    );
  }
  if (!hasPerSide(found)) return <p className="muted">{undone ? 'Put back as logged.' : 'Nothing logged per side.'}</p>;

  return (
    <section className="card perside" aria-label="Bar sets logged per side">
      {undone && <p role="status" className="muted">Put back as logged.</p>}
      <p>Before the app, these bar sets were logged as the weight on each side. Apply turns each ticked one into the total: 2 × side + {fmtWeight(totalOf(0))} for the bar.</p>
      {found.convert.length > 0 && (<>
        <h3>To totals <span className="muted small">{plural(convert.length, 'set')}</span></h3>
        <ul className="perside-list" aria-label="To totals">
          {found.convert.map((s) => (
            <li key={key(s)}>
              <label>
                <input type="checkbox" checked={ticked(s)} onChange={() => toggle(s)} />
                <span>
                  <b>{s.exercise}</b> <span className="muted small">{fmtDay(s.date, today)}</span>
                  <span className="perside-was">{sets(s.sets)}</span>
                  {ticked(s) && <span className="perside-now">→ {sets(s.sets, (e) => totalOf(e.weight))}</span>}
                  {s.reads === 'total' && <span className="muted small">Reads as totals already, so left unticked</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </>)}
      {found.flag.length > 0 && (<>
        <h3>Not used for learning or records <span className="muted small">{plural(flagged.length, 'set')}</span></h3>
        <p className="muted small">Smith machine sets from before {year}: a machine’s bar weighs what that one’s does, so these can’t be read either way. They stay as logged and show in History, marked; nothing learns from them and they set no record.</p>
        <details className="perside-more">
          <summary>{plural(found.flag.length, 'session')}</summary>
          <ul className="perside-list" aria-label="Not used for learning or records">
            {found.flag.map((s) => (
              <li key={key(s)}><span><b>{s.exercise}</b> <span className="muted small">{fmtDay(s.date, today)}</span><span className="perside-was">{sets(s.sets)}</span></span></li>
            ))}
          </ul>
        </details>
      </>)}
      {found.doubled.length > 0 && (<>
        <h3>Logged twice <span className="muted small">{plural(gone.length, 'set')}</span></h3>
        <ul className="perside-list" aria-label="Logged twice">
          {found.doubled.map((d) => (
            <li key={key(d)}><span><b>{d.exercise}</b> <span className="muted small">{fmtDay(d.date, today)}</span>
              <span className="perside-was">{sets(d.keep)}, then the same again: the repeat goes</span></span></li>
          ))}
        </ul>
      </>)}
      <button className="wide primary" disabled={busy || !(convert.length + flagged.length + gone.length)} onClick={() => void apply()}>Apply</button>
      <button className="wide" disabled={busy} onClick={dismiss}>Leave as logged, don’t ask again</button>
    </section>
  );
}
