import { useState } from 'react';
import { MAIN } from '../db/db';
import { slugError } from '../domain/sync';
import type { PeopleStore } from '../state/usePeople';

const toSlug = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

// What's typed in the new-person form. Every switch of person remounts the Data screen, so it lives here, outside it.
let kept: { name: string; slug: string | null } = { name: '', slug: null };

/** Add, rename and delete the people tracked on this phone. Each has their own sets, body log, priorities and program. */
export function PeopleCard({ people }: { people: PeopleStore }) {
  const [{ name, slug }, setForm] = useState(kept);
  const change = (n: string, s: string | null) => { kept = { name: n, slug: s }; setForm(kept); };
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const folder = slug ?? toSlug(name);
  const taken = people.people.map((p) => p.slug);
  const err = name.trim() ? slugError(folder, taken, people.retired) : null;
  const target = people.people.find((p) => p.id === deleting);

  return (
    <section className="card">
      <h2>{people.people.length > 1 ? 'Profiles' : 'Add a person'}</h2>
      <p className="muted small">Track someone training with you. Their sets, body log, priorities and program stay separate; gyms and the backup are shared.</p>
      {people.people.length > 1 && (
        <ul className="people">
          {people.people.map((p) => (
            <li key={p.id}>
              <input aria-label={`Name of ${p.name}`} value={p.name} onChange={(e) => void people.rename(p.id, e.target.value)} />
              {p.id !== MAIN && <button className="mini danger" onClick={() => { setDeleting(p.id); setConfirm(''); }}>Delete</button>}
              {p.id === MAIN && <span className="muted small people-note">Your own profile can’t be deleted.</span>}
              {/* Under the row that opened it, not after the whole list. */}
              {target?.id === p.id && (
                <div className="confirm-delete">
                  <p className="warn">Deletes everything {p.name} logged on this phone. Their backup folder (profiles/{p.slug}) stays in the repo.</p>
                  <label className="field">Type {p.name} to confirm<input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
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
      <label className="field">Name<input value={name} onChange={(e) => change(e.target.value, slug)} placeholder="e.g. Sam" /></label>
      {name.trim() && (
        <label className="field">Backup folder<input value={folder} onChange={(e) => change(name, e.target.value)} aria-describedby="slug-help" /></label>
      )}
      {name.trim() && <p id="slug-help" className={`small ${err ? 'warn' : 'muted'}`}>{err ?? `Backed up to profiles/${folder}/ in your private repo.`}</p>}
      <button className="wide" disabled={!name.trim() || err != null} onClick={() => { void people.add(name.trim(), folder); change('', null); }}>Add {name.trim() || 'person'}</button>
    </section>
  );
}
