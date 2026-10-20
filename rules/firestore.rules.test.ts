import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, documentId, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch, type Firestore } from 'firebase/firestore';

// Synthetic users: alice owns the data, bob is her friend, eve is a stranger.
let env: RulesTestEnvironment;
const PROJECT = process.env.RULES_PROJECT ?? 'demo-gym-tracker';
const as = (uid: string | null) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore() as unknown as Firestore;
const seed = (f: (db: Firestore) => Promise<unknown>) => env.withSecurityRulesDisabled(async (c) => { await f(c.firestore() as unknown as Firestore); });
const later = () => Timestamp.fromMillis(Date.now() + 86_400_000);
/** Accepting an invite, as the app does it: both friend documents, and the invite used up, in one write. */
const accept = (who: string, owner: string, token: string, used = token) => {
  const db = as(who), b = writeBatch(db);
  b.set(doc(db, `users/${owner}/friends/${who}`), { since: 1, via: token });
  b.set(doc(db, `users/${who}/friends/${owner}`), { since: 1, via: 'invite' });
  b.delete(doc(db, `users/${owner}/invites/${used}`));
  return b.commit();
};

beforeAll(async () => {
  // RULES_PROJECT: a project of their own, to run against an emulator already serving the app's (its rules and data stay put).
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
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
  it('a live invite lets its holder become a friend, using it up in the same write', async () => {
    await seed((db) => setDoc(doc(db, 'users/alice/invites/tok123'), { created: 1, expires: later() }));
    await assertSucceeds(accept('eve', 'alice', 'tok123'));
    await assertSucceeds(getDoc(doc(as('eve'), 'users/alice/months/2026-10')));
    expect((await getDoc(doc(as('alice'), 'users/alice/invites/tok123'))).exists()).toBe(false);
  });
  it('works once: the next person holding the same link is refused', async () => {
    await seed((db) => setDoc(doc(db, 'users/alice/invites/tok123'), { created: 1, expires: later() }));
    await assertSucceeds(accept('eve', 'alice', 'tok123'));
    await assertFails(accept('carol', 'alice', 'tok123'));
    await assertFails(setDoc(doc(as('carol'), 'users/alice/friends/carol'), { since: 1, via: 'tok123' }));
  });
  it('an invite left in place does not let anyone in (it must go in the same write)', async () => {
    await seed((db) => setDoc(doc(db, 'users/alice/invites/tok123'), { created: 1, expires: later() }));
    await assertFails(setDoc(doc(as('eve'), 'users/alice/friends/eve'), { since: 1, via: 'tok123' }));
    await seed((db) => setDoc(doc(db, 'users/alice/invites/tok456'), { created: 1, expires: later() }));
    await assertFails(accept('eve', 'alice', 'tok123', 'tok456')); // using up another invite instead
  });
  it('an expired invite does not', async () => {
    await seed((db) => setDoc(doc(db, 'users/alice/invites/old'), { created: 1, expires: Timestamp.fromMillis(Date.now() - 1000) }));
    await assertFails(setDoc(doc(as('eve'), 'users/alice/friends/eve'), { since: 1, via: 'old' }));
    await assertFails(accept('eve', 'alice', 'old'));
  });
  it('nobody but the owner deletes an invite, except by accepting it', async () => {
    await seed((db) => setDoc(doc(db, 'users/alice/invites/tok123'), { created: 1, expires: later() }));
    await assertFails(deleteDoc(doc(as('eve'), 'users/alice/invites/tok123')));
    await assertFails(accept('bob', 'alice', 'tok123')); // already a friend: nothing to accept, so it can't be burnt
    await seed((db) => setDoc(doc(db, 'users/alice/friends/carol'), { since: 1, via: 'tok123' })); // let in before invites worked once
    await assertFails(deleteDoc(doc(as('carol'), 'users/alice/invites/tok123')));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'users/alice/invites/tok123')));
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
  /** A first name, as the app claims it: the name and the profile naming it, in one write. */
  const claim = (uid: string, name: string) => {
    const db = as(uid);
    return writeBatch(db).set(doc(db, `usernames/${name}`), { uid }).set(doc(db, `users/${uid}`), { username: name, displayName: name }).commit();
  };
  /** A change, as the app makes it: the new name claimed, the old one released and the profile moved on, in one write. */
  const swap = (uid: string, from: string, to: string, o: { prev?: string; release?: string | null; claim?: boolean; at?: unknown } = {}) => {
    const db = as(uid), b = writeBatch(db);
    if (o.claim !== false) b.set(doc(db, `usernames/${to}`), { uid });
    const release = o.release === undefined ? from : o.release;
    if (release) b.delete(doc(db, `usernames/${release}`));
    b.set(doc(db, `users/${uid}`), { username: to, displayName: to, prev: o.prev ?? from, changedAt: o.at ?? serverTimestamp() });
    return b.commit();
  };
  const seedEve = () => seed(async (db) => {
    await setDoc(doc(db, 'usernames/eve'), { uid: 'eve' });
    await setDoc(doc(db, 'users/eve'), { username: 'eve', displayName: 'eve' });
  });
  it('can be looked up by exact name, never listed', async () => {
    await assertSucceeds(getDoc(doc(as('eve'), 'usernames/alice')));
    await assertFails(getDocs(collection(as('eve'), 'usernames')));
    await assertFails(getDoc(doc(as(null), 'usernames/alice')));
  });
  it('a name is claimed for yourself, in the allowed shape, together with your profile naming it', async () => {
    await assertFails(setDoc(doc(as('eve'), 'usernames/alice'), { uid: 'eve' })); // taken
    await assertFails(setDoc(doc(as('eve'), 'usernames/someone'), { uid: 'bob' }));
    await assertFails(claim('eve', 'Bad Name'));
    await assertFails(claim('eve', 'Eve'));
    await assertFails(setDoc(doc(as('eve'), 'usernames/eve_99'), { uid: 'eve' })); // a name alone: nobody hoards names
    await assertSucceeds(claim('eve', 'eve_99'));
    await assertFails(deleteDoc(doc(as('eve'), 'usernames/alice')));
  });
  it('a profile holds only a name you hold, and only its owner writes it', async () => {
    await seed((db) => setDoc(doc(db, 'usernames/eve'), { uid: 'eve' }));
    await assertFails(setDoc(doc(as('eve'), 'users/eve'), { username: 'eve', displayName: 'eve', months: {} }));
    await assertFails(setDoc(doc(as('eve'), 'users/eve'), { username: 'eve', displayName: 'Someone else' }));
    await assertFails(setDoc(doc(as('eve'), 'users/eve'), { username: 'alice', displayName: 'alice' }));
    await assertSucceeds(setDoc(doc(as('eve'), 'users/eve'), { username: 'eve', displayName: 'eve' }));
    await assertFails(setDoc(doc(as('eve'), 'users/alice'), { username: 'x', displayName: 'x' }));
  });
  it('a stolen name is refused: nobody takes a held name, or goes by one they don’t hold', async () => {
    await seedEve();
    await assertFails(swap('eve', 'eve', 'alice')); // claiming alice's: her name document is there
    await assertFails(swap('eve', 'eve', 'alice', { claim: false })); // going by it without the document
    await assertFails(setDoc(doc(as('eve'), 'users/eve'), { username: 'alice', displayName: 'alice', prev: 'eve', changedAt: serverTimestamp() }));
    expect((await getDoc(doc(as('eve'), 'usernames/alice'))).data()).toEqual({ uid: 'alice' });
    expect((await getDoc(doc(as('eve'), 'users/eve'))).data()?.username).toBe('eve');
  });
  it('nobody releases someone else’s name, alone or inside their own change', async () => {
    await seedEve();
    await assertFails(deleteDoc(doc(as('eve'), 'usernames/alice')));
    const db = as('eve');
    await assertFails(writeBatch(db).set(doc(db, 'usernames/eve2'), { uid: 'eve' }).delete(doc(db, 'usernames/eve')).delete(doc(db, 'usernames/alice'))
      .set(doc(db, 'users/eve'), { username: 'eve2', displayName: 'eve2', prev: 'eve', changedAt: serverTimestamp() }).commit());
    // Releasing alice's as if it were his old name.
    await assertFails(swap('eve', 'alice', 'eve2', { prev: 'eve' }));
    expect((await getDoc(doc(as('eve'), 'usernames/alice'))).exists()).toBe(true);
  });
  it('you can’t release your own name while your profile still goes by it', async () => {
    await assertFails(deleteDoc(doc(as('alice'), 'usernames/alice')));
  });
  it('a change is one write: the new name, the old one released and the profile, all or nothing', async () => {
    await assertFails(swap('alice', 'alice', 'alice_k', { release: null })); // keeping the old name too
    await assertFails(swap('alice', 'alice', 'alice_k', { claim: false })); // going by a name not held
    const db = as('alice');
    await assertFails(setDoc(doc(db, 'usernames/alice_k'), { uid: 'alice' })); // the new name alone
    await assertFails(writeBatch(db).set(doc(db, 'usernames/alice_k'), { uid: 'alice' }).delete(doc(db, 'usernames/alice')).commit()); // no profile
    expect((await getDoc(doc(db, 'usernames/alice'))).exists()).toBe(true);
    expect((await getDoc(doc(db, 'usernames/alice_k'))).exists()).toBe(false);
    await assertSucceeds(swap('alice', 'alice', 'alice_k'));
    expect((await getDoc(doc(db, 'usernames/alice'))).exists()).toBe(false);
    expect((await getDoc(doc(db, 'usernames/alice_k'))).data()).toEqual({ uid: 'alice' });
    expect((await getDoc(doc(as('bob'), 'users/alice'))).data()).toMatchObject({ username: 'alice_k', prev: 'alice' });
    // The old name is anyone's now.
    await assertSucceeds(claim('eve', 'alice'));
  });
  it('the previous name is the real one, and the time is the server’s', async () => {
    await assertFails(swap('alice', 'alice', 'alice_k', { prev: 'bob' }));
    await assertFails(swap('alice', 'alice', 'alice_k', { at: Timestamp.fromMillis(Date.now() - 3 * 86_400_000) }));
    await assertSucceeds(swap('alice', 'alice', 'alice_k'));
  });
  it('once a day: a second change within the day is refused, the next day it goes', async () => {
    await assertSucceeds(swap('alice', 'alice', 'alice_k'));
    await assertFails(swap('alice', 'alice_k', 'alice_z'));
    await seed((db) => setDoc(doc(db, 'users/alice'), { username: 'alice_k', displayName: 'alice_k', prev: 'alice', changedAt: Timestamp.fromMillis(Date.now() - 86_400_000 - 60_000) }));
    await assertSucceeds(swap('alice', 'alice_k', 'alice_z'));
  });
  it('deleting the account takes the name with the profile, in one write', async () => {
    const db = as('alice');
    await assertSucceeds(writeBatch(db).delete(doc(db, 'usernames/alice')).delete(doc(db, 'users/alice')).commit());
  });
});

describe('private friend tags (your synced settings)', () => {
  const tags = { tags: { bob: 'Bob (gym)' }, updatedAt: 1 };
  it('are yours alone: a friend can’t read or write them', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'users/alice/private/tags'), tags));
    await assertSucceeds(getDoc(doc(as('alice'), 'users/alice/private/tags')));
    await assertFails(getDoc(doc(as('bob'), 'users/alice/private/tags')));
    await assertFails(setDoc(doc(as('bob'), 'users/alice/private/tags'), tags));
  });
});

describe('gyms sent to a friend', () => {
  const gym = { name: 'Home', equipment: ['barbell'], exclude: [], include: [] };
  const sent = (from: string) => ({ from, fromName: from, gym, sent: 1 });
  it('a friend can send you one; you read it and clear it', async () => {
    await assertSucceeds(setDoc(doc(as('bob'), 'users/alice/gymInbox/g1'), sent('bob')));
    await assertSucceeds(getDocs(collection(as('alice'), 'users/alice/gymInbox')));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'users/alice/gymInbox/g1')));
  });
  it('a stranger cannot send one, nor read yours', async () => {
    await assertFails(setDoc(doc(as('eve'), 'users/alice/gymInbox/g1'), sent('eve')));
    await seed((db) => setDoc(doc(db, 'users/alice/gymInbox/g2'), sent('bob')));
    await assertFails(getDoc(doc(as('eve'), 'users/alice/gymInbox/g2')));
    await assertFails(deleteDoc(doc(as('eve'), 'users/alice/gymInbox/g2')));
  });
  it('a friend cannot send as someone else, add other fields, or read your inbox', async () => {
    await assertFails(setDoc(doc(as('bob'), 'users/alice/gymInbox/g1'), sent('carol')));
    await assertFails(setDoc(doc(as('bob'), 'users/alice/gymInbox/g1'), { ...sent('bob'), months: {} }));
    await seed((db) => setDoc(doc(db, 'users/alice/gymInbox/g2'), sent('bob')));
    await assertFails(getDocs(collection(as('bob'), 'users/alice/gymInbox')));
    await assertFails(setDoc(doc(as('bob'), 'users/alice/gymInbox/g2'), { ...sent('bob'), sent: 2 })); // no rewriting one already there
  });
});

describe('a sent gym, read back by its sender (the push Worker checks it with their token)', () => {
  const gym = { name: 'Home', equipment: ['barbell'], exclude: [], include: [] };
  it('its sender can get that one; nobody else can, and the sender still can’t list the inbox', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users/alice/gymInbox/g1'), { from: 'bob', fromName: 'bob', gym, sent: 1 });
      await setDoc(doc(db, 'users/alice/gymInbox/g2'), { from: 'carol', fromName: 'carol', gym, sent: 1 });
    });
    await assertSucceeds(getDoc(doc(as('bob'), 'users/alice/gymInbox/g1')));
    await assertFails(getDoc(doc(as('bob'), 'users/alice/gymInbox/g2')));
    await assertFails(getDoc(doc(as('eve'), 'users/alice/gymInbox/g1')));
    await assertFails(getDoc(doc(as(null), 'users/alice/gymInbox/g1')));
    await assertFails(getDocs(collection(as('bob'), 'users/alice/gymInbox')));
    await assertFails(deleteDoc(doc(as('bob'), 'users/alice/gymInbox/g1')));
  });
});

// The push Worker reads Firestore over REST with the sender's own ID token. These go to the emulator the same way, with
// the unsigned token the Auth emulator would issue, to prove what the Worker relies on: a 404 for a friend's
// meta/__probe (allowed, and absent) and a 403 for a stranger's.
describe('the push Worker’s reads over REST', () => {
  const token = (uid: string) => {
    const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    return `${b({ alg: 'none', typ: 'JWT' })}.${b({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: uid, user_id: uid, iat: now, auth_time: now, exp: now + 3600 })}.`;
  };
  const rest = async (uid: string, path: string) => {
    const r = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { authorization: `Bearer ${token(uid)}` } });
    return { status: r.status, body: r.ok ? await r.json() as { createTime: string; fields: Record<string, { stringValue?: string }> } : null };
  };
  it('the friendship probe: 404 for a friend, 403 for a stranger', async () => {
    expect((await rest('bob', 'users/alice/meta/__probe')).status).toBe(404);
    expect((await rest('eve', 'users/alice/meta/__probe')).status).toBe(403);
    // A friend only on your own list (anyone can add anyone there) is still a stranger to the probe.
    await assertSucceeds(setDoc(doc(as('eve'), 'users/eve/friends/alice'), { since: 1 }));
    expect((await rest('eve', 'users/alice/meta/__probe')).status).toBe(403);
  });
  it('a request and a sent gym come back to their sender with a server createTime; a stranger gets 403', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users/alice/requests/eve'), { username: 'eve', sent: 1 });
      await setDoc(doc(db, 'users/alice/gymInbox/g1'), { from: 'bob', fromName: 'bob', gym: { name: 'Home' }, sent: 1 });
    });
    const req = await rest('eve', 'users/alice/requests/eve');
    expect(req.status).toBe(200);
    expect(Math.abs(Date.parse(req.body!.createTime) - Date.now())).toBeLessThan(60_000);
    const g = await rest('bob', 'users/alice/gymInbox/g1');
    expect(g.status).toBe(200);
    expect(g.body!.fields.from.stringValue).toBe('bob');
    expect((await rest('eve', 'users/alice/gymInbox/g1')).status).toBe(403);
    expect((await rest('carol', 'users/alice/requests/eve')).status).toBe(403);
  });
});

describe('pings and messages (inbox), with the sender’s counter (sendRate)', () => {
  type Rate = { at: Timestamp; win: Timestamp; n: number };
  /** One send, as the app makes it: the inbox document and the sender's counter in one write. */
  const send = (from: string, to: string, data: Record<string, unknown>, rate: Partial<Record<keyof Rate, unknown>> = {}, id = `m${Math.random().toString(36).slice(2, 8)}`) => {
    const db = as(from), b = writeBatch(db);
    b.set(doc(db, `users/${to}/inbox/${id}`), { from, at: serverTimestamp(), ...data });
    b.set(doc(db, `users/${from}/sendRate/${to}`), { at: serverTimestamp(), win: serverTimestamp(), n: 1, ...rate });
    return b.commit();
  };
  const ping = (e = 'strong') => ({ kind: 'p', e });
  const msg = (t: string) => ({ kind: 'm', t });
  const ago = (ms: number) => Timestamp.fromMillis(Date.now() - ms);
  const seedRate = (r: Rate) => seed((db) => setDoc(doc(db, 'users/bob/sendRate/alice'), r));
  const clearRate = () => seed((db) => deleteDoc(doc(db, 'users/bob/sendRate/alice')));

  it('a friend’s ping and message go in; a stranger’s don’t', async () => {
    await assertSucceeds(send('bob', 'alice', ping()));
    await seedRate({ at: ago(5000), win: ago(60_000), n: 1 });
    const win = ((await getDoc(doc(as('bob'), 'users/bob/sendRate/alice'))).data() as Rate).win;
    await assertSucceeds(send('bob', 'alice', msg('x'.repeat(140)), { win, n: 2 }));
    await assertFails(send('eve', 'alice', ping()));
  });
  it('only the six pings, 1 to 140 characters, the four keys and no more', async () => {
    for (const e of ['strong', 'fire', 'clap', 'gym', 'eyes', 'salute']) {
      await clearRate();
      await assertSucceeds(send('bob', 'alice', ping(e)));
    }
    await clearRate();
    await assertFails(send('bob', 'alice', ping('kiss')));
    await assertFails(send('bob', 'alice', msg('')));
    await assertFails(send('bob', 'alice', msg('x'.repeat(141))));
    await assertFails(send('bob', 'alice', { kind: 'm', t: 7 }));
    await assertFails(send('bob', 'alice', { ...ping(), t: 'hi' }));
    await assertFails(send('bob', 'alice', { ...msg('hi'), name: 'bob' }));
    await assertFails(send('bob', 'alice', { kind: 'x', e: 'strong' }));
    // The rules count UTF-16 units, as a JS string's length and an input's maxLength do: an emoji like 💪 is two.
    await clearRate();
    await assertFails(send('bob', 'alice', msg('💪'.repeat(71))));
    await assertSucceeds(send('bob', 'alice', msg('💪'.repeat(70))));
  });
  it('never as someone else, never with the phone’s clock, never without the counter in the same write', async () => {
    await assertFails(send('bob', 'alice', { ...ping(), from: 'carol' }));
    await assertFails(send('bob', 'alice', { ...ping(), at: Timestamp.now() }));
    await assertFails(setDoc(doc(as('bob'), 'users/alice/inbox/x1'), { from: 'bob', at: serverTimestamp(), ...ping() }));
    await assertSucceeds(send('bob', 'alice', ping()));
  });
  it('2 s between sends, 30 an hour, and a new hour starts again at 1', async () => {
    await assertSucceeds(send('bob', 'alice', ping()));
    const first = (await getDoc(doc(as('bob'), 'users/bob/sendRate/alice'))).data() as Rate;
    await assertFails(send('bob', 'alice', ping(), { win: first.win, n: 2 })); // inside 2 s
    await seedRate({ at: ago(5000), win: ago(600_000), n: 29 });
    const win = ((await getDoc(doc(as('bob'), 'users/bob/sendRate/alice'))).data() as Rate).win;
    await assertFails(send('bob', 'alice', ping(), { win, n: 29 })); // the count must move
    await assertSucceeds(send('bob', 'alice', ping(), { win, n: 30 }));
    await seedRate({ at: ago(5000), win, n: 30 });
    await assertFails(send('bob', 'alice', ping(), { win, n: 31 })); // the 31st
    await assertFails(send('bob', 'alice', ping())); // and no starting over inside the hour
    await seedRate({ at: ago(5000), win: ago(3_601_000), n: 30 });
    await assertSucceeds(send('bob', 'alice', ping())); // a new hour: n = 1, win = now
  });
  it('the counter is yours alone, and goes only once its hour is over', async () => {
    await assertFails(getDoc(doc(as('alice'), 'users/bob/sendRate/alice')));
    await assertFails(setDoc(doc(as('alice'), 'users/bob/sendRate/alice'), { at: serverTimestamp(), win: serverTimestamp(), n: 1 }));
    await seedRate({ at: ago(5000), win: ago(600_000), n: 3 });
    await assertFails(deleteDoc(doc(as('bob'), 'users/bob/sendRate/alice')));
    await seedRate({ at: ago(5000), win: ago(3_601_000), n: 3 });
    await assertSucceeds(deleteDoc(doc(as('bob'), 'users/bob/sendRate/alice')));
    // With the account: its profile goes in the same write.
    await seedRate({ at: ago(5000), win: ago(600_000), n: 3 });
    const bob = as('bob'), b = writeBatch(bob);
    b.delete(doc(bob, 'users/bob/sendRate/alice'));
    b.delete(doc(bob, 'users/bob'));
    await assertSucceeds(b.commit());
  });
  it('you read and clear yours; a sender reads back only their own, by asking for them; nobody edits one', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users/carol'), { username: 'carol', displayName: 'Carol' });
      await setDoc(doc(db, 'users/alice/friends/carol'), { since: 1 });
      await setDoc(doc(db, 'users/alice/inbox/b1'), { from: 'bob', kind: 'p', e: 'fire', at: Timestamp.now() });
      await setDoc(doc(db, 'users/alice/inbox/c1'), { from: 'carol', kind: 'm', t: 'secret', at: Timestamp.now() });
    });
    expect((await assertSucceeds(getDocs(collection(as('alice'), 'users/alice/inbox')))).size).toBe(2);
    const mine = await assertSucceeds(getDocs(query(collection(as('bob'), 'users/alice/inbox'), where('from', '==', 'bob'))));
    expect(mine.docs.map((d) => d.id)).toEqual(['b1']);
    await assertSucceeds(getDoc(doc(as('bob'), 'users/alice/inbox/b1')));
    await assertFails(getDocs(collection(as('bob'), 'users/alice/inbox')));
    await assertFails(getDoc(doc(as('bob'), 'users/alice/inbox/c1')));
    await assertFails(getDocs(query(collection(as('eve'), 'users/alice/inbox'), where('from', '==', 'bob'))));
    await assertFails(updateDoc(doc(as('bob'), 'users/alice/inbox/b1'), { e: 'clap' }));
    await assertFails(updateDoc(doc(as('alice'), 'users/alice/inbox/b1'), { e: 'clap' }));
    await assertFails(deleteDoc(doc(as('bob'), 'users/alice/inbox/b1')));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'users/alice/inbox/b1')));
  });
});

describe('your friends list: mute and read, nothing else', () => {
  it('the owner sets muted and readAt (the server’s time), and nothing else', async () => {
    await assertSucceeds(updateDoc(doc(as('alice'), 'users/alice/friends/bob'), { muted: true }));
    await assertSucceeds(updateDoc(doc(as('alice'), 'users/alice/friends/bob'), { readAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(as('alice'), 'users/alice/friends/bob'), { muted: false })); // readAt untouched
    await assertFails(updateDoc(doc(as('alice'), 'users/alice/friends/bob'), { readAt: Timestamp.now() }));
    await assertFails(updateDoc(doc(as('alice'), 'users/alice/friends/bob'), { muted: 'yes' }));
    await assertFails(updateDoc(doc(as('alice'), 'users/alice/friends/bob'), { since: 99 }));
    await assertFails(updateDoc(doc(as('alice'), 'users/alice/friends/bob'), { via: 'x' }));
  });
  it('a friend can’t mute you on your list, nor see it', async () => {
    await assertFails(updateDoc(doc(as('bob'), 'users/alice/friends/bob'), { muted: true }));
    await assertFails(updateDoc(doc(as('bob'), 'users/alice/friends/bob'), { readAt: serverTimestamp() }));
    await assertFails(getDoc(doc(as('bob'), 'users/alice/friends/bob')));
  });
});

describe('blocking', () => {
  beforeEach(() => seed(async (db) => {
    await setDoc(doc(db, 'users/eve'), { username: 'eve', displayName: 'Eve' });
    await setDoc(doc(db, 'users/alice/blocked/eve'), { at: Timestamp.now() });
  }));
  it('who you blocked is yours alone', async () => {
    await assertSucceeds(getDocs(collection(as('alice'), 'users/alice/blocked')));
    await assertFails(getDoc(doc(as('eve'), 'users/alice/blocked/eve')));
    await assertFails(deleteDoc(doc(as('eve'), 'users/alice/blocked/eve')));
    await assertFails(setDoc(doc(as('alice'), 'users/alice/blocked/carol'), { at: 1, why: 'x' }));
    await assertSucceeds(setDoc(doc(as('alice'), 'users/alice/blocked/carol'), { at: serverTimestamp() }));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'users/alice/blocked/eve')));
  });
  it('someone blocked can’t ask again, use an invite, or answer an old request', async () => {
    await assertFails(setDoc(doc(as('eve'), 'users/alice/requests/eve'), { username: 'eve', sent: 1 }));
    await seed((db) => setDoc(doc(db, 'users/alice/invites/tok123'), { created: 1, expires: later() }));
    await assertFails(accept('eve', 'alice', 'tok123'));
    await seed((db) => setDoc(doc(db, 'users/eve/requests/alice'), { username: 'alice', sent: 1 }));
    await assertFails(setDoc(doc(as('eve'), 'users/alice/friends/eve'), { since: 1 }));
    // Unblocked, the same moves work.
    await seed((db) => deleteDoc(doc(db, 'users/alice/blocked/eve')));
    await assertSucceeds(setDoc(doc(as('eve'), 'users/alice/friends/eve'), { since: 1 }));
    await seed((db) => deleteDoc(doc(db, 'users/alice/friends/eve')));
    await assertSucceeds(accept('eve', 'alice', 'tok123'));
  });
  it('blocking a friend, as the app does it: both friend documents and any requests go in one write', async () => {
    await seed((db) => setDoc(doc(db, 'users/bob/requests/alice'), { username: 'alice', sent: 1 }));
    const db = as('alice'), b = writeBatch(db);
    b.delete(doc(db, 'users/alice/friends/bob'));
    b.delete(doc(db, 'users/bob/friends/alice'));
    b.delete(doc(db, 'users/alice/requests/bob'));
    b.delete(doc(db, 'users/bob/requests/alice'));
    b.set(doc(db, 'users/alice/blocked/bob'), { at: serverTimestamp() });
    await assertSucceeds(b.commit());
    await assertFails(getDoc(doc(as('bob'), 'users/alice/months/2026-10')));
    await assertFails(setDoc(doc(as('bob'), 'users/alice/requests/bob'), { username: 'bob', sent: 1 }));
    const bob = as('bob');
    await assertFails(writeBatch(bob).set(doc(bob, 'users/alice/inbox/z'), { from: 'bob', kind: 'p', e: 'fire', at: serverTimestamp() })
      .set(doc(bob, 'users/bob/sendRate/alice'), { at: serverTimestamp(), win: serverTimestamp(), n: 1 }).commit());
  });
});

describe('private (cycle phase)', () => {
  const cycle = { days: { '2026-10-01': 'period' }, tracking: true, updatedAt: 1 };
  it('the owner can read and write it', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'users/alice/private/cycle'), cycle));
    await assertSucceeds(getDoc(doc(as('alice'), 'users/alice/private/cycle')));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'users/alice/private/cycle')));
  });
  it('a friend cannot read it, list it, or write it', async () => {
    await seed((db) => setDoc(doc(db, 'users/alice/private/cycle'), cycle));
    await assertFails(getDoc(doc(as('bob'), 'users/alice/private/cycle')));
    await assertFails(getDocs(collection(as('bob'), 'users/alice/private')));
    await assertFails(setDoc(doc(as('bob'), 'users/alice/private/cycle'), cycle));
    await assertFails(deleteDoc(doc(as('bob'), 'users/alice/private/cycle')));
  });
  it('a stranger, or someone signed out, cannot read it', async () => {
    await seed((db) => setDoc(doc(db, 'users/alice/private/cycle'), cycle));
    await assertFails(getDoc(doc(as('eve'), 'users/alice/private/cycle')));
    await assertFails(getDoc(doc(as(null), 'users/alice/private/cycle')));
    await assertFails(setDoc(doc(as('eve'), 'users/alice/private/cycle'), cycle));
  });
});
describe('Crew status phrase (in the synced settings)', () => {
  const settings = (status: string) => ({ items: { status: JSON.stringify(status) }, updatedAt: 1 });
  it('is yours to set; a friend can read it but not write it; a stranger can do neither', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'users/alice/meta/profile'), settings('deload week')));
    const got = await assertSucceeds(getDoc(doc(as('bob'), 'users/alice/meta/profile')));
    expect(JSON.parse((got.data() as { items: { status: string } }).items.status)).toBe('deload week');
    await assertFails(setDoc(doc(as('bob'), 'users/alice/meta/profile'), settings('hacked')));
    await assertFails(updateDoc(doc(as('bob'), 'users/alice/meta/profile'), { 'items.status': JSON.stringify('hacked') }));
    await assertFails(getDoc(doc(as('eve'), 'users/alice/meta/profile')));
    await assertFails(setDoc(doc(as('eve'), 'users/alice/meta/profile'), settings('hacked')));
  });
});

// The reads that ask only for what changed (round 14): no rule changed for them, and these keep it so.
describe('reading only what changed', () => {
  const months = (db: Firestore, owner: string) =>
    getDocs(query(collection(db, `users/${owner}/months`), where(documentId(), '>=', '2026-08'), where(documentId(), '<=', '2026-10')));
  it('a friend reads a run of your months in one query (Crew); a stranger can’t', async () => {
    await seed((db) => setDoc(doc(db, 'users/alice/months/2026-09'), { sets: [], body: [], deleted: {}, updatedAt: 1 }));
    expect((await assertSucceeds(months(as('bob'), 'alice'))).docs.map((d) => d.id)).toEqual(['2026-09', '2026-10']);
    await assertFails(months(as('eve'), 'alice'));
    await assertFails(months(as(null), 'alice'));
  });
  it('your old day plans’ archive (meta/plans-YYYY): yours to write and list; a friend reads it like your settings; a stranger can’t', async () => {
    const archive = (db: Firestore) => getDocs(query(collection(db, 'users/alice/meta'), where(documentId(), '>=', 'plans-'), where(documentId(), '<', 'plans.')));
    await assertSucceeds(setDoc(doc(as('alice'), 'users/alice/meta/plans-2025'), { items: { 'day:2025-06-02': '{}' }, updatedAt: 1 }, { merge: true }));
    expect((await assertSucceeds(archive(as('alice')))).docs.map((d) => d.id)).toEqual(['plans-2025']);
    await assertSucceeds(getDoc(doc(as('bob'), 'users/alice/meta/plans-2025')));
    await assertFails(setDoc(doc(as('bob'), 'users/alice/meta/plans-2025'), { items: {} }));
    await assertFails(archive(as('eve')));
    await assertFails(setDoc(doc(as('eve'), 'users/alice/meta/plans-2025'), { items: {} }));
  });
  it('your inbox from a time on (the news reads only what’s new); nobody else’s', async () => {
    await seed((db) => setDoc(doc(db, 'users/alice/inbox/m1'), { from: 'bob', kind: 'p', e: 'strong', at: Timestamp.fromMillis(Date.now()) }));
    const since = (db: Firestore) => getDocs(query(collection(db, 'users/alice/inbox'), where('at', '>', Timestamp.fromMillis(Date.now() - 60_000))));
    expect((await assertSucceeds(since(as('alice')))).size).toBe(1);
    await assertFails(since(as('bob'))); // a sender reads back only their own, asking with where from == them
    await assertFails(since(as('eve')));
  });
});
