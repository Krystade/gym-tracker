import { useState } from 'react';
import type { SetsStore } from '../state/useSets';
import type { SettingsStore } from '../state/useSettings';
import { bestSet, e1rmSeries, exerciseNames, sessionsFor } from '../domain/stats';
import type { GymsStore } from '../state/useGyms';
import { availableSet } from '../domain/equipment';
import { CATALOG } from '../domain/catalog';
import { calibrate, calibratedE1rm, testDue, weightForReps } from '../domain/estimators';
import { localDate } from '../domain/ids';
import { estimateRir, priorE1rm, rirOffset } from '../domain/progression';
import { fmtDate, fmtSet, fmtWeight, plural } from '../domain/format';
import { LineChart } from './LineChart';
import { SetRowContent } from './SetRow';
import { SwapSuggestions } from './SwapSuggestions';
import { swapSuggestions } from '../domain/care';
import type { ProgramStore } from '../state/useProgram';
import { nextTime, plannedSets } from '../domain/suggest';
import { todayPlanFor } from './TodayPlan';
import { SuggestionCard } from './SuggestionCard';

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

export function ExerciseScreen({ name, store, settings, gyms, programs, date, onLog, onBack }: {
  name: string; store: SetsStore; settings: SettingsStore; gyms: GymsStore; programs: ProgramStore; date: string; onLog: () => void; onBack: () => void;
}) {
  const { s: sug, trainedToday } = nextTime(store.entries, name, settings.get(name), date, plannedSets(programs.program, todayPlanFor(programs, store.entries, date), name));
  const sessions = sessionsFor(store.entries, name);
  const series = e1rmSeries(store.entries, name);
  const best = bestSet(store.entries, name);
  const cal = calibrate(store.entries, name);
  const current = calibratedE1rm(store.entries, name);
  const [n, setN] = useState(6);
  const due = testDue(store.entries, name, localDate(new Date()));
  const offset = rirOffset(store.entries, name);
  return (
    <>
      <button onClick={onBack}>‹ Back</button>
      <h1>{name}</h1>
      <SuggestionCard s={sug} onLog={trainedToday ? undefined : onLog} />
      <div className="tiles">
        <div className="tile"><span>Est. 1RM</span><b>{current ? lb(current) : '—'}</b></div>
        <div className="tile"><span>Est. {n}RM</span><b>{current ? lb(weightForReps(cal.formula, current, n)) : '—'}</b></div>
        <div className="tile"><span>Best set{best ? ` · ${best.set.date}` : ''}</span><b>{best ? fmtSet(best.set) : '—'}</b></div>
        <div className="tile"><span>Sessions</span><b>{sessions.length}</b></div>
      </div>
      <div className="chips" role="group" aria-label="Rep max">
        {[3, 5, 6, 8, 10].map((k) => <button key={k} type="button" className="chip" aria-pressed={n === k} onClick={() => setN(k)}>{k}RM</button>)}
      </div>
      <p className="muted small">{cal.tests ? `${cal.formula === 'wd' ? 'Weight-adjusted formula' : 'Epley'} · calibrated · ${plural(cal.tests, 'test')}${cal.errorPct != null ? ` · ±${Math.round(cal.errorPct)}%` : ''}` : 'Epley · no tests yet'}</p>
      {due && <p className="card note-card">Time for a test: pick a weight you can do about 8–12 times, go to failure with good form, and tick <b>Test</b>. It tunes these estimates.</p>}
      {sessions.length > 0 && <h2>History</h2>}
      {sessions.map((s) => {
        const prior = priorE1rm(store.entries, name, s.date);
        return (
          <section className="card" key={s.date}>
            <p><b>{fmtDate(s.date)}</b></p>
            <ol className="sets">
              {s.sets.map((x, i) => (
                <li key={x.id} className="set-row"><SetRowContent s={x} no={i + 1} estRir={estimateRir(x, s.sets, prior, offset)} /></li>
              ))}
            </ol>
          </section>
        );
      })}
      <SwapSuggestions items={swapSuggestions(name, store.entries, localDate(new Date()), 5, gyms.active ? availableSet(gyms.active, [...CATALOG, ...exerciseNames(store.entries), ...gyms.active.include]) : undefined)} />
      <SettingsEditor key={name} name={name} settings={settings} />
      <section className="card">
        <LineChart points={series} />
        {series.length > 1 && <p className="muted small">Best estimated 1RM per session · PRs filled</p>}
      </section>
    </>
  );
}
