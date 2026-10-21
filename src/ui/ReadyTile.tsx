import { useMemo, useState, type CSSProperties } from 'react';
import type { BodyStore } from '../state/useBody';
import type { Systemic } from '../domain/learn/deload';
import { Energy } from './Energy';
import { CycleRow } from './Cycle';
import { Icon } from './icons';
import { StatsSheet } from './StatsSheet';
import { readyNow, stripView, tileView, whyView, type Planned, type ReadyInput, type StripView, type TileView, type WhyView } from './readyView';
import './ready.css';

// Readiness S4 (20-readiness-plan §5, owner Q5): Today's READY tile, at the top, about today only. Its number, the verdict, the
// session it reads with its sets at full strength, the day it's fresh by (a day, never a time: owner Q2), and Why ›. The Energy
// chips (and the cycle row under them) live in it. After the day's first working set it folds to one line; a tap opens it again.
// Under it, the week strip: the plan's days from today, each rest day's reason. Why › opens the sheet (Stats v2's).

/** The tile as the day started (`morning`), or as it is now once he has trained today and opens it again. */
export function ReadyCard({ input, morning, body, worked, sys }: {
  input: ReadyInput; morning: Planned; body: BodyStore;
  /** A working set logged today: the tile folds. */
  worked: boolean;
  /** learn/deload's read of today, for the Why sheet. */
  sys: Systemic | null;
}) {
  const [openPick, setOpen] = useState<boolean | null>(null);
  const [why, setWhy] = useState(false);
  const open = openPick ?? !worked;
  // After the first set, opened again: the plan with today's session in it (computed only then).
  const live = worked && (open || why);
  const r = useMemo(() => (live ? readyNow(input) : morning), [live, input, morning]);
  const t = tileView(r);
  const strip = stripView(r);
  if (!open) {
    const energy = body.days.find((d) => d.date === input.today)?.energy;
    return (
      <section className="ready-card folded" aria-label="Ready">
        <button type="button" className="ready-fold" aria-expanded={false} onClick={() => setOpen(true)}>
          {t.number != null && <b className="ready-n-sm">{t.number}</b>}
          <span className="ready-fold-t">Ready{energy != null ? <span> · Energy {energy}</span> : null}</span>
          <Icon name="chev-down" size={18} sw={2} />
        </button>
      </section>
    );
  }
  return (
    <>
      <section className="ready-card" aria-label="Ready" data-kind={t.kind}>
        <ReadyTile t={t} onWhy={() => setWhy(true)} onFold={worked ? () => setOpen(false) : undefined} />
        <div className="ready-checkin">
          <Energy body={body} date={input.today} />
          <CycleRow date={input.today} />
        </div>
      </section>
      {strip && <WeekStrip s={strip} />}
      {why && <WhySheet w={whyView(r, input, sys)} t={t} onClose={() => setWhy(false)} />}
    </>
  );
}

export function ReadyTile({ t, onWhy, onFold }: { t: TileView; onWhy: () => void; onFold?: () => void }) {
  return (
    <div className="ready-tile">
      <div className="ready-top">
        <span className="ready-k">Ready</span>
        <span className="ready-acts">
          {onFold && <button type="button" className="ready-link" aria-expanded={true} aria-label="Fold Ready" onClick={onFold}><Icon name="chev-down" size={18} sw={2} className="flip" /></button>}
          <button type="button" className="ready-link" onClick={onWhy}>Why <Icon name="chev-right" size={16} sw={2} /></button>
        </span>
      </div>
      <div className="ready-main">
        {t.number != null && <b className="ready-n" aria-label={`Ready ${t.number}`}>{t.number}</b>}
        <div className="ready-say">
          <p className="ready-verdict">{t.verdict}</p>
          {t.session && <p className="ready-line"><b>{t.session}</b>{t.sets && <> · {t.sets}</>}</p>}
          {t.fresh && <p className="ready-line">{t.fresh}</p>}
        </div>
      </div>
      {t.note && <p className="ready-note">{t.note}</p>}
    </div>
  );
}

export function WeekStrip({ s }: { s: StripView }) {
  return (
    <section className="week-strip" aria-label="Week plan">
      <div className="ws-head"><h2>Week plan</h2><span>{s.goal}</span></div>
      <ol className="ws-days" style={{ '--n': s.days.length } as CSSProperties}>
        {s.days.map((d) => (
          <li key={d.date} data-mark={d.mark} aria-label={`${d.label}: ${d.mark === 'rest' ? 'rest' : d.mark === 'optional' ? 'optional' : d.session ?? 'train'}${d.mark === 'light' ? ', light' : ''}`}>
            <span className="ws-day">{d.label}</span>
            <i className="ws-mark" aria-hidden="true" />
            <span className="ws-s">{d.session ?? ''}</span>
          </li>
        ))}
      </ol>
      {s.reasons.length > 0 && (
        <ul className="ws-why">
          {s.reasons.map((x) => <li key={x.label}><b>{x.days}</b><span>{x.label}</span></li>)}
        </ul>
      )}
    </section>
  );
}

export function WhyBody({ w, t }: { w: WhyView; t: TileView }) {
  const top = Math.max(1, ...w.volume.map((v) => Math.max(v.band[1], v.planned)));
  const pct = (x: number) => `${Math.min(100, (100 * x) / top).toFixed(1)}%`;
  return (
    <div className="why">
      <div className="why-hero">
        {t.number != null && <b>{t.number}</b>}
        <div><p className="why-v">{w.verdict}</p><p className="why-b">{w.because}</p></div>
      </div>
      {w.gain && <p className="why-gain">{w.gain}</p>}
      <h3>Your muscles</h3>
      {w.muscles.length ? (
        <table className="why-table">
          <thead><tr><th scope="col">Muscle</th><th scope="col">Last trained</th><th scope="col">Fresh by</th><th scope="col">Now</th></tr></thead>
          <tbody>
            {w.muscles.map((m) => (
              <tr key={m.muscle}><th scope="row">{m.muscle}</th><td>{m.last}</td><td>{m.fresh}</td><td className={m.pct > 50 ? 'ok' : 'warn'}>{m.pct}%</td></tr>
            ))}
          </tbody>
        </table>
      ) : <p className="why-p">Nothing trained in the last two weeks.</p>}
      <p className="why-p small">Now: the chance the muscle is back to full strength today. Fresh by: the first day that’s better than even.</p>
      <dl className="why-lines">
        <div><dt>Recovery speeds</dt><dd>{w.source}</dd></div>
        <div><dt>Energy</dt><dd>{w.energy}</dd></div>
        <div><dt>Deload</dt><dd>{w.systemic}</dd></div>
        <div><dt>Pain</dt><dd>{w.pain.map((p) => <span key={p}>{p}</span>)}</dd></div>
      </dl>
      {w.volume.length > 0 && <>
        <h3>This week’s sets</h3>
        <p className="why-p small">Pale: done this week. Gold: with the plan done. The line under each bar is the muscle’s range.</p>
        <ul className="why-vol">
          {w.volume.map((v) => (
            <li key={v.muscle}>
              <span className="why-vol-m">{v.muscle}</span><span className="why-vol-n">{v.text}</span>
              <span className="why-bar" aria-hidden="true" style={{ '--done': pct(v.done), '--plan': pct(Math.max(v.done, v.planned)), '--lo': pct(v.band[0]), '--hi': pct(v.band[1]) } as CSSProperties} />
            </li>
          ))}
        </ul>
      </>}
    </div>
  );
}

function WhySheet({ w, t, onClose }: { w: WhyView; t: TileView; onClose: () => void }) {
  return <StatsSheet title="Why" onClose={onClose}><WhyBody w={w} t={t} /></StatsSheet>;
}
