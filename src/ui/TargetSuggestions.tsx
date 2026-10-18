import { useState } from 'react';
import { MUSCLES } from '../domain/muscles';
import type { Profile } from '../domain/profile';
import { goalSuggestion, prioritySuggestion } from '../domain/suggestTargets';
import type { SetEntry } from '../domain/types';
import { getPref, setPref } from '../state/prefs';

// Suggested targets, never applied by themselves: one tap takes one, Dismiss hides it until what it suggests changes.
// The dismissed value is kept per profile on this phone.

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Under the goal: the last 8 weeks' average, when it's a session or more from your goal. */
export function GoalSuggestion({ owner, entries, profile, today, onAccept }: {
  owner: string; entries: SetEntry[]; profile: Profile; today: string; onAccept: (goal: number) => void;
}) {
  const [, bump] = useState(0);
  const sug = goalSuggestion(entries, profile, today);
  if (!sug || getPref<number>(owner, 'suggest:goal') === sug.goal) return null;
  return (
    <div className="target-suggest" role="group" aria-label="Suggested goal">
      <p>Your last 8 weeks average {fmt(sug.average)} {sug.average === 1 ? 'session' : 'sessions'} a week.</p>
      <div className="target-suggest-actions">
        <button type="button" className="primary" onClick={() => onAccept(sug.goal)}>Set goal to {sug.goal}</button>
        <button type="button" onClick={() => { setPref(owner, 'suggest:goal', sug.goal); bump((n) => n + 1); }}>Dismiss</button>
      </div>
    </div>
  );
}

/** Above the priority list: priorities from what you've trained, each change listed before one tap applies them. */
export function PrioritySuggestion({ owner, entries, profile, today, onApply }: {
  owner: string; entries: SetEntry[]; profile: Profile; today: string; onApply: (tiers: Profile['tiers']) => void;
}) {
  const [, bump] = useState(0);
  const sug = prioritySuggestion(entries, profile, today);
  const sig = sug ? MUSCLES.map((m) => sug.tiers[m]).join('') : '';
  if (!sug || getPref<string>(owner, 'suggest:tiers') === sig) return null;
  return (
    <div className="target-suggest" role="group" aria-label="Suggested priorities">
      <p>From what you’ve trained the last 8 weeks, {sug.changes.length === 1 ? '1 priority' : `${sug.changes.length} priorities`} would change.</p>
      <ul className="target-suggest-changes" aria-label="Priority changes">
        {/* Most-trained first, so the list reads as the ranking it came from. */}
        {[...sug.changes].sort((a, b) => b.perWeek - a.perWeek).map((c) => (
          <li key={c.muscle}><span>{c.muscle}</span><span>{fmt(Math.round(c.perWeek * 2) / 2)} sets/wk</span><span>{c.from} → <b>{c.to}</b></span></li>
        ))}
      </ul>
      <div className="target-suggest-actions">
        <button type="button" className="primary" onClick={() => onApply(sug.tiers)}>{sug.changes.length === 1 ? 'Apply' : 'Apply all'}</button>
        <button type="button" onClick={() => { setPref(owner, 'suggest:tiers', sig); bump((n) => n + 1); }}>Dismiss</button>
      </div>
    </div>
  );
}
