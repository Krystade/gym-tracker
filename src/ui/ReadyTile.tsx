import { useMemo, useState, type CSSProperties } from 'react';
import type { BodyStore } from '../state/useBody';
import type { Systemic } from '../domain/learn/deload';
import type { Slot } from '../domain/program';
import type { SetEntry } from '../domain/types';
import { Energy } from './Energy';
import { CycleRow } from './Cycle';
import { Icon } from './icons';
import { StatsSheet } from './StatsSheet';
import { MuscleSheet, MusclesSheet } from './StatsTiles';
import { BodyMap } from './body/BodyMap';
import { recoveryTone, recoveryTones, TONE_WORD } from './body/regions';
import type { Muscle } from '../domain/muscles';
import { WeighIn } from './WeighIn';
import { readyNow, stripView, tileView, whyView, type Planned, type ReadyInput, type StripView, type TileView, type WhyView } from './readyView';
import './ready.css';

/**
 * Owner, 2026-10-21 (IA A1, not yet confirmed): the week plan as a one-line Week row inside Ready, which a tap opens to the full
 * strip with each rest day's reason. False puts back the full strip under the tile, always shown.
 */
export const WEEK_ROW = true;

// Readiness S4 (20-readiness-plan §5, owner Q5): Today's READY tile, at the top, about today only. Its number, the verdict, the
// session it reads with its sets at full strength, the day it's fresh by (a day, never a time: owner Q2), and Why ›. The Energy
// chips (and the cycle row under them) live in it, and since IA A1 (owner, 2026-10-21) the weigh-in and a one-line Week row
// under them (WEEK_ROW). After the day's first working set it folds to one line; a tap opens it again. The week strip: the plan's
// days from today, each rest day's reason. Why › opens the sheet (Stats v2's).

/** The tile as the day started (`morning`), or as it is now once he has trained today and opens it again. */
export function ReadyCard({ input, morning, body, worked, sys, slots = [], onOpenLift, weekRow = WEEK_ROW }: {
  input: ReadyInput; morning: Planned; body: BodyStore;
  /** A working set logged today: the tile folds. */
  worked: boolean;
  /** learn/deload's read of today, for the Why sheet. */
  sys: Systemic | null;
  /** Today's plan as Today shows it (skips and swaps in): the muscles Why names. */
  slots?: readonly Slot[];
  /** A lift named in the muscles sheet: its screen. */
  onOpenLift?: (name: string) => void;
  /** The week as a one-line row inside the tile (WEEK_ROW); false: the full strip under it. */
  weekRow?: boolean;
}) {
  const [openPick, setOpen] = useState<boolean | null>(null);
  const [why, setWhy] = useState(false);
  // All muscles › in Why: the Stats Muscles sheet, in the Why sheet's place.
  const [muscles, setMuscles] = useState(false);
  // A muscle tapped on a body map (Why's, or the Muscles sheet's): its weeks, with a way back to where it was tapped.
  const [muscle, setMuscle] = useState<{ m: Muscle; from: 'why' | 'muscles' } | null>(null);
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
          <WeighIn body={body} date={input.today} row />
          {strip && weekRow && <WeekRow s={strip} />}
        </div>
      </section>
      {strip && !weekRow && <WeekStrip s={strip} />}
      {why && <WhySheet w={whyView(r, input, sys, slots)} t={t} onClose={() => setWhy(false)} onAllMuscles={() => { setWhy(false); setMuscles(true); }}
        onMuscle={(m) => { setWhy(false); setMuscle({ m, from: 'why' }); }} />}
      {muscles && (
        <StatsSheet title="Sets per muscle" onClose={() => setMuscles(false)}>
          <MusclesSheet entries={input.entries as SetEntry[]} profile={input.profile} today={input.today} body={input.body} program={input.program} onOpenLift={onOpenLift}
            onOpenMuscle={(m) => { setMuscles(false); setMuscle({ m, from: 'muscles' }); }} />
        </StatsSheet>
      )}
      {muscle && (
        <MuscleSheet entries={input.entries as SetEntry[]} profile={input.profile} today={input.today} muscle={muscle.m} onClose={() => setMuscle(null)}
          back={<button type="button" className="st-link st-back" onClick={() => { setMuscle(null); if (muscle.from === 'why') setWhy(true); else setMuscles(true); }}>
            <Icon name="chev-left" size={18} sw={2} />{muscle.from === 'why' ? 'Why' : 'Muscles'}</button>} />
      )}
    </>
  );
}

export function ReadyTile({ t, onWhy, onFold }: { t: TileView; onWhy: () => void; onFold?: () => void }) {
  const inline = !!t.session && !!t.fresh?.startsWith('Fresh');
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
          {/* "Fresh today" rides on the session's line (IA A1: a line less above the plan); "Next: …" keeps its own. */}
          {t.session && <p className="ready-line"><b>{t.session}</b>{t.sets && <> · {t.sets}</>}{inline && <> · {t.fresh!.charAt(0).toLowerCase()}{t.fresh!.slice(1)}</>}</p>}
          {t.fresh && !inline && <p className="ready-line">{t.fresh}</p>}
        </div>
      </div>
      {t.note && <p className="ready-note">{t.note}</p>}
    </div>
  );
}

/**
 * The week in one line inside Ready (IA A1): a mark for each day from today, and how far the goal is ("1 of 2"). A tap opens the
 * full strip in place, each training day's session and each rest day's reason.
 */
export function WeekRow({ s }: { s: StripView }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ready-week">
      <button type="button" className="rw-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="chip-label">Week</span>
        {open ? <span className="rw-goal-l">{s.goal}</span> : (
          <ol className="rw-days" aria-hidden="true" style={{ '--n': s.days.length } as CSSProperties}>
            {s.days.map((d) => <li key={d.date} data-mark={d.mark}><i className="ws-mark" /><span>{d.label}</span></li>)}
          </ol>
        )}
        <span className="rw-goal">{open ? null : s.count}<Icon name="chev-down" size={16} sw={2} className={open ? 'flip' : undefined} /></span>
        {!open && <span className="sr-only">{s.goal}: {s.days.map((d) => `${d.label} ${d.mark === 'rest' ? 'rest' : d.mark === 'optional' ? 'optional' : d.session ?? 'train'}`).join(', ')}</span>}
      </button>
      {open && <WeekStrip s={s} inTile />}
    </div>
  );
}

export function WeekStrip({ s, inTile = false }: { s: StripView; /** Inside Ready's Week row: no card or heading of its own. */ inTile?: boolean }) {
  return (
    <section className={inTile ? 'week-strip in-tile' : 'week-strip'} aria-label="Week plan">
      {!inTile && <div className="ws-head"><h2>Week plan</h2><span>{s.goal}</span></div>}
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

export function WhyBody({ w, t, onAllMuscles, onMuscle }: { w: WhyView; t: TileView; /** The Stats Muscles sheet. */ onAllMuscles?: () => void;
  /** A muscle tapped on the body map: its weeks. */ onMuscle?: (m: Muscle) => void }) {
  const tones = recoveryTones(w.muscles);
  const said = (['notyet', 'recovering'] as const).map((k) => { const ms = w.muscles.filter((m) => recoveryTone(m.pct) === k).map((m) => m.muscle); return ms.length ? `${TONE_WORD[k]}: ${ms.join(', ')}` : ''; }).filter(Boolean);
  const top = Math.max(1, ...w.today.map((v) => Math.max(v.band[1], v.done + v.add)));
  const pct = (x: number) => `${Math.min(100, (100 * x) / top).toFixed(1)}%`;
  return (
    <div className="why">
      <div className="why-hero">
        {t.number != null && <b>{t.number}</b>}
        <div><p className="why-v">{w.verdict}</p><p className="why-b">{w.because}</p></div>
      </div>
      {w.gain && <p className="why-gain">{w.gain}</p>}
      <h3>Your muscles</h3>
      {w.muscles.length > 0 && <BodyMap size="sm" tones={tones} onMuscle={onMuscle} label={`Recovery today: ${said.length ? said.join('; ') : 'every muscle ready'}`} />}
      {w.muscles.length ? (
        <table className="why-table">
          <thead><tr><th scope="col">Muscle</th><th scope="col">Last trained</th><th scope="col">Fresh by</th><th scope="col">Now</th></tr></thead>
          <tbody>
            {w.muscles.map((m) => (
              <tr key={m.muscle}><th scope="row">{m.muscle}</th><td>{m.last}</td><td>{m.fresh}</td><td className={recoveryTone(m.pct)}>{m.pct}%</td></tr>
            ))}
          </tbody>
        </table>
      ) : <p className="why-p">Nothing trained in the last two weeks.</p>}
      <p className="why-p small">Now: the chance the muscle is back to full strength today; 80% and up is ready, 50 to 79% recovering, under 50% not yet. Fresh by: the first day that’s better than even.</p>
      <dl className="why-lines">
        <div><dt>Recovery speeds</dt><dd>{w.source}</dd></div>
        <div><dt>Energy</dt><dd>{w.energy}</dd></div>
        <div><dt>Deload</dt><dd>{w.systemic}</dd></div>
        <div><dt>Pain</dt><dd>{w.pain.map((p) => <span key={p}>{p}</span>)}</dd></div>
      </dl>
      {/* IA A9 (owner, 2026-10-21): the muscles today's plan touches; every muscle is one tap on, in the Stats Muscles sheet. */}
      <h3>Today’s muscles</h3>
      {w.today.length > 0 ? <>
        <p className="why-p small">Pale: done this week. Gold: what today’s plan adds. The line under each bar is the muscle’s range.</p>
        <ul className="why-vol" aria-label="Today’s muscles">
          {w.today.map((v) => (
            <li key={v.muscle}>
              <span className="why-vol-m">{v.muscle}</span><span className="why-vol-n">{v.text}</span>
              <span className="why-bar" aria-hidden="true" style={{ '--done': pct(v.done), '--plan': pct(v.done + v.add), '--lo': pct(v.band[0]), '--hi': pct(v.band[1]) } as CSSProperties} />
            </li>
          ))}
        </ul>
      </> : <p className="why-p">No lifts planned today.</p>}
      {onAllMuscles && <button type="button" className="why-all" onClick={onAllMuscles}>All muscles<Icon name="chev-right" size={18} sw={2} /></button>}
    </div>
  );
}

function WhySheet({ w, t, onClose, onAllMuscles, onMuscle }: { w: WhyView; t: TileView; onClose: () => void; onAllMuscles: () => void; onMuscle: (m: Muscle) => void }) {
  return <StatsSheet title="Why" onClose={onClose}><WhyBody w={w} t={t} onAllMuscles={onAllMuscles} onMuscle={onMuscle} /></StatsSheet>;
}
