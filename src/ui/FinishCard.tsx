import { useMemo, type CSSProperties } from 'react';
import { addDays } from '../domain/analytics';
import type { BodyDay } from '../domain/body';
import { isHoldLift } from '../domain/care';
import { finishSummary, nextUp } from '../domain/finish';
import { fmtSet, fmtWeight, plural } from '../domain/format';
import { volumeAdvice } from '../domain/learn/volume';
import type { DayPlan, Program } from '../domain/program';
import type { Profile } from '../domain/profile';
import { nextTarget } from '../domain/progression';
import { daySets, sameExercise } from '../domain/stats';
import type { SetEntry } from '../domain/types';
import { zone } from '../push/activity';
import { tappedLight } from '../state/lightWeek';
import type { SettingsStore } from '../state/useSettings';
import { Icon } from './icons';
import { closest, highest, unlockedOn } from '../domain/achievements';
import { useAchievements, useAchOpen } from '../state/useAchievements';
import { NextRow, UnlockRow } from './AchievementsSheet';
import { earned, earnedOn, INCOME, type DayEarned } from '../domain/buddies/points';
import { trainingOf } from '../domain/buddies/stats';
import { walletOf, type Ledger } from '../domain/buddies/gacha';
import { goalsFor, weekCount, type WeekCount, type WeekGoals } from '../domain/weekGoal';
import { WeekRings, weekWords } from './WeekRings';

// The plan, turned into the day's summary once it's done (owner, 2026-10-20): on Finish, by itself once the session has gone
// quiet, or as everything planned is done. A card in the plan's place on Today, never over anything (the phone is his alone,
// but a sheet would still take the screen for nothing). "Add more" brings the plan back.

const half = (n: number) => fmtWeight(Math.round(n * 2) / 2);
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** A day `k` days after `date`, as said on `today`: today, tomorrow, or its weekday. */
function when(date: string, k: number, today: string): string {
  const d = addDays(date, k);
  return d === today ? 'today' : d === addDays(today, 1) ? 'tomorrow' : WEEKDAY[new Date(`${d}T12:00:00Z`).getUTCDay()];
}

/**
 * A session before today's that closed while the app was away (IA A1, owner 2026-10-21): one line, "Tue’s workout · 12 sets ·
 * 34 min", and a tap opens that day in History, where the whole session is.
 */
export function LastWorkoutLine({ entries, date, today, profile, onOpen }: { entries: SetEntry[]; date: string; today: string; profile: Profile; onOpen: () => void }) {
  const s = useMemo(() => finishSummary(entries, date, profile), [entries, date, profile]);
  const day = date === addDays(today, -1) ? 'Yesterday' : WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return (
    <section className="past-workout" aria-label="Last workout">
      <button type="button" className="card past-line" onClick={onOpen}>
        <span className="past-line-t"><b>{day}’s workout</b><span> · {s.sets} {s.sets === 1 ? 'set' : 'sets'}{s.minutes != null && ` · ${s.minutes} min`}</span></span>
        <span className="past-line-go">History<Icon name="chev-right" size={18} sw={2} /></span>
      </button>
    </section>
  );
}

/**
 * What the workout paid into Gym Buddies (owner, 2026-11-21): the day's part of what the Buddies tab counts (buddies/points
 * earnedOn, `earned` itself a day apart, so the two never disagree), line by line, its tickets by where they came from, how far the
 * next session ticket is, and a way to spend them. `wallet`: what's left to spend now, once the buddies' spends are read.
 */
function PointsEarned({ pay, wallet, week, onOpen }: { pay: DayEarned; wallet: { points: number; tickets: number } | null; week: { count: WeekCount; goals: WeekGoals }; onOpen?: () => void }) {
  const p = pay.parts;
  const rows: [string, number][] = [
    [plural(p.sets / INCOME.set, 'set'), p.sets], ['Cardio', p.cardio], ['Session', p.sessions], ['Goal week hit', p.goalWeeks], ['Achievements', p.awards],
  ];
  const tickets: [string, number][] = [['goal week', p.goalWeekTickets], [`${INCOME.sessionsPerTicket} sessions`, p.sessionTickets], ['achievements', p.awardTickets]];
  const into = INCOME.sessionsPerTicket - pay.toTicket;
  return (
    <section className="finish-pts" aria-label="Points earned">
      <dl className="finish-pts-rows">
        {rows.filter(([, n]) => n > 0).map(([what, n]) => <div key={what}><dt>{what}</dt><dd>+{n}</dd></div>)}
      </dl>
      {pay.tickets > 0 && (
        <p className="finish-tickets" aria-label={`${plural(pay.tickets, 'ticket')} earned`}>
          <span>Tickets</span>
          {tickets.filter(([, n]) => n > 0).map(([what, n]) => <span key={what} className="pts-ticket">+{n} {what}</span>)}
        </p>
      )}
      {/* The week's rings (owner, 2026-11-21) beside the next session ticket's progress: the week so far, both goals. */}
      <div className="finish-pts-next finish-week" role="group" aria-label="This week">
        <WeekRings count={week.count} goals={week.goals} size={46} />
        <div className="finish-week-t">
          <p className="small finish-week-words">{weekWords(week.count, week.goals)}</p>
          <div className="finish-ticket-bar" role="progressbar" aria-label="Session ticket progress" aria-valuemin={0} aria-valuemax={INCOME.sessionsPerTicket} aria-valuenow={into}>
            <i style={{ width: `${(100 * into) / INCOME.sessionsPerTicket}%` }} />
          </div>
          <p className="muted small">{plural(pay.toTicket, 'session')} to your next session ticket</p>
        </div>
      </div>
      {onOpen && <button type="button" className="wide finish-buddies" onClick={onOpen}>
        Open Buddies{wallet ? ` · ${wallet.tickets > 0 ? plural(wallet.tickets, 'ticket') : `${wallet.points.toLocaleString('en-US')} pts`}` : ''}
      </button>}
    </section>
  );
}

/**
 * `how`: closed by Finish or by going quiet, or (null) only the plan done. `planName`: the day's (Day A, Quick). `onMore`: "Add more".
 * `buddies`: Gym Buddies' start and spends, for what the day paid (none until read); `onOpenBuddies`: the summary's button.
 */
export function FinishCard({ entries, date, today, profile, program, plans, planName, how, body, settings, owner, onMore, buddies, onOpenBuddies }: {
  entries: SetEntry[]; date: string; today: string; profile: Profile; program: Program | null; plans: DayPlan[]; planName?: string;
  how: 'finish' | 'auto' | null; body: readonly BodyDay[]; settings: SettingsStore; owner: string; onMore?: () => void;
  buddies?: { start: string; ledger: Ledger | null } | null; onOpenBuddies?: () => void;
}) {
  const s = useMemo(() => finishSummary(entries, date, profile), [entries, date, profile]);
  const up = useMemo(() => nextUp(entries, program, plans, date, zone()), [entries, program, plans, date]);
  // What the learning layer says for next time: the lifts done today whose next target goes up, and the volume steps (item 07)
  // for the muscles trained today.
  const higher = useMemo(() => {
    const names: string[] = [];
    for (const e of daySets(entries, date)) if (!names.some((n) => sameExercise(n, e.exercise))) names.push(e.exercise);
    return names.flatMap((ex) => {
      const t = nextTarget(entries, ex, settings.get(ex, isHoldLift(ex, entries)), addDays(date, 1));
      return t?.kind === 'increase' && t.weight > 0 ? [`${ex} ${fmtWeight(t.weight)} lb`] : [];
    }).slice(0, 3);
  }, [entries, date, settings]);
  const steps = useMemo(() => {
    const a = volumeAdvice(entries, body, profile, today, tappedLight(owner));
    return (a?.muscles ?? []).filter((m) => m.kind === 'raise' && s.muscles.some((x) => x.muscle === m.muscle)).slice(0, 3);
  }, [entries, body, profile, today, owner, s.muscles]);

  // The day's achievements, the highest level of each, and the closest next one (plan §6). A tap opens its levels on Stats.
  const ach = useAchievements(entries, today), openAch = useAchOpen();
  const unlocked = useMemo(() => (ach ? highest(unlockedOn(ach, date)) : []), [ach, date]);
  const closer = useMemo(() => (ach ? closest(ach, 1)[0] : undefined), [ach]);
  // What the day paid, and what's left to spend (the Buddies tab's own sums: domain/buddies/points).
  const start = buddies?.start, ledger = buddies?.ledger ?? null;
  const training = useMemo(() => (start ? trainingOf(entries, { start, today, profile }) : null), [entries, start, today, profile]);
  const pay = useMemo(() => (training ? earnedOn(training, ach, date) : null), [training, ach, date]);
  const wallet = useMemo(() => (training && ledger ? walletOf(earned(training, ach), ledger) : null), [training, ach, ledger]);
  // The week up to this day, against both goals (domain/weekGoal), for the rings.
  const week = useMemo(() => ({ goals: goalsFor(profile, entries)(date), count: weekCount(entries, date, date) }), [profile, entries, date]);

  const title = `${how ? 'Workout done' : 'Plan done'}${planName ? ` · ${planName}` : ''}`;
  const next = [up.day, up.inDays != null && when(date, up.inDays, today)].filter(Boolean).join(' · ');
  return (
    <section className="card finish-card" aria-label="Workout summary">
      <div className="finish-head">
        <h2><Icon name="check" size={20} sw={2.5} />{title}</h2>
        {pay && pay.points > 0 && <span className="pts-pill" aria-label={`${pay.points} points earned`}>+{pay.points} pts</span>}
      </div>
      {how === 'auto' && <p className="muted small finish-why">Closed after a quiet spell. Log a set to pick it back up.</p>}
      <dl className="finish-stats">
        <div><dt>Sets</dt><dd>{s.sets}{s.bouts > 0 && <small> +{s.bouts} cardio</small>}</dd></div>
        <div><dt>Tonnage</dt><dd>{s.tonnage.toLocaleString('en-US')}<small> lb</small></dd></div>
        <div><dt>Time</dt><dd>{s.minutes != null ? <>{s.minutes}<small> min</small></> : '—'}</dd></div>
      </dl>
      {s.prs.length > 0 && (
        <ul className="finish-prs" aria-label="PRs">
          {s.prs.map((p) => <li key={p.exercise}><span className="tag pr-tag">PR</span><b>{p.exercise}</b><span className="nw">{fmtSet(p.set)}</span></li>)}
        </ul>
      )}
      {pay && (pay.points > 0 || pay.tickets > 0) && <PointsEarned pay={pay} wallet={wallet} week={week} onOpen={onOpenBuddies} />}
      {unlocked.length > 0 && (
        <section aria-label="Achievements today">
          <h3 className="finish-sub">Achievements {date === today ? 'today' : 'that day'}</h3>
          {unlocked.map((u) => <UnlockRow key={`${u.id}:${u.level}:${u.lift ?? ''}`} u={u} onOpen={openAch} />)}
        </section>
      )}
      {closer && (
        <section aria-label="Closest achievement">
          <h3 className="finish-sub">Next up</h3>
          <NextRow t={closer} onOpen={openAch} />
        </section>
      )}
      {s.muscles.length > 0 && (
        <>
          <h3 className="finish-sub">This week, against your targets</h3>
          <ul className="finish-muscles" aria-label="Sets per muscle this week">
            {s.muscles.map((m) => (
              <li key={m.muscle} className={m.status} aria-label={`${m.muscle}: ${half(m.week)} sets this week, of ${half(m.band[0])} to ${half(m.band[1])}`}>
                <span>{m.muscle}</span>
                <span className="finish-bar-track" aria-hidden="true" style={{ '--lo': `${Math.min(100, (100 * m.band[0]) / Math.max(m.band[1], 1))}%` } as CSSProperties}>
                  <i style={{ width: `${Math.min(100, (100 * m.week) / Math.max(m.band[1], 1))}%` }} />
                </span>
                <span className="nw">{half(m.week)} <small>of {half(m.band[0])}–{half(m.band[1])}</small></span>
              </li>
            ))}
          </ul>
        </>
      )}
      {(next || higher.length > 0 || steps.length > 0) && (
        <div className="finish-next" aria-label="Next">
          {next && <p><b>Next:</b> {next}</p>}
          {higher.length > 0 && <p className="muted small">Go up next time: {higher.join(' · ')}</p>}
          {steps.length > 0 && <p className="muted small">Next 3 weeks: {steps.map((m) => `${m.muscle} ${half(m.base!)} → ${half(m.aim!)} a week`).join(' · ')}</p>}
        </div>
      )}
      {onMore && <button type="button" className="wide finish-more" onClick={onMore}>Add more</button>}
    </section>
  );
}
