import type { SetsStore } from '../state/useSets';
import { bestSet, currentE1rm, e1rmSeries, estimateWeightForReps, sessionsFor } from '../domain/stats';
import { fmtDate, fmtSet, fmtWeight } from '../domain/format';
import { LineChart } from './LineChart';

const lb = (n: number) => fmtWeight(Math.round(n));

export function ExerciseScreen({ name, store, onBack }: { name: string; store: SetsStore; onBack: () => void }) {
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
      <section className="card">
        <LineChart points={series} />
        {series.length > 1 && <p className="muted small">Best estimated 1RM per session · PRs filled</p>}
      </section>
      {sessions.map((s) => (
        <section className="card" key={s.date}>
          <p><b>{fmtDate(s.date)}</b></p>
          <ol className="sets">
            {s.sets.map((x) => (
              <li key={x.id} className="set-row">
                <span className="set-no">{x.setNo}</span>
                <span>{fmtSet(x)}</span>
                {x.rir != null && <span className="tag">RIR {x.rir}</span>}
                {x.flags.filter((f) => f !== 'bodyweight').map((f) => <span key={f} className={`tag ${f}`}>{f.replace('_', ' ')}</span>)}
                {x.note && <span className="note">{x.note}</span>}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
