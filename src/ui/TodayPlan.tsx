import type { SetEntry } from '../domain/types';
import { isWorking } from '../domain/progression';
import { nextDay, type DayPlan, type Program } from '../domain/program';
import { sameExercise } from '../domain/stats';
import { isHold } from '../domain/care';
import type { ProgramStore } from '../state/useProgram';
import { estimateSeconds, hhmm, paces, timedDay } from '../domain/timing';
import { warmupCount } from '../domain/suggest';

export const todayPlanFor = (store: ProgramStore, entries: SetEntry[], date: string): DayPlan | null => {
  if (!store.program) return null;
  return store.plans.find((x) => x.date === date)
    ?? { key: `day:${date}`, date, day: nextDay(store.program, store.plans, entries, date), skips: [], swaps: {} };
};

export function TodayPlan({ program, plan, entries, past, onChange, onOpen, onSwap }: {
  program: Program; plan: DayPlan; entries: SetEntry[]; past?: boolean;
  onChange: (p: DayPlan) => void; onOpen: (exercise: string) => void; onSwap: (original: string) => void;
}) {
  const day = program.days[plan.day] ?? program.days[0];
  const doneOf = (ex: string) => entries.filter((e) => e.date === plan.date && sameExercise(e.exercise, ex) && isWorking(e)).length;
  const title = past ? 'Plan' : 'Today’s plan';
  return (
    <section className="card plan" aria-label={title}>
      <h2>{title} · {day.name}</h2>
      {(() => {
        const todo = day.slots.filter((s) => !plan.skips.includes(s.exercise)).map((s) => ({ exercise: plan.swaps[s.exercise] ?? s.exercise, sets: s.sets }));
        const mins = Math.round(estimateSeconds(todo, paces(entries), (ex) => warmupCount(entries, ex, plan.date)) / 60);
        const first = timedDay(entries, plan.date)[0];
        const start = first ? new Date(first.loggedAt!) : null;
        return <p className="muted small" aria-label="Plan length">≈ {mins} min{start && ` · started ${hhmm(start)} · ends ≈ ${hhmm(new Date(start.getTime() + mins * 60_000))}`}</p>;
      })()}
      {program.days.length > 1 && (
        <div className="chips" role="group" aria-label="Program day">
          {program.days.map((d, i) => (
            <button key={d.name} type="button" className="chip" aria-pressed={i === plan.day} onClick={() => onChange({ ...plan, day: i, skips: [], swaps: {}, slots: undefined })}>{d.name}</button>
          ))}
        </div>
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
                <span className="muted small">{slot.repMin}–{slot.repMax}{isHold(slot.exercise) ? ' s hold' : ' reps'}</span>
              </button>
              <span className="plan-count">{skipped ? 'Skipped' : `${Math.min(done, slot.sets)}/${slot.sets}`}</span>
              <button type="button" onClick={() => onChange({ ...plan, skips: skipped ? plan.skips.filter((x) => x !== slot.exercise) : [...plan.skips, slot.exercise] })}>
                {skipped ? 'Undo' : 'Skip'}
              </button>
              {!skipped && <button type="button" onClick={() => onSwap(slot.exercise)}>Swap</button>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
