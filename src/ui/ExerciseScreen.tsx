import { useState } from 'react';
import type { SetsStore } from '../state/useSets';
import type { SettingsStore } from '../state/useSettings';
import { bestSet, e1rmSeries, exerciseNames, sessionsFor, type SeriesPoint } from '../domain/stats';
import type { GymsStore } from '../state/useGyms';
import { availableSet } from '../domain/equipment';
import { CATALOG } from '../domain/catalog';
import { calibrate, calibratedE1rm, testDue, weightForReps } from '../domain/estimators';
import { localDate } from '../domain/ids';
import { addDays } from '../domain/analytics';
import { estimateRir, priorE1rm, rirOffset } from '../domain/progression';
import { fmtDay, fmtSet, fmtWeight, plural } from '../domain/format';
import { LineChart } from './LineChart';
import { SetRowContent } from './SetRow';
import { SwapSuggestions } from './SwapSuggestions';
import { isHoldLift, swapSuggestions } from '../domain/care';
import type { ProgramStore } from '../state/useProgram';
import { nextTime, plannedSets } from '../domain/suggest';
import { todayPlanFor } from './TodayPlan';
import { SuggestionCard } from './SuggestionCard';

const lb = (n: number) => `${fmtWeight(Math.round(n))} lb`;
const HISTORY_CAP = 10;

// Oldest first, like e1rmSeries; the value is seconds, so it reuses the chart's `e1rm` field.
function holdSeries(sessions: ReturnType<typeof sessionsFor>): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let top = -Infinity;
  for (const x of [...sessions].reverse()) {
    const vals = x.sets.map((e) => e.reps).filter((v): v is number => v != null && v > 0);
    if (!vals.length) continue;
    const v = Math.max(...vals);
    out.push({ date: x.date, e1rm: v, pr: v > top });
    top = Math.max(top, v);
  }
  return out;
}

function SettingsEditor({ name, settings, hold }: { name: string; settings: SettingsStore; hold: boolean }) {
  const cur = settings.get(name, hold);
  const [min, setMin] = useState(String(cur.repMin));
  const [max, setMax] = useState(String(cur.repMax));
  const [inc, setInc] = useState(String(cur.increment));
  const [saved, setSaved] = useState(false);
  const vMin = Number(min), vMax = Number(max), vInc = Number(inc);
  // A hold's range is in seconds; its increment is weight added once every hold reaches the top.
  const unit = hold ? 'seconds' : 'reps', top = hold ? 300 : 50;
  const whole = (v: number) => Number.isInteger(v) && v >= 1;
  const problem = !whole(vMin) || !whole(vMax) ? `Min and max ${unit} are whole numbers`
    : vMax < vMin ? `Max ${unit} can’t be below min ${unit}`
    : vMax > top ? `Max ${unit} go up to ${top}`
    : !(vInc > 0 && vInc <= 50) ? `${hold ? 'Added weight' : 'The increment'} is more than 0 and up to 50 lb`
    : null;
  const valid = !problem;
  return (
    <section className="card" role="group" aria-label="Progression settings">
      <p className="muted small">{hold
        ? 'Add 5 s each time until every hold reaches max seconds, then add weight or move to a harder variation.'
        : 'Double progression: stay at a weight until every working set reaches max reps, then add the increment.'}</p>
      <div className="settings-grid">
        <label>Min {unit}<input aria-label={`Min ${unit}`} inputMode="numeric" value={min} onChange={(e) => { setMin(e.target.value); setSaved(false); }} /></label>
        <label>Max {unit}<input aria-label={`Max ${unit}`} inputMode="numeric" value={max} onChange={(e) => { setMax(e.target.value); setSaved(false); }} /></label>
        <label>{hold ? 'Add weight (lb)' : 'Increment (lb)'}<input aria-label={hold ? 'Add weight' : 'Increment'} inputMode="decimal" value={inc} onChange={(e) => { setInc(e.target.value.replace(',', '.')); setSaved(false); }} /></label>
      </div>
      {problem && <p role="status" className="small err">{problem}</p>}
      <button className="wide" disabled={!valid} onClick={async () => { await settings.save({ ...cur, repMin: vMin, repMax: vMax, increment: vInc }); setSaved(true); }}>
        {saved ? 'Saved' : 'Save settings'}
      </button>
    </section>
  );
}

export function ExerciseScreen({ name, store, settings, gyms, programs, date, onLog, onBack }: {
  name: string; store: SetsStore; settings: SettingsStore; gyms: GymsStore; programs: ProgramStore; date: string; onLog: () => void; onBack: () => void;
}) {
  const hold = isHoldLift(name, store.entries);
  const { s: sug, trainedToday } = nextTime(store.entries, name, settings.get(name, hold), date, plannedSets(programs.program, todayPlanFor(programs, store.entries, date), name));
  const sessions = sessionsFor(store.entries, name);
  // A hold has no 1RM: its trend is the longest hold of each session, in seconds.
  const series = hold ? holdSeries(sessions) : e1rmSeries(store.entries, name);
  const longest = hold ? Math.max(0, ...series.map((p) => p.e1rm)) : 0;
  const best = bestSet(store.entries, name);
  const cal = calibrate(store.entries, name);
  const current = calibratedE1rm(store.entries, name);
  const [n, setN] = useState(6);
  const [all, setAll] = useState(false);
  const today = localDate(new Date());
  const snoozed = settings.get(name).testSnoozedUntil;
  const due = testDue(store.entries, name, today);
  const offset = rirOffset(store.entries, name);
  return (
    <>
      <button onClick={onBack}>‹ Back</button>
      <h1>{name}</h1>
      <SuggestionCard s={sug} onLog={trainedToday ? undefined : onLog} />
      {/* The chips sit right under the estimate they change, not over the chart (which is always e1RM). */}
      {!hold && <>
      <div className="tiles tiles-est">
        <div className="tile"><span>Est. 1RM</span><b>{current ? lb(current) : '—'}</b></div>
        <div className="tile"><span>Est. {n}RM</span><b>{current ? lb(weightForReps(cal.formula, current, n)) : '—'}</b></div>
      </div>
      <div className="chips" role="group" aria-label="Rep max">
        {[3, 5, 6, 8, 10].map((k) => <button key={k} type="button" className="chip" aria-pressed={n === k} onClick={() => setN(k)}>{k}RM</button>)}
      </div>
      <p className="muted small">{cal.tests ? `${cal.formula === 'wd' ? 'Weight-adjusted formula' : 'Epley'} · calibrated · ${plural(cal.tests, 'test')}${cal.errorPct != null ? ` · ±${Math.round(cal.errorPct)}%` : ''}` : 'Epley · no tests yet'}</p>
      </>}
      <div className="tiles">
        {hold
          ? <div className="tile"><span>Best hold</span><b>{longest ? `${longest} s` : '—'}</b></div>
          : <div className="tile"><span>Best set{best ? ` · ${fmtDay(best.set.date, today)}` : ''}</span><b>{best ? fmtSet(best.set).replace(/^(\d\S*) ×/, '$1 lb ×') : '—'}</b></div>}
        <div className="tile"><span>Sessions</span><b>{sessions.length}</b></div>
      </div>
      <section className="card">
        <LineChart points={series} today={today} {...(hold ? { label: 'Longest hold over time', unit: 's', noun: '', column: 'Longest hold (s)' } : {})} />
        {series.length > 1 && <p className="muted small">{hold ? 'Longest hold per session · PRs filled' : 'Best estimated 1RM per session · PRs filled'}</p>}
      </section>
      {!hold && due && !(snoozed && today < snoozed) && (
        <p className="card note-card test-due">
          <span>Time for a test: pick a weight you can do about 8–12 times, go to failure with good form, and tick <b>Test</b>. It tunes these estimates.</span>
          <button className="mini" onClick={() => void settings.save({ ...settings.get(name, hold), testSnoozedUntil: addDays(today, 14) })}>Not now</button>
        </p>
      )}
      {sessions.length > 0 && <h2>History</h2>}
      {(all ? sessions : sessions.slice(0, HISTORY_CAP)).map((s) => {
        const prior = priorE1rm(store.entries, name, s.date);
        return (
          <section className="card" key={s.date}>
            <p><b>{fmtDay(s.date, today)}</b></p>
            <ol className="sets">
              {s.sets.map((x, i) => (
                <li key={x.id} className="set-row"><SetRowContent s={x} no={i + 1} estRir={estimateRir(x, s.sets, prior, offset)} /></li>
              ))}
            </ol>
          </section>
        );
      })}
      {!all && sessions.length > HISTORY_CAP && <button className="wide" onClick={() => setAll(true)}>Show all {sessions.length} sessions</button>}
      <SwapSuggestions items={swapSuggestions(name, store.entries, today, 5, gyms.active ? availableSet(gyms.active, [...CATALOG, ...exerciseNames(store.entries), ...gyms.active.include]) : undefined)} />
      <SettingsEditor key={name} name={name} settings={settings} hold={hold} />
    </>
  );
}
