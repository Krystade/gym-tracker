import { useEffect, useMemo, useState } from 'react';
import type { SetsStore } from '../state/useSets';
import { getAliases, putAliases } from '../db/db';
import { CATALOG } from '../domain/catalog';
import { isHold } from '../domain/care';
import { fmtDate, fmtWeight, plural } from '../domain/format';
import { matchExercise, nameKey, parseNotes, toEntries, type NoteLine, type NoteSet } from '../domain/notes';
import { exerciseNames } from '../domain/stats';

const EXAMPLE = `9/28
Seated Row: 80x10 70x12 dropped the weight 70x12
Face Pull: skip
Bench press: 95x10, 115x8 2 RIR
Pull-ups: BWx8 -20x6
Plank: 45s 40s
9/29
Lat pulldown
100x12 100x10`;

const chip = (s: NoteSet): string =>
  s.flags.includes('hold') ? `${s.weight ? `${fmtWeight(s.weight)} lb · ` : ''}${s.reps ?? '—'} s` : `${s.weight === 0 ? 'BW' : fmtWeight(s.weight)}×${s.reps ?? '—'}`;
const BADGE: Partial<Record<string, string>> = { warmup: 'warm-up', pain: 'pain', unsure: '?', partial: 'partial', double_pulley: '2×pulley' };

export function PasteScreen({ store, today, onBack, onDone }: { store: SetsStore; today: string; onBack: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [raws, setRaws] = useState<string[] | null>(null);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [ignored, setIgnored] = useState<Set<number>>(new Set());
  const [include, setInclude] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void getAliases().then(setAliases).catch(() => setAliases({})); }, []);

  const known = useMemo(() => [...new Set([...exerciseNames(store.entries), ...CATALOG])], [store.entries]);
  const match = (name: string) => matchExercise(name, known, aliases);
  const resolve = (name: string) => overrides[nameKey(name)] ?? match(name).exercise;
  const lines = useMemo(() => (raws ? parseNotes(raws.join('\n'), today, (n) => isHold(resolve(n))) : []),
    [raws, today, overrides, aliases, known]);
  const built = useMemo(() => toEntries(lines, resolve, { ignored, include }, store.entries),
    [lines, ignored, include, store.entries]);
  const badName = lines.some((l) => l.kind === 'sets' && !ignored.has(l.index) && !resolve(l.name!).trim());
  const days = new Set(built.entries.map((e) => e.date)).size;

  async function add() {
    setBusy(true);
    const r = await store.importEntries(built.entries);
    if (r) {
      const changed = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v.trim()));
      if (Object.keys(changed).length) {
        const merged = { ...aliases, ...changed };
        setAliases(merged);
        try { await putAliases(merged); } catch { /* mappings are a convenience; the sets are saved */ }
      }
      setDone(`Added ${plural(built.entries.length, 'set')} from ${plural(days, 'day')} (${r.added} new, ${r.updated} updated).`);
    }
    setBusy(false);
  }

  if (done) return (
    <>
      <button onClick={onBack}>‹ Back</button>
      <h1>Paste from notes</h1>
      <p role="status" className="card">{done}</p>
      <button className="primary wide" onClick={onDone}>View history</button>
      <button className="wide" onClick={() => { setDone(null); setRaws(null); setText(''); setOverrides({}); setIgnored(new Set()); setInclude(new Set()); }}>Paste more</button>
    </>
  );

  if (!raws) return (
    <>
      <button onClick={onBack}>‹ Back</button>
      <h1>Paste from notes</h1>
      <label className="paste-label">Workout notes
        <textarea className="paste" rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} />
      </label>
      <button className="primary wide" disabled={!text.trim()} onClick={() => { setRaws(text.split(/\r?\n/)); window.scrollTo(0, 0); }}>Read notes</button>
      <details className="card paste-help">
        <summary>What can I paste?</summary>
        <p className="muted small">A date on its own line, then one exercise per line: a name, then sets as weight×reps. Lines before any date count as today.</p>
        <pre>{EXAMPLE}</pre>
        <p className="muted small">BW = bodyweight, −20 = assisted, 100x12x3 = three sets, 90x = didn’t count reps, 70x9? = unsure, 45s = a hold. Words after a set become its note; “WU”, “RIR” and pain words are picked up. Nothing is saved until you tap Add.</p>
      </details>
    </>
  );

  const row = (l: NoteLine) => {
    const off = ignored.has(l.index);
    const editBtn = <button className="mini" aria-label={`Edit line ${l.index + 1}`} onClick={() => setEditing(l.index)}>Edit</button>;
    const ignoreBtn = (l.kind === 'sets' || l.kind === 'unparsed') && (
      <button className="mini" aria-label={`${off ? 'Include' : 'Ignore'} line ${l.index + 1}`}
        onClick={() => setIgnored((s) => { const n = new Set(s); if (n.has(l.index)) n.delete(l.index); else n.add(l.index); return n; })}>{off ? 'Include' : 'Ignore'}</button>
    );
    if (editing === l.index) return (
      <li key={l.index} className="paste-line editing">
        <input aria-label={`Line ${l.index + 1} text`} autoFocus value={raws[l.index]}
          onChange={(e) => setRaws((r) => r!.map((x, i) => (i === l.index ? e.target.value : x)))}
          onKeyDown={(e) => { if (e.key === 'Enter') setEditing(null); }} />
        <span className="paste-preview muted small">{l.kind === 'sets' ? l.sets!.map(chip).join('  ') : l.kind === 'unparsed' ? l.reason : l.kind}</span>
        <button className="mini primary" onClick={() => setEditing(null)}>Done</button>
      </li>
    );
    if (l.kind === 'blank') return null;
    if (l.kind === 'date') return <li key={l.index} className="paste-date"><h2>{fmtDate(l.date)}</h2>{editBtn}</li>;
    if (l.kind === 'heading' || l.kind === 'skip') return (
      <li key={l.index} className="paste-line dim"><span>{l.kind === 'skip' ? `${l.name} — skipped` : l.raw.trim()}</span>{editBtn}</li>
    );
    if (l.kind === 'unparsed') return (
      <li key={l.index} className={`paste-line ${off ? 'dim' : 'bad'}`}>
        <span className="paste-raw">{l.raw.trim()}</span>
        {!off && <span className="warn small">{l.reason}</span>}
        <span className="paste-actions">{editBtn}{ignoreBtn}</span>
      </li>
    );
    const m = match(l.name!);
    const key = nameKey(l.name!);
    const ex = resolve(l.name!);
    const group = built.groups.find((g) => g.lines[0] === l.index && g.existing);
    const skipped = off || built.groups.some((g) => g.existing && g.lines.includes(l.index) && !include.has(g.key));
    return (
      <li key={l.index} className={`paste-line${skipped ? ' dim' : ''}`}>
        <input className="paste-name" list="known-exercises" aria-label={`Exercise on line ${l.index + 1}`} value={ex}
          onChange={(e) => setOverrides((o) => ({ ...o, [key]: e.target.value }))} />
        {ex !== l.name && <span className="muted small">as written: {l.name}</span>}
        {!(key in overrides) && m.how === 'fuzzy' && <span className="tag">matched — check the name</span>}
        {!(key in overrides) && m.how === 'new' && <span className="tag">new exercise</span>}
        <span className="paste-sets">
          {l.sets!.map((s, i) => (
            <span key={i} className="paste-set">{chip(s)}{s.flags.filter((f) => BADGE[f]).map((f) => <i key={f} className="tag">{BADGE[f]}</i>)}{s.rir != null && <i className="tag">RIR {s.rir}</i>}</span>
          ))}
        </span>
        {group && (
          <label className="paste-existing small">
            <input type="checkbox" checked={include.has(group.key)} onChange={(e) => setInclude((s) => { const n = new Set(s); if (e.target.checked) n.add(group.key); else n.delete(group.key); return n; })} />
            Already in your log — add anyway
          </label>
        )}
        <span className="paste-actions">{editBtn}{ignoreBtn}</span>
      </li>
    );
  };

  const unparsed = lines.filter((l) => l.kind === 'unparsed' && !ignored.has(l.index)).length;
  return (
    <>
      <button onClick={() => setRaws(null)}>‹ Edit the text</button>
      <h1>Check before adding</h1>
      <p className="muted small">Tap a name to change it (remembered next time). Edit a line to fix it; Ignore leaves it out.{unparsed > 0 && <b className="warn"> {plural(unparsed, 'line')} couldn’t be read.</b>}</p>
      <datalist id="known-exercises">{known.map((k) => <option key={k} value={k} />)}</datalist>
      <ul className="paste-list">{lines.map(row)}</ul>
      <div className="paste-footer">
        <button className="primary wide" disabled={busy || badName || built.entries.length === 0} onClick={() => void add()}>
          {built.entries.length ? `Add ${plural(built.entries.length, 'set')} from ${plural(days, 'day')}` : 'Nothing to add'}
        </button>
      </div>
    </>
  );
}
