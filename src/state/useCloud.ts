import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteCloudLink, getCloudLink, putCloudLink, type CloudLink, type Person } from '../db/db';
import { useDb } from './profileDb';
import { cloudError, loadCloud } from '../cloud/firebase';
import { deleteCloudData, syncCloud } from '../cloud/sync';
import type { SetsStore } from './useSets';
import type { BodyStore } from './useBody';

export type CloudStatus = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'done'; text: string } | { kind: 'error'; text: string };
const QUIET_MS = 3000; // after the last change, so a run of sets syncs once

/**
 * The account this phone is signed in to. Its log syncs with the person it was linked to at sign-in; while another person
 * on the phone is open, nothing syncs. Firebase loads only once there's an account (or the Account card asks for it).
 */
export function useCloud(store: SetsStore, body: BodyStore, person: Person) {
  const db = useDb();
  const [link, setLink] = useState<CloudLink | null | undefined>(undefined);
  const [status, setStatus] = useState<CloudStatus>({ kind: 'idle' });
  const [lastSync, setLastSync] = useState<string | null>(null);
  const mine = !!link && link.person === person.id;

  useEffect(() => { void getCloudLink().then((l) => setLink(l ?? null)).catch(() => setLink(null)); }, []);
  useEffect(() => { void db.getCloudSeen().then((s) => setLastSync(s && link && s.uid === link.uid ? s.at ?? null : null)); }, [db, link]);

  // One sync at a time; a request during one runs once more after it.
  const running = useRef(false), again = useRef(false);
  const latest = useRef({ store, body, link });
  latest.current = { store, body, link };
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
      const { store: s, body: b } = latest.current;
      const r = await syncCloud(c, l.uid, { sets: s.entries, body: b.days, tombstones: await db.getTombstones(), seen: prev?.uid === l.uid ? prev.seen : {} },
        { importSets: (x) => s.importEntries(x), importBody: (x) => b.importDays(x), removeSets: (x) => s.removeMany(x) });
      const at = new Date().toISOString();
      await db.putCloudSeen({ key: 'cloud-seen', uid: l.uid, seen: r.seen, at });
      setLastSync(at);
      const got = [r.pulled && `${r.pulled} set${r.pulled === 1 ? '' : 's'} in`, r.removed && `${r.removed} removed`].filter(Boolean).join(', ');
      setStatus({ kind: 'done', text: `Synced${got ? `: ${got}` : ''}` });
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error && !(e as { code?: string }).code ? e.message : cloudError(e) });
    } finally {
      running.current = false;
      if (again.current) { again.current = false; void run(); }
    }
  }, [db, person.id]);

  // Sync a few seconds after the log changes, and whenever the app comes back to the front.
  useEffect(() => {
    if (!mine || store.loading) return;
    const t = setTimeout(() => void run(), QUIET_MS);
    return () => clearTimeout(t);
  }, [mine, store.entries, body.days, store.loading, run]);
  useEffect(() => {
    if (!mine) return;
    const on = () => { if (document.visibilityState === 'visible') void run(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
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
    setLink(null);
    setStatus({ kind: 'idle' });
  }, []);

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
      setLink(null);
      setStatus({ kind: 'done', text: 'Account deleted. Your log is still on this phone.' });
      return true;
    } catch (e) { setStatus({ kind: 'error', text: cloudError(e) }); return false; }
  }, [link]);

  return { link, mine, status, lastSync, enter, signOut, resetPassword, deleteAccount, run };
}
export type CloudStore = ReturnType<typeof useCloud>;
