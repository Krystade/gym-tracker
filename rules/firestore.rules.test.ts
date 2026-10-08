import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp, type Firestore } from 'firebase/firestore';

// Synthetic users: alice owns the data, bob is her friend, eve is a stranger.
let env: RulesTestEnvironment;
const as = (uid: string | null) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore() as unknown as Firestore;
const seed = (f: (db: Firestore) => Promise<unknown>) => env.withSecurityRulesDisabled(async (c) => { await f(c.firestore() as unknown as Firestore); });
const later = () => Timestamp.fromMillis(Date.now() + 86_400_000);

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-gym-tracker', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await seed(async (db) => {
    await setDoc(doc(db, 'users/alice'), { username: 'alice', displayName: 'Alice' });
    await setDoc(doc(db, 'users/bob'), { username: 'bob', displayName: 'Bob' });
    await setDoc(doc(db, 'users/alice/months/2026-10'), { sets: [], body: [], deleted: {}, updatedAt: 1 });
    await setDoc(doc(db, 'users/alice/meta/index'), { months: { '2026-10': 1 } });
    await setDoc(doc(db, 'users/alice/friends/bob'), { since: 1 });
    await setDoc(doc(db, 'users/bob/friends/alice'), { since: 1 });
    await setDoc(doc(db, 'usernames/alice'), { uid: 'alice' });
  });
});

describe('your log', () => {
  it('is yours to read and write', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'users/alice/months/2026-10')));
    await assertSucceeds(setDoc(doc(as('alice'), 'users/alice/months/2026-11'), { sets: [], body: [], deleted: {}, updatedAt: 2 }));
  });
  it('a friend can read it but not write it', async () => {
    await assertSucceeds(getDoc(doc(as('bob'), 'users/alice/months/2026-10')));
    await assertSucceeds(getDoc(doc(as('bob'), 'users/alice/meta/index')));
    await assertFails(setDoc(doc(as('bob'), 'users/alice/months/2026-10'), { sets: [] }));
  });
  it('a stranger, or someone signed out, can do neither', async () => {
    await assertFails(getDoc(doc(as('eve'), 'users/alice/months/2026-10')));
    await assertFails(getDoc(doc(as('eve'), 'users/alice/meta/index')));
    await assertFails(getDocs(collection(as('eve'), 'users/alice/months')));
    await assertFails(getDoc(doc(as(null), 'users/alice/months/2026-10')));
    await assertFails(setDoc(doc(as('eve'), 'users/alice/months/2026-10'), { sets: [] }));
  });
  it('a removed friend loses access at once, and either side can remove', async () => {
    await assertSucceeds(deleteDoc(doc(as('bob'), 'users/alice/friends/bob')));
    await assertFails(getDoc(doc(as('bob'), 'users/alice/months/2026-10')));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'users/bob/friends/alice')));
    await seed((db) => setDoc(doc(db, 'users/alice/friends/bob'), { since: 1 }));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'users/alice/friends/bob'))); // from your own list
    await assertFails(deleteDoc(doc(as('eve'), 'users/bob/friends/alice'))); // not someone else's friendship
  });
  it('nobody can add themselves to your friends list without an invite or your request', async () => {
    await assertFails(setDoc(doc(as('eve'), 'users/alice/friends/eve'), { since: 1 }));
    await assertFails(setDoc(doc(as('eve'), 'users/alice/friends/eve'), { since: 1, via: 'guess' }));
  });
});

describe('invites', () => {
  it('a live invite lets its holder become a friend', async () => {
    await seed((db) => setDoc(doc(db, 'users/alice/invites/tok123'), { created: 1, expires: later() }));
    await assertSucceeds(setDoc(doc(as('eve'), 'users/alice/friends/eve'), { since: 1, via: 'tok123' }));
    await assertSucceeds(getDoc(doc(as('eve'), 'users/alice/months/2026-10')));
  });
  it('an expired invite does not', async () => {
    await seed((db) => setDoc(doc(db, 'users/alice/invites/old'), { created: 1, expires: Timestamp.fromMillis(Date.now() - 1000) }));
    await assertFails(setDoc(doc(as('eve'), 'users/alice/friends/eve'), { since: 1, via: 'old' }));
  });
  it('only the owner can list or make invites', async () => {
    await assertFails(getDocs(collection(as('eve'), 'users/alice/invites')));
    await assertFails(setDoc(doc(as('eve'), 'users/alice/invites/mine'), { created: 1, expires: later() }));
  });
});

describe('requests', () => {
  it('a request lets the person you asked add you back', async () => {
    // eve asks alice; alice accepts: her own list, then eve's, which eve's request allows.
    await seed((db) => setDoc(doc(db, 'users/eve'), { username: 'eve', displayName: 'Eve' }));
    await assertSucceeds(setDoc(doc(as('eve'), 'users/alice/requests/eve'), { username: 'eve', sent: 1 }));
    await assertSucceeds(setDoc(doc(as('alice'), 'users/alice/friends/eve'), { since: 1 }));
    await assertSucceeds(setDoc(doc(as('alice'), 'users/eve/friends/alice'), { since: 1 }));
  });
  it('without a request, you cannot add yourself to their list', async () => {
    await seed((db) => setDoc(doc(db, 'users/eve'), { username: 'eve', displayName: 'Eve' }));
    await assertFails(setDoc(doc(as('alice'), 'users/eve/friends/alice'), { since: 1 }));
  });
  it('you send requests only as yourself, never to yourself, and a stranger cannot read them', async () => {
    await assertFails(setDoc(doc(as('eve'), 'users/alice/requests/bob'), { username: 'bob', sent: 1 }));
    await assertFails(setDoc(doc(as('alice'), 'users/alice/requests/alice'), { username: 'alice', sent: 1 }));
    await seed((db) => setDoc(doc(db, 'users/alice/requests/bob'), { username: 'bob', sent: 1 }));
    await assertFails(getDoc(doc(as('eve'), 'users/alice/requests/bob')));
    await assertSucceeds(getDoc(doc(as('bob'), 'users/alice/requests/bob')));
  });
});

describe('usernames and profiles', () => {
  it('can be looked up by exact name, never listed', async () => {
    await assertSucceeds(getDoc(doc(as('eve'), 'usernames/alice')));
    await assertFails(getDocs(collection(as('eve'), 'usernames')));
    await assertFails(getDoc(doc(as(null), 'usernames/alice')));
  });
  it('a name is claimed once, for yourself, in the allowed shape', async () => {
    await assertFails(setDoc(doc(as('eve'), 'usernames/alice'), { uid: 'eve' })); // taken
    await assertFails(setDoc(doc(as('eve'), 'usernames/someone'), { uid: 'bob' }));
    await assertFails(setDoc(doc(as('eve'), 'usernames/Bad Name'), { uid: 'eve' }));
    await assertSucceeds(setDoc(doc(as('eve'), 'usernames/eve_99'), { uid: 'eve' }));
    await assertFails(deleteDoc(doc(as('eve'), 'usernames/alice')));
  });
  it('a profile holds only a name, and only its owner writes it', async () => {
    await assertFails(setDoc(doc(as('eve'), 'users/eve'), { username: 'eve', months: {} }));
    await assertSucceeds(setDoc(doc(as('eve'), 'users/eve'), { username: 'eve', displayName: 'Eve' }));
    await assertFails(setDoc(doc(as('eve'), 'users/alice'), { username: 'x', displayName: 'x' }));
  });
});
