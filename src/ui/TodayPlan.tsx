import { useMemo, useState } from 'react';
import type { SetEntry } from '../domain/types';
import { isWorking } from '../domain/progression';
import { nextDay, type DayPlan, type Program, type Slot } from '../domain/program';
import { sameExercise } from '../domain/stats';
import { isHoldLift } from '../domain/care';
import type { ProgramStore } from '../state/useProgram';
import { estimateSeconds, hhmm, paces, timedDay } from '../domain/timing';
import { warmupCount } from '../domain/suggest';

export const todayPlanFor = (store: ProgramStore, entries: SetEntry[], date: string): DayPlan | null => {
  if (!store.program) return null;
  return store.plans.find((x) => x.date === date)
    ?? { key: `day:${date}`, date, day: nextDay(store.program, store.plans, entries, date), skips: [], swaps: {} };
};

/** `buildQuick`: a one-off day of lifts that fits, for the Quick chip. */
export function TodayPlan({ program, plan, entries, past, open, onToggle, onChange, onOpen, onSwap, buildQuick }: {
  program: Program; plan: DayPlan; entries: SetEntry[]; past?: boolean; open: boolean; onToggle: () => void;
  onChange: (p: DayPlan) => void; onOpen: (exercise: string) => void; onSwap: (original: string) => void;
  buildQuick: (fits: (slots: Slot[]) => boolean) => Slot[];
}) {
  const quick = plan.quick != null;
  const day = quick ? { name: 'Quick', slots: plan.slots ?? [] } : program.days[plan.day] ?? program.days[0];
  const [minutes, setMinutes] = useState(String(plan.quick ?? program.minutes ?? 30));
  const doneOf = (ex: string) => entries.filter((e) => e.date === plan.date && sameExercise(e.exercise, ex) && isWorking(e)).length;
  const title = past ? 'Plan' : 'Today’s plan';
  const pace = useMemo(() => paces(entries), [entries]);
  // Warm-up counts per lift, worked out once per log change.
  const warm = useMemo(() => {
    const cache = new Map<string, number>();
    return (ex: string) => {
      const k = ex.toLowerCase();
      if (!cache.has(k)) cache.set(k, warmupCount(entries, ex, plan.date));
      return cache.get(k)!;
    };
  }, [entries, plan.date]);
  // Quick: as many pairs of sets as fit the minutes, from your own pace with warm-ups.
  const pickQuick = (mins: number) => onChange({ ...plan, quick: mins, skips: [], swaps: {},
    slots: buildQuick((slots) => estimateSeconds(slots, pace, warm) <= mins * 60) });
  const live = day.slots.filter((s) => !plan.skips.includes(s.exercise));
  const finished = live.filter((s) => doneOf(plan.swaps[s.exercise] ?? s.exercise) >= s.sets).length;
  // The second line of the header: how long it runs when open, how far along when folded. Inside the
  // toggle, so it fills the 44 px tap area instead of sitting under it.
  const length = () => {
    const todo = live.map((s) => ({ exercise: plan.swaps[s.exercise] ?? s.exercise, sets: s.sets }));
    const mins = Math.round(estimateSeconds(todo, pace, warm) / 60);
    const first = timedDay(entries, plan.date)[0];
    const start = first ? new Date(first.loggedAt!) : null;
    return <span className="muted small" aria-label="Plan length">≈ {mins} min{start && ` · started ${hhmm(start)} · ends ≈ ${hhmm(new Date(start.getTime() + mins * 60_000))}`}</span>;
  };
  return (
    <section className="card plan" aria-label={title}>
      <h2><button type="button" className="plan-toggle" aria-expanded={open} onClick={onToggle}>
        <span>{title} · {day.name}</span>
        {open ? length() : <span className="muted small">{finished} of {live.length} done</span>}
      </button></h2>
      {open && (<>
      <div className="chips" role="group" aria-label="Program day">
        {program.days.map((d, i) => (
          <button key={d.name} type="button" className="chip" aria-pressed={!quick && i === plan.day} onClick={() => onChange({ ...plan, day: i, skips: [], swaps: {}, slots: undefined, quick: undefined })}>{d.name}</button>
        ))}
        <button type="button" className="chip" aria-pressed={quick} onClick={() => { if (!quick) pickQuick(Number(minutes) || 30); }}>Quick</button>
      </div>
      {quick && (
        <label className="quick-minutes">Minutes
          <input aria-label="Minutes" inputMode="numeric" value={minutes} onChange={(e) => {
            setMinutes(e.target.value);
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 5 && n <= 180) pickQuick(n);
          }} />
          <span className="muted small">What your week is furthest behind on</span>
        </label>
      )}
      <ol className="plan-slots" aria-label="Planned exercises">
        {day.slots.map((slot) => {
          const skipped = plan.skips.includes(slot.exercise);
          const target = plan.swaps[slot.exercise] ?? slot.exercise;
          const done = doneOf(target);
          return (
            <li key={slot.exercise} className={skipped ? 'skipped' : done >= slot.sets ? 'done' : ''}>
              <button className="plan-name" data-exercise={target} disabled={skipped} onClick={() => { onChange(plan); onOpen(target); }}>
                <b>{target}</b>
                {target !== slot.exercise && <span className="muted small">for {slot.exercise}</span>}
                {/* The count rides under the name, so the name gets the width it needs. */}
                <span className="muted small"><span className="plan-count">{skipped ? 'Skipped' : `${Math.min(done, slot.sets)}/${slot.sets}`}</span> · {slot.repMin}–{slot.repMax}{isHoldLift(slot.exercise, entries) ? ' s hold' : ' reps'}</span>
              </button>
              <button type="button" onClick={() => onChange({ ...plan, skips: skipped ? plan.skips.filter((x) => x !== slot.exercise) : [...plan.skips, slot.exercise] })}>
                {skipped ? 'Undo' : 'Skip'}
              </button>
              {skipped ? <span aria-hidden="true" /> : <button type="button" onClick={() => onSwap(slot.exercise)}>Swap</button>}
            </li>
          );
        })}
      </ol>
      </>)}
    </section>
  );
}
