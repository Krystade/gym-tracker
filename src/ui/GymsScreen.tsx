import { useState } from 'react';
import type { GymsStore } from '../state/useGyms';
import { canDo, EQUIPMENT_GROUPS, type Equipment, type Gym } from '../domain/equipment';
import { CATALOG } from '../domain/catalog';
import { normalizeName } from '../domain/ids';
import { sameExercise } from '../domain/stats';

const newGym = (n: number): Gym => ({ id: `g${Date.now().toString(36)}`, name: n ? `Gym ${n + 1}` : 'My gym', equipment: [], exclude: [], include: [] });
const without = (xs: string[], name: string) => xs.filter((x) => !sameExercise(x, name));

export function GymsScreen({ gyms, logged, fresh, onBack }: { gyms: GymsStore; logged: string[]; fresh?: boolean; onBack: () => void }) {
  const [q, setQ] = useState('');
  // "Set up your gym" opens on an unsaved draft: backing out leaves no gym; the first edit saves it.
  const [draft, setDraft] = useState<Gym | null>(() => (fresh && !gyms.active ? newGym(gyms.gyms.length) : null));
  const g = draft ?? gyms.active;
  const update = (fn: (x: Gym) => Gym) => {
    if (!g) return;
    if (draft) { const n = fn(draft); setDraft(null); void gyms.save([...gyms.gyms, n], n.id); return; }
    void gyms.save(gyms.gyms.map((x) => (x.id === g.id ? fn(x) : x)), g.id);
  };
  const add = () => { const n = newGym(gyms.gyms.length); void gyms.save([...gyms.gyms, n], n.id); };

  if (!g) return (
    <>
      <button onClick={onBack}>‹ Back</button>
      <h1>Gyms</h1>
      <p className="muted">List what your gym has, and the program and swap suggestions only use lifts you can do there.</p>
      <button className="primary wide" onClick={add}>Add gym</button>
    </>
  );

  const query = normalizeName(q);
  const names = [...new Set([...logged, ...g.include, ...CATALOG.filter((c) => !logged.some((l) => sameExercise(l, c)))])];
  const shown = (query ? names.filter((n) => n.toLowerCase().includes(query.toLowerCase())) : names.filter((n) => g.include.some((x) => sameExercise(x, n)) || g.exclude.some((x) => sameExercise(x, n)))).slice(0, 40);
  const listed = names.some((n) => sameExercise(n, query));

  return (
    <>
      <button onClick={onBack}>‹ Back</button>
      <h1>Gyms</h1>
      {!draft && <div className="chips gym-chips" role="group" aria-label="Active gym">
        {gyms.gyms.map((x) => <button key={x.id} className={`chip${x.id === g.id ? ' primary' : ''}`} aria-pressed={x.id === g.id} onClick={() => void gyms.save(gyms.gyms, x.id)}><span className="pname">{x.name}</span></button>)}
        <button className="chip" onClick={add}>+ Add gym</button>
      </div>}
      <section className="card">
        <label className="field">Gym name<input value={g.name} onChange={(e) => update((x) => ({ ...x, name: e.target.value }))} /></label>
      </section>
      {EQUIPMENT_GROUPS.map(([label, items]) => (
        <fieldset key={label} className="card gear">
          <legend>{label}</legend>
          {items.map((e) => (
            <label key={e} className="check">
              <input type="checkbox" checked={g.equipment.includes(e)}
                onChange={(ev) => update((x) => ({ ...x, equipment: ev.target.checked ? [...x.equipment, e] : x.equipment.filter((y): y is Equipment => y !== e) }))} />
              {e}
            </label>
          ))}
        </fieldset>
      ))}
      <section className="card">
        <h2>Exercises here</h2>
        <p className="muted small">Exclude a lift the gear can’t really do (a weak cable stack, a broken machine). Add lifts that need nothing listed above, or that aren’t in the app’s list.</p>
        <input type="search" aria-label="Search exercises" placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="gym-ex">
          {query && !listed && <li><button className="primary" onClick={() => { update((x) => ({ ...x, include: [...without(x.include, query), query], exclude: without(x.exclude, query) })); }}>I can do “{query}” here</button></li>}
          {shown.map((n) => {
            const ok = canDo(g, n);
            const excluded = g.exclude.some((x) => sameExercise(x, n));
            const included = g.include.some((x) => sameExercise(x, n));
            return (
              <li key={n}>
                <span>{n}<span className={`small ${ok ? 'muted' : 'warn'}`}> · {excluded ? 'excluded' : included ? 'added' : ok ? 'can do' : ok === false ? 'missing gear' : 'gear unknown'}</span></span>
                {excluded ? <button className="mini" onClick={() => update((x) => ({ ...x, exclude: without(x.exclude, n) }))} aria-label={`Allow ${n}`}>Allow</button>
                  : included ? <button className="mini" onClick={() => update((x) => ({ ...x, include: without(x.include, n) }))} aria-label={`Remove ${n}`}>Remove</button>
                  : ok ? <button className="mini" onClick={() => update((x) => ({ ...x, exclude: [...x.exclude, n] }))} aria-label={`Exclude ${n}`}>Exclude</button>
                  : <button className="mini" onClick={() => update((x) => ({ ...x, include: [...x.include, n] }))} aria-label={`I can do ${n} here`}>I can do it</button>}
              </li>
            );
          })}
        </ul>
      </section>
      {!draft && <button className="wide danger gym-delete" onClick={() => {
        if (!confirm(`Delete ${g.name}?`)) return;
        const rest = gyms.gyms.filter((x) => x.id !== g.id);
        void gyms.save(rest, rest[0]?.id);
      }}>Delete <span className="pname">{g.name}</span></button>}
    </>
  );
}
