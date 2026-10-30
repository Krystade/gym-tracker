import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, deleteField, doc, documentId, getDoc, getDocs, increment, limit, orderBy, query, serverTimestamp, setDoc, startAfter, Timestamp, updateDoc, where, writeBatch, type Firestore, type WriteBatch } from 'firebase/firestore';

// Synthetic users: alice owns the data, bob is her friend, eve is a stranger.
let env: RulesTestEnvironment;
const PROJECT = process.env.RULES_PROJECT ?? 'demo-gym-tracker';
// The emulator `firebase emulators:exec` started (its FIRESTORE_EMULATOR_HOST), else firebase.json's.
const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
const as = (uid: string | null) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore() as unknown as Firestore;
const seed = (f: (db: Firestore) => Promise<unknown>) => env.withSecurityRulesDisabled(async (c) => { await f(c.firestore() as unknown as Firestore); });
const later = () => Timestamp.fromMillis(Date.now() + 86_400_000);
/** Today's id for the app's daily counter, as firestore.rules work it out: UTC days since 1970. */
const dayId = (ms = Date.now()) => String(Math.floor(ms / 86_400_000));
/** Your social counter moved and the app's daily counter up one, in batch `b`, as the app does with each social write (r28). */
async function counters(db: Firestore, uid: string, b: WriteBatch) {
  const r = (await getDoc(doc(db, `socialRate/${uid}`))).data() as { win: Timestamp; n: number } | undefined;
  b.set(doc(db, `socialRate/${uid}`), r ? { at: serverTimestamp(), win: r.win, n: r.n + 1 } : { at: serverTimestamp(), win: serverTimestamp(), n: 1 });
  b.set(doc(db, `limits/${dayId()}`), { n: increment(1) }, { merge: true });
  return b;
}
/** A social write (a request, a gym, an invite) with its counters, as the app makes it. */
const social = async (uid: string, put: (db: Firestore, b: WriteBatch) => unknown) => {
  const db = as(uid), b = writeBatch(db);
  put(db, b);
  return (await counters(db, uid, b)).commit();
};
/** Accepting an invite, as the app does it: both friend documents, and the invite used up, in one write. */
const accept = (who: string, owner: string, token: string, used = token) => {
  const db = as(who), b = writeBatch(db);
  b.set(doc(db, `users/${owner}/friends/${who}`), { since: 1, via: token });
  b.set(doc(db, `users/${who}/friends/${owner}`), { since: 1, via: 'invite' });
  b.delete(doc(db, `users/${owner}/invites/${used}`));
  return b.commit();
};

/**
 * The rules as they ship, but for the owners' list: deployed it names the app's owner; here it names two synthetic accounts,
 * `root` and `second` (the room left for a second moderator), so these tests sign in as them. Anything but that list is as is.
 */
const OWNERS_FN = /function OWNERS\(\) \{ return \[[^\]]*\]; \}/;
function rulesUnderTest(): string {
  const rules = readFileSync('firestore.rules', 'utf8');
  if ((rules.match(new RegExp(OWNERS_FN, 'g')) ?? []).length !== 1) throw new Error('firestore.rules: expected one OWNERS() list to stand synthetic owners in for');
  return rules.replace(OWNERS_FN, "function OWNERS() { return ['root', 'second']; }");
}

beforeAll(async () => {
  // RULES_PROJECT: a project of their own, to run against an emulator already serving the app's (its rules and data stay put).
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: rulesUnderTest(), host: HOST, port: Number(PORT) } });
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
    await assertSucceeds(social('eve', (db, b) => b.set(doc(db, 'users/alice/requests/eve'), { username: 'eve', sent: 1 })));
    await assertSucceeds(setDoc(doc(as('alice'), 'users/alice/friends/eve'), { since: 1 }));
    await assertSucceeds(setDoc(doc(as('alice'), 'users/eve/friends/alice'), { since: 1 }));
  });
  it('without a request, you cannot add yourself to their list', async () => {
    await seed((db) => setDoc(doc(db, 'users/eve'), { username: 'eve', displayName: 'Eve' }));
    await assertFails(setDoc(doc(as('alice'), 'users/eve/friends/alice'), { since: 1 }));
  });
  it('you send requests only as yourself, never to yourself, and a stranger cannot read them', async () => {
    await assertFails(social('eve', (db, b) => b.set(doc(db, 'users/alice/requests/bob'), { username: 'bob', sent: 1 })));
    await assertFails(social('alice', (db, b) => b.set(doc(db, 'users/alice/requests/alice'), { username: 'alice', sent: 1 })));
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

// Social S1 (plan §4): a display name beside the @username, set by its owner at the server's time, once a day.
describe('display names', () => {
  const DAY = 86_400_000;
  const ago = (ms: number) => Timestamp.fromMillis(Date.now() - ms);
  /** Dana: a profile of the old shape (no display name), holding her name. */
  const seedDana = (extra: Record<string, unknown> = {}) => seed(async (db) => {
    await setDoc(doc(db, 'usernames/dana'), { uid: 'dana' });
    await setDoc(doc(db, 'users/dana'), { username: 'dana', displayName: 'dana', ...extra });
  });
  /** A display name as the app sets it: the name and the server's time, nothing else. */
  const setName = (uid: string, name: string, at: unknown = serverTimestamp()) => updateDoc(doc(as(uid), `users/${uid}`), { displayName: name, nameAt: at });
  /** A change of username as the app now makes it: the new name claimed, the old released, the profile updated in place. */
  const rename = (uid: string, from: string, to: string) => {
    const db = as(uid);
    return writeBatch(db).set(doc(db, `usernames/${to}`), { uid }).delete(doc(db, `usernames/${from}`))
      .update(doc(db, `users/${uid}`), { username: to, prev: from, changedAt: serverTimestamp() }).commit();
  };
  /** The same as an app from before display names makes it: the whole profile written in the old shape. */
  const oldRename = (uid: string, from: string, to: string) => {
    const db = as(uid);
    return writeBatch(db).set(doc(db, `usernames/${to}`), { uid }).delete(doc(db, `usernames/${from}`))
      .set(doc(db, `users/${uid}`), { username: to, displayName: to, prev: from, changedAt: serverTimestamp() }).commit();
  };
  const read = async (uid: string) => (await getDoc(doc(as(uid), `users/${uid}`))).data()!;

  it('its owner sets one, and changes it a day later; a friend and a stranger both read it', async () => {
    await seedDana();
    await assertSucceeds(setName('dana', 'Dana K.'));
    expect(await read('dana')).toMatchObject({ username: 'dana', displayName: 'Dana K.' });
    await assertSucceeds(getDoc(doc(as('bob'), 'users/dana')));
    expect((await getDoc(doc(as('eve'), 'users/dana'))).data()?.displayName).toBe('Dana K.');
    await assertFails(getDoc(doc(as(null), 'users/dana')));
    await seedDana({ displayName: 'Dana K.', nameAt: ago(DAY + 60_000) });
    await assertSucceeds(setName('dana', 'Dana 🏋️‍♀️'));
  });
  it('takes 60 UTF-16 units at most, emoji and joiners included', async () => {
    for (const name of ['D', 'x'.repeat(60), '💪'.repeat(30), 'Ana 🏋️‍♀️ García', 'Ünal Ç.', '李小龙', 'میر‌آبادی']) {
      await seedDana();
      await assertSucceeds(setName('dana', name)).catch((e) => { throw new Error(`${JSON.stringify(name)}: ${e}`); });
    }
  });
  it('refuses an @, anything drawn like the ✓, controls, invisible and direction-flipping characters, links, edge spaces, and past 60 units', async () => {
    const bad: [string, string][] = [
      ['an @', 'Dana @dana_real'], ['an @ alone', '@'],
      ['✓', 'Dana ✓'], ['✔', 'Dana ✔'], ['✔️', 'Dana ✔️'], ['☑', 'Dana ☑'], ['☑️', 'Dana ☑️'], ['✅', 'Dana ✅'], ['🗸', 'Dana 🗸'], ['√', 'Dana √'],
      ['🔵', 'Dana 🔵'], ['®', 'Dana®'], ['™', 'Dana™'],
      ['right-to-left override', 'Dana\u202eoof'], ['left-to-right override', '\u202dDana'], ['an isolate', 'Dana\u2066x\u2069'], ['a zero-width space', 'Da\u200bna'],
      ['a left-to-right mark', 'Dana\u200e'], ['a word joiner', 'Da\u2060na'], ['a byte-order mark', '\ufeffDana'], ['an Arabic letter mark', 'Dana\u061c'], ['a soft hyphen', 'Da\u00adna'],
      ['a line break', 'Dana\nK.'], ['a tab', 'Dana\tK.'], ['a null', 'Dana\u0000'], ['a C1 control', 'Dana\u0085'], ['a line separator', 'Dana\u2028K.'],
      ['a link', 'https://x'], ['a link mid-name', 'Dana see http://evil.example'], ['www.', 'Dana www.example.com'], ['WWW.', 'WWW.EXAMPLE'],
      ['61 units', 'x'.repeat(61)], ['31 emoji', '💪'.repeat(31)], ['empty', ''], ['a space first', ' Dana'], ['a space last', 'Dana '], ['only a space', ' '],
    ];
    const passed: string[] = [];
    for (const [why, name] of bad) {
      await seedDana();
      await assertFails(setName('dana', name)).catch(() => passed.push(why));
    }
    expect(passed).toEqual([]);
    expect((await read('dana')).displayName).toBe('dana');
  });
  it('is not text a link could hide in, nor anything but a string', async () => {
    await seedDana();
    await assertFails(setName('dana', 42 as unknown as string));
    await assertFails(setName('dana', ['Dana'] as unknown as string));
    await assertFails(updateDoc(doc(as('dana'), 'users/dana'), { displayName: 'Dana', nameAt: serverTimestamp(), bio: 'hi' }));
  });
  it('once a day, by the server’s clock: a second change within the day is refused, clearing it included', async () => {
    await seedDana();
    await assertSucceeds(setName('dana', 'Dana K.'));
    await assertFails(setName('dana', 'Dana R.'));
    await assertFails(setName('dana', 'dana')); // back to none counts as a change
    await assertFails(updateDoc(doc(as('dana'), 'users/dana'), { displayName: 'dana' })); // and isn't free without the time
    await seedDana({ displayName: 'Dana K.', nameAt: ago(DAY - 60_000) });
    await assertFails(setName('dana', 'Dana R.'));
    await seedDana({ displayName: 'Dana K.', nameAt: ago(DAY + 60_000) });
    await assertSucceeds(setName('dana', 'dana')); // cleared, a day on
    expect(await read('dana')).toMatchObject({ displayName: 'dana' });
  });
  it('only with the server’s time beside it, never the phone’s, and the time never moves on its own', async () => {
    await seedDana();
    await assertFails(setName('dana', 'Dana K.', Timestamp.now()));
    await assertFails(setName('dana', 'Dana K.', ago(3 * DAY)));
    await assertFails(updateDoc(doc(as('dana'), 'users/dana'), { displayName: 'Dana K.' })); // no time at all
    await seedDana({ displayName: 'Dana K.', nameAt: ago(2 * DAY) });
    await assertFails(updateDoc(doc(as('dana'), 'users/dana'), { nameAt: serverTimestamp() })); // the time alone
    await assertFails(updateDoc(doc(as('dana'), 'users/dana'), { nameAt: deleteField() })); // nor taken away
    const kept = (await read('dana')).nameAt as Timestamp;
    await assertSucceeds(updateDoc(doc(as('dana'), 'users/dana'), { displayName: 'Dana K.', nameAt: kept })); // the same, unchanged
  });
  it('only its owner sets it', async () => {
    await seedDana();
    await assertFails(updateDoc(doc(as('eve'), 'users/dana'), { displayName: 'Hacked', nameAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as('bob'), 'users/alice'), { displayName: 'Hacked', nameAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as(null), 'users/dana'), { displayName: 'Hacked', nameAt: serverTimestamp() }));
  });
  it('a first profile has none (the old shape), whatever the app', async () => {
    const db = as('fay');
    await assertFails(writeBatch(db).set(doc(db, 'usernames/fay'), { uid: 'fay' }).set(doc(db, 'users/fay'), { username: 'fay', displayName: 'Fay K.' }).commit());
    await assertFails(writeBatch(db).set(doc(db, 'usernames/fay'), { uid: 'fay' }).set(doc(db, 'users/fay'), { username: 'fay', displayName: 'fay', nameAt: serverTimestamp() }).commit());
    await assertSucceeds(writeBatch(db).set(doc(db, 'usernames/fay'), { uid: 'fay' }).set(doc(db, 'users/fay'), { username: 'fay', displayName: 'fay' }).commit());
  });
  it('a change of username keeps it (the app now updates the profile in place); with none set, the old shape follows the name', async () => {
    await seedDana({ displayName: 'Dana K.', nameAt: ago(2 * DAY), createdAt: ago(9 * DAY) });
    await assertSucceeds(rename('dana', 'dana', 'dana_k'));
    expect(await read('dana')).toMatchObject({ username: 'dana_k', displayName: 'Dana K.', prev: 'dana' });
    // None set: the old shape moves to the new name in the same update.
    await seedDana();
    const db = as('dana');
    await assertSucceeds(writeBatch(db).set(doc(db, 'usernames/dana_z'), { uid: 'dana' }).delete(doc(db, 'usernames/dana'))
      .update(doc(db, 'users/dana'), { username: 'dana_z', displayName: 'dana_z', prev: 'dana', changedAt: serverTimestamp() }).commit());
    expect(await read('dana')).toMatchObject({ username: 'dana_z', displayName: 'dana_z' });
    // A change of username can't carry a new display name in with it, set within the day: that goes by the once-a-day rule.
    await seed((x) => setDoc(doc(x, 'users/dana'), { username: 'dana_z', displayName: 'dana_z', prev: 'dana', changedAt: ago(2 * DAY), nameAt: Timestamp.now() }));
    await assertFails(writeBatch(db).set(doc(db, 'usernames/dana_y'), { uid: 'dana' }).delete(doc(db, 'usernames/dana_z'))
      .update(doc(db, 'users/dana'), { username: 'dana_y', displayName: 'Dana Y.', prev: 'dana_z', changedAt: serverTimestamp() }).commit());
  });
  it('an app from before display names still changes a username (the old shape written whole); a display name set goes with it, but not within its day', async () => {
    await seedDana();
    await assertSucceeds(oldRename('dana', 'dana', 'dana_k'));
    expect(await read('dana')).toEqual({ username: 'dana_k', displayName: 'dana_k', prev: 'dana', changedAt: expect.anything() });
    await seedDana({ displayName: 'Dana K.', nameAt: ago(DAY + 60_000), createdAt: ago(9 * DAY) });
    await assertSucceeds(oldRename('dana', 'dana', 'dana_m'));
    expect(await read('dana')).toMatchObject({ username: 'dana_m', displayName: 'dana_m' });
    // Within the day of setting it: refused, or renaming would be a way round once a day.
    await seedDana({ displayName: 'Dana K.', nameAt: ago(60_000) });
    await assertFails(oldRename('dana', 'dana', 'dana_n'));
    // An old app's write can't take away the time of a name it leaves in place.
    await seedDana({ displayName: 'Dana K.', nameAt: ago(2 * DAY) });
    const db = as('dana');
    await assertFails(writeBatch(db).set(doc(db, 'usernames/dana_p'), { uid: 'dana' }).delete(doc(db, 'usernames/dana'))
      .set(doc(db, 'users/dana'), { username: 'dana_p', displayName: 'Dana K.', prev: 'dana', changedAt: serverTimestamp() }).commit());
    // The same write with the time left in place goes: an older app never writes one, but nothing is lost by it.
    await assertSucceeds(writeBatch(db).set(doc(db, 'usernames/dana_q'), { uid: 'dana' }).delete(doc(db, 'usernames/dana'))
      .update(doc(db, 'users/dana'), { username: 'dana_q', prev: 'dana', changedAt: serverTimestamp() }).commit());
  });
  it('the username part is as strict as before: no `prev` or `changedAt` moved without a change of name', async () => {
    await seedDana({ displayName: 'Dana K.', nameAt: ago(2 * DAY), prev: 'old', changedAt: ago(5 * DAY) });
    await assertFails(updateDoc(doc(as('dana'), 'users/dana'), { prev: 'someone' }));
    await assertFails(updateDoc(doc(as('dana'), 'users/dana'), { changedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as('dana'), 'users/dana'), { displayName: 'Dana R.', nameAt: serverTimestamp(), changedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(as('dana'), 'users/dana'), { displayName: 'Dana R.', nameAt: serverTimestamp() }));
  });
  it('createdAt: the server’s time, on the first profile or added once to one without; never moved after', async () => {
    const db = as('gil');
    await assertFails(writeBatch(db).set(doc(db, 'usernames/gil'), { uid: 'gil' }).set(doc(db, 'users/gil'), { username: 'gil', displayName: 'gil', createdAt: ago(9 * DAY) }).commit());
    await assertSucceeds(writeBatch(db).set(doc(db, 'usernames/gil'), { uid: 'gil' }).set(doc(db, 'users/gil'), { username: 'gil', displayName: 'gil', createdAt: serverTimestamp() }).commit());
    expect(Math.abs(((await getDoc(doc(db, 'users/gil'))).data()!.createdAt as Timestamp).toMillis() - Date.now())).toBeLessThan(60_000);
    // Once set, never moved: not back, and not on to now (an hour on, so now is another time than the one kept).
    await seed((x) => updateDoc(doc(x, 'users/gil'), { createdAt: ago(3_600_000) }));
    await assertFails(updateDoc(doc(db, 'users/gil'), { createdAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db, 'users/gil'), { createdAt: ago(9 * DAY) }));
    // An account from before it: added once, as now; never backdated.
    await seedDana();
    await assertFails(updateDoc(doc(as('dana'), 'users/dana'), { createdAt: ago(9 * DAY) }));
    await assertFails(updateDoc(doc(as('eve'), 'users/dana'), { createdAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(as('dana'), 'users/dana'), { createdAt: serverTimestamp() }));
    const kept = (await read('dana')).createdAt as Timestamp;
    await assertSucceeds(setName('dana', 'Dana K.')); // other changes leave it be
    expect(((await read('dana')).createdAt as Timestamp).toMillis()).toBe(kept.toMillis());
  });
});

// Social S2 (plan §2, §4): the ✓, one document only the owner writes. These rules stand `root` and `second` in for the owners.
describe('the ✓ (config/verified)', () => {
  const ref = (uid: string | null) => doc(as(uid), 'config/verified');
  it('anyone signed in reads it; someone signed out can’t', async () => {
    await seed((db) => setDoc(doc(db, 'config/verified'), { uids: { bob: Timestamp.now() } }));
    expect((await assertSucceeds(getDoc(ref('eve')))).data()?.uids).toHaveProperty('bob');
    await assertSucceeds(getDoc(ref('bob')));
    await assertFails(getDoc(ref(null)));
  });
  it('the owner grants it, adds to it and takes it away; so can a second owner in the list', async () => {
    await assertSucceeds(setDoc(ref('root'), { uids: { bob: serverTimestamp() } }));
    await assertSucceeds(updateDoc(ref('root'), { 'uids.alice': serverTimestamp() }));
    await assertSucceeds(updateDoc(ref('second'), { 'uids.bob': deleteField() }));
    expect(Object.keys((await getDoc(ref('eve'))).data()!.uids)).toEqual(['alice']);
    await assertSucceeds(deleteDoc(ref('second')));
    await assertSucceeds(setDoc(ref('root'), { uids: {} }));
  });
  it('nobody else writes it: not to grant themselves, not to take one away, not to delete it', async () => {
    for (const who of ['alice', 'bob', 'eve']) {
      await assertFails(setDoc(ref(who), { uids: { [who]: serverTimestamp() } }));
    }
    await assertFails(setDoc(ref(null), { uids: { eve: serverTimestamp() } }));
    await seed((db) => setDoc(doc(db, 'config/verified'), { uids: { bob: Timestamp.now() } }));
    await assertFails(updateDoc(ref('eve'), { 'uids.eve': serverTimestamp() }));
    await assertFails(updateDoc(ref('alice'), { 'uids.bob': deleteField() }));
    await assertFails(setDoc(ref('bob'), { uids: { bob: Timestamp.now() } }, { merge: true }));
    await assertFails(deleteDoc(ref('eve')));
    expect(Object.keys((await getDoc(ref('eve'))).data()!.uids)).toEqual(['bob']);
  });
  it('holds only the map of uids, even from the owner; and there is no other config to write', async () => {
    await assertFails(setDoc(ref('root'), { uids: { bob: serverTimestamp() }, note: 'x' }));
    await assertFails(setDoc(ref('root'), { uids: ['bob'] }));
    await assertFails(setDoc(ref('root'), { bob: serverTimestamp() }));
    await assertFails(setDoc(doc(as('root'), 'config/other'), { uids: {} }));
    await assertFails(getDoc(doc(as('root'), 'config/other')));
    await assertFails(getDocs(collection(as('eve'), 'config')));
  });
  it('the owners are no key to anyone’s log, private settings or names', async () => {
    await assertFails(getDoc(doc(as('root'), 'users/alice/months/2026-10')));
    await assertFails(getDoc(doc(as('root'), 'users/alice/private/tags')));
    await assertFails(updateDoc(doc(as('root'), 'users/alice'), { displayName: 'Owned', nameAt: serverTimestamp() }));
    await assertFails(getDocs(collection(as('root'), 'usernames')));
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
    await assertSucceeds(social('bob', (db, b) => b.set(doc(db, 'users/alice/gymInbox/g1'), sent('bob'))));
    await assertSucceeds(getDocs(collection(as('alice'), 'users/alice/gymInbox')));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'users/alice/gymInbox/g1')));
  });
  it('a stranger cannot send one, nor read yours', async () => {
    await assertFails(social('eve', (db, b) => b.set(doc(db, 'users/alice/gymInbox/g1'), sent('eve'))));
    await seed((db) => setDoc(doc(db, 'users/alice/gymInbox/g2'), sent('bob')));
    await assertFails(getDoc(doc(as('eve'), 'users/alice/gymInbox/g2')));
    await assertFails(deleteDoc(doc(as('eve'), 'users/alice/gymInbox/g2')));
  });
  it('a friend cannot send as someone else, add other fields, or read your inbox', async () => {
    await assertFails(social('bob', (db, b) => b.set(doc(db, 'users/alice/gymInbox/g1'), sent('carol'))));
    await assertFails(social('bob', (db, b) => b.set(doc(db, 'users/alice/gymInbox/g1'), { ...sent('bob'), months: {} })));
    await seed((db) => setDoc(doc(db, 'users/alice/gymInbox/g2'), sent('bob')));
    await assertFails(getDocs(collection(as('bob'), 'users/alice/gymInbox')));
    await assertFails(social('bob', (db, b) => b.set(doc(db, 'users/alice/gymInbox/g2'), { ...sent('bob'), sent: 2 }))); // no rewriting one already there
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
    const r = await fetch(`http://${HOST}:${PORT}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { authorization: `Bearer ${token(uid)}` } });
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
  it('a board report comes back to its reporter with a server createTime; to anyone else but an owner, 403', async () => {
    await seed((db) => setDoc(doc(db, 'board/p1/reports/eve'), { why: 'spam', at: Timestamp.now() }));
    const r = await rest('eve', 'board/p1/reports/eve');
    expect(r.status).toBe(200);
    expect(Math.abs(Date.parse(r.body!.createTime) - Date.now())).toBeLessThan(60_000);
    expect((await rest('bob', 'board/p1/reports/bob')).status).toBe(404); // his own, never made: not there
    expect((await rest('bob', 'board/p1/reports/eve')).status).toBe(403);
    expect((await rest('root', 'board/p1/reports/eve')).status).toBe(200);
  });
});

describe('pings and messages (inbox), with the sender’s counter (sendRate)', () => {
  type Rate = { at: Timestamp; win: Timestamp; n: number };
  /** One send, as the app makes it: the inbox document and the sender's counter in one write. */
  const send = async (from: string, to: string, data: Record<string, unknown>, rate: Partial<Record<keyof Rate, unknown>> = {}, id = `m${Math.random().toString(36).slice(2, 8)}`) => {
    const db = as(from), b = writeBatch(db);
    b.set(doc(db, `users/${to}/inbox/${id}`), { from, at: serverTimestamp(), ...data });
    b.set(doc(db, `users/${from}/sendRate/${to}`), { at: serverTimestamp(), win: serverTimestamp(), n: 1, ...rate });
    return (await counters(db, from, b)).commit();
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
    await assertFails(social('eve', (db, b) => b.set(doc(db, 'users/alice/requests/eve'), { username: 'eve', sent: 1 })));
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
    await assertFails(social('bob', (db, b) => b.set(doc(db, 'users/alice/requests/bob'), { username: 'bob', sent: 1 })));
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
describe('body days (private/body-YYYY-MM), apart from the month friends read', () => {
  const kept = { body: [{ date: '2026-10-05', weight: 181.4, energy: 4, at: { weight: 1 } }], updatedAt: 1 };
  const month = { sets: [{ id: 'app|2026-10-05|squat|1', date: '2026-10-05' }], body: [], deleted: {}, updatedAt: 2, prs: [] };
  it('the owner reads and writes them, beside the month with its body left empty, in one write as the sync makes it', async () => {
    const db = as('alice');
    await assertSucceeds(writeBatch(db).set(doc(db, 'users/alice/months/2026-10'), month).set(doc(db, 'users/alice/private/body-2026-10'), kept).commit());
    await assertSucceeds(getDoc(doc(db, 'users/alice/private/body-2026-10')));
    await assertSucceeds(getDocs(collection(db, 'users/alice/private')));
    await assertSucceeds(deleteDoc(doc(db, 'users/alice/private/body-2026-10')));
  });
  it('a friend cannot read them, list them or write them, and still reads the month’s sets', async () => {
    await seed(async (db) => { await setDoc(doc(db, 'users/alice/private/body-2026-10'), kept); await setDoc(doc(db, 'users/alice/months/2026-10'), month); });
    await assertFails(getDoc(doc(as('bob'), 'users/alice/private/body-2026-10')));
    await assertFails(getDocs(collection(as('bob'), 'users/alice/private')));
    await assertFails(setDoc(doc(as('bob'), 'users/alice/private/body-2026-10'), kept));
    await assertFails(deleteDoc(doc(as('bob'), 'users/alice/private/body-2026-10')));
    const read = await assertSucceeds(getDoc(doc(as('bob'), 'users/alice/months/2026-10')));
    expect(read.data()?.sets).toHaveLength(1);
    expect(read.data()?.body).toEqual([]);
    await assertFails(getDoc(doc(as('eve'), 'users/alice/private/body-2026-10')));
    await assertFails(getDoc(doc(as(null), 'users/alice/private/body-2026-10')));
  });
  it('only a month’s id, and only body days in their shape', async () => {
    const db = as('alice');
    await assertFails(setDoc(doc(db, 'users/alice/private/body-2026-13'), kept));
    await assertFails(setDoc(doc(db, 'users/alice/private/body-x'), kept));
    await assertFails(setDoc(doc(db, 'users/alice/private/weights'), kept));
    await assertFails(setDoc(doc(db, 'users/alice/private/body-2026-10'), { ...kept, sets: [] }));
    await assertFails(setDoc(doc(db, 'users/alice/private/body-2026-10'), { body: 'x', updatedAt: 1 }));
    await assertFails(setDoc(doc(db, 'users/alice/private/body-2026-10'), { body: Array.from({ length: 101 }, (_, i) => ({ date: `d${i}` })), updatedAt: 1 }));
  });
  it('an older build still writes body days on the month, until it updates', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'users/alice/months/2026-10'), { sets: [], body: kept.body, deleted: {}, updatedAt: 3 }));
  });
});
describe('Together ledger (private/together)', () => {
  const ledger = { v: 1, p: { bob: { o: '2026-11-02', t: 'AQ' } }, updatedAt: 1 };
  it('the owner can read and write it', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'users/alice/private/together'), ledger));
    await assertSucceeds(getDoc(doc(as('alice'), 'users/alice/private/together')));
  });
  it('the friend it names cannot read it or write it; a third friend, a stranger or someone signed out neither', async () => {
    await seed((db) => setDoc(doc(db, 'users/alice/private/together'), ledger));
    for (const who of ['bob', 'carol', 'eve', null]) {
      await assertFails(getDoc(doc(as(who), 'users/alice/private/together')));
      await assertFails(setDoc(doc(as(who), 'users/alice/private/together'), ledger));
    }
    await assertFails(getDocs(collection(as('bob'), 'users/alice/private')));
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

// Compare (r22): each person's phone publishes one small summary of per-range numbers; a friend reads it, one read.
describe('the compare summary (users/{uid}/summary/compare)', () => {
  const pts = (k = 0) => Array.from({ length: 13 }, (_, i) => i * k);
  const range = (weeks: number) => ({ met: '1'.repeat(weeks), vol: pts(1), prs: pts(0), lifts: [{ n: 'Bench Press', s: pts(0.5) }] });
  /** A summary as the app writes it (domain/compare Summary, at the server's time). */
  const summary = (o: Record<string, unknown> = {}) => ({
    v: 1, at: serverTimestamp(), day: '2026-10-21', goal: 3, streak: 4,
    r: { '4w': range(4), '12w': range(12), '1y': range(52) }, firsts: [{ n: 'Bench Press', w: 225, d: '2026-10-03' }], ...o,
  });
  const path = (uid: string, d = 'compare') => `users/${uid}/summary/${d}`;
  const seeded = (uid: string) => seed((db) => setDoc(doc(db, path(uid)), { ...summary(), at: Timestamp.now() }));
  const write = (uid: string, data: Record<string, unknown>, d = 'compare') => setDoc(doc(as(uid), path(uid, d)), data);

  it('a friend can read it, and its owner; a stranger or someone signed out cannot', async () => {
    await seeded('alice');
    await assertSucceeds(getDoc(doc(as('bob'), path('alice'))));
    await assertSucceeds(getDoc(doc(as('alice'), path('alice'))));
    await assertFails(getDoc(doc(as('eve'), path('alice'))));
    await assertFails(getDoc(doc(as(null), path('alice'))));
  });
  it('a friend asking for one not written yet (a friend on an older app) is allowed and finds nothing; a stranger is refused', async () => {
    const got = await assertSucceeds(getDoc(doc(as('bob'), path('alice'))));
    expect(got.exists()).toBe(false);
    await assertFails(getDoc(doc(as('eve'), path('alice'))));
  });
  it('a pending request is not a friendship: neither side reads the other’s until it’s accepted', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users/eve'), { username: 'eve', displayName: 'Eve' });
      await setDoc(doc(db, path('eve')), { ...summary(), at: Timestamp.now() });
    });
    await seeded('alice');
    await assertSucceeds(social('eve', (db, b) => b.set(doc(db, 'users/alice/requests/eve'), { username: 'eve', sent: 1 })));
    await assertFails(getDoc(doc(as('eve'), path('alice'))));
    await assertFails(getDoc(doc(as('alice'), path('eve'))));
    // Putting her on your own list (anyone can name anyone there) doesn't get you hers: only her list naming you does.
    await assertSucceeds(setDoc(doc(as('eve'), 'users/eve/friends/alice'), { since: 1 }));
    await assertFails(getDoc(doc(as('eve'), path('alice'))));
    // Accepted (both documents, the request gone): now each reads the other's.
    const db = as('alice');
    await assertSucceeds(writeBatch(db).set(doc(db, 'users/alice/friends/eve'), { since: 1, via: 'request' }).delete(doc(db, 'users/alice/requests/eve')).commit());
    await assertSucceeds(getDoc(doc(as('eve'), path('alice'))));
    await assertSucceeds(getDoc(doc(as('alice'), path('eve'))));
  });
  it('a removed friend loses it at once', async () => {
    await seeded('alice');
    await assertSucceeds(deleteDoc(doc(as('alice'), 'users/alice/friends/bob')));
    await assertFails(getDoc(doc(as('bob'), path('alice'))));
  });
  it('only its owner writes it: creates, replaces and deletes; a friend or a stranger can do none of it', async () => {
    await assertSucceeds(write('alice', summary()));
    await assertSucceeds(write('alice', summary({ streak: 5 })));
    await assertFails(setDoc(doc(as('bob'), path('alice')), summary()));
    await assertFails(setDoc(doc(as('eve'), path('alice')), summary()));
    await assertFails(setDoc(doc(as('bob'), path('bob')), summary()).then(() => setDoc(doc(as('bob'), path('alice')), summary())));
    await assertFails(updateDoc(doc(as('bob'), path('alice')), { streak: 9 }));
    await assertFails(deleteDoc(doc(as('bob'), path('alice'))));
    await assertFails(deleteDoc(doc(as('eve'), path('alice'))));
    await assertSucceeds(deleteDoc(doc(as('alice'), path('alice'))));
  });
  it('nobody lists the collection but its owner', async () => {
    await seeded('alice');
    await assertSucceeds(getDocs(collection(as('alice'), 'users/alice/summary')));
    await assertFails(getDocs(collection(as('bob'), 'users/alice/summary')));
    await assertFails(getDocs(collection(as('eve'), 'users/alice/summary')));
  });
  it('its shape is checked: these keys, every range, 13 points, 12 lifts and 8 firsts at most (the first of each in shape), the server’s time, one document', async () => {
    await assertSucceeds(write('alice', summary())); // the shape the app writes goes in
    const full = (n: number) => summary({ r: { '4w': range(4), '12w': { ...range(12), lifts: Array.from({ length: 12 }, (_, i) => ({ n: `Lift ${i}`, s: pts(1) })) }, '1y': range(52) },
      firsts: Array.from({ length: n }, (_, i) => ({ n: 'Deadlift', w: 135 + i, d: '2026-10-03' })) });
    await assertSucceeds(write('alice', full(8))); // the most it holds: 12 lifts, 8 firsts
    await assertSucceeds(write('alice', summary({ goal: 1, streak: 0, firsts: [{ n: 'x'.repeat(60), w: 0, d: '2026-10-03' }] }))); // the bounds themselves
    await assertSucceeds(write('alice', summary({ goal: 7, streak: 1000, r: { '4w': range(4), '12w': { ...range(12), lifts: [{ n: 'Ü'.repeat(60), s: pts(1) }] }, '1y': range(52) }, firsts: [{ n: 'Deadlift', w: 2000, d: '2026-10-03' }] })));
    await assertSucceeds(write('alice', summary({ r: { '4w': { ...range(4), vol: [] }, '12w': range(12), '1y': range(52) }, firsts: [] }))); // no volume yet, no firsts
    // Achievements (plan §7): optional; 32 at most; levels 0–4; a lift name only as long as a lift's.
    const ach1 = { i: 'plates', l: 2, d: '2026-10-03', n: 'Deadlift' };
    await assertSucceeds(write('alice', summary({ ach: [] })));
    await assertSucceeds(write('alice', summary({ ach: Array.from({ length: 32 }, () => ach1) })));
    await assertSucceeds(write('alice', summary({ ach: [{ i: 'sessions', l: 0, d: '2026-10-03' }] })));
    await assertSucceeds(write('alice', summary({ ach: [{ i: 'goal-weeks', l: 4, d: '2026-10-03' }, ach1] })));
    await assertSucceeds(write('alice', summary({ ach: [{ ...ach1, n: 'x'.repeat(60) }] })));
    // Gym Buddies (stage 6): the lead, lifetime points, up to 40 buddies, the first in shape.
    const b1 = { i: 'c004', l: 21, s: [16, 16, 15, 10], e: ['d104', null, 'plinth-wood', null] };
    const bud = (x: Record<string, unknown> = {}, b: Record<string, unknown> = {}) => summary({ bud: { lead: 'c004', pts: 1530, r: [{ ...b1, ...b }], ...x } });
    await assertSucceeds(write('alice', bud()));
    await assertSucceeds(write('alice', bud({ pts: 0 }, { l: 0, s: [0, 0, 0, 0], e: [null, null, null, null] })));
    await assertSucceeds(write('alice', bud({ pts: 100000000, r: Array.from({ length: 40 }, (_, k) => ({ ...b1, i: `c${k}` })) }, {})));
    await assertSucceeds(write('alice', bud({}, { l: 100000 })));
    const r = summary().r as Record<string, ReturnType<typeof range>>;
    const withRange = (k: string, x: Record<string, unknown>) => summary({ r: { ...r, [k]: { ...r[k], ...x } } });
    const lift = (x: Record<string, unknown>) => withRange('12w', { lifts: [{ n: 'Bench Press', s: pts(1), ...x }] });
    const first = (x: Record<string, unknown>) => summary({ firsts: [{ n: 'Bench Press', w: 225, d: '2026-10-03', ...x }] });
    const bad: [string, Record<string, unknown>, string?][] = [
      ['another key', summary({ sets: [] })],
      ['a key missing', (({ streak: _s, ...x }) => x)(summary())],
      ['another version', summary({ v: 2 })],
      ['the phone’s clock', summary({ at: Timestamp.now() })],
      ['not a day', summary({ day: '21/10/2026' })],
      ['goal 0', summary({ goal: 0 })], ['goal 8', summary({ goal: 8 })], ['goal not whole', summary({ goal: 2.5 })],
      ['a negative streak', summary({ streak: -1 })], ['a streak past 1000', summary({ streak: 1001 })], ['a streak not whole', summary({ streak: 4.5 })],
      ['a day as a number', summary({ day: 20261021 })],
      ['a range missing', summary({ r: { '4w': r['4w'], '12w': r['12w'] } })], ['ranges as a list', summary({ r: [r['4w'], r['12w'], r['1y']] })],
      ['a range as text', summary({ r: { ...r, '12w': 'x' } })],
      ['another range', summary({ r: { ...r, '2y': r['1y'] } })],
      ['sets in a range', withRange('4w', { sets: [] })],
      ['a range without its lifts', summary({ r: { ...r, '4w': (({ lifts: _l, ...x }) => x)(r['4w']) } })],
      ['weeks the wrong length', withRange('12w', { met: '1'.repeat(11) })], ['weeks not 0 and 1', withRange('4w', { met: '1x11' })],
      ['a year’s weeks short', withRange('1y', { met: '1'.repeat(51) })], ['4 weeks short', withRange('4w', { met: '111' })],
      ['4 weeks long', withRange('4w', { met: '11111' })], ['12 weeks long', withRange('12w', { met: '1'.repeat(13) })], ['a year long', withRange('1y', { met: '1'.repeat(53) })],
      ['weeks as a list', withRange('4w', { met: [1, 1, 1, 1] })],
      ['volume the wrong length', withRange('4w', { vol: pts(1).slice(0, 5) })],
      ['PRs the wrong length', withRange('1y', { prs: pts(1).slice(0, 12) })], ['PRs long', withRange('4w', { prs: [...pts(1), 13] })],
      ['volume long', withRange('4w', { vol: [...pts(1), 13] })], ['volume as text', withRange('4w', { vol: 'x'.repeat(13) })],
      ['PRs as text', withRange('4w', { prs: 'x'.repeat(13) })], ['lifts as a map', withRange('4w', { lifts: {} })],
      ['13 lifts', withRange('12w', { lifts: Array.from({ length: 13 }, (_, i) => ({ n: `Lift ${i}`, s: pts(1) })) })],
      ['a lift with sets', lift({ sets: [] })], ['a lift with no name', lift({ n: '' })], ['a lift named past 60', lift({ n: 'x'.repeat(61) })],
      ['a lift’s series too short', lift({ s: pts(1).slice(0, 12) })], ['a lift’s series long', lift({ s: [...pts(1), 13] })],
      ['a series as text', lift({ s: 'x'.repeat(13) })], ['a lift named with a list', lift({ n: ['Bench Press'] })], ['a lift with no series', withRange('12w', { lifts: [{ n: 'Bench Press' }] })],
      ['a first lift of another shape', withRange('1y', { lifts: [{ n: 'Bench Press', s: pts(1), x: 1 }, { n: 'Squat', s: pts(1) }] })],
      ['a lift that isn’t one', withRange('4w', { lifts: ['Bench Press'] })],
      ['9 firsts', summary({ firsts: Array.from({ length: 9 }, (_, i) => ({ n: 'Deadlift', w: 135 + i, d: '2026-10-03' })) })],
      ['a first too heavy', first({ w: 2001 })], ['a first under nothing', first({ w: -1 })], ['a first a little under', first({ w: -0.5 })], ['a first not dated', first({ d: 'Oct 3' })],
      ['a first with more', first({ reps: 5 })], ['a first with no name', first({ n: '' })], ['a first named past 60', first({ n: 'x'.repeat(61) })],
      ['a first’s weight as text', first({ w: '225' })], ['a first with no date', summary({ firsts: [{ n: 'Bench Press', w: 225 }] })], ['firsts as a map', summary({ firsts: {} })],
      ['a first first off shape', summary({ firsts: [{ n: 'Deadlift', w: 135, d: '2026-10-03', x: 1 }, { n: 'Deadlift', w: 225, d: '2026-10-04' }] })],
      ['33 achievements', summary({ ach: Array.from({ length: 33 }, () => ach1) })], ['achievements as a map', summary({ ach: {} })],
      ['an achievement at level 5', summary({ ach: [{ ...ach1, l: 5 }] })], ['an achievement under level 0', summary({ ach: [{ ...ach1, l: -1 }] })],
      ['an achievement level not whole', summary({ ach: [{ ...ach1, l: 1.5 }] })], ['an achievement not dated', summary({ ach: [{ ...ach1, d: 'Oct 3' }] })],
      ['an achievement with a value', summary({ ach: [{ ...ach1, v: 315 }] })], ['an achievement with no id', summary({ ach: [{ l: 1, d: '2026-10-03' }] })],
      ['an achievement id not one', summary({ ach: [{ ...ach1, i: 'Plates!' }] })], ['an achievement id past 20', summary({ ach: [{ ...ach1, i: 'a'.repeat(21) }] })],
      ['an achievement id as a number', summary({ ach: [{ ...ach1, i: 7 }] })], ['an achievement lift named past 60', summary({ ach: [{ ...ach1, n: 'x'.repeat(61) }] })],
      ['an achievement lift with no name', summary({ ach: [{ ...ach1, n: '' }] })], ['an achievement with no level', summary({ ach: [{ i: 'plates', d: '2026-10-03' }] })],
      ['an achievement that isn’t one', summary({ ach: ['plates'] })],
      ['buddies as a list', summary({ bud: [b1] })], ['buddies with more', bud({ spent: 40 })], ['buddies with no lead', summary({ bud: { pts: 1, r: [b1] } })],
      ['buddies with no points', summary({ bud: { lead: 'c004', r: [b1] } })], ['buddies with no roster', summary({ bud: { lead: 'c004', pts: 1 } })],
      ['a lead not an id', bud({ lead: 'c 004!' })], ['a lead as a number', bud({ lead: 4 })], ['a lead past 64', bud({ lead: 'c'.repeat(65) })],
      ['points under 0', bud({ pts: -1 })], ['points not whole', bud({ pts: 1.5 })], ['points as text', bud({ pts: '1530' })], ['points past the cap', bud({ pts: 100000001 })],
      ['no buddies', bud({ r: [] })], ['41 buddies', bud({ r: Array.from({ length: 41 }, () => b1) })], ['buddies as a map', bud({ r: {} })],
      ['a buddy with a name', bud({}, { n: 'Rex' })], ['a buddy with no id', bud({ r: [{ l: 1, s: [0, 0, 0, 0], e: [null, null, null, null] }] })], ['a buddy id not one', bud({}, { i: 'c/004' })],
      ['a buddy Lv under 0', bud({}, { l: -1 })], ['a buddy Lv not whole', bud({}, { l: 2.5 })], ['a buddy Lv past the cap', bud({}, { l: 100001 })],
      ['three stats', bud({}, { s: [1, 2, 3] })], ['five stats', bud({}, { s: [1, 2, 3, 4, 5] })], ['stats as a map', bud({}, { s: {} })],
      ['three slots', bud({}, { e: [null, null, null] })], ['slots as text', bud({}, { e: 'none' })],
      ['a first buddy off shape', bud({ r: [{ ...b1, x: 1 }, b1] })], ['a buddy that isn’t one', bud({ r: ['c004'] })],
      ['another document', summary(), 'other'],
    ];
    const passed: string[] = [];
    for (const [why, data, d] of bad) await assertFails(write('alice', data, d)).catch(() => passed.push(why));
    expect(passed).toEqual([]);
  });
});

describe('the paths from before Compare are as they were', () => {
  it('months and meta: a friend reads and can’t write, a stranger can do neither; private stays the owner’s', async () => {
    await assertSucceeds(getDoc(doc(as('bob'), 'users/alice/months/2026-10')));
    await assertSucceeds(getDoc(doc(as('bob'), 'users/alice/meta/index')));
    await assertFails(setDoc(doc(as('bob'), 'users/alice/meta/index'), { months: {} }));
    await assertFails(setDoc(doc(as('bob'), 'users/alice/months/2026-10'), { sets: [] }));
    await assertFails(getDoc(doc(as('eve'), 'users/alice/months/2026-10')));
    await assertFails(getDoc(doc(as('eve'), 'users/alice/meta/index')));
    await assertSucceeds(setDoc(doc(as('alice'), 'users/alice/private/cycle'), { days: {}, tracking: false, updatedAt: 1 }));
    await assertFails(getDoc(doc(as('bob'), 'users/alice/private/cycle')));
    // A summary is no key to anything else: with one there, a friend still can't write the log, nor a stranger read private.
    await seed((db) => setDoc(doc(db, 'users/alice/summary/compare'), { v: 1 }));
    await assertFails(setDoc(doc(as('bob'), 'users/alice/months/2026-11'), { sets: [] }));
    await assertFails(getDoc(doc(as('eve'), 'users/alice/private/cycle')));
  });
});

// ---- The board (social S3 + S4, plan §4) ----
// Members pass the gate: a day-old profile, the one-time acceptance in their private/board (no verified email since r28). Mara
// has a display name; Theo, Sam and Lena go by their usernames. Eve is a stranger who never joined. `root` is an owner.
describe('the board (social S3, S4)', () => {
  const DAY = 86_400_000;
  const ago = (ms: number) => Timestamp.fromMillis(Date.now() - ms);
  /** Signed in with the email verified (or not). */
  const V = (uid: string | null, verified = true) => (uid ? env.authenticatedContext(uid, { email_verified: verified }) : env.unauthenticatedContext()).firestore() as unknown as Firestore;
  const DN: Record<string, string> = { mara: 'Mara R.' };
  const member = (uid: string, o: { createdAt?: Timestamp | null; ok?: unknown } = {}) => seed(async (db) => {
    const createdAt = o.createdAt === undefined ? ago(2 * DAY) : o.createdAt;
    await setDoc(doc(db, `users/${uid}`), { username: uid, displayName: DN[uid] ?? uid, ...(createdAt && { createdAt }) });
    await setDoc(doc(db, `usernames/${uid}`), { uid });
    if (o.ok !== null) await setDoc(doc(db, `users/${uid}/private/board`), { ok: o.ok ?? true, at: ago(2 * DAY) });
  });
  let n = 0;
  const pid = () => `p${++n}${Math.random().toString(36).slice(2, 6)}`;
  /** A post as the app writes it: the post and the author's counter, in one write. */
  const post = (uid: string, data: Record<string, unknown> = {}, o: { rate?: Record<string, unknown> | null; id?: string; verified?: boolean; db?: Firestore } = {}) => {
    const db = o.db ?? V(uid, o.verified ?? true), b = writeBatch(db);
    b.set(doc(db, `board/${o.id ?? pid()}`), { uid, name: DN[uid] ?? uid, user: uid, t: 'Deload week, then heavy.', at: serverTimestamp(), reports: 0, likes: 0, ...data });
    if (o.rate !== null) b.set(doc(db, `boardRate/${uid}`), { at: serverTimestamp(), win: serverTimestamp(), n: 1, ...o.rate });
    b.set(doc(db, `limits/${dayId()}`), { n: increment(1) }, { merge: true });
    return b.commit();
  };
  /** A post already there, written as an admin. */
  const seedPost = (id: string, uid: string, extra: Record<string, unknown> = {}) =>
    seed((db) => setDoc(doc(db, `board/${id}`), { uid, name: DN[uid] ?? uid, user: uid, t: `Post ${id}`, at: Timestamp.now(), reports: 0, likes: 0, ...extra }));
  /** A report as the app makes it: yours, the post's count up one, your report counter moved, in one write. */
  const report = (who: string, id: string, o: { why?: string; by?: number; doc?: boolean; rate?: Record<string, unknown> | null; verified?: boolean } = {}) => {
    const db = V(who, o.verified ?? true), b = writeBatch(db);
    if (o.doc !== false) b.set(doc(db, `board/${id}/reports/${who}`), { why: o.why ?? 'spam', at: serverTimestamp() });
    if (o.by !== 0) b.update(doc(db, `board/${id}`), { reports: increment(o.by ?? 1) });
    if (o.rate !== null) b.set(doc(db, `reportRate/${who}`), { at: serverTimestamp(), win: serverTimestamp(), n: 1, ...o.rate });
    return b.commit();
  };
  /** A 💪 as the app gives it (or takes it back): your like document and the post's count, in one write. */
  const like = async (who: string, id: string, o: { by?: number; doc?: boolean; as?: string } = {}) => {
    const db = V(who), b = writeBatch(db), by = o.by ?? 1;
    const ref = doc(db, `board/${id}/likes/${o.as ?? who}`);
    if (o.doc !== false) { if (by > 0) b.set(ref, {}); else b.delete(ref); }
    if (by) b.update(doc(db, `board/${id}`), { likes: increment(by) });
    return (await counters(db, who, b)).commit();
  };
  const page = (db: Firestore, after?: Timestamp) =>
    getDocs(query(collection(db, 'board'), where('at', '>', ago(30 * DAY)), orderBy('at', 'desc'), ...(after ? [startAfter(after)] : []), limit(20)));

  beforeEach(async () => { for (const m of ['mara', 'theo', 'sam', 'lena']) await member(m); });

  // Positives
  it('a member posts 1 and 280 characters, the counter in the same write; the next a minute on', async () => {
    await assertSucceeds(post('mara', { t: 'x' }));
    const first = (await getDoc(doc(V('mara'), 'boardRate/mara'))).data() as { win: Timestamp };
    await seed((db) => setDoc(doc(db, 'boardRate/mara'), { at: ago(61_000), win: first.win, n: 1 }));
    await assertSucceeds(post('mara', { t: 'x'.repeat(280) }, { rate: { win: first.win, n: 2 } }));
    await assertSucceeds(post('theo')); // no display name: the username as the name
  });
  it('anyone signed in pages the board, newest first, 20 at a time; someone signed out can’t', async () => {
    for (let i = 0; i < 25; i++) await seedPost(`s${String(i).padStart(2, '0')}`, 'theo', { at: ago((i + 1) * 60_000) });
    const one = await assertSucceeds(page(V('eve', false)));
    expect(one.size).toBe(20);
    expect(one.docs[0].id).toBe('s00');
    const two = await assertSucceeds(page(V('eve', false), one.docs[19].data().at as Timestamp));
    expect(two.docs.map((d) => d.id)).toEqual(['s20', 's21', 's22', 's23', 's24']);
    await assertSucceeds(getDoc(doc(V('eve', false), 'board/s00')));
    await assertFails(page(V(null)));
    await assertFails(getDoc(doc(V(null), 'board/s00')));
  });
  it('a 💪 and its count go up together, and come back down together; anyone signed in sees a like', async () => {
    await seedPost('p1', 'mara');
    await assertSucceeds(like('eve', 'p1'));
    await assertSucceeds(getDoc(doc(V('theo'), 'board/p1/likes/eve')));
    expect((await getDoc(doc(V('theo'), 'board/p1'))).data()?.likes).toBe(1);
    await assertSucceeds(like('eve', 'p1', { by: -1 }));
    expect((await getDoc(doc(V('theo'), 'board/p1'))).data()?.likes).toBe(0);
  });
  it('a member reports a post: the count goes up with it; the owner reads the reports, keeps it, removes it, bans and tells the author', async () => {
    await seedPost('p1', 'sam');
    await assertSucceeds(report('theo', 'p1', { why: 'harass' }));
    await assertSucceeds(report('lena', 'p1', { why: 'personal' }));
    await assertSucceeds(getDoc(doc(V('theo'), 'board/p1/reports/theo'))); // your own, back (the Worker reads it with your token)
    const rs = await assertSucceeds(getDocs(collection(V('root'), 'board/p1/reports')));
    expect(rs.docs.map((d) => d.data().why).sort()).toEqual(['harass', 'personal']);
    await assertSucceeds(updateDoc(doc(V('root'), 'board/p1'), { kept: 2 }));
    await assertSucceeds(setDoc(doc(V('root'), 'banned/sam'), { at: serverTimestamp(), why: 'spam' }));
    await assertSucceeds(setDoc(doc(V('root'), 'notices/sam'), { removed: 1, banned: true, at: serverTimestamp() }));
    await assertSucceeds(getDoc(doc(V('sam'), 'notices/sam')));
    // Removed: the post with its reports and likes, in one write.
    await seed((db) => setDoc(doc(db, 'board/p1/likes/eve'), {}));
    const db = V('root'), b = writeBatch(db);
    for (const r of ['theo', 'lena']) b.delete(doc(db, `board/p1/reports/${r}`));
    b.delete(doc(db, 'board/p1/likes/eve'));
    b.delete(doc(db, 'board/p1'));
    await assertSucceeds(b.commit());
    await assertSucceeds(setDoc(doc(V('root'), 'config/verified'), { uids: { mara: serverTimestamp() } }));
    // An owner lifts the ban.
    await assertSucceeds(deleteDoc(doc(V('second'), 'banned/sam')));
  });
  it('the author deletes their own post', async () => {
    await seedPost('p1', 'mara');
    await assertSucceeds(deleteDoc(doc(V('mara'), 'board/p1')));
  });

  // What a count alone can't show (the mutation check, 2026-10-22): each write moves only its own key, only as yourself, once.
  it('a report or a 💪 moves only its count, as yourself, once: not the words with it, not someone else’s beside yours, not twice', async () => {
    await seedPost('p1', 'sam');
    const rate = (db: Firestore, who: string) => doc(db, `reportRate/${who}`);
    const rated = { at: serverTimestamp(), win: serverTimestamp(), n: 1 };
    // Reporting while rewriting the post, or marking it kept.
    for (const extra of [{ t: 'rewritten' }, { kept: 5 }]) {
      const db = V('theo'), b = writeBatch(db);
      b.set(doc(db, 'board/p1/reports/theo'), { why: 'spam', at: serverTimestamp() });
      b.update(doc(db, 'board/p1'), { reports: increment(1), ...extra });
      b.set(rate(db, 'theo'), rated);
      await assertFails(b.commit());
    }
    // Someone else's report beside yours, the count up one.
    {
      const db = V('theo'), b = writeBatch(db);
      b.set(doc(db, 'board/p1/reports/theo'), { why: 'spam', at: serverTimestamp() });
      b.set(doc(db, 'board/p1/reports/lena'), { why: 'spam', at: serverTimestamp() });
      b.update(doc(db, 'board/p1'), { reports: increment(1) });
      b.set(rate(db, 'theo'), rated);
      await assertFails(b.commit());
    }
    await assertSucceeds(report('theo', 'p1')); // the plain report still goes
    // A 💪 while rewriting the post; someone else's beside yours.
    {
      const db = V('eve'), b = writeBatch(db);
      b.set(doc(db, 'board/p1/likes/eve'), {});
      b.update(doc(db, 'board/p1'), { likes: increment(1), t: 'rewritten' });
      await assertFails(b.commit());
    }
    {
      const db = V('eve'), b = writeBatch(db);
      b.set(doc(db, 'board/p1/likes/eve'), {});
      b.set(doc(db, 'board/p1/likes/theo'), {});
      b.update(doc(db, 'board/p1'), { likes: increment(1) });
      await assertFails(b.commit());
    }
    await assertSucceeds(like('eve', 'p1'));
    // Given already: the count again, with no new like.
    await assertFails(like('eve', 'p1', { doc: false }));
    // Taken back without the count coming down.
    await assertFails(deleteDoc(doc(V('eve'), 'board/p1/likes/eve')));
    expect((await getDoc(doc(V('theo'), 'board/p1'))).data()).toMatchObject({ likes: 1, reports: 1, t: 'Post p1' });
  });
  it('a counter of yours starts at the server’s time: never written alone with an earlier last post', async () => {
    await assertFails(setDoc(doc(V('mara'), 'boardRate/mara'), { at: ago(120_000), win: serverTimestamp(), n: 1 }));
    await assertFails(setDoc(doc(V('theo'), 'reportRate/theo'), { at: ago(120_000), win: serverTimestamp(), n: 1 }));
    await assertSucceeds(setDoc(doc(V('mara'), 'boardRate/mara'), { at: serverTimestamp(), win: serverTimestamp(), n: 1 }));
    // Nobody starts someone else's (it would stand between a new member and their first post).
    await assertFails(setDoc(doc(V('mara'), 'boardRate/theo'), { at: serverTimestamp(), win: serverTimestamp(), n: 1 }));
    await assertFails(setDoc(doc(V('mara'), 'reportRate/theo'), { at: serverTimestamp(), win: serverTimestamp(), n: 1 }));
  });
  it('the owner lists who is banned, to lift a ban; nobody else can', async () => {
    await seed((db) => setDoc(doc(db, 'banned/sam'), { at: Timestamp.now() }));
    const got = await assertSucceeds(getDocs(collection(V('root'), 'banned')));
    expect(got.docs.map((d) => d.id)).toContain('sam');
    await assertFails(getDocs(collection(V('mara'), 'banned')));
    await assertSucceeds(getDoc(doc(V('mara'), 'banned/sam'))); // asking about one account stays open (the gate asks)
  });

  // Negatives: the gate
  it('a post is refused signed out, without the acceptance, under a day old, or banned; an unverified email is no bar', async () => {
    await assertFails(post('mara', {}, { db: V(null) }));
    await assertSucceeds(post('mara', {}, { verified: false })); // owner, 2026-10-22
    await assertSucceeds(post('theo', {}, { db: as('theo') })); // a token without the claim at all
    await member('eve', { ok: null });
    await assertFails(post('eve')); // never accepted
    await member('eve', { ok: false });
    await assertFails(post('eve'));
    await seed((db) => setDoc(doc(db, 'users/eve/private/board'), { hidden: ['x'] })); // a hide list, no acceptance
    await assertFails(post('eve'));
    await member('eve', { createdAt: Timestamp.now() });
    await assertFails(post('eve')); // a day old by the server's clock, not yet
    await member('eve', { createdAt: ago(DAY - 60_000) });
    await assertFails(post('eve'));
    await member('eve', { createdAt: null });
    await assertFails(post('eve')); // a profile from before createdAt: it waits for one
    await member('eve', { createdAt: ago(DAY + 60_000) });
    await assertSucceeds(post('eve')); // and now it passes
    await seed((db) => setDoc(doc(db, 'banned/mara'), { at: Timestamp.now() }));
    await assertFails(post('mara'));
  });
  it('a post holds 1 to 280 characters, no link, the author’s own names, the server’s time, and nothing counted yet', async () => {
    await assertFails(post('mara', { t: '' }));
    await assertFails(post('mara', { t: 'x'.repeat(281) }));
    await assertFails(post('mara', { t: '💪'.repeat(141) })); // UTF-16 units, as the app counts: 282
    await assertFails(post('mara', { t: 7 }));
    for (const t of ['see https://x.example', 'ftp://x', 'www.shop.example', 'WWW.SHOP.EXAMPLE', 'line one\nwww.x']) await assertFails(post('mara', { t }));
    await assertFails(post('mara', { name: 'Someone Else' }));
    await assertFails(post('mara', { name: 'mara' })); // her display name is Mara R.
    await assertFails(post('mara', { user: 'theo' }));
    await assertFails(post('theo', { name: 'Theo K.' }));
    await assertFails(post('mara', { uid: 'theo' }));
    await assertFails(post('theo', { uid: 'mara', name: 'Mara R.', user: 'mara' }, { db: V('theo') }));
    await assertFails(post('mara', { at: Timestamp.now() }));
    await assertFails(post('mara', { reports: 5 }));
    await assertFails(post('mara', { likes: 9 }));
    await assertFails(post('mara', { kept: 0 }));
    await assertFails(post('mara', { img: 'x' }));
    await assertFails(post('mara', {}, { rate: null })); // without the counter
    await assertSucceeds(post('mara', { t: '💪'.repeat(140) }));
  });
  it('60 s between posts, 5 a day, and a new day starts again at 1; the counter is yours alone', async () => {
    await assertSucceeds(post('mara'));
    const r1 = (await getDoc(doc(V('mara'), 'boardRate/mara'))).data() as { at: Timestamp; win: Timestamp; n: number };
    await assertFails(post('mara', {}, { rate: { win: r1.win, n: 2 } })); // inside 60 s
    await seed((db) => setDoc(doc(db, 'boardRate/mara'), { at: ago(61_000), win: r1.win, n: 1 }));
    await assertFails(post('mara', {}, { rate: { win: r1.win, n: 1 } })); // the count must move
    await assertFails(post('mara', {}, { rate: { win: r1.win, n: 3 } }));
    await assertFails(post('mara')); // no starting over inside the day
    await seed((db) => setDoc(doc(db, 'boardRate/mara'), { at: ago(61_000), win: ago(3600_000), n: 4 }));
    const win = ((await getDoc(doc(V('mara'), 'boardRate/mara'))).data() as { win: Timestamp }).win;
    await assertSucceeds(post('mara', {}, { rate: { win, n: 5 } }));
    await seed((db) => setDoc(doc(db, 'boardRate/mara'), { at: ago(61_000), win, n: 5 }));
    await assertFails(post('mara', {}, { rate: { win, n: 6 } })); // the 6th in a day
    await seed((db) => setDoc(doc(db, 'boardRate/mara'), { at: ago(61_000), win: ago(DAY + 1000), n: 5 }));
    await seed((db) => setDoc(doc(db, 'boardRate/mara'), { at: ago(61_000), win: ago(DAY + 1000), n: 3 }));
    const old = ((await getDoc(doc(V('mara'), 'boardRate/mara'))).data() as { win: Timestamp }).win;
    await assertFails(post('mara', {}, { rate: { win: old, n: 4 } })); // a day over: no counting on in it
    await assertSucceeds(post('mara')); // a new day: n = 1, win = now
    // The first counter of all: 1, at the server's time.
    await assertFails(post('theo', {}, { rate: { n: 0 } }));
    await assertFails(post('theo', {}, { rate: { win: ago(DAY + 1000) } }));
    await assertFails(post('theo', {}, { rate: { at: ago(61_000) } }));
    await assertFails(post('theo', {}, { rate: { x: 1 } }));
    // Yours alone; and it goes only once its day is over, or with the account.
    await assertFails(getDoc(doc(V('theo'), 'boardRate/mara')));
    await assertFails(setDoc(doc(V('theo'), 'boardRate/mara'), { at: serverTimestamp(), win: serverTimestamp(), n: 1 }));
    await assertFails(deleteDoc(doc(V('mara'), 'boardRate/mara')));
    const db = V('mara'), b = writeBatch(db);
    b.delete(doc(db, 'boardRate/mara')); b.delete(doc(db, 'usernames/mara')); b.delete(doc(db, 'users/mara'));
    await assertSucceeds(b.commit());
  });

  // Negatives: changing a post
  it('nobody edits a post: not its words, not a count by more than one, not without the document that stands for it', async () => {
    await seedPost('p1', 'mara');
    await assertFails(updateDoc(doc(V('mara'), 'board/p1'), { t: 'edited' }));
    await assertFails(updateDoc(doc(V('mara'), 'board/p1'), { name: 'Mara' }));
    await assertFails(updateDoc(doc(V('root'), 'board/p1'), { t: 'edited by the owner' }));
    await assertFails(report('theo', 'p1', { by: 2 }));
    await assertFails(report('theo', 'p1', { doc: false })); // +1 without a report
    await assertFails(report('theo', 'p1', { by: 0 })); // a report without the count
    await assertFails(like('theo', 'p1', { doc: false })); // +1 without a like
    await assertFails(like('theo', 'p1', { by: 2 }));
    await assertFails(like('theo', 'p1', { as: 'lena' })); // someone else's like
    const t = V('theo');
    await assertFails(writeBatch(t).set(doc(t, 'board/p1/likes/theo'), { n: 9 }).update(doc(t, 'board/p1'), { likes: increment(1) }).commit());
    await assertFails(like('theo', 'p1', { by: -1 })); // taking back a like never given
    await assertFails(setDoc(doc(V('theo'), 'board/p1/likes/theo'), {})); // the like alone
    await assertSucceeds(like('theo', 'p1'));
    await assertFails(like('theo', 'p1')); // a second
    await assertFails(like('lena', 'p1', { by: -1, as: 'theo' })); // taking back someone else's
    await assertSucceeds(like('lena', 'p1'));
    const l = V('lena');
    await assertFails(writeBatch(l).delete(doc(l, 'board/p1/likes/lena')).delete(doc(l, 'board/p1/likes/theo')).update(doc(l, 'board/p1'), { likes: increment(-1) }).commit());
    await assertFails(deleteDoc(doc(V('root'), 'board/p1/likes/theo'))); // an owner, while the post stays
    await assertFails(getDoc(doc(V(null), 'board/p1/likes/theo')));
    expect((await getDoc(doc(V('eve'), 'board/p1'))).data()?.likes).toBe(2);
    // Reviewed: the owner's alone, never more than the reports.
    await seed((db) => setDoc(doc(db, 'board/p2'), { uid: 'mara', name: 'Mara R.', user: 'mara', t: 'x', at: Timestamp.now(), reports: 3, likes: 0 }));
    await assertFails(updateDoc(doc(V('mara'), 'board/p2'), { kept: 3 }));
    await assertFails(updateDoc(doc(V('theo'), 'board/p2'), { kept: 3 }));
    await assertFails(updateDoc(doc(V('root'), 'board/p2'), { kept: 4 }));
    await assertFails(updateDoc(doc(V('root'), 'board/p2'), { kept: -1 }));
    await assertFails(updateDoc(doc(V('root'), 'board/p2'), { kept: 3, hidden: true }));
    await assertFails(updateDoc(doc(V('root'), 'board/p2'), { hidden: true }));
    await assertSucceeds(updateDoc(doc(V('root'), 'board/p2'), { kept: 3 }));
  });
  it('one report per person per post, for a reason on the list, past the gate, never edited; only the owner reads them', async () => {
    await seedPost('p1', 'mara');
    await assertFails(report('theo', 'p1', { why: 'boring' }));
    await assertFails(report('eve', 'p1')); // never joined the board
    await assertFails(report('theo', 'p1', { rate: null })); // without the counter
    const t = V('theo');
    await assertFails(writeBatch(t).set(doc(t, 'board/p1/reports/lena'), { why: 'spam', at: serverTimestamp() }).update(doc(t, 'board/p1'), { reports: increment(1) })
      .set(doc(t, 'reportRate/theo'), { at: serverTimestamp(), win: serverTimestamp(), n: 1 }).commit()); // as someone else
    await assertFails(writeBatch(t).set(doc(t, 'board/p1/reports/theo'), { why: 'spam', at: Timestamp.now() }).update(doc(t, 'board/p1'), { reports: increment(1) })
      .set(doc(t, 'reportRate/theo'), { at: serverTimestamp(), win: serverTimestamp(), n: 1 }).commit()); // the phone's clock
    await assertFails(writeBatch(t).set(doc(t, 'board/p1/reports/theo'), { why: 'spam', at: serverTimestamp(), note: 'x' }).update(doc(t, 'board/p1'), { reports: increment(1) })
      .set(doc(t, 'reportRate/theo'), { at: serverTimestamp(), win: serverTimestamp(), n: 1 }).commit());
    await assertSucceeds(report('theo', 'p1'));
    await assertFails(report('theo', 'p1')); // a second by the same person
    const r = await getDoc(doc(V('theo'), 'reportRate/theo'));
    await assertFails(report('theo', 'p1', { rate: { win: r.data()!.win, n: 2 } }));
    await assertFails(updateDoc(doc(V('theo'), 'board/p1/reports/theo'), { why: 'harass' }));
    await assertFails(updateDoc(doc(V('root'), 'board/p1/reports/theo'), { why: 'harass' }));
    await assertFails(deleteDoc(doc(V('theo'), 'board/p1/reports/theo')));
    // The poster can't see who reported them; nobody but the owner lists them.
    await assertFails(getDoc(doc(V('mara'), 'board/p1/reports/theo')));
    await assertFails(getDocs(collection(V('mara'), 'board/p1/reports')));
    await assertFails(getDocs(collection(V('theo'), 'board/p1/reports')));
    await assertFails(getDocs(collection(V('lena'), 'board/p1/likes')));
    // A report on a post that isn't there.
    await assertFails(report('lena', 'nope'));
  });
  it('20 reports a day each', async () => {
    await seedPost('p1', 'mara');
    await seed((db) => setDoc(doc(db, 'reportRate/theo'), { at: ago(5000), win: ago(3600_000), n: 19 }));
    const win = ((await getDoc(doc(V('theo'), 'reportRate/theo'))).data() as { win: Timestamp }).win;
    await assertSucceeds(report('theo', 'p1', { rate: { win, n: 20 } }));
    await seedPost('p2', 'mara');
    await seed((db) => setDoc(doc(db, 'reportRate/theo'), { at: ago(5000), win, n: 20 }));
    await assertFails(report('theo', 'p2', { rate: { win, n: 21 } }));
    await assertFails(report('theo', 'p2'));
    await assertFails(getDoc(doc(V('lena'), 'reportRate/theo')));
  });

  // Negatives: the owner's alone
  it('only an owner bans, tells, or deletes someone else’s post; a ban is anyone’s to see, a notice only its person’s', async () => {
    await seedPost('p1', 'mara');
    for (const who of ['mara', 'theo', 'eve']) {
      await assertFails(setDoc(doc(V(who), `banned/${who === 'mara' ? 'theo' : 'mara'}`), { at: serverTimestamp() }));
      await assertFails(setDoc(doc(V(who), `notices/${who}`), { removed: 0, banned: false, at: serverTimestamp() }));
    }
    await assertFails(deleteDoc(doc(V('theo'), 'board/p1')));
    await assertFails(setDoc(doc(V('theo'), 'config/verified'), { uids: { theo: serverTimestamp() } }));
    await assertFails(setDoc(doc(V('root'), 'banned/mara'), { at: Timestamp.now() })); // the server's time
    await assertFails(setDoc(doc(V('root'), 'banned/mara'), { at: serverTimestamp(), note: 'x' }));
    await assertFails(setDoc(doc(V('root'), 'banned/mara'), { at: serverTimestamp(), why: 'x'.repeat(201) }));
    await assertFails(setDoc(doc(V('root'), 'notices/mara'), { removed: -1, banned: false, at: serverTimestamp() }));
    await assertFails(setDoc(doc(V('root'), 'notices/mara'), { removed: 1, banned: 'yes', at: serverTimestamp() }));
    await assertFails(setDoc(doc(V('root'), 'notices/mara'), { removed: 1, banned: true, at: Timestamp.now() }));
    await assertFails(setDoc(doc(V('root'), 'notices/mara'), { removed: 1, banned: true, at: serverTimestamp(), why: 'x' }));
    await assertSucceeds(setDoc(doc(V('root'), 'banned/mara'), { at: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(V('root'), 'notices/mara'), { removed: 1, banned: true, at: serverTimestamp() }));
    await assertSucceeds(getDoc(doc(V('theo'), 'banned/mara')));
    await assertFails(getDocs(collection(V('theo'), 'banned')));
    await assertFails(getDoc(doc(V('theo'), 'notices/mara')));
    await assertFails(getDoc(doc(V(null), 'banned/mara')));
    await assertFails(deleteDoc(doc(V('mara'), 'banned/mara')));
    await assertFails(deleteDoc(doc(V('theo'), 'notices/mara')));
    await assertSucceeds(deleteDoc(doc(V('mara'), 'notices/mara'))); // cleared with the account
    await assertSucceeds(deleteDoc(doc(V('root'), 'board/p1')));
  });
  it('a banned account can’t post, give a 💪 or report', async () => {
    await seedPost('p1', 'theo');
    await seed((db) => setDoc(doc(db, 'banned/mara'), { at: Timestamp.now() }));
    await assertFails(post('mara'));
    await assertFails(like('mara', 'p1'));
    await assertFails(report('mara', 'p1'));
    await assertSucceeds(page(V('mara'))); // still reads
  });

  // Privacy: the board opens nothing else
  it('a member who can post is still refused anyone else’s log, settings, summary, private documents, friends and inbox', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users/alice/meta/profile'), { items: {}, updatedAt: 1 });
      await setDoc(doc(db, 'users/alice/summary/compare'), { v: 1 });
      await setDoc(doc(db, 'users/alice/private/tags'), { tags: {} });
      await setDoc(doc(db, 'users/alice/private/board'), { ok: true, hidden: ['p1'], muted: ['bob'] });
      await setDoc(doc(db, 'users/alice/private/cycle'), { days: {} });
      await setDoc(doc(db, 'users/alice/inbox/m1'), { from: 'bob', kind: 'p', e: 'fire', at: Timestamp.now() });
      await setDoc(doc(db, 'users/alice/requests/bob'), { username: 'bob', sent: 1 });
      await setDoc(doc(db, 'boardRate/alice'), { at: Timestamp.now(), win: Timestamp.now(), n: 1 });
    });
    await assertSucceeds(post('mara')); // she passes the gate
    const m = V('mara');
    for (const p of ['users/alice/months/2026-10', 'users/alice/meta/index', 'users/alice/meta/profile', 'users/alice/summary/compare',
      'users/alice/private/tags', 'users/alice/private/board', 'users/alice/private/cycle', 'users/alice/friends/bob', 'users/alice/inbox/m1',
      'users/alice/requests/bob', 'users/alice/sendRate/bob', 'boardRate/alice']) {
      await assertFails(getDoc(doc(m, p)));
    }
    for (const c of ['users/alice/months', 'users/alice/meta', 'users/alice/private', 'users/alice/friends', 'users/alice/inbox', 'users/alice/summary', 'usernames', 'boardRate', 'notices']) {
      await assertFails(getDocs(collection(m, c)));
    }
    await assertFails(setDoc(doc(m, 'users/alice/private/board'), { ok: true }));
  });

  // Friend requests: anyone, or invite only
  it('a profile set to invite only refuses requests; anyone (or a profile from before the setting) takes them', async () => {
    const ask = () => social('eve', (db, b) => b.set(doc(db, 'users/mara/requests/eve'), { username: 'eve', sent: 1 }));
    await assertSucceeds(ask()); // no setting: anyone
    await seed((db) => deleteDoc(doc(db, 'users/mara/requests/eve')));
    await assertSucceeds(updateDoc(doc(V('mara'), 'users/mara'), { reqs: 'invite' }));
    await assertFails(ask());
    await assertFails(social('eve', (db, b) => b.set(doc(db, 'users/nobody/requests/eve'), { username: 'eve', sent: 1 }))); // no profile at all
    await assertSucceeds(updateDoc(doc(V('mara'), 'users/mara'), { reqs: 'any' }));
    await assertSucceeds(ask());
    // Only these two, and only your own; an invite link still works with invite only.
    await assertFails(updateDoc(doc(V('mara'), 'users/mara'), { reqs: 'nobody' }));
    await assertFails(updateDoc(doc(V('mara'), 'users/mara'), { reqs: true }));
    await assertFails(updateDoc(doc(V('theo'), 'users/mara'), { reqs: 'invite' }));
    await assertSucceeds(updateDoc(doc(V('mara'), 'users/mara'), { reqs: 'invite' }));
    await seed((db) => setDoc(doc(db, 'users/mara/invites/tok1'), { created: 1, expires: later() }));
    await assertSucceeds(accept('eve', 'mara', 'tok1'));
  });
  it('with the setting there, an older app’s change of username and the display-name change still pass', async () => {
    await assertSucceeds(updateDoc(doc(V('theo'), 'users/theo'), { reqs: 'invite' }));
    const db = V('theo'), b = writeBatch(db);
    b.set(doc(db, 'usernames/theo_k'), { uid: 'theo' });
    b.delete(doc(db, 'usernames/theo'));
    b.update(doc(db, 'users/theo'), { username: 'theo_k', displayName: 'theo_k', prev: 'theo', changedAt: serverTimestamp() });
    await assertSucceeds(b.commit());
    await assertSucceeds(updateDoc(doc(V('theo'), 'users/theo'), { displayName: 'Theo K.', nameAt: serverTimestamp() }));
    expect((await getDoc(doc(V('eve'), 'users/theo'))).data()).toMatchObject({ username: 'theo_k', displayName: 'Theo K.', reqs: 'invite' });
  });
});

// Limits (r28, plan .superpowers/security/rate-limits.md): the app's counter for the day, your social counter, the owner's
// switches, and the sync documents' names and sizes. Bob is Alice's friend, so his gyms and pings to her are social writes.
describe('limits (r28)', () => {
  const DAY = 86_400_000;
  const ago = (ms: number) => Timestamp.fromMillis(Date.now() - ms);
  const today = () => doc(as(null), `limits/${dayId()}`);
  const setDay = (n: number, id = dayId()) => seed((db) => setDoc(doc(db, `limits/${id}`), { n }));
  const setRate = (uid: string, r: { at: Timestamp; win: Timestamp; n: number }) => seed((db) => setDoc(doc(db, `socialRate/${uid}`), r));
  const gym = { name: 'Home', equipment: ['barbell'], exclude: [], include: [] };
  const gymTo = (from: string, to: string) => social(from, (db, b) => b.set(doc(db, `users/${to}/gymInbox/g${Math.random().toString(36).slice(2, 8)}`), { from, fromName: from, gym, sent: 1 }));
  const ping = async (from: string, to: string, withCounters = true) => {
    const db = as(from), b = writeBatch(db);
    b.set(doc(db, `users/${to}/inbox/m${Math.random().toString(36).slice(2, 8)}`), { from, kind: 'p', e: 'fire', at: serverTimestamp() });
    b.set(doc(db, `users/${from}/sendRate/${to}`), { at: serverTimestamp(), win: serverTimestamp(), n: 1 });
    return (withCounters ? await counters(db, from, b) : b).commit();
  };
  const ask = (from: string, to: string, username = from) => social(from, (db, b) => b.set(doc(db, `users/${to}/requests/${from}`), { username, sent: 1 }));
  const sw = (x: Record<string, unknown>) => setDoc(doc(as('root'), 'config/switches'), { ...x, at: serverTimestamp() });
  beforeEach(() => seed((db) => setDoc(doc(db, 'users/eve'), { username: 'eve', displayName: 'Eve' })));

  it('the day’s counter: the 2,000th social write of the day goes in, the next is refused for everyone, and a new day starts at 1', async () => {
    await setDay(1999);
    await assertSucceeds(gymTo('bob', 'alice'));
    expect((await getDoc(today())).data()?.n).toBe(2000); // anyone reads it, signed out too (the Worker's cron)
    await assertFails(gymTo('bob', 'alice'));
    await assertFails(ask('eve', 'alice'));
    await setDay(1999);
    await assertSucceeds(ask('eve', 'alice')); // the same write, one under the cap
    // Yesterday's full counter is yesterday's: today's starts again at 1.
    await seed((db) => deleteDoc(doc(db, `limits/${dayId()}`)));
    await setDay(2000, dayId(Date.now() - DAY));
    await assertSucceeds(gymTo('bob', 'alice'));
    expect((await getDoc(today())).data()?.n).toBe(1);
  });
  it('a post moves the day’s counter too, and is refused once it’s full', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users/alice'), { username: 'alice', displayName: 'Alice', createdAt: ago(2 * DAY) });
      await setDoc(doc(db, 'users/alice/private/board'), { ok: true, at: ago(DAY) });
    });
    const post = (count = true) => {
      const db = as('alice'), b = writeBatch(db);
      b.set(doc(db, `board/p${Math.random().toString(36).slice(2, 8)}`), { uid: 'alice', name: 'Alice', user: 'alice', t: 'Heavy day.', at: serverTimestamp(), reports: 0, likes: 0 });
      b.set(doc(db, 'boardRate/alice'), { at: serverTimestamp(), win: serverTimestamp(), n: 1 });
      if (count) b.set(doc(db, `limits/${dayId()}`), { n: increment(1) }, { merge: true });
      return b.commit();
    };
    await assertFails(post(false)); // without the day's counter
    await setDay(2000);
    await assertFails(post());
    await setDay(1999);
    await assertSucceeds(post());
  });
  it('nobody moves the day’s counter alone, by two, on another day, or back; only an owner clears one', async () => {
    await setDay(5);
    await assertFails(setDoc(doc(as('alice'), `limits/${dayId()}`), { n: increment(1) }, { merge: true })); // no counter of yours with it
    const moved = async (uid: string, f: (db: Firestore, b: WriteBatch) => void) => {
      const db = as(uid), b = writeBatch(db);
      const r = (await getDoc(doc(db, `socialRate/${uid}`))).data() as { win: Timestamp; n: number } | undefined;
      b.set(doc(db, `socialRate/${uid}`), r ? { at: serverTimestamp(), win: r.win, n: r.n + 1 } : { at: serverTimestamp(), win: serverTimestamp(), n: 1 });
      f(db, b);
      return b.commit();
    };
    await assertFails(moved('alice', (db, b) => b.set(doc(db, `limits/${dayId()}`), { n: increment(2) }, { merge: true })));
    await assertFails(moved('alice', (db, b) => b.set(doc(db, `limits/${dayId()}`), { n: 1 })));
    await assertFails(moved('alice', (db, b) => b.set(doc(db, `limits/${dayId(Date.now() - DAY)}`), { n: increment(1) }, { merge: true })));
    await assertFails(moved('alice', (db, b) => b.set(doc(db, `limits/${dayId()}`), { n: increment(1), x: 1 }, { merge: true })));
    // With a counter of your own moved beside it: allowed, and counted there (300 a day).
    await assertSucceeds(moved('alice', (db, b) => b.set(doc(db, `limits/${dayId()}`), { n: increment(1) }, { merge: true })));
    await assertFails(deleteDoc(doc(as('alice'), `limits/${dayId()}`)));
    await assertFails(getDocs(collection(as('alice'), 'limits')));
    await assertSucceeds(getDocs(collection(as('root'), 'limits')));
    await assertSucceeds(deleteDoc(doc(as('root'), `limits/${dayId()}`)));
  });
  it('your social counter: the 300th of your day goes in, the next is refused, and a new day starts at 1', async () => {
    await setRate('bob', { at: ago(5000), win: ago(3_600_000), n: 299 });
    await assertSucceeds(gymTo('bob', 'alice'));
    await assertFails(gymTo('bob', 'alice'));
    await assertFails(ping('bob', 'alice'));
    const fresh = () => {
      const db = as('bob'), b = writeBatch(db);
      b.set(doc(db, `users/alice/gymInbox/n${Math.random().toString(36).slice(2, 8)}`), { from: 'bob', fromName: 'bob', gym, sent: 1 });
      b.set(doc(db, 'socialRate/bob'), { at: serverTimestamp(), win: serverTimestamp(), n: 1 });
      b.set(doc(db, `limits/${dayId()}`), { n: increment(1) }, { merge: true });
      return b.commit();
    };
    await assertFails(fresh()); // starting again inside the day
    await setRate('bob', { at: ago(5000), win: ago(DAY + 1000), n: 300 });
    await assertSucceeds(fresh());
    // Only yours: nobody starts, moves or reads someone else's.
    await assertFails(setDoc(doc(as('eve'), 'socialRate/bob'), { at: serverTimestamp(), win: serverTimestamp(), n: 1 }));
    await assertFails(getDoc(doc(as('eve'), 'socialRate/bob')));
  });
  it('every social write moves your counter: a ping, a gym, a request, an invite, a 💪 given or taken back', async () => {
    await assertFails(ping('bob', 'alice', false));
    await assertSucceeds(ping('bob', 'alice'));
    await assertFails(setDoc(doc(as('bob'), 'users/alice/gymInbox/g1'), { from: 'bob', fromName: 'bob', gym, sent: 1 }));
    await assertSucceeds(social('bob', (d, b) => b.set(doc(d, 'users/alice/gymInbox/g1'), { from: 'bob', fromName: 'bob', gym, sent: 1 })));
    await assertFails(setDoc(doc(as('eve'), 'users/alice/requests/eve'), { username: 'eve', sent: 1 }));
    await assertSucceeds(ask('eve', 'alice'));
    await assertFails(setDoc(doc(as('alice'), 'users/alice/invites/tok12345'), { created: Timestamp.now(), expires: later() }));
    await assertSucceeds(social('alice', (d, b) => b.set(doc(d, 'users/alice/invites/tok12345'), { created: Timestamp.now(), expires: later() })));
    await seed((d) => setDoc(doc(d, 'board/p1'), { uid: 'eve', name: 'eve', user: 'eve', t: 'x', at: Timestamp.now(), reports: 0, likes: 0 }));
    const a = as('alice');
    await assertFails(writeBatch(a).set(doc(a, 'board/p1/likes/alice'), {}).update(doc(a, 'board/p1'), { likes: increment(1) }).commit());
    await assertSucceeds(social('alice', (d, b) => { b.set(doc(d, 'board/p1/likes/alice'), {}); b.update(doc(d, 'board/p1'), { likes: increment(1) }); }));
    await assertFails(writeBatch(a).delete(doc(a, 'board/p1/likes/alice')).update(doc(a, 'board/p1'), { likes: increment(-1) }).commit());
    await assertSucceeds(social('alice', (d, b) => { b.delete(doc(d, 'board/p1/likes/alice')); b.update(doc(d, 'board/p1'), { likes: increment(-1) }); }));
  });
  it('the owner’s switches close the board, requests and messages for everyone; reading stays open; only an owner sets them', async () => {
    await assertFails(setDoc(doc(as('alice'), 'config/switches'), { board: true, at: serverTimestamp() }));
    await assertFails(setDoc(doc(as('root'), 'config/switches'), { board: 'yes', at: serverTimestamp() }));
    await assertFails(setDoc(doc(as('root'), 'config/switches'), { board: true, at: serverTimestamp(), other: true }));
    await seed((d) => setDoc(doc(d, 'board/p1'), { uid: 'eve', name: 'eve', user: 'eve', t: 'x', at: Timestamp.now(), reports: 0, likes: 0 }));
    const likeIt = () => social('alice', (d, b) => { b.set(doc(d, 'board/p1/likes/alice'), {}); b.update(doc(d, 'board/p1'), { likes: increment(1) }); });
    await assertSucceeds(sw({ board: true, requests: true, messages: true }));
    await assertSucceeds(getDoc(doc(as('eve'), 'config/switches')));
    await assertFails(likeIt());
    await assertFails(ask('eve', 'alice'));
    await assertFails(gymTo('bob', 'alice'));
    await assertFails(ping('bob', 'alice'));
    await assertSucceeds(getDoc(doc(as('bob'), 'board/p1')));
    await assertSucceeds(getDoc(doc(as('alice'), 'users/alice/months/2026-10')));
    await assertSucceeds(sw({ board: false, requests: false, messages: false }));
    await assertSucceeds(likeIt());
    await assertSucceeds(ask('eve', 'alice'));
    await assertSucceeds(gymTo('bob', 'alice'));
    await assertSucceeds(ping('bob', 'alice'));
    await assertFails(deleteDoc(doc(as('alice'), 'config/switches')));
    await assertSucceeds(deleteDoc(doc(as('root'), 'config/switches')));
  });
  it('a month: a month’s id, its keys, and up to 5,000 sets and 100 body days', async () => {
    const m = (id: string, x: Record<string, unknown> = {}) => setDoc(doc(as('alice'), `users/alice/months/${id}`), { sets: [], body: [], deleted: {}, updatedAt: 2, prs: [], ...x });
    await assertSucceeds(m('2026-11'));
    await assertSucceeds(m('1999-01'));
    for (const id of ['2026-13', '2026-00', 'junk', '2026-1', '1850-01', 'plans-2026']) await assertFails(m(id));
    await assertFails(m('2026-11', { extra: 'x'.repeat(100) }));
    await assertFails(m('2026-11', { sets: 'x' }));
    await assertSucceeds(m('2026-11', { sets: Array.from({ length: 5000 }, (_, i) => i) }));
    await assertFails(m('2026-11', { sets: Array.from({ length: 5001 }, (_, i) => i) }));
    await assertSucceeds(m('2026-11', { body: Array.from({ length: 100 }, (_, i) => i) }));
    await assertFails(m('2026-11', { body: Array.from({ length: 101 }, (_, i) => i) }));
    await assertFails(m('2026-11', { prs: Array.from({ length: 5001 }, (_, i) => i) }));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'users/alice/months/2026-11')));
  });
  it('settings: the index, the settings document and a plan archive a year, in their shapes; nothing else', async () => {
    const put = (id: string, x: Record<string, unknown>) => setDoc(doc(as('alice'), `users/alice/meta/${id}`), x);
    await assertSucceeds(put('index', { months: { '2026-10': 1 }, meta: 1 }));
    await assertSucceeds(setDoc(doc(as('alice'), 'users/alice/meta/index'), { meta: 2 }, { merge: true }));
    await assertFails(put('index', { months: {}, junk: 1 }));
    await assertSucceeds(put('profile', { items: { profile: '{}' }, updatedAt: 1, plansFrom: '2026-07-01' }));
    await assertFails(put('profile', { items: { profile: '{}' }, updatedAt: 1, junk: 'x' }));
    await assertFails(put('profile', { items: Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`k${i}`, '1'])), updatedAt: 1 }));
    await assertSucceeds(put('plans-2025', { items: { 'day:2025-01-01': '{}' }, updatedAt: 1 }));
    await assertFails(put('plans-1850', { items: {}, updatedAt: 1 }));
    await assertFails(put('anything', { items: {}, updatedAt: 1 }));
  });
  it('private: board, cycle, tags and together only, the board’s lists 200 at most; your own list in its keys; a request’s name short', async () => {
    const put = (id: string, x: Record<string, unknown>) => setDoc(doc(as('alice'), `users/alice/private/${id}`), x);
    await assertFails(put('anything', { x: 1 }));
    await assertSucceeds(put('board', { hidden: Array.from({ length: 200 }, (_, i) => `p${i}`) }));
    await assertFails(put('board', { hidden: Array.from({ length: 201 }, (_, i) => `p${i}`) }));
    await assertFails(put('board', { ok: true, junk: 1 }));
    await assertSucceeds(setDoc(doc(as('alice'), 'users/alice/friends/zed'), { since: 1, via: 'invite' }));
    await assertFails(setDoc(doc(as('alice'), 'users/alice/friends/zoe'), { since: 1, junk: 'x' }));
    await assertFails(ask('eve', 'alice', 'e'.repeat(61)));
    await assertSucceeds(ask('eve', 'alice', 'e'.repeat(60)));
  });
  it('an invite: a token-like id, about a week long, counted', async () => {
    const inv = (id: string, expires: Timestamp, x: Record<string, unknown> = {}) => social('alice', (d, b) => b.set(doc(d, `users/alice/invites/${id}`), { created: Timestamp.now(), expires, ...x }));
    await assertSucceeds(inv('tok12345', Timestamp.fromMillis(Date.now() + 7 * DAY)));
    await assertFails(inv('tok12346', Timestamp.fromMillis(Date.now() + 9 * DAY)));
    await assertFails(inv('x', later()));
    await assertFails(inv('tok12347', later(), { note: 'x' }));
    await assertFails(updateDoc(doc(as('alice'), 'users/alice/invites/tok12345'), { expires: later() }));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'users/alice/invites/tok12345')));
  });
});
