import { useState } from 'react';
import { CARDIO_TARGETS, cardioTierOf, thisWeekCardio } from '../domain/cardio';
import { MUSCLES } from '../domain/muscles';
import { goalOf, type Profile, type Tier, type TrainingGoal } from '../domain/profile';
import type { SetEntry } from '../domain/types';
import { activeProfileDb } from '../db/db';
import type { FittedProfileStore } from '../state/useFittedProfile';
import { Input } from './Field';
import { GoalSuggestion, PrioritySuggestion } from './TargetSuggestions';

// Muscle priorities and the training goal: settings, opened from More (and from Stats and Program). Owner, 2026-10-20: the
// priorities list doesn't belong on Stats. The sessions-a-week goal is its own screen on More (owner, 2026-10-21: it drives
// far more than the priorities: Today's week strip, the Stats ring, Friends' rings, Compare's Goal and the reminder days).

/** A priority's weekly range as read: an excluded one ([0, 0]) plans nothing. */
const range = ([lo, hi]: [number, number]) => (hi <= 0 ? 'none' : `${fmtN(lo)}–${fmtN(hi)} sets`);
/** The goal as a row's note says it. */
export const goalLabel = (p: Pick<Profile, 'goal'>) => (goalOf(p) === 'strength' ? 'Strength' : 'Size');

const GOALS: [TrainingGoal, string][] = [['size', 'Size'], ['strength', 'Strength']];
/** The training goal (owner decision 4): Size, recommended for growth; Strength moves barbell compounds to 5–8 reps. */
function GoalCard({ profile }: { profile: FittedProfileStore }) {
  const goal = goalOf(profile.profile);
  return (
    <section className="card" role="group" aria-label="Training goal">
      <h2>Training goal</h2>
      <div className="chips seg-wide" role="group" aria-label="Goal">
        {GOALS.map(([g, label]) => (
          <button key={g} type="button" className="chip" aria-pressed={goal === g} onClick={() => void profile.save({ ...profile.profile, goal: g })}>{label}</button>
        ))}
      </div>
      <p className="muted small">{goal === 'size'
        ? 'Size is the recommended default for growth: muscle grows about the same anywhere from 5 to 30 reps taken near failure (ACSM 2026), so lifts keep 8–12 and 10–15.'
        : 'Barbell compounds default to 5–8 reps: heavier loads, 80 % of your max or more, build strength (ACSM 2026: 6 reviews, 6,574 people). Other lifts keep their ranges. Size is the recommended default for growth.'}
        {' '}A range you set on a lift’s page always wins.</p>
    </section>
  );
}

/** Settings: the training goal, the weekly sets per priority, and each muscle's priority. */
export function PrioritiesScreen({ profile, entries, today, backLabel = '‹ Back', onBack }: { profile: FittedProfileStore; entries: SetEntry[]; today: string; backLabel?: string; onBack: () => void }) {
  return (
    <>
      <button className="back" onClick={onBack}>{backLabel}</button>
      <h1>Priorities and goal</h1>
      <GoalCard profile={profile} />
      <Priorities profile={profile} cardioMinutes={thisWeekCardio(entries, today)} entries={entries} today={today} />
    </>
  );
}

/** More › Weekly goal: sessions a week, and the last 8 weeks' average offered when it's a session or more away. */
export function WeeklyGoal({ profile, entries, today }: { profile: FittedProfileStore; entries: SetEntry[]; today: string }) {
  const p = profile.profile;
  const [goal, setGoal] = useState(String(p.weeklyGoal));
  const [owner] = useState(activeProfileDb);
  return (
    <section className="card" aria-label="Weekly goal">
      <label className="goal-row">Sessions per week goal
        <Input aria-label="Sessions per week goal" inputMode="numeric" value={goal}
          onChange={(e) => {
            setGoal(e.target.value);
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 1 && n <= 7) void profile.save({ ...p, weeklyGoal: n });
          }} />
      </label>
      <p className="muted small">1 to 7. It sets Today’s week plan, your ring on Stats and Friends, Compare’s Goal and the reminder’s first days, and how many sessions the priorities’ weekly sets are spread over.</p>
      <GoalSuggestion owner={owner} entries={entries} profile={p} today={today} onAccept={(n) => { setGoal(String(n)); void profile.save({ ...p, weeklyGoal: n }); }} />
    </section>
  );
}

const fmtN = (n: number) => (n % 1 ? n.toFixed(1) : String(n));

/** One priority's weekly range: fitted to the week, or yours, with a way to set it or hand it back. */
function TierTarget({ t, profile, who }: { t: Tier; profile: FittedProfileStore; who?: string }) {
  const [lo, hi] = profile.profile.targets[t];
  const mine = profile.fit.custom.includes(t);
  const [edit, setEdit] = useState<[string, string] | null>(null);
  const v = edit && [Number(edit[0]), Number(edit[1])] as [number, number];
  const ok = !!v && v.every((n) => Number.isFinite(n) && n >= 0 && n <= 40) && v[0] <= v[1] && edit!.every((x) => x.trim() !== '');
  return (
    <li className="tier-target">
      <span>{t} · {range([lo, hi])} · <span className="muted">{mine ? (who ? `set by @${who}` : 'yours') : 'auto'}</span></span>
      {edit ? (
        <span className="tier-edit">
          <label>Min<Input aria-label="Min" inputMode="decimal" value={edit[0]} onChange={(e) => setEdit([e.target.value, edit[1]])} /></label>
          <label>Max<Input aria-label="Max" inputMode="decimal" value={edit[1]} onChange={(e) => setEdit([edit[0], e.target.value])} /></label>
          <button className="mini" disabled={!ok} onClick={async () => { await profile.setTarget(t, v); setEdit(null); }}>Save</button>
        </span>
      ) : mine
        ? <button className="mini" onClick={() => void profile.setTarget(t, null)}>Use auto</button>
        : <button className="mini" onClick={() => setEdit([fmtN(lo), fmtN(hi)])}>Edit</button>}
    </li>
  );
}

/** `entries` and `today`: what the suggested goal and priorities are read from (your own Stats only). */
/** Also a friend's, read-only, on their Stats (`who`). */
export function Priorities({ profile, readOnly, who, cardioMinutes, entries, today }: { profile: FittedProfileStore; readOnly?: boolean; who?: string; cardioMinutes: number; entries: SetEntry[]; today: string }) {
  const p = profile.profile;
  const [owner] = useState(activeProfileDb);
  return (
    <fieldset className="card plain" id="priorities" disabled={readOnly}>
      <h2>Muscle priorities</h2>
      {/* A friend's goal, read-only beside their priorities; your own is under More › Weekly goal. */}
      {readOnly && <label className="goal-row">Sessions per week goal<Input aria-label="Sessions per week goal" value={String(p.weeklyGoal)} readOnly /></label>}
      <section className="sub" role="group" aria-label="Weekly sets">
        <p className="muted small">Weekly sets per muscle, fitted to {profile.budget.sessions} sessions × {profile.budget.perSession} sets. 1 gets the most, 4 the least.</p>
        <ol className="tier-targets">{([1, 2, 3, 4] as Tier[]).map((t) => <TierTarget key={t} t={t} profile={profile} who={who} />)}</ol>
      </section>
      {!readOnly && <PrioritySuggestion owner={owner} entries={entries} profile={p} today={today} onApply={(tiers) => void profile.save({ ...p, tiers })} />}
      <div className="prio-grid">
        {MUSCLES.map((m) => (
          <label key={m}>{m}
            <select aria-label={m} value={p.tiers[m]} onChange={(e) => void profile.save({ ...p, tiers: { ...p.tiers, [m]: Number(e.target.value) as Tier } })}>
              {([1, 2, 3, 4] as Tier[]).map((t) => <option key={t} value={t}>{t} · {range(p.targets[t])}</option>)}
            </select>
          </label>
        ))}
      </div>
      {/* Cardio is planned in minutes a week, not sets. */}
      <div className="prio-grid cardio-prio">
        <label>Cardio
          <select aria-label="Cardio" value={cardioTierOf(p)} onChange={(e) => void profile.save({ ...p, cardioTier: Number(e.target.value) as Tier })}>
            {([1, 2, 3, 4] as Tier[]).map((t) => <option key={t} value={t}>{t} · {CARDIO_TARGETS[t][0]}–{CARDIO_TARGETS[t][1]} min</option>)}
          </select>
        </label>
        {/* Priority 4 (or none): no range to fall short of, just the minutes. */}
        <p className="muted small" aria-label="Cardio this week">This week: {cardioTierOf(p) === 4 ? cardioMinutes : `${cardioMinutes} of ${CARDIO_TARGETS[cardioTierOf(p)][0]}–${CARDIO_TARGETS[cardioTierOf(p)][1]}`} min</p>
      </div>
    </fieldset>
  );
}

