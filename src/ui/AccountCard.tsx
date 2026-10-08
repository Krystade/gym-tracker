import { useState } from 'react';
import type { CloudStore } from '../state/useCloud';
import type { Person } from '../db/db';

const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Sign in or create an account; signed in, the log syncs with the cloud on its own. */
export function AccountCard({ cloud, people }: { cloud: CloudStore; people: Person[] }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { link, status } = cloud;
  const busy = status.kind === 'busy';
  const message = status.kind === 'error' ? <p role="alert" className="warn">{status.text}</p>
    : status.kind !== 'idle' ? <p role="status" className="muted small">{status.text}</p> : null;

  if (link === undefined) return null;
  if (!link) {
    const ready = email.trim() !== '' && password !== '' && !busy;
    return (
      <section className="card" aria-labelledby="account-h">
        <h2 id="account-h">Account</h2>
        <p className="muted small">Keeps your log in the cloud, so another phone can sign in and have it all. The log stays on this phone too, and works offline.</p>
        <form className="sync-form" onSubmit={(e) => { e.preventDefault(); if (ready) void cloud.enter('in', email, password).then((ok) => ok && setPassword('')); }}>
          <label>Email<input type="email" autoComplete="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <div className="form-actions">
            <button type="button" disabled={!ready} onClick={() => void cloud.enter('up', email, password).then((ok) => ok && setPassword(''))}>Create account</button>
            <button type="submit" className="primary" disabled={!ready}>Sign in</button>
          </div>
          <button type="button" className="link small-link" onClick={() => void cloud.resetPassword(email)}>Forgot password?</button>
        </form>
        {message}
      </section>
    );
  }

  const owner = people.find((p) => p.id === link.person)?.name;
  return (
    <section className="card" aria-labelledby="account-h">
      <h2 id="account-h">Account</h2>
      <p>Signed in as {link.email}</p>
      {cloud.mine ? (<>
        <p className="muted small">Your log syncs on its own a few seconds after a change.{cloud.lastSync && ` Last synced ${when(cloud.lastSync)}.`}</p>
        <button className="wide" disabled={busy} onClick={() => void cloud.run()}>Sync now</button>
      </>) : <p className="muted small">This account belongs to {owner ?? 'another person'} on this phone; switch to them to sync.</p>}
      {message}
      <button className="wide" onClick={() => void cloud.signOut()}>Sign out</button>
      <details className="danger-zone">
        <summary>Delete account</summary>
        <p className="muted small">Deletes the cloud copy of your log and the login. The log on this phone stays.</p>
        <form className="sync-form" onSubmit={(e) => { e.preventDefault(); if (confirm) void cloud.deleteAccount(confirm).then((ok) => ok && setConfirm('')); }}>
          <label>Password to confirm<input type="password" autoComplete="current-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
          <button type="submit" className="danger wide" disabled={!confirm || busy}>Delete account and cloud copy</button>
        </form>
      </details>
    </section>
  );
}
