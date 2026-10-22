import { useCallback, useEffect, useState } from 'react';
import { cloudError, loadCloud } from '../cloud/firebase';
import { banUser, keepPost, listBanned, listReported, removePost, sweepExpired, unbanUser } from '../cloud/board';
import { heldByReports, leadOf, reviewOrder, tally, type Review } from '../domain/board';
import { noteGone, patchBoard } from '../state/board';
import { useVerified } from './FriendName';
import './board.css';

// More › Board review (the owner's alone: More shows its row only to cloud/owner isOwner, and firestore.rules refuse anyone else
// every write here). Each reported post the owner hasn't reviewed, the most urgent first, with its reasons tallied: Keep (shown
// again, its reports so far reviewed), Remove (gone; its author told on their next board open) or Ban (every post of theirs gone,
// and no more posts, 💪 or reports). Opening it also clears posts over 30 days old (Spark has no expiry of its own).

export function BoardReview({ uid }: { uid: string }) {
  const [items, setItems] = useState<Review[] | null>(null);
  const [banned, setBanned] = useState<{ uid: string; user: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const verified = Object.keys(useVerified(uid)).length;

  const load = useCallback(async () => {
    try {
      const c = await loadCloud();
      await sweepExpired(c).catch(() => 0);
      setItems(reviewOrder(await listReported(c)));
      setBanned(await listBanned(c).catch(() => []));
      setErr(null);
    } catch (e) { setErr(cloudError(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, f: () => Promise<string>) => {
    setBusy(key); setMsg(null); setErr(null);
    try { setMsg(await f()); await load(); } catch (e) { setErr(cloudError(e)); } finally { setBusy(null); setArmed(null); }
  };
  const held = items?.filter((r) => heldByReports(r.post)).length ?? 0;
  return (
    <>
      <p className="rv-sub">{items == null ? 'Loading…' : `${items.length === 1 ? '1 reported post' : `${items.length} reported posts`} · ${held} hidden`}</p>
      {msg && <p className="ok small" role="status">{msg}</p>}
      {err && <p className="warn small" role="alert">{err}</p>}
      {items?.length === 0 && <p className="muted">Nothing to review.</p>}
      {items?.map(({ post: p, why }) => {
        const open = p.reports - (p.kept ?? 0), lead = leadOf(p), hidden = heldByReports(p);
        return (
          <section key={p.id} className="rv-card" aria-label={`Reported post by @${p.user}`}>
            <div className="rv-head">
              <span className="rv-who">{lead ? `${lead} @${p.user}` : `@${p.user}`}</span>
              <span className={`rv-badge${hidden ? ' held' : ''}`}>{hidden ? `${open} · hidden` : open === 1 ? '1 report' : `${open} reports`}</span>
            </div>
            <p className="rv-text">{p.t}</p>
            <p className="rv-why">{tally(why)}</p>
            <div className="rv-btns">
              <button type="button" disabled={!!busy} onClick={() => void act(p.id, async () => {
                await keepPost(await loadCloud(), p);
                await patchBoard(uid, (b) => ({ ...b, posts: b.posts.map((x) => (x.id === p.id ? { ...x, kept: p.reports } : x)) }));
                return 'Kept: it shows for everyone again.';
              })}>Keep</button>
              <button type="button" className="danger" disabled={!!busy} onClick={() => armed !== `rm:${p.id}` ? setArmed(`rm:${p.id}`) : void act(p.id, async () => {
                await removePost(await loadCloud(), p);
                await noteGone(uid, p.id);
                return `Removed. @${p.user} is told on their next visit.`;
              })}>{armed === `rm:${p.id}` ? 'Sure?' : 'Remove'}</button>
              <button type="button" className="danger" disabled={!!busy} onClick={() => armed !== `ban:${p.id}` ? setArmed(`ban:${p.id}`) : void act(p.id, async () => {
                const n = await banUser(await loadCloud(), p.uid);
                await patchBoard(uid, (b) => ({ ...b, posts: b.posts.filter((x) => x.uid !== p.uid) }));
                return `@${p.user} is banned; ${n === 1 ? 'their post is' : `${n} posts are`} gone.`;
              })}>{armed === `ban:${p.id}` ? 'Sure?' : 'Ban'}</button>
            </div>
          </section>
        );
      })}
      {banned.length > 0 && (
        <section className="card" aria-label="Banned accounts">
          <div className="rv-head"><span>Banned accounts</span><span className="rv-n">{banned.length}</span></div>
          <ul className="rv-banned">
            {banned.map((x) => (
              <li key={x.uid}><span>@{x.user}</span>
                <button type="button" className="mini" disabled={!!busy} onClick={() => void act(x.uid, async () => { await unbanUser(await loadCloud(), x.uid); return `@${x.user} can post again.`; })}>Unban</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="card">
        <div className="rv-head"><span>Verified people</span><span className="rv-n">{verified}</span></div>
        <p className="muted small">Give or remove the ✓ from a person’s page, or from ⋯ on their post.</p>
      </section>
    </>
  );
}
