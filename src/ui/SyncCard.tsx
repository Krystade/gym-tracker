import { useState } from 'react';
import type { SyncStore } from '../state/useSync';
import { fmtDate } from '../domain/format';

const DEFAULT_REPO = 'Krystade/gym-data';

export function SyncCard({ sync, newestSet }: { sync: SyncStore; newestSet: string | null }) {
  const c = sync.config;
  const [repo, setRepo] = useState(c?.repo ?? DEFAULT_REPO);
  const [token, setToken] = useState('');
  const [replacing, setReplacing] = useState(false);
  const editing = !c || replacing;
  const repoOk = /^[\w.-]+\/[\w.-]+$/.test(repo.trim());
  const stale = c?.lastSync && newestSet && newestSet > c.lastSync.slice(0, 10);

  async function save() {
    const t = token.trim();
    if (!repoOk || (!t && !c)) return;
    // The field is cleared at once: after saving, the token is never rendered again.
    if (await sync.saveConfig({ key: 'sync', repo: repo.trim(), token: t || c!.token, branch: c?.branch ?? 'main', lastSync: c?.lastSync })) { setToken(''); setReplacing(false); }
  }

  return (
    <section className="card" aria-labelledby="sync-h">
      <h2 id="sync-h">Private backup</h2>
      <p className="muted small">Copies your sets and body data to your private GitHub repo and pulls in anything newer (including the converter’s history.csv). Photos never leave the phone.</p>
      {editing ? (
        <form className="sync-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label>Repository<input aria-label="Repository" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={repo} onChange={(e) => setRepo(e.target.value)} /></label>
          <label>Access token<input aria-label="Access token" type="password" autoComplete="off" value={token} placeholder={c ? 'Paste a new token' : 'github_pat_…'} onChange={(e) => setToken(e.target.value)} /></label>
          <div className="form-actions">
            {c && <button type="button" onClick={() => { setReplacing(false); setToken(''); }}>Cancel</button>}
            <button type="submit" className="primary" disabled={!repoOk || (!token.trim() && !c)}>Save</button>
          </div>
          <details className="small">
            <summary>How to make a token</summary>
            <ol>
              <li>GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token.</li>
              <li>Repository access: <b>Only select repositories</b> → your private data repo.</li>
              <li>Permissions → Repository → <b>Contents: Read and write</b>. Nothing else.</li>
              <li>Pick an expiry (up to a year), generate, copy, paste here.</li>
            </ol>
          </details>
        </form>
      ) : (<>
        <p className="sync-saved"><span>{c.repo}</span><span className="muted small">Token saved</span></p>
        <button className="primary wide" disabled={sync.status.kind === 'running'} onClick={() => void sync.run()}>{sync.status.kind === 'running' ? 'Syncing…' : 'Sync now'}</button>
        <p className="muted small">{c.lastSync ? `Last synced ${fmtDate(c.lastSync.slice(0, 10))} ${c.lastSync.slice(11, 16)} UTC` : 'Not synced yet.'}{stale ? ' · new sets since then' : ''}</p>
        <div className="form-actions">
          <button type="button" onClick={() => setReplacing(true)}>Replace token</button>
          <button type="button" className="danger" onClick={() => { if (confirm('Forget the token and repo on this phone? The backup itself stays on GitHub.')) void sync.forget(); }}>Forget</button>
        </div>
      </>)}
      {(sync.status.kind === 'done' || sync.status.kind === 'error') && (
        <p role="status" className={sync.status.kind === 'error' ? 'warn' : ''}>{sync.status.text}</p>
      )}
    </section>
  );
}
