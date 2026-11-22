import { goalHit, type WeekCount, type WeekGoals } from '../domain/weekGoal';

// The week's two rings (owner, 2026-11-21, mock-up "Weekly rings, placed" A): sessions against the sessions goal, sets against
// the sets goal, in Today's header beside the date and in the workout summary. Either full makes the week a goal week
// (domain/goalHit). A ring keeps its shape (flex: none, square): never squashed by what's beside it.

/** One ring: `value` of `goal`, the numbers inside (only the value once "value/goal" won't fit). */
function GoalRing({ value, goal, size, colour, what }: { value: number; goal: number; size: number; colour: string; what: string }) {
  const width = size >= 44 ? 5 : 4, r = (size - width) / 2, c = size / 2, C = 2 * Math.PI * r;
  const v = Math.floor(value + 1e-9), frac = goal > 0 ? Math.min(1, value / goal) : 0;
  const text = `${v}/${goal}`, fits = text.length <= (size >= 44 ? 6 : 5);
  return (
    <span className={`week-ring${frac >= 1 ? ' met' : ''}`} role="img" aria-label={`${what} this week: ${v} of ${goal}${frac >= 1 ? ', met' : ''}`}
      style={{ width: size, height: size, ['--ring' as string]: colour }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--fill)" strokeWidth={width} />
        {frac > 0 && <circle cx={c} cy={c} r={r} fill="none" stroke={colour} strokeWidth={width} strokeLinecap={frac < 1 ? 'round' : 'butt'}
          strokeDasharray={`${(C * frac).toFixed(2)} ${C.toFixed(2)}`} transform={`rotate(-90 ${c} ${c})`} />}
      </svg>
      <span className="week-ring-n" aria-hidden="true">{fits ? <>{v}<i>/{goal}</i></> : v}</span>
    </span>
  );
}

/** Both rings. No sets goal (none known): the sessions ring alone. */
export function WeekRings({ count, goals, size = 38, className }: { count: WeekCount; goals: WeekGoals; size?: number; className?: string }) {
  return (
    <span className={`week-rings${className ? ` ${className}` : ''}`} data-hit={goalHit(count, goals) ?? 'none'}>
      <GoalRing value={count.sessions} goal={goals.sessions} size={size} colour="var(--accent)" what="Sessions" />
      {goals.sets != null && goals.sets > 0 && <GoalRing value={count.sets} goal={goals.sets} size={size} colour="var(--ok)" what="Sets" />}
    </span>
  );
}

/** The week in words, beside the summary's rings: which goal it met, else what's left of the nearer one. */
export function weekWords(count: WeekCount, goals: WeekGoals): string {
  const hit = goalHit(count, goals);
  if (hit) return hit === 'both' ? 'Goal week: both goals hit.' : `Goal week: hit on ${hit}.`;
  const sessions = goals.sessions - count.sessions, sets = goals.sets ? Math.ceil(goals.sets - count.sets - 1e-9) : null;
  const s = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return sets != null ? `${s(sessions, 'session')} or ${s(sets, 'set')} to a goal week.` : `${s(sessions, 'session')} to a goal week.`;
}
