import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
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
import { readyNow, stripView, tileView, whyView, type Planned, type ReadyInput, type StripDay, type StripView, type TileView, type WhyView } from './readyView';
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
export function ReadyCard({ input, morning, body, worked, sys, slots = [], onOpenLift, onPickDay, weekRow = WEEK_ROW }: {
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
  /** A day of the Week row tapped (owner, 2026-10-23): Today shows that day. */
  onPickDay?: (date: string) => void;
}) {
  const [openPick, setOpen] = useState<boolean | null>(null);
  // The Week row's strip, opened from "Week 1 of 3" on the tile's top line.
  const [weekOpen, setWeekOpen] = useState(false);
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
  const strip = stripView(r, input.entries);
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
        <ReadyTile t={t} onWhy={() => setWhy(true)} onFold={worked ? () => setOpen(false) : undefined}
          week={strip && weekRow ? <WeekToggle s={strip} open={weekOpen} onToggle={() => setWeekOpen(!weekOpen)} /> : undefined} />
        <div className="ready-checkin">
          <Energy body={body} date={input.today} />
          <CycleRow date={input.today} />
          <WeighIn body={body} date={input.today} row />
          {strip && weekRow && <WeekRow s={strip} onPick={onPickDay} open={weekOpen} />}
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

/**
 * Owner, 2026-10-23: a day tapped in the Week row shows on Today in today's place, read only. Ready is about today, so it goes;
 * the Week row stays, at the top, the day shown with the pill, to tap another day or today again.
 */
export function WeekCard({ s, shown, onPick }: { s: StripView; shown: string; onPick: (date: string) => void }) {
  return <section className="ready-card week-card" aria-label="Week"><div className="ready-checkin"><WeekRow s={s} shown={shown} onPick={onPick} /></div></section>;
}

export function ReadyTile({ t, onWhy, onFold, week }: { t: TileView; onWhy: () => void; onFold?: () => void; /** The Week row's toggle, on the top line. */ week?: ReactNode }) {
  const inline = !!t.session && !!t.fresh?.startsWith('Fresh');
  return (
    <div className="ready-tile">
      <div className="ready-top">
        <span className="ready-k">Ready</span>
        <span className="ready-acts">
          {week}
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

/** What a day's mark says, for a screen reader. */
const said = (d: StripDay) => (d.mark === 'done' ? 'done' : d.mark === 'missed' || d.mark === 'rest' ? 'rest' : d.mark === 'optional' ? 'optional' : d.session ?? 'train');
/** A day's mark: a tick on a day he went. */
const Mark = ({ d }: { d: StripDay }) => <i className="ws-mark" aria-hidden="true">{d.mark === 'done' && <Icon name="check" size={10} sw={3.5} />}</i>;
/** A day as a tap says it: "Wed: done", "Fri, today: Day A". */
const dayName = (d: StripDay) => `${d.day}${d.today ? ', today' : ''}: ${said(d)}${d.mark === 'light' ? ', light' : ''}`;

/** "Week 1 of 3": a tap opens the strip in place (each training day's session, each rest day's reason). */
function WeekToggle({ s, open, onToggle, line = false }: { s: StripView; open: boolean; onToggle: () => void; /** A row of its own, over the days. */ line?: boolean }) {
  return (
    <button type="button" className={line ? 'rw-row' : 'ready-link rw-toggle'} aria-expanded={open} onClick={onToggle}>
      {line ? <span className="chip-label">Week</span> : <span>Week</span>}
      <span className="rw-goal">{s.count}<span className="sr-only"> done</span><Icon name="chev-down" size={16} sw={2} className={open ? 'flip' : undefined} /></span>
    </button>
  );
}

/**
 * The week inside Ready (IA A1): a mark for each day of the week (item 12: the days he went before today ticked), and under
 * "Week 1 of 3" (on the tile's top line, so the plan's first lift stays on the first screen) the strip in its place. Owner,
 * 2026-10-23: each day is a 44 × 44 tap that shows that day on Today (`onPick`); the day shown (today unless one was tapped) has
 * the pill. With no `open` given, its own toggle in a line over the days (a day shown in today's place, WeekCard).
 */
export function WeekRow({ s, shown, onPick, open: given }: { s: StripView; shown?: string; onPick?: (date: string) => void; open?: boolean }) {
  const [mine, setMine] = useState(false);
  const open = given ?? mine;
  const at = shown ?? s.days.find((d) => d.today)?.date;
  return (
    <div className={given == null ? 'ready-week' : 'ready-week bare'}>
      {given == null && <WeekToggle s={s} open={open} onToggle={() => setMine(!mine)} line />}
      {open ? <WeekStrip s={s} inTile shown={at} onPick={onPick} /> : (
        <ol className="rw-days" aria-label="This week" style={{ '--n': s.days.length } as CSSProperties}>
          {s.days.map((d) => (
            <li key={d.date} data-mark={d.mark} data-today={d.today || undefined} data-shown={d.date === at || undefined}>
              {onPick
                ? <button type="button" aria-label={dayName(d)} aria-pressed={d.date === at} onClick={() => onPick(d.date)}><Mark d={d} /><span>{d.short}</span></button>
                : <><Mark d={d} /><span aria-hidden="true">{d.short}</span><span className="sr-only">{dayName(d)}</span></>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function WeekStrip({ s, inTile = false, shown, onPick }: { s: StripView; /** Inside Ready's Week row: no card or heading of its own. */ inTile?: boolean;
  /** The day Today shows (the pill), and a day tapped: as the Week row's. */ shown?: string; onPick?: (date: string) => void }) {
  const at = shown ?? s.days.find((d) => d.today)?.date;
  return (
    <section className={inTile ? 'week-strip in-tile' : 'week-strip'} aria-label="Week plan">
      {!inTile && <div className="ws-head"><h2>Week plan</h2><span>{s.goal}</span></div>}
      <ol className="ws-days" aria-label="This week" style={{ '--n': s.days.length } as CSSProperties}>
        {s.days.map((d) => {
          const body = <><span className="ws-day">{d.label}</span><Mark d={d} /><span className="ws-s">{d.session ?? ''}</span></>;
          return (
            <li key={d.date} data-mark={d.mark} data-today={d.today || undefined} data-shown={d.date === at || undefined} aria-label={onPick ? undefined : dayName(d)}>
              {onPick ? <button type="button" className="ws-pick" aria-label={dayName(d)} aria-pressed={d.date === at} onClick={() => onPick(d.date)}>{body}</button> : body}
            </li>
          );
        })}
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
