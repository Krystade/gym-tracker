import { useState } from 'react';
import type { SetEntry } from '../domain/types';
import type { ProfileStore } from '../state/useProfile';
import type { ProgramStore } from '../state/useProgram';
import { buildProgram, MAX_SETS_PER_DAY, programVolume, type Program } from '../domain/program';
import { defaultSettings } from '../domain/progression';
import { exerciseNames } from '../domain/stats';
import { MuscleBars } from './charts/MuscleBars';
import { ExercisePicker } from './ExercisePicker';

export function ProgramScreen({ programs, profile, entries, onBack }: { programs: ProgramStore; profile: ProfileStore; entries: SetEntry[]; onBack: () => void }) {
  const p = programs.program;
  const [days, setDays] = useState(String(p?.days.length ?? profile.profile.weeklyGoal));
  const [per, setPer] = useState(String(p?.perSession ?? 14));
  const [addTo, setAddTo] = useState<number | null>(null);
  const d = Number(days), s = Number(per);
  const valid = Number.isInteger(d) && d >= 1 && d <= 6 && Number.isInteger(s) && s >= 8 && s <= 20;

  const edit = (fn: (x: Program) => void) => { if (!p) return; const next: Program = structuredClone(p); fn(next); void programs.save(next); };

  if (addTo != null) return <ExercisePicker recent={exerciseNames(entries)} onCancel={() => setAddTo(null)} onPick={(name) => {
    const st = defaultSettings(name);
    edit((x) => { if (!x.days[addTo].slots.some((sl) => sl.exercise === name)) x.days[addTo].slots.push({ exercise: name, sets: 3, repMin: st.repMin, repMax: st.repMax }); });
    setAddTo(null);
  }} />;

  return (
    <>
      <button onClick={onBack}>‹ Back</button>
      <h1>Program</h1>
      <section className="card">
        <p className="muted small">Built from your priorities: each set goes to the priority muscle furthest below its weekly target, using the lifts you actually do. Full-body days: an exercise with enough weekly sets repeats on every day, so priority muscles are trained each session.</p>
        <div className="settings-grid two">
          <label>Days per week<input aria-label="Days per week" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
          <label>Sets per session<input aria-label="Sets per session" inputMode="numeric" value={per} onChange={(e) => setPer(e.target.value)} /></label>
        </div>
        <button className="primary wide" disabled={!valid} onClick={() => {
          if (p && !confirm('Replace the current program?')) return;
          void programs.save(buildProgram(profile.profile, entries, { days: d, perSession: s }, new Date()));
        }}>{p ? 'Rebuild program' : 'Build program'}</button>
      </section>
      {p && p.days.map((day, di) => (
        <section className="card" key={day.name}>
          <h2>{day.name} · {day.slots.reduce((a, x) => a + x.sets, 0)} sets</h2>
          <ol className="prog-slots">
            {day.slots.map((slot, si) => (
              <li key={slot.exercise}>
                <span className="prog-name"><b>{slot.exercise}</b><span className="muted small">{slot.repMin}–{slot.repMax} reps</span></span>
                <button aria-label={`Fewer sets of ${slot.exercise}`} disabled={slot.sets <= 1} onClick={() => edit((x) => { x.days[di].slots[si].sets--; })}>−</button>
                <span className="prog-sets">{slot.sets}</span>
                <button aria-label={`More sets of ${slot.exercise}`} disabled={slot.sets >= MAX_SETS_PER_DAY + 2} onClick={() => edit((x) => { x.days[di].slots[si].sets++; })}>+</button>
                <button aria-label={`Remove ${slot.exercise}`} onClick={() => edit((x) => { x.days[di].slots.splice(si, 1); })}>×</button>
              </li>
            ))}
          </ol>
          <button className="wide" onClick={() => setAddTo(di)}>Add exercise to {day.name}</button>
        </section>
      ))}
      {p && (
        <section className="card">
          <h2>Weekly volume</h2>
          <p className="muted small">Fractional sets per week if you run every day once, against your priority targets.</p>
          <MuscleBars sets={programVolume(p)} profile={profile.profile} />
        </section>
      )}
    </>
  );
}
