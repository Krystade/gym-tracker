import { useState } from 'react';
import { MAIN } from '../db/db';
import { slugError } from '../domain/sync';
import type { PeopleStore } from '../state/usePeople';

const toSlug = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

/** Add, rename and delete the people tracked on this phone. Each has their own sets, body log, priorities and program. */
export function PeopleCard({ people }: { people: PeopleStore }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const folder = slug ?? toSlug(name);
  const taken = people.people.map((p) => p.slug);
  const err = name.trim() ? slugError(folder, taken) : null;
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
            </li>
          ))}
        </ul>
      )}
      {target && (
        <div className="confirm-delete">
          <p className="warn">Deletes everything {target.name} logged on this phone. Their backup folder (profiles/{target.slug}) stays in the repo.</p>
          <label className="field">Type {target.name} to confirm<input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
          <div className="form-actions">
            <button onClick={() => setDeleting(null)}>Cancel</button>
            <button className="danger" disabled={confirm.trim() !== target.name.trim()} onClick={() => { void people.remove(target.id); setDeleting(null); }}>Delete {target.name}</button>
          </div>
        </div>
      )}
      <label className="field">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" /></label>
      {name.trim() && (
        <label className="field">Backup folder<input value={folder} onChange={(e) => setSlug(e.target.value)} aria-describedby="slug-help" /></label>
      )}
      {name.trim() && <p id="slug-help" className={`small ${err ? 'warn' : 'muted'}`}>{err ?? `Backed up to profiles/${folder}/ in your private repo.`}</p>}
      <button className="wide" disabled={!name.trim() || err != null} onClick={() => { void people.add(name.trim(), folder); setName(''); setSlug(null); }}>Add {name.trim() || 'person'}</button>
    </section>
  );
}
