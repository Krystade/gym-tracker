# Round 5: accounts, cloud sync, and friends

## Owner decisions (2026-10-07)

- Sign-in: **email + password**. Google sign-in breaks inside an iPhone home-screen app (popups close without returning; redirect needs Firebase's `/__/auth` pages on our own domain, which GitHub Pages can't serve under `/gym-tracker/`).
- Data home: **phone first, cloud sync**. IndexedDB stays the working copy; the app works offline exactly as now; every change syncs to the account; a new phone signs in and gets everything.
- Friend view: **everything but photos**: Stats, Lifts, History session by session (including set notes, flags and pain notes), body weight, calories, protein, energy, priorities and program.
- Adding friends: **invite link and username search with a request**.

## Research findings that shape this

- Firebase Spark (free): Auth 50K monthly users (no phone sign-in); Firestore 1 GiB, 50K reads / 20K writes / 20K deletes a day, 10 GiB egress a month. Cloud Storage needs the paid Blaze plan, so photos stay on the phone (they already do).
- Supabase free projects pause after 7 days without use; ruled out.
- A Firebase web config is not a secret and can live in the public repo. Security rules are what protect the data, so the rules get their own tests.
- Firestore Lite (`firebase/firestore/lite`) does one-off reads and writes without realtime or its own offline cache, which is all phone-first sync needs and keeps the bundle small.

## Data model (Firestore)

| Path | Holds | Who reads | Who writes |
|---|---|---|---|
| `usernames/{name}` | `{ uid }` | any signed-in user, **by exact name only** (no listing) | the owner, once (claim) and on change |
| `users/{uid}` | `{ username, displayName }` | any signed-in user (to show a name on a request) | owner |
| `users/{uid}/months/{yyyy-mm}` | that month's sets, body days, tombstones, `updatedAt` | owner, friends | owner |
| `users/{uid}/meta/profile` | priorities, program, settings friends' Stats needs | owner, friends | owner |
| `users/{uid}/friends/{friendUid}` | `{ since, via }` | owner | owner; or the friend, with a valid invite or an accepted request |
| `users/{uid}/invites/{token}` | `{ created, expires }` (7 days) | owner; anyone signed in by exact token | owner |
| `users/{uid}/requests/{fromUid}` | `{ username, sent }` | owner and sender | sender creates; owner or sender deletes |

- **Why months:** one document per month keeps reads tiny (a friend's full history is one read per month logged) and stays far below the 1 MiB document limit (a heavy month is about 120 KB).
- **Friendship** is two documents, one in each user's `friends`. A viewer can read your data only while `users/you/friends/viewer` exists, so either side removing it ends access at once.
- **Invite link:** `…/gym-tracker/#invite=<uid>.<token>`. Opening it signed in creates both friend documents; the rule checks the token exists and hasn't expired.
- **Request:** search an exact username, tap Send; they see it under Friends and accept (which creates both documents) or decline.

### Security rules (draft)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function signedIn() { return request.auth != null; }
    function me(uid) { return signedIn() && request.auth.uid == uid; }
    function friendOf(uid) { return exists(/databases/$(db)/documents/users/$(uid)/friends/$(request.auth.uid)); }
    function liveInvite(uid, token) {
      let inv = /databases/$(db)/documents/users/$(uid)/invites/$(token);
      return exists(inv) && get(inv).data.expires > request.time;
    }

    match /usernames/{name} {
      allow get: if signedIn();
      allow list: if false;
      allow create: if signedIn() && request.resource.data.uid == request.auth.uid && name.matches('^[a-z0-9_]{3,20}$');
      allow delete: if signedIn() && resource.data.uid == request.auth.uid;
    }
    match /users/{uid} {
      allow get: if signedIn();
      allow write: if me(uid);
      match /months/{m} { allow read: if me(uid) || friendOf(uid); allow write: if me(uid); }
      match /meta/{d}   { allow read: if me(uid) || friendOf(uid); allow write: if me(uid); }
      match /friends/{f} {
        allow read: if me(uid);
        allow delete: if me(uid) || me(f);
        allow create: if me(uid)
          || (me(f) && liveInvite(uid, request.resource.data.via))
          || (me(f) && exists(/databases/$(db)/documents/users/$(f)/requests/$(uid)));
      }
      match /invites/{t} { allow read, write: if me(uid); allow get: if signedIn(); }
      match /requests/{from} { allow create: if me(from); allow read, delete: if me(uid) || me(from); }
    }
  }
}
```

## Sync (phone first)

- Each local change marks its month dirty. A dirty month syncs a few seconds after the change, when the app comes back to the front, and on sign-in.
- **One month syncs in one Firestore transaction:** read the cloud month, merge, write.
- **The merge keeps today's GitHub-backup rules:**
  - the union of sets by id;
  - where both sides have a value, the phone's wins;
  - body days fill in missing fields.
- **Tombstones sync too.** A set deleted on one phone is removed on every phone. This fixes a gap in the GitHub backup, where another phone could push the set back.
- **On a new phone:** sign in, pull every month, then the phone works on its own as usual.
- **The GitHub private backup stays** as it is. Whether to retire it is a later decision.
- **Firebase loads only when it's needed:** a dynamic import when Account opens or a signed-in session starts. First load stays as fast as now.
- **The account belongs to one person on this phone** (the active one at sign-in). Other people on the phone stay local-only.

## Screens

- **Data tab → Account card.**
  - Signed out: Sign in or Create account, with email, password, and a Forgot password link.
  - Signed in:
    - your email and username, plus the last sync time;
    - Sign out;
    - Delete account, which removes the cloud data and the login after a typed confirmation;
    - a line spelling out what friends can see.
- **Username:** picked once after the account is created, and changeable later. 3–20 characters, lowercase letters, digits and `_`, and unique.
- **Friends** (a new card on Data, with a badge when requests are waiting):
  - "Invite link": copies or shares a 7-day link, and you can revoke it.
  - "Find by username": type an exact username, then tap Send request.
  - Requests waiting: Accept or Decline.
  - Friends list: tap a friend to open their page, or Remove them.
- **A friend's page:**
  - The same Stats, Lifts and History screens, read-only, under a bar reading "Viewing Sam · Back to you".
  - Nothing can be logged or edited there.
  - Body weight shows on their Stats.

## Phases (each: tests first, deploy, then the full suite)

1. **Accounts and sync:**
   - sign up, sign in, sign out, password reset and delete account;
   - month sync both ways, with tombstones;
   - restore on a new phone;
   - the Account card.
2. **Friends:**
   - claiming a username;
   - invite links;
   - username search, requests, accept and decline;
   - the friends list and remove.
3. **Friend view:** a read-only store fed from a friend's months and meta, the existing screens in read-only mode, and the "Viewing" bar.

## Tests

- **Unit:** the month merge (union, phone wins, tombstones, body fill), dirty-month tracking, and invite token parsing.
- **Rules:** with `@firebase/rules-unit-testing` against the Firestore emulator, check these one at a time:
  - a stranger can't read your months or meta;
  - a friend can read them;
  - a removed friend can't;
  - an expired or wrong invite fails;
  - username listing is denied;
  - nobody can write into your data.
- **e2e:** Auth and Firestore emulators. Two browser contexts (two synthetic users) cover:
  - sign-up;
  - logging on phone A and seeing the set on phone B;
  - a delete that propagates;
  - an invite link;
  - a request that's accepted;
  - the friend's Stats and History showing;
  - removing the friend, after which their page is refused.
- The emulators need Java 21 (not installed on this machine yet).

## Setup only the owner can do (accounts and credentials)

1. Create a Firebase project (console.firebase.google.com) and stay on the Spark (free) plan.
2. Authentication → Sign-in method → enable Email/Password.
3. Authentication → Settings → Authorized domains → add `krystade.github.io`.
4. Firestore Database → Create database → production mode, nearest region.
5. Project settings → Add app → Web, then copy the `firebaseConfig` object (not secret) into chat.
6. Rules go live with `npx firebase deploy --only firestore:rules` after `npx firebase login` (the login is yours to run), or by pasting `firestore.rules` into the console.

## Constraints

- No personal data in fixtures; e2e users are synthetic (`a@test.local`).
- I never type real credentials. Test accounts exist only in the local emulator.
- Stage explicit paths. Headless only.

## Rulings made while building phase 1

- **The month index lives in `users/{uid}/meta/index`, not on `users/{uid}`.** Any signed-in user can read `users/{uid}` (it carries the name a request shows), and the index would tell them when you train. *If wrong:* a cheap move later.
- **Tombstones in the cloud carry a delete time.** Set ids are reused (delete set 3, log a new set 3), so a set logged after the delete outlives it. A phone that was offline stamps its deletes when it next syncs. *If wrong:* in a rare race, a re-logged set on another phone could be removed.
- **Phase 1 syncs sets and body days only.** Priorities, program, name mappings and gyms go to `meta/profile` in phase 3, where friends' Stats needs them anyway. Until then a new phone gets the log but not the program. *If wrong:* build a program again on the new phone.
- **On 127.0.0.1 or localhost the app talks to the local emulators under the `demo-gym-tracker` project.** The dev server and the tests can never touch the real project.
