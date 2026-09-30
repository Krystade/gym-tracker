import { useState } from 'react';
import type { SetsStore } from '../state/useSets';
import type { SettingsStore } from '../state/useSettings';
import { bestSet, currentE1rm, e1rmSeries, estimateWeightForReps, sessionsFor } from '../domain/stats';
import { estimateRir, priorE1rm } from '../domain/progression';
import { fmtDate, fmtSet, fmtWeight } from '../domain/format';
import { LineChart } from './LineChart';
import { SetRowContent } from './SetRow';

const lb = (n: number) => fmtWeight(Math.round(n));

function SettingsEditor({ name, settings }: { name: string; settings: SettingsStore }) {
  const cur = settings.get(name);
  const [min, setMin] = useState(String(cur.repMin));
  const [max, setMax] = useState(String(cur.repMax));
  const [inc, setInc] = useState(String(cur.increment));
  const [saved, setSaved] = useState(false);
  const vMin = Number(min), vMax = Number(max), vInc = Number(inc);
  const valid = Number.isInteger(vMin) && Number.isInteger(vMax) && vMin >= 1 && vMax >= vMin && vMax <= 50 && vInc > 0 && vInc <= 50;
  return (
    <section className="card" role="group" aria-label="Progression settings">
      <p className="muted small">Double progression: stay at a weight until every working set reaches max reps, then add the increment.</p>
      <div className="settings-grid">
        <label>Min reps<input aria-label="Min reps" inputMode="numeric" value={min} onChange={(e) => { setMin(e.target.value); setSaved(false); }} /></label>
        <label>Max reps<input aria-label="Max reps" inputMode="numeric" value={max} onChange={(e) => { setMax(e.target.value); setSaved(false); }} /></label>
        <label>Increment (lb)<input aria-label="Increment" inputMode="decimal" value={inc} onChange={(e) => { setInc(e.target.value.replace(',', '.')); setSaved(false); }} /></label>
      </div>
      <button className="wide" disabled={!valid} onClick={async () => { await settings.save({ key: cur.key, repMin: vMin, repMax: vMax, increment: vInc }); setSaved(true); }}>
        {saved ? 'Saved' : 'Save settings'}
      </button>
    </section>
  );
}

export function ExerciseScreen({ name, store, settings, onBack }: { name: string; store: SetsStore; settings: SettingsStore; onBack: () => void }) {
  const sessions = sessionsFor(store.entries, name);
  const series = e1rmSeries(store.entries, name);
  const current = currentE1rm(series);
  const best = bestSet(store.entries, name);
  return (
    <>
      <button onClick={onBack}>‹ Back</button>
      <h1>{name}</h1>
      <div className="tiles">
        <div className="tile"><span>Est. 1RM</span><b>{current ? lb(current) : '—'}</b></div>
        <div className="tile"><span>Est. 6RM</span><b>{current ? lb(estimateWeightForReps(current, 6)) : '—'}</b></div>
        <div className="tile"><span>Best set{best ? ` · ${best.set.date}` : ''}</span><b>{best ? fmtSet(best.set) : '—'}</b></div>
        <div className="tile"><span>Sessions</span><b>{sessions.length}</b></div>
      </div>
      <SettingsEditor key={name} name={name} settings={settings} />
      <section className="card">
        <LineChart points={series} />
        {series.length > 1 && <p className="muted small">Best estimated 1RM per session · PRs filled</p>}
      </section>
      {sessions.map((s) => {
        const prior = priorE1rm(store.entries, name, s.date);
        return (
          <section className="card" key={s.date}>
            <p><b>{fmtDate(s.date)}</b></p>
            <ol className="sets">
              {s.sets.map((x) => (
                <li key={x.id} className="set-row"><SetRowContent s={x} estRir={estimateRir(x, s.sets, prior)} /></li>
              ))}
            </ol>
          </section>
        );
      })}
    </>
  );
}
