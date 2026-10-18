import { useMemo, useState } from 'react';
import type { Profile } from '../domain/profile';
import { quickDay } from '../domain/program';
import { availableSet, type Gym } from '../domain/equipment';
import { CATALOG } from '../domain/catalog';
import { isWorking } from '../domain/progression';
import { exerciseNames, sameExercise } from '../domain/stats';
import { estimateSeconds, paces, usualMinutes } from '../domain/timing';
import { warmupCount } from '../domain/suggest';
import { cardioTarget } from '../domain/cardio';
import { isHoldLift } from '../domain/care';
import type { SetEntry } from '../domain/types';
import { fmtLoad } from './SuggestionCard';

/**
 * With no program: a quick session for today from what the week is furthest behind on (the Quick day's builder), as long
 * as your sessions usually run. Nothing is saved; today's own sets don't move it, so it holds still while you work
 * through it, and it folds once every row is done. A tap on a row starts that lift.
 */
export function SuggestedToday({ profile, entries, date, gym, loadFor, onOpen }: {
  profile: Profile; entries: SetEntry[]; date: string; /** The gym you're at: only what it has. */ gym?: Gym | null;
  loadFor: (exercise: string, sets: number) => number | null; onOpen: (exercise: string) => void;
}) {
  const pace = useMemo(() => paces(entries), [entries]);
  const [minutes, setMinutes] = useState(() => String(usualMinutes(entries, date, pace)));
  const [mins, setMins] = useState(() => Number(minutes));
  const slots = useMemo(() => {
    // Warm-ups as the day started: a lift logged today would drop them from the estimate and grow the list under you.
    const before = entries.filter((e) => e.date < date);
    const available = gym ? availableSet(gym, [...CATALOG, ...exerciseNames(entries), ...gym.include]) : undefined;
    const cache = new Map<string, number>();
    const warm = (ex: string) => { const k = ex.toLowerCase(); if (!cache.has(k)) cache.set(k, warmupCount(before, ex, date)); return cache.get(k)!; };
    // quickDay reads only the days before today, so a set logged now never moves the list.
    return quickDay(profile, entries, date, (s) => estimateSeconds(s, pace, warm) <= mins * 60, available ? { available, include: gym!.include } : {});
  }, [profile, entries, date, mins, pace, gym]);
  const doneOf = (ex: string) => entries.filter((e) => e.date === date && sameExercise(e.exercise, ex) && (isWorking(e) || !!e.cardio)).length;
  const finished = slots.filter((s) => doneOf(s.exercise) >= s.sets).length;
  const [openPick, setOpen] = useState<boolean | null>(null);
  const open = openPick ?? (finished < slots.length);
  if (!slots.length) return null;
  return (
    <section className="card suggested" aria-label="Suggested today">
      <h2><button type="button" className="suggested-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>Suggested today</span>
        <span className="muted small">{open ? 'What your week is furthest behind on' : `${finished} of ${slots.length} done`}</span>
      </button></h2>
      {open && <>
        <label className="suggested-minutes">Minutes
          <input aria-label="Minutes" inputMode="numeric" value={minutes} onChange={(e) => {
            setMinutes(e.target.value);
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 5 && n <= 180) setMins(n);
          }} />
        </label>
        <ol className="suggested-slots" aria-label="Suggested exercises">
          {slots.map((s) => {
            const done = doneOf(s.exercise);
            return (
              <li key={s.exercise} className={done >= s.sets ? 'done' : ''}>
                <button type="button" className="suggested-name" data-exercise={s.exercise} onClick={() => onOpen(s.exercise)}>
                  <b>{s.exercise}</b>
                  <span className="muted small"><span className="suggested-count">{done}/{s.sets}</span> · {s.minutes != null
                    ? cardioTarget(entries, s.exercise, s.minutes, date).text
                    : <>{s.repMin}–{s.repMax}{isHoldLift(s.exercise, entries) ? ' s hold' : ' reps'}{fmtLoad(loadFor(s.exercise, s.sets))}</>}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </>}
    </section>
  );
}
