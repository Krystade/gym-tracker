import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteCloudLink, getCloudLink, putCloudLink, type CloudLink, type Person } from '../db/db';
import { useDb } from './profileDb';
import { cloudError, loadCloud } from '../cloud/firebase';
import { deleteCloudData, phoneApply, syncCloud } from '../cloud/sync';
import { readMeta } from '../cloud/meta';
import { syncCycle } from '../cloud/cycle';
import { syncTogether } from '../cloud/together';
import { togetherChanged } from './useTogether';
import { cycleChanged, onCycleChange } from './useCycle';
import type { SetsStore } from './useSets';
import type { BodyStore } from './useBody';
import { replacedChanged } from './useReplaced';
import { KEEP_MS } from '../domain/replaced';
import { forgetFriendCaches } from './friendCache';
import { publishSummary } from './publishSummary';
import { useBox, useOwnBox } from './box';

export type CloudStatus = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'done'; text: string } | { kind: 'error'; text: string };
const QUIET_MS = 3000; // after the last change, so a run of sets syncs once
const NEWS_MS = 60_000;
// Every 5 minutes while open (it was 2: battery audit, 2026-10-23); a change here and coming back to the app still sync at once.
const POLL_MS = 300_000;
const whenIdle = (f: () => void) => {
  const w = globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(f, { timeout: 3000 }); else setTimeout(f, 500);
};

/**
 * The account this phone is signed in to. Its log syncs with the person it was linked to at sign-in; while another person
 * on the phone is open, nothing syncs. Firebase loads only once there's an account (or the Account card asks for it).
 */
export function useCloud(store: SetsStore, body: BodyStore, person: Person, meta: { reload: () => void; rev: unknown[]; /** After each sync: friends' news (requests, gyms, messages) may have come in. */ onSynced?: () => void }) {
  const db = useDb();
  const [link, setLink] = useState<CloudLink | null | undefined>(undefined);
  // The status and when it last synced show only on the Account card: kept in boxes it reads, so a sync (after every set)
  // doesn't take every screen through two renders.
  const statusBox = useOwnBox<CloudStatus>({ kind: 'idle' }), lastSyncBox = useOwnBox<string | null>(null);
  const setStatus = statusBox.set, setLastSync = lastSyncBox.set;
  const mine = !!link && link.person === person.id;

  useEffect(() => { void getCloudLink().then((l) => setLink(l ?? null)).catch(() => setLink(null)); }, []);
  useEffect(() => { void db.getCloudSeen().then((s) => setLastSync(s && link && s.uid === link.uid ? s.at ?? null : null)); }, [db, link]);
  // At startup: copies a sync replaced more than 30 days ago go.
  useEffect(() => { void db.pruneReplaced(Date.now() - KEEP_MS).then((n) => { if (n) replacedChanged(); }, () => {}); }, [db]);

  // One sync at a time; a request during one runs once more after it.
  const running = useRef(false), again = useRef(false), followUp = useRef(false);
  const news = useRef<{ text: string; at: number } | null>(null);
  const latest = useRef({ store, body, link, meta });
  latest.current = { store, body, link, meta };
  const run = useCallback(async (): Promise<void> => {
    const l = latest.current.link;
    if (!l || l.person !== person.id) return;
    if (running.current) { again.current = true; return; }
    running.current = true;
    setStatus({ kind: 'busy', text: 'Syncing…' });
    try {
      const c = await loadCloud();
      if (c.auth.currentUser?.uid !== l.uid) { await c.auth.authStateReady(); }
      if (c.auth.currentUser?.uid !== l.uid) throw Object.assign(new Error('signed out'), { code: 'auth/requires-recent-login' });
      const prev = await db.getCloudSeen();
      // A first sync with this account uploads everything already on the phone, so a log kept before signing in moves over.
      const first = prev?.uid !== l.uid;
      // The log as the database has it, not as the screens last showed it: a change saved a moment ago goes up too.
      const log = await db.getSyncSnapshot();
      const r = await syncCloud(c, l.uid, {
        ...log, seen: prev && !first ? prev.seen : {}, meta: await readMeta(db), metaSeen: (prev && !first && prev.meta) || { items: {}, at: 0 },
      }, phoneApply(db, {
        log: async () => { await latest.current.store.synced(); await latest.current.body.reload(); },
        meta: () => latest.current.meta.reload(), replaced: replacedChanged,
      }));
      // Changed here while the sync was out, so left as it is: one more sync straight after sends it up (or merges it). Only one,
      // so something that never settles can't keep the phone syncing; the edit's own sync, or the next poll, comes anyway.
      if (r.skipped && !followUp.current) again.current = followUp.current = true;
      else followUp.current = false;
      // Cycle phase, to its own private document. Refused until the rules that allow it are deployed: noted, and the rest goes on.
      // Days brought in, or the account's setting taken by a phone that never set it, both change what Today and More show.
      await syncCycle(c, l.uid, db).then((r) => { if (r.pulled || r.trackingAdopted) cycleChanged('pulled'); }, (e) => console.warn('Cycle sync skipped:', e));
      // Together's ledger, to its own private document (cloud/together): read when it changed here or a day on, written when new.
      await syncTogether(c, l.uid, db).then((pulled) => { if (pulled) togetherChanged(); }, (e) => console.warn('Together sync skipped:', e));
      // Compare: your summary for friends, when it changed, at most every 15 minutes (state/publishSummary). When the phone is
      // idle, not in the moment after a set; refused or offline, the sync still counts.
      whenIdle(() => void publishSummary(c, l.uid, db).catch((e) => console.warn('Compare summary skipped:', e)));
      const at = new Date().toISOString();
      await db.putCloudSeen({ key: 'cloud-seen', uid: l.uid, seen: r.seen, meta: r.metaSeen, at });
      setLastSync(at);
      latest.current.meta.onSynced?.(); // the More tab's dot: friends' requests, gyms and messages
      const n = log.sets.length;
      const up = n - r.replacedSets; // the account's copy won the rest
      const got = [first && up > 0 && `${up} set${up === 1 ? '' : 's'} from this phone saved to your account`, r.pulled && `${r.pulled} set${r.pulled === 1 ? '' : 's'} in`,
        r.removed && `${r.removed} removed`, r.metaPulled && 'program and settings updated', r.replaced && `${r.replaced} replaced on this phone`].filter(Boolean).join(', ');
      // The follow-up sync a few seconds later (the import changed the log) has nothing to say; keep what this one said.
      if (got) news.current = { text: `Synced: ${got}`, at: Date.now() };
      setStatus({ kind: 'done', text: got ? `Synced: ${got}` : news.current && Date.now() - news.current.at < NEWS_MS ? news.current.text : 'Synced' });
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error && !(e as { code?: string }).code ? e.message : cloudError(e) });
    } finally {
      running.current = false;
      if (again.current) { again.current = false; void run(); }
    }
  }, [db, person.id]);

  // Sync a few seconds after the log changes (cycle days included), and whenever the app comes back to the front.
  const [cycleRev, setCycleRev] = useState(0);
  useEffect(() => onCycleChange((c) => { if (c === 'local') setCycleRev((n) => n + 1); }), []);
  useEffect(() => {
    if (!mine || store.loading) return;
    const t = setTimeout(() => void run(), QUIET_MS);
    return () => clearTimeout(t);
  }, [mine, store.entries, body.days, store.loading, run, cycleRev, ...meta.rev]);
  useEffect(() => {
    if (!mine) return;
    const on = () => { if (document.visibilityState === 'visible') void run(); };
    document.addEventListener('visibilitychange', on);
    // And every 5 minutes while it's open, so another phone's sets and friends' requests turn up without a tap.
    const t = setInterval(() => { if (document.visibilityState === 'visible') void run(); }, POLL_MS);
    return () => { document.removeEventListener('visibilitychange', on); clearInterval(t); };
  }, [mine, run]);

  const enter = useCallback(async (how: 'up' | 'in', email: string, password: string): Promise<boolean> => {
    setStatus({ kind: 'busy', text: how === 'up' ? 'Creating your account…' : 'Signing in…' });
    try {
      const { auth, A } = await loadCloud();
      const cred = how === 'up' ? await A.createUserWithEmailAndPassword(auth, email.trim(), password) : await A.signInWithEmailAndPassword(auth, email.trim(), password);
      const l: CloudLink = { key: 'cloud', uid: cred.user.uid, email: cred.user.email ?? email.trim(), person: person.id };
      await putCloudLink(l);
      latest.current.link = l;
      setLink(l);
      await run();
      return true;
    } catch (e) { setStatus({ kind: 'error', text: cloudError(e) }); return false; }
  }, [person.id, run]);

  const signOut = useCallback(async () => {
    try { const { auth, A } = await loadCloud(); await A.signOut(auth); } catch { /* signed out locally either way */ }
    await deleteCloudLink();
    await forgetFriendCaches(); // friends' lines and threads kept for Friends: not on the phone once signed out
    await db.clearTogether().catch(() => {}); // and the ledger that names them (the account keeps its copy)
    togetherChanged();
    setLink(null);
    setStatus({ kind: 'idle' });
  }, [db]);

  const resetPassword = useCallback(async (email: string) => {
    if (!email.trim()) { setStatus({ kind: 'error', text: 'Type your email first.' }); return; }
    try {
      const { auth, A } = await loadCloud();
      await A.sendPasswordResetEmail(auth, email.trim());
      setStatus({ kind: 'done', text: `If there’s an account for ${email.trim()}, a reset link is on its way.` });
    } catch (e) { setStatus({ kind: 'error', text: cloudError(e) }); }
  }, []);

  /** The cloud copy and the login go; the log on this phone stays. */
  const deleteAccount = useCallback(async (password: string): Promise<boolean> => {
    if (!link) return false;
    setStatus({ kind: 'busy', text: 'Deleting your account…' });
    try {
      const c = await loadCloud();
      await c.auth.authStateReady();
      const user = c.auth.currentUser;
      if (!user || user.uid !== link.uid) throw Object.assign(new Error(), { code: 'auth/requires-recent-login' });
      await c.A.reauthenticateWithCredential(user, c.A.EmailAuthProvider.credential(link.email, password));
      await deleteCloudData(c, user.uid);
      await c.A.deleteUser(user);
      await deleteCloudLink();
      await forgetFriendCaches();
      await db.clearTogether().catch(() => {});
      togetherChanged();
      setLink(null);
      setStatus({ kind: 'done', text: 'Account deleted. Your log is still on this phone.' });
      return true;
    } catch (e) { setStatus({ kind: 'error', text: cloudError(e) }); return false; }
  }, [link, db]);

  return { link, mine, statusBox, lastSyncBox, enter, signOut, resetPassword, deleteAccount, run };
}
export type CloudStore = ReturnType<typeof useCloud>;

/** The sync's status and when it last synced, live, for the screen that shows them. */
export const useCloudStatus = (cloud: CloudStore) => ({ status: useBox(cloud.statusBox), lastSync: useBox(cloud.lastSyncBox) });
