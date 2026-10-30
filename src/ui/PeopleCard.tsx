import { useState } from 'react';
import { MAIN } from '../db/db';
import type { PeopleStore } from '../state/usePeople';
import { Input } from './Field';

/** A profile's short name, for its backup file's name (domain/backup backupName). */
const toSlug = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'person';

// What's typed in the new-person form. Every switch of person remounts the More screen, so it lives here, outside it.
let kept = '';

/** Add, rename and delete the people tracked on this phone. Each has their own sets, body log, priorities and program. */
export function PeopleCard({ people }: { people: PeopleStore }) {
  const [name, setName] = useState(kept);
  const change = (n: string) => { kept = n; setName(n); };
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const target = people.people.find((p) => p.id === deleting);

  return (
    <section className="card">
      <h2>{people.people.length > 1 ? 'Profiles' : 'Add a person'}</h2>
      <p className="muted small">Track someone training with you. Their sets, body log, photos, priorities and program stay separate; gyms are shared.</p>
      {people.people.length > 1 && (
        <ul className="people">
          {people.people.map((p) => (
            <li key={p.id}>
              <Input aria-label={`Name of ${p.name}`} value={p.name} onChange={(e) => void people.rename(p.id, e.target.value)} />
              {p.id !== MAIN && <button className="mini danger" onClick={() => { setDeleting(p.id); setConfirm(''); }}>Delete</button>}
              {p.id === MAIN && <span className="muted small people-note">Your own profile can’t be deleted.</span>}
              {/* Under the row that opened it, not after the whole list. */}
              {target?.id === p.id && (
                <div className="confirm-delete">
                  <p className="warn">Deletes everything {p.name} logged on this phone, photos too.</p>
                  <label className="field">Type {p.name} to confirm<Input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
                  <div className="form-actions">
                    <button onClick={() => setDeleting(null)}>Cancel</button>
                    <button className="danger" disabled={confirm.trim() !== p.name.trim()} onClick={() => { void people.remove(p.id); setDeleting(null); }}>Delete {p.name}</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <label className="field">Name<Input value={name} onChange={(e) => change(e.target.value)} placeholder="e.g. Sam" /></label>
      <button className="wide" disabled={!name.trim()} onClick={() => { void people.add(name.trim(), toSlug(name.trim())); change(''); }}>Add {name.trim() || 'person'}</button>
    </section>
  );
}
