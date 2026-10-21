import { useMemo, useState } from 'react';
import type { SetEntry } from '../domain/types';
import { defaultSettings, isWorking } from '../domain/progression';
import { nextDay, type DayPlan, type Program, type Slot } from '../domain/program';
import { sameExercise } from '../domain/stats';
import { isHoldLift } from '../domain/care';
import type { ProgramStore } from '../state/useProgram';
import { hhmm, usualMinutes } from '../domain/timing';
import { paceBefore, sessionLengths, sizing, type Forecast, type Lengths, type Sizing } from '../domain/learn/session';
import { DELTA, kneePlan, restDelta } from '../domain/learn/rest';
import { warmupCount } from '../domain/suggest';
import { fmtLoad } from './SuggestionCard';
import { cardioTarget } from '../domain/cardio';
import { Icon } from './icons';
import { Input } from './Field';

const toMin = (s: number) => Math.round(s / 60);
/** His pace for a plan, as shown beside its length: the forecast and its middle 80 %. */
export const atPace = (f: Forecast) => `at your recent pace ≈ ${toMin(f.seconds)} min (${toMin(f.lo)}–${toMin(f.hi)})`;
/**
 * The length of a plan built to minutes, saying which number sized it (owner, 2026-10-20): his pace once 2 days are timed (with
 * the timer's rests beside it when over 10 min away), else the timer's rests and that his pace isn't known yet.
 */
export const sizedLength = (L: Lengths, by: Sizing['by']): string => `≈ ${toMin(sizedSeconds(L, by))} min ${sizedHow(L, by)}`;
/** The seconds that sized it: his pace's forecast, else the plan's. */
export const sizedSeconds = (L: Lengths, by: Sizing['by']): number => (by === 'pace' && L.pace ? L.pace.seconds : L.plan);
/** Which number that is, said after it. */
export const sizedHow = (L: Lengths, by: Sizing['by']): string => by === 'pace' && L.pace
  ? `at your pace (${toMin(L.pace.lo)}–${toMin(L.pace.hi)})${L.both ? ` · ${toMin(L.plan)} at the timer’s rests` : ''}`
  : 'at the timer’s rests · your pace sizes it after 2 timed days';

/** Done for the plan: a working set, or a cardio bout. */
const doneEntry = (e: SetEntry) => isWorking(e) || !!e.cardio;

/**
 * The day's plan: the one stored, else the suggested day (readiness S4: today's session in the week's plan, which may reorder the
 * days, owner Q3), else program.nextDay. He can still pick any day on the plan.
 */
export const todayPlanFor = (store: ProgramStore, entries: SetEntry[], date: string, suggested?: number | null): DayPlan | null => {
  if (!store.program) return null;
  const day = suggested != null && suggested >= 0 && suggested < store.program.days.length ? suggested : nextDay(store.program, store.plans, entries, date);
  return store.plans.find((x) => x.date === date) ?? { key: `day:${date}`, date, day, skips: [], swaps: {} };
};

const daySlots = (program: Program, plan: DayPlan): Slot[] => (plan.quick != null ? plan.slots ?? [] : (program.days[plan.day] ?? program.days[0]).slots);

/** The day's slots as he'll do them: skips left out, swaps under the names they're done under. */
export const planSlots = (program: Program, plan: DayPlan): Slot[] => daySlots(program, plan).filter((s) => !plan.skips.includes(s.exercise))
  .map((s) => (plan.swaps[s.exercise] ? { ...s, exercise: plan.swaps[s.exercise] } : s));

/** The day's lifts in plan order, by the names they're done under (swaps applied). */
export const plannedNames = (program: Program, plan: DayPlan): string[] => daySlots(program, plan).map((s) => plan.swaps[s.exercise] ?? s.exercise);

/** Cards in plan order: planned lifts fill the places planned lifts hold, in the plan's order; any other card keeps its place. */
export function inPlanOrder(cards: string[], planned: string[]): string[] {
  const at = (n: string) => planned.findIndex((p) => sameExercise(p, n));
  const queue = cards.filter((n) => at(n) >= 0).sort((a, b) => at(a) - at(b));
  return cards.map((n) => (at(n) >= 0 ? queue.shift()! : n));
}

/** The day's lifts not yet done and not skipped, by the names they're done under (swaps applied). */
export function leftToDo(program: Program, plan: DayPlan, entries: SetEntry[]): string[] {
  const day = { slots: daySlots(program, plan) };
  return day.slots.filter((s) => !plan.skips.includes(s.exercise)).map((s) => ({ ex: plan.swaps[s.exercise] ?? s.exercise, sets: s.sets }))
    .filter(({ ex, sets }) => entries.filter((e) => e.date === plan.date && sameExercise(e.exercise, ex) && doneEntry(e)).length < sets).map(({ ex }) => ex);
}

/** The day's slots to do, by the names they're done under (swaps applied, skips left out). */
const todoOf = (program: Program, plan: DayPlan) => daySlots(program, plan).filter((s) => !plan.skips.includes(s.exercise))
  .map((s) => ({ exercise: plan.swaps[s.exercise] ?? s.exercise, sets: s.sets, minutes: s.minutes }));

/**
 * The day's δ for his knees (item 17, learn/rest restDelta): the plan's own minutes for a Quick day or a program built by
 * minutes, else his usual session; raised only where the plan at his knees runs past it. The timer and the plan's length use it.
 */
export function dayRestDelta(program: Program, plan: DayPlan, entries: SetEntry[], keptRest?: (exercise: string) => number | undefined): number {
  if (!kneePlan(entries, plan.date)) return DELTA;
  const minutes = plan.quick ?? program.minutes ?? usualMinutes(entries, plan.date);
  return restDelta(entries, plan.date, todoOf(program, plan), minutes,
    { warmups: (ex) => warmupCount(entries, ex, plan.date), kept: keptRest, overhead: paceBefore(entries, plan.date)?.overhead ?? 0 });
}

/** `buildQuick`: a one-off day of lifts that fits, for the Quick chip. `restDelta`: the day's (dayRestDelta). */
export function TodayPlan({ program, plan, entries, past, open, onToggle, onEdit, onChange, onOpen, onSwap, buildQuick, loadFor, rangeFor, keptRest, restDelta: delta = DELTA }: {
  program: Program; plan: DayPlan; entries: SetEntry[]; past?: boolean; open: boolean; onToggle: () => void;
  /** The program's editor (IA A1: Edit on the plan's header, in place of the Today header's Program button). */
  onEdit?: () => void;
  onChange: (p: DayPlan) => void; onOpen: (exercise: string) => void; onSwap: (original: string) => void;
  buildQuick: (fits: (slots: Slot[]) => boolean) => Slot[];
  /** The weight the lift's card will suggest, if it has one. */
  loadFor?: (exercise: string, sets: number) => number | null;
  /** A lift's rep range from its settings, for one swapped in. */
  rangeFor?: (exercise: string, hold: boolean) => { repMin: number; repMax: number };
  /** His rest setting for a lift (the timer's base), if he's set one: the plan's rests. */
  keptRest?: (exercise: string) => number | undefined;
  restDelta?: number;
}) {
  const quick = plan.quick != null;
  const day = quick ? { name: 'Quick', slots: plan.slots ?? [] } : program.days[plan.day] ?? program.days[0];
  const [minutes, setMinutes] = useState(String(plan.quick ?? program.minutes ?? 30));
  const doneOf = (ex: string) => entries.filter((e) => e.date === plan.date && sameExercise(e.exercise, ex) && doneEntry(e)).length;
  const title = past ? 'Plan' : 'Today’s plan';
  // Warm-up counts per lift, worked out once per log change.
  const warm = useMemo(() => {
    const cache = new Map<string, number>();
    return (ex: string) => {
      const k = ex.toLowerCase();
      if (!cache.has(k)) cache.set(k, warmupCount(entries, ex, plan.date));
      return cache.get(k)!;
    };
  }, [entries, plan.date]);
  // Quick: as many pairs of sets as fit the minutes at his own pace (learn/session sizing); under 2 timed days, at the timer's
  // rests (his knees where in use, at the plain δ).
  const size = useMemo(() => sizing(entries, plan.date, { warmups: warm, kept: keptRest, knee: kneePlan(entries, plan.date) ?? undefined }), [entries, plan.date, warm, keptRest]);
  const pickQuick = (mins: number) => onChange({ ...plan, quick: mins, skips: [], swaps: {},
    slots: buildQuick((slots) => size.seconds(slots) <= mins * 60) });
  // Built to minutes: a Quick day, or a program day built by minutes.
  const byMinutes = quick || program.minutes != null;
  // A swapped-in lift's own range (a hold swapped for a lift counts seconds), as its card will show.
  const range = (slot: Slot, target: string) => {
    const hold = isHoldLift(target, entries);
    // The lift's range as its card will use it (its own, else the training goal's default); a slot's is what it was built with.
    const r = rangeFor?.(target, hold) ?? (target === slot.exercise ? slot : defaultSettings(target, hold));
    return `${r.repMin}–${r.repMax}${hold ? ' s hold' : ' reps'}`;
  };
  const live = day.slots.filter((s) => !plan.skips.includes(s.exercise));
  const finished = live.filter((s) => doneOf(plan.swaps[s.exercise] ?? s.exercise) >= s.sets).length;
  // The day in sets, for the bar under the header: each planned set a segment, lit once it's done (extra sets don't count).
  const total = live.reduce((n, s) => n + s.sets, 0);
  const setsDone = live.reduce((n, s) => n + Math.min(s.sets, doneOf(plan.swaps[s.exercise] ?? s.exercise)), 0);
  // The header (IA A1, owner 2026-10-21): "Day B · 14 sets · ≈ 41 min", Edit › beside it. The length is the plan's, sized as
  // the Program screen says it; what's left to say (his recent pace when over 10 min away, which number sized a minutes plan,
  // and once started when it ends at his pace) goes on the line under it, inside the toggle so it fills the 44 px tap area.
  const length = () => {
    const L = sessionLengths(entries, plan.date, todoOf(program, plan), { warmups: warm, kept: keptRest, delta });
    const when = L.started != null ? `started ${hhmm(new Date(L.started))} · ends ≈ ${hhmm(new Date(L.endsAt!))}` : null;
    const mins = toMin(byMinutes ? sizedSeconds(L, size.by) : L.plan);
    const more = [byMinutes ? sizedHow(L, size.by) : L.both ? atPace(L.pace!) : null, when].filter(Boolean);
    return <span className="plan-len" aria-label="Plan length">≈ {mins} min{more.length > 0 && <> <span className="plan-more">{more.map((x, i) => <span key={i}>{i > 0 && ' '}{x}</span>)}</span></>}</span>;
  };
  // Lift sets, as the Program screen counts a day (a cardio slot is minutes, not sets); how many are done once he's started.
  const liftSets = live.reduce((n, s) => n + (s.minutes == null ? s.sets : 0), 0);
  const liftDone = live.reduce((n, s) => n + (s.minutes == null ? Math.min(s.sets, doneOf(plan.swaps[s.exercise] ?? s.exercise)) : 0), 0);
  return (
    <section className="card plan" aria-label={title}>
      <div className="plan-head">
        <h2><button type="button" className="plan-toggle" aria-expanded={open} onClick={onToggle}>
          {/* "Today's plan" for a screen reader: the card's name, which the eye gets from where it sits. */}
          <span className="plan-title"><span className="sr-only">{title} · </span><b>{day.name}</b>
            {liftSets > 0 && <span className="plan-meta"> · {liftDone > 0 ? `${liftDone}/${liftSets}` : liftSets} sets</span>}
            {open ? <span className="plan-meta"> · {length()}</span> : <span className="plan-meta"> · {finished} of {live.length} done</span>}</span>
        </button></h2>
        {onEdit && <button type="button" className="plan-edit" aria-label="Edit plan" data-tour="program" onClick={onEdit}>Edit<Icon name="chev-right" size={18} sw={2} /></button>}
      </div>

      {open && (<>
      {total > 0 && (
        <div className="sets-progress">
          <div className="sets-bar" aria-hidden="true">{Array.from({ length: total }, (_, i) => <i key={i} className={i < setsDone ? 'on' : undefined} />)}</div>
        </div>
      )}
      <ol className="plan-slots" aria-label="Planned exercises">
        {day.slots.map((slot) => {
          const skipped = plan.skips.includes(slot.exercise);
          const target = plan.swaps[slot.exercise] ?? slot.exercise;
          const done = doneOf(target);
          return (
            <li key={slot.exercise} className={skipped ? 'skipped' : done >= slot.sets ? 'done' : ''} data-state={!skipped && done > 0 && done < slot.sets ? 'going' : undefined}>
              <button className="plan-name" data-exercise={target} disabled={skipped} onClick={() => { onChange(plan); onOpen(target); }}>
                <span className="slot-glyph" aria-hidden="true">{!skipped && done >= slot.sets && <Icon name="check" size={16} sw={2.75} />}</span>
                <b>{target}</b>
                {target !== slot.exercise && <span className="muted small">for {slot.exercise}</span>}
                {/* The count rides under the name, so the name gets the width it needs. */}
                <span className="muted small"><span className="plan-count">{skipped ? 'Skipped' : `${done}/${slot.sets}`}</span> · {slot.minutes != null
                  ? cardioTarget(entries, target, slot.minutes, plan.date).text
                  : <>{range(slot, target)}{!skipped && loadFor && <span className="plan-load">{fmtLoad(loadFor(target, slot.sets))}</span>}</>}</span>
              </button>
              <button type="button" onClick={() => onChange({ ...plan, skips: skipped ? plan.skips.filter((x) => x !== slot.exercise) : [...plan.skips, slot.exercise] })}>
                {skipped ? 'Undo' : 'Skip'}
              </button>
              {skipped ? <span aria-hidden="true" /> : <button type="button" onClick={() => onSwap(slot.exercise)}>Swap</button>}
            </li>
          );
        })}
      </ol>
      {/* Which day, under the lifts (IA A1): picked now and then, so the first lift and its target come first. */}
      <div className="chips seg-wide plan-days" role="group" aria-label="Program day">
        {program.days.map((d, i) => (
          <button key={d.name} type="button" className="chip" aria-pressed={!quick && i === plan.day} onClick={() => onChange({ ...plan, day: i, skips: [], swaps: {}, slots: undefined, quick: undefined })}>{d.name}</button>
        ))}
        <button type="button" className="chip" aria-pressed={quick} onClick={() => { if (!quick) pickQuick(Number(minutes) || 30); }}>Quick</button>
      </div>
      {quick && (
        <label className="quick-minutes">Minutes
          <Input aria-label="Minutes" inputMode="numeric" value={minutes} onChange={(e) => {
            setMinutes(e.target.value);
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 5 && n <= 180) pickQuick(n);
          }} />
          <span className="muted small">What your week is furthest behind on</span>
        </label>
      )}
      </>)}
    </section>
  );
}
