# Push notifications and friend messages

Sources: three research passes run on 2026-10-16 (iOS Home Screen web push, Cloudflare Worker as a free sender, friend messaging design), checked against the repo and spot-checked on the web the same day. Every platform claim cites a source and date in the Sources section at the end. Where sources disagree, or a behaviour can only be confirmed on the iPhone, the item is marked **unverified**.

## Owner decisions so far (2026-10-16)

- **Four notification kinds:**
  1. **Rest timer done**, including with the phone locked.
  2. **Friend activity:** a request received, your request or invite accepted, a gym shared with you.
  3. **Workout reminder:** on a planned day, nothing logged by a chosen time.
  4. **Weekly recap.**
- **New: friend messages and quick emoji pings**, Life360-style. A one-tap ping, plus short text.
- **Sender:** a **free-plan Cloudflare Worker**. No Firebase Blaze, no Cloud Functions.
- The app stays on GitHub Pages and Firebase Spark. It still works fully without notifications.

## What the platform allows (shapes everything below)

- **Where push works:** only in the Home Screen app on iOS 16.4+, never in a Safari tab.
  - The manifest already has `display: 'standalone'`.
  - On iOS 26, every site added to the Home Screen opens as a web app.
- **Permission:** must be requested from a tap, and `userVisibleOnly: true` is required.
- **Every push must show a notification.**
  - Safari revokes the subscription after 3 pushes that show nothing.
  - That includes pushes that arrive while the app is open. Discourse lost its iOS subscriptions this way.
  - So the service worker never decides to stay quiet. Any suppression happens on the Worker.
- **Notification options on iOS:**
  - **Supported:** title, body, `data`, `close()`, `getNotifications()`, the app badge.
  - **Not supported:** action buttons (so no quick reply or emoji buttons on the notification), `image`, `badge`, `requireInteraction`, `renotify`, `vibrate`, `silent`.
  - `icon` is ignored; iOS always uses the app icon.
  - **`tag` does not replace an earlier notification** (WebKit 258922, still NEW 2026-07-31). Grouping has to happen on the Worker. The push service's `Topic` header collapses only pushes that haven't been delivered yet.
- **No local or scheduled notifications.** Page JavaScript is suspended in the background. A rest-timer alert on the lock screen is therefore a server push sent at the right moment.
- **Declarative Web Push (iOS 18.4+):**
  - The payload carries the notification itself plus an absolute `navigate` URL. With `mutable: true`, the service worker can still run.
  - If the service worker shows nothing, the proposed notification is shown anyway, so the 3-strike rule can't trigger.
  - iOS 16.4–18.3, Chrome and Firefox treat the same JSON as ordinary push data, which the service worker renders.
- **No `pushsubscriptionchange` event on iOS.** Subscriptions can also die silently (WebKit 273063; Apple forums 786360, June 2025), and APNs can return 201 for a dead one (forums 719990). The app re-syncs its subscription each time it comes to the foreground.

## Architecture

### Client

- **Service worker:** move from `generateSW` to **`injectManifest`** with a typed `src/sw.ts`.
  - It recreates today's behaviour exactly:
    - `precacheAndRoute(self.__WB_MANIFEST)` and `cleanupOutdatedCaches()`.
    - A `NavigationRoute` to `index.html`. vite-plugin-pwa's generateSW sets `navigateFallback: 'index.html'` by default. Confirm by grepping today's `dist/sw.js` before switching.
    - `self.skipWaiting()` and `clientsClaim()`.
  - `vite.config.ts` changes:
    - `strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts'`.
    - `injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png}'] }`.
    - Drop the `workbox` block.
  - `src/sw.ts` gets its own `/// <reference lib="webworker" />` and `declare let self: ServiceWorkerGlobalScope`. The root tsconfig lib stays as it is, so DOM types don't clash.
  - The reload on `controllerchange` in `main.tsx` keeps working, because the new worker still calls skipWaiting and clientsClaim.
- **`push` handler** (`src/push/sw-push.ts`, unit-tested):
  - Always `event.waitUntil(self.registration.showNotification(title, { body, data, lang }))`. It reads `event.notification` on declarative iOS, otherwise `event.data.json().notification`. A broken payload still shows "Gym Tracker" with an empty body.
  - It records the badge with `self.navigator.setAppBadge(n)`.
  - It writes `{ lastPushAt, kind }` to IndexedDB for the diagnostics panel.
  - It `postMessage({ type: 'push', kind })`s any open window so that window refreshes its inbox.
- **`notificationclick` handler:**
  1. `notification.close()`.
  2. Store `{ route, at }` in IndexedDB.
  3. If `clients.matchAll({ type: 'window' })` finds a window, `focus()` it and `postMessage({ route })`.
  4. Otherwise `clients.openWindow(<scope> + '#open=' + route)`.
  - The app also reads a stored route on `visibilitychange` (if it is under 2 minutes old). That covers WebKit 263687, where `openWindow` opens the root instead of the deep link. One commenter couldn't reproduce that bug on iOS 26.0, so it's **unverified** whether it still happens.
  - MDN BCD lists `notificationclick` as unsupported on iOS, which contradicts WebKit's own fixed bug 252544. The stored route works either way.
- **Routes:** in the hash, beside the existing `#invite=` handling in `App.tsx`. There is no router.
  - `#open=rest`
  - `#open=friend.<uid>`, which opens that friend's sheet
  - `#open=friends`
  - `#open=today`
  - `#open=recap`, which opens Stats
- **`src/push/client.ts`** (new):
  - **`enablePush()`** runs from the button's click handler. It calls `reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` before any other `await`, with the registration fetched in advance when the card mounts. Then it sends `POST /subscribe`.
  - **`resyncPush()`** runs from the `visibilitychange` hook in `main.tsx`. It calls `getSubscription()`:
    - If that returns null while permission is `granted`, it tries to subscribe again without a tap. That is **unverified on iOS**; if it throws, the card shows a "Re-enable notifications" button.
    - Otherwise it upserts the subscription (`lastSeen`).
  - **`api(path, body)`** attaches `Authorization: Bearer <await auth.currentUser.getIdToken()>`.

### Worker (`worker/` in this repo, deployed as `gym-tracker-push`)

**Components:**
- **One Worker plus one SQLite-backed Durable Object class, `UserBox`.** There is one `UserBox` per Firebase uid, created with `idFromName(uid)`.
  - Free plan: SQLite-backed Durable Objects only, 100k DO requests/day, 30 s CPU per request.
  - The Worker itself gets 10 ms CPU per request and 100k requests/day.
- **Request path:** the Worker only does CORS, verifies the Firebase ID token, applies a rate limit and forwards to the DO.
- **Sending:** encryption and the APNs `fetch` happen inside the DO, so the Worker's 10 ms CPU limit never applies to them.
- **Encryption library:** `@pushforge/builder` (2.0.5, MIT, no dependencies). It supports `ttl`, `urgency` and `topic`, returns `{ endpoint, headers, body }`, and its CLI generates VAPID keys.

**VAPID token caching:**
- Apple says: don't refresh the VAPID JWT more than once an hour, and `exp` can be at most 24 h ahead.
- A singleton `UserBox` named `"vapid"` signs one JWT per push-service origin (with `jose`, `exp` 12 h) and caches it. User DOs fetch it by RPC and keep it in memory until an hour before it expires.
- We overwrite the `Authorization` header that pushforge produces with the cached `vapid t=…, k=…`. Encryption doesn't depend on the JWT.
- **To check at the start of part B:** pushforge's header format, and that replacing that one header is clean. If not, use `@block65/webcrypto-web-push` 2.0.0 and sign the JWT ourselves.

**Auth:**
- `jose` `createRemoteJWKSet('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')` with `jwtVerify`:
  - `alg` RS256.
  - `aud` `krystade-gym-tracker`.
  - `iss` `https://securetoken.google.com/krystade-gym-tracker`.
  - Plus manual checks: `sub` is not empty and `auth_time` is not in the future.
- **Local mode** is set only by `.dev.vars` (`AUTH_EMULATOR=1`) and only for the project `demo-gym-tracker`. It accepts the Auth emulator's unsigned tokens. A unit test proves the production config rejects `alg: none`.
- **Fallback if Workers Logs show verification over 10 ms CPU:**
  - The Worker routes on the token's *unverified* `sub`.
  - The DO verifies the token and rejects it unless `sub` equals its own name.
  - Routing on an unverified claim is harmless because the DO checks it.

**Firestore access: the caller's own ID token, no service account:**
- The Worker calls Firestore REST with `Authorization: Bearer <the caller's token>`. Requests with an ID token are evaluated against Security Rules, so the existing tested `firestore.rules` decide (Firestore REST docs, updated 2026-10-15).
- Freshness checks use the REST `createTime` returned on a document `GET`. That time is set by the server, so the phone's clock can't fake it.
- Recipient-side state (mutes, push throttle, unread count) lives in the recipient's DO, so the Worker never writes to Firestore.
- **This replaces the friend-messaging research's service-account idea.** No admin key exists anywhere.

**Endpoints:**
- All require a valid token, except `OPTIONS`.
- CORS: origin exactly `https://krystade.github.io` with `Vary: Origin`. `http://127.0.0.1:*` is allowed only in local mode.
- `Allow-Methods: GET, POST, PUT, DELETE`, `Allow-Headers: authorization, content-type`, `Max-Age: 7200`.

| Route | Body | Does |
|---|---|---|
| `POST /subscribe` | `{ endpoint, keys, ua }` | Upserts the device. Its id is the first 16 hex characters of SHA-256(endpoint). At most 5 per user; the oldest `lastSeen` is evicted. Returns the id |
| `DELETE /subscribe/:id` | | Removes the device (the "Turn off" button) |
| `PUT /prefs` | `{ tz, kinds, reminder: { days, at }, recap: { day, at }, quiet: { from, to } \| null, muted: uid[] }` | Replaces the prefs and reschedules the alarm |
| `POST /timer` | `{ sub, seconds, label }` | Sets the rest alarm for this device. Calling it again replaces the previous one |
| `DELETE /timer` | | Cancels it |
| `POST /activity` | `{ date, next, week: { sessions, sets, prs } }` | Records "logged today", the next program day and the recap counts |
| `POST /notify` | `{ kind: 'request' \| 'accepted' \| 'gym' \| 'inbox', to, id? }` | Checks the claim against Firestore, then calls the **recipient's** DO, which applies mute, quiet hours and throttle and sends |
| `POST /badge` | `{ n }` | Sets the true unread count when the app opens |
| `POST /test` | `{ sub }` | Sends one push to this device |
| `GET /status` | | Devices (`lastOkAt`, `lastStatus`), next alarm, prefs. Feeds the diagnostics panel |

**How each `/notify` is checked**, using the sender's token against Firestore REST:

| kind | Request | Pass when |
|---|---|---|
| `request` | `GET users/{to}/requests/{me}` | 200 and `createTime` is under 60 s old. The `me(from)` rule lets the sender read it |
| `accepted` | `GET users/{to}/meta/__probe` | 404 (allowed, so `friendOf(to)`); 403 means not friends. `users/{to}/friends/{me}` can only exist through an invite or a request, so this proves the friendship. Checking your own list wouldn't, because anyone can add anyone to their own list |
| `gym` | `GET users/{to}/gymInbox/{id}` | 200, `from == me` and `createTime` under 60 s. Needs a new sender `get` rule, below |
| `inbox` | `GET users/{to}/inbox/{id}` | 200, `from == me` and `createTime` under 60 s |

- The sender's name is always read from `GET users/{me}.username`, never from the request body.
- The notification text comes from the Worker's preset table, or from the stored `t` for a message. It is never taken from the request.
- Each DO keeps the last 200 notified doc ids, so replaying a `/notify` sends nothing.

**Sending (inside the DO):**
- **Payload** (shared type `src/push/payload.ts`, imported by the Worker by relative path):
  ```json
  { "web_push": 8030,
    "notification": { "title": "jake", "body": "💪 Strong", "lang": "en",
      "navigate": "https://krystade.github.io/gym-tracker/#open=friend.<uid>",
      "app_badge": "2", "data": { "kind": "ping", "route": "friend.<uid>" } },
    "mutable": true }
  ```
  - `Content-Type: application/notification+json`. Only secondary sources (pushpad 2025-03, aimtell 2026-04) state that, so it is **unverified**.
  - Payloads stay under 1 KB. The limit is 4 KB.
- **Headers per kind:**

  | Kind | Urgency | TTL | Topic |
  |---|---|---|---|
  | Rest | `high` | 60 s | `rest` |
  | Friend | `normal` | 86400 | 22-char base64url of SHA-256(sender uid) |
  | Reminder | `normal` | 4 h | `remind` |
  | Recap | `low` | 86400 | `recap` |

- **Response handling:**
  - 404/410: delete the device.
  - 413: log the kind only.
  - 429: back off 60 s.
  - Every result is stored on the device row for `/status`.
  - Devices whose `lastSeen` is over 30 days old are pruned when the alarm runs.
- **Never logged:** message text or payloads. Logs carry only kind, status and duration.

**Scheduling: one DO alarm per user:**
- The DO keeps its pending events in storage: the rest timer, the next reminder, the next recap and the next prune. `setAlarm` always points at the earliest one.
  - One alarm per object; calling `setAlarm` again replaces it.
  - Millisecond granularity, at-least-once, retried with backoff (Alarms docs, updated 2026-04-21).
- **Rest:** the client sends a duration, not a clock time, so a wrong phone clock doesn't matter. `due = Date.now() + seconds*1000`.
- **Reminder and recap times** are computed in the user's IANA time zone with `Intl.DateTimeFormat({ timeZone })`. Cron triggers only run in UTC.
  - Full time-zone support in workerd is **unverified**. A unit test covers New York across a DST change.
- **The reminder is skipped** when `lastLoggedDate` equals today in local time.
- **Why not the alternatives:**
  - **Queues** (free since 2026-02-04): no documented way to cancel a delayed message, delivery precision unspecified, about 3 operations per message.
  - **Cron:** 5 per account, UTC only, 10 ms CPU per run.

**Abuse limits:**
- A `ratelimit` binding keyed by **uid**: 60 requests per 60 s across all routes, plus 10 per 60 s on `/notify`. It is per location and approximate.
- Exact per-sender limits run in the recipient's DO, which handles one request at a time:
  - At most 1 friend push per sender per 60 s. Pings skipped in that window still land in the inbox, and the next push says "+N more".
  - At most 30 pushes per sender per hour.
- The daily limit stays **fail closed**.

**What sits on Cloudflare:**
- Subscriptions, prefs, time zone, muted uids, recap counts, the rest label and recent doc ids.
- Message text passes through memory only.

### Firestore

- The Firestore client stays **`firebase/firestore/lite`**, which has **no realtime listeners**.
- An open thread loads with `getDocs` when the sheet opens, and again on `visibilitychange`, on a `postMessage` from the service worker, and after each send.
- The sender's half of a thread is `where('from', '==', me)` on `users/{f}/inbox`, sorted on the phone. That avoids a composite index and any `firestore.indexes.json` deploy.

## Data model and rules

```
users/{to}/inbox/{autoId}   { from, kind: 'p', e: presetKey, at }            // ping
                            { from, kind: 'm', t: string(1..140), at }         // message
users/{me}/friends/{f}      { since, via } + muted?: bool, readAt?: Timestamp  // owner-only: no read receipts
users/{from}/sendRate/{to}  { at, win, n }                                     // the sender's own throttle
users/{me}/blocked/{them}   { at }                                             // owner-only
```

- **`at`** is `serverTimestamp()` and the rules require `== request.time`.
- **Presets are stored as keys**, so the rules check a fixed list and the wording can change without a data migration.
- **`gymInbox` stays as it is** in storage; the UI merges it into the thread. Its `fromName` is never shown again. The name comes from `users/{from}`.
- **Unread:** inbox docs from that friend with `at > friends/{f}.readAt`. Opening the sheet writes `readAt`.
- **Retention:** Spark has no TTL deletes. On app open, the recipient deletes inbox docs older than 30 days, in batches of 50. Unfriending or blocking also deletes that friend's docs from your inbox.

**Rules changes** in `firestore.rules`, under `match /users/{uid}`:

1. **`inbox`:**
   - **Create:**
     - `signedIn() && friendOf(uid)`.
     - `from == request.auth.uid`.
     - `at == request.time`.
     - Exact keys per kind: `e in presets()`, or `t is string` with size 1–140.
     - `getAfter(…/users/$(request.auth.uid)/sendRate/$(uid)).data.at == request.time`.
   - **Read:** `me(uid) || (signedIn() && resource.data.from == request.auth.uid)`.
   - **Delete:** `me(uid)`.
   - **Update:** `if false`.
   - **Cost:** 2 lookups and 2 writes per message.
2. **`sendRate`:**
   - Owner-only.
   - Create with `n == 1`.
   - Update needs at least 2 s since `at`, and either `n + 1 <= 30` inside the hour window or a reset to `n == 1` with a new `win`.
   - The exact rule is in the messaging research. Near a window boundary the phone's clock can disagree with the server; the client retries once.
3. **`blocked`:** `allow read, write: if me(uid)`.
4. **`friends`:**
   - New update rule: only `muted` (a bool) and `readAt` (`== request.time`) may change, and only by `me(uid)`.
   - Add `!exists(users/$(uid)/blocked/$(f))` to both `me(f)` create paths.
5. **`requests` create:** add `!exists(users/$(uid)/blocked/$(from))`. Today any signed-in user can request anyone, with no limit.
6. **`gymInbox`:** add `allow get: if signedIn() && resource.data.from == request.auth.uid`, for the Worker's sender check.

**Never stored in:**
- `users/{uid}`: any signed-in user can read it.
- `meta/*` or `months/*`: friends can read those, so a friend would see they'd been muted.
- URLs beyond `#open=friend.<uid>`: a uid is already public in invite links.
- Repo fixtures: they stay synthetic.

## UX (375×812, notch insets)

**Notifications card** on More, under the round-7 tab bar. Its states:
1. **In a Safari tab** (not `matchMedia('(display-mode: standalone)')` and not `navigator.standalone`): "Notifications work from the Home Screen app: Share → Add to Home Screen, then open it from there."
2. **Not signed in:** "Notifications need an account", with a Sign in button.
3. **Standalone, never asked:** one **Turn on notifications** button. One tap triggers iOS's prompt; nothing appears on launch.
4. **Denied:** "Turned off in iPhone Settings → Notifications → Gym Tracker". iOS shows the name the user gave the icon.
5. **On:**
   - Per-kind switches: Rest timer, Friends (pings and messages), Friend activity, Workout reminder, Weekly recap.
   - Reminder: weekday chips plus a time.
   - Recap: day plus time.
   - Quiet hours.
   - **Send test push.**
   - Diagnostics:
     - "Last push received" (written by the service worker).
     - This device's `lastStatus` from `/status`.
     - iOS level: `'pushManager' in window` means declarative push is available.
   - **Turn off on this phone.**
   - Changing anything sends `PUT /prefs`, debounced 1 s.

**Behaviour per kind:**
- **Rest timer:**
  - When the round-7 C3 timer starts it calls `POST /timer` with a label such as "Bench · set 4 next". +30 s posts again; dismissing or the next set calls `DELETE`.
  - **While the app is visible**, a page timer calls `DELETE` 3 s before the end and the in-app bar ends the rest itself. In the background that page timer is suspended, so the push goes out.
  - **Offline:** the in-app timer still runs and the bar shows a small "no lock-screen alert".
- **Badge:**
  - It counts unread friend items only.
  - The DO increments it per push (`app_badge`). The app sends `POST /badge` with the true count on open and after reading.
  - Users can switch badges off per app in iOS Settings.
- **Friend activity copy:**
  - "jake wants to be friends" opens Friends.
  - "You and jake are friends" opens their sheet.
  - "jake sent you a gym: Planet Fitness" opens their sheet. The gym name is cut to 40 characters.
- **Reminder:** "Day B is up · nothing logged yet". `next` comes from the last `/activity`.
- **Recap:** "This week: 4 sessions · 61 sets · 2 PRs". Opens Stats.
- **Quiet hours:**
  - Apply to friend kinds only. Rest is user-started; reminder and recap are user-timed.
  - A skipped push still leaves the item in the inbox. Nothing is sent when quiet hours end.
  - iOS Focus (Sleep) also applies, per app.

**Pings and messages:**
- **Friends row:** `@jake`, the latest item ("💪 · 2h"), and a ≥44 px 💬 button with an unread dot.
  - Tapping the name still opens their log.
  - Remove moves into the sheet's ⋯ menu.
- **Bottom sheet**, never a centred modal (shared-device rule). Bottom padding `env(safe-area-inset-bottom)`. Top to bottom:
  1. Header: `@jake`, a mute bell, and ⋯ (View log, Remove, Block).
  2. The last ~20 items as bubbles, mine on the right. A shared gym shows inline with Add and Dismiss.
  3. **The preset row**, above the text field so the keyboard can't hide it.
  4. A 140-character field with a live counter, and Send.
- **Sending:**
  - It writes the inbox doc and the `sendRate` doc in one batch, then `POST /notify`.
  - Shows a "Sent 💪" tick, with no confirm dialog.
  - During the 2 s gap the buttons are briefly disabled.
  - A blocked or ex-friend sender sees a neutral "Couldn't send".
- **Other ways in:**
  - FriendView's viewing bar gets the same 💬 button, for kudos.
  - A notification tap opens the sheet: 1 tap to reply with a preset.
  - When there's unread, a one-line banner on Today ("jake 💪 · tap to reply").
- **Preset set** (6 × 48 px + 5 × 8 px = 328 px, inside the 343 px content width):

  | Key | Ping | Copy |
  |---|---|---|
  | `strong` | 💪 | Strong |
  | `fire` | 🔥 | On fire |
  | `clap` | 👏 | Nice work |
  | `gym` | 🏋️ | Gym today? |
  | `eyes` | 👀 | Did you lift? |
  | `salute` | 🫡 | On it |

  - An unknown key renders as "sent you a ping".
  - Adding a preset means changing the rules, the Worker table and the app together.
- **No read receipts, typing indicators or reaction counts.** Mute is per friend and invisible to them. Block is a batch:
  - Delete both friend docs and any request.
  - Write `blocked/{them}`.
  - Revoke invites.
  - Unblock lives in a "Blocked" list at the bottom of Friends.

## Parts, in shippable order

Each part ships on its own: tests first, deploy, then the full suite from a separate worktree.

### A. Service worker parity (no new behaviour)

1. Record today's `dist/sw.js`: its precache entries and its navigation fallback.
2. Switch to `injectManifest` with `src/sw.ts` as above.
3. **Gate:** `npm run build`. Then:
   - `dist/sw.js` contains the injected manifest and the navigation route.
   - The precache list is identical apart from `sw.js` itself.
   - The existing e2e suite stays green, including the offline and update paths.
4. Decide the manifest `id` here, **before any subscription exists** (see Questions).

### B. Pipe end to end: Worker, opt-in, test push (the go/no-go gate)

1. **Worker:**
   - `worker/` with `wrangler.jsonc`: DO binding, `new_sqlite_classes` migration, `ratelimit` binding, `FIREBASE_PROJECT` var.
   - The repo's `.gitignore` ignores `*.json`, which a `.jsonc` file doesn't match. Add `.dev.vars*` and `.wrangler/` to `.gitignore`.
   - Routes: auth, CORS, `/subscribe`, `/test`, `/status`, `/badge`.
   - Sending, the VAPID cache, 410 cleanup.
2. **Client:**
   - `src/push/*`: `push` and `notificationclick` handlers, the `#open=` routes, the Notifications card (states 1–5), diagnostics.
   - `resyncPush` on foreground.
3. **Deploy**, then **device pass 1** on the iPhone (owner):
   - Turn on.
   - Send test with the app open, then with the app backgrounded, then locked.
   - Tap the notification.
   - Report what showed and where the tap landed.
4. **If iOS push doesn't work on his phone, stop here.**

### C. Rest timer push

- Depends on round 7 C3 having shipped.
- `/timer` routes, the alarm, the visible-app cancel.
- Device pass 2: time from the end of the timer to the lock screen, with music playing.

### D. Friend activity

- The `gymInbox` sender `get` rule.
- `/notify` for `request`, `accepted` and `gym`.
- Calls added after the existing writes in `friends.ts`: `sendRequest`, `acceptRequest`, `acceptInvite`, `sendGym`. A failed `/notify` never fails the Firestore action.

### E. Pings and messages

- Rules: `inbox`, `sendRate`, `blocked`, the `friends` update rule, block checks.
- `friends.ts`: `sendPing`, `sendMessage`, `listThread`, `markRead`, `setMuted`, `blockFriend`, `unblock`, `pruneInbox`.
- The sheet and the row changes.
- Unread added to the existing `onRequests` count: requests + gyms + unread.
- `/notify inbox` with mute, throttle and "+N more".

### F. Reminder, recap, quiet hours

- `/activity` posted when the first set of a day is saved and when a session summary shows.
- `/prefs` with time zone, days, times and quiet hours.
- Alarm scheduling in local time.

## Tests

### Unit (vitest, `src/**/*.test.ts`)

- **Payload:**
  - The builder per kind.
  - Size under 1 KB with a 140-character emoji message.
  - Absolute in-scope `navigate`.
  - Unknown preset key → "sent you a ping".
- **Service worker handlers**, with a fake `self.registration`, `clients`, `navigator` and IndexedDB:
  - Every push path calls `showNotification` inside `waitUntil`, including a broken payload and a declarative `event.notification`.
  - A click with a window open: `focus` + `postMessage`.
  - A click with no window: `openWindow` + stored route.
- **Route parsing** `#open=…`, next to `invite.test.ts`.

### Worker (new `npm run test:worker`)

- Runs `@cloudflare/vitest-pool-workers`. `runInDurableObject` and `runDurableObjectAlarm` exist (docs, updated 2026-10-10). Outbound fetches go through an injected `fetcher` so APNs, Google JWKS and Firestore are faked.
- Added to the deploy workflow beside `npm test`.
- **Auth:**
  - Rejects an expired token, a wrong `aud` or `iss`, an empty `sub`.
  - Rejects `alg: none` in the production config, and accepts it only with local mode **and** `demo-gym-tracker`.
- **CORS:**
  - The exact origin passes.
  - `https://krystade.github.io.evil.com` gets no `Allow-Origin`.
  - Preflight headers are correct.
- **Encryption:** decrypt the produced body in the test with the subscription's private key (WebCrypto, RFC 8291), checked first against the RFC 8291 §5 example. Assert headers: `TTL`, `Urgency`, a `Topic` of 32 characters or fewer, `Content-Encoding: aes128gcm`.
- **Responses:** 410 and 404 delete the device; 201 sets `lastOkAt`; pruning removes devices older than 30 days.
- **VAPID:** two sends an hour apart reuse one JWT; a JWT one hour before expiry is renewed.
- **Rest:**
  - `/timer` then `runDurableObjectAlarm` sends one high-urgency push to that device only.
  - `DELETE` sends none.
  - A second `/timer` replaces the first.
- **Reminder:**
  - Fires on a planned day when nothing was logged.
  - Skips when `/activity` said today.
  - The next-fire time is correct across a DST change for `America/New_York`.
- **Recap:** body built from the counts.
- **Notify:**
  - Firestore 403 means no push. 404 on the probe means `accepted` passes.
  - A `createTime` 61 s old is refused.
  - A replayed doc id sends nothing.
  - A muted sender sends nothing.
  - The second ping inside 60 s is held, and the next push says "+1 more".
  - The 31st push in an hour is dropped.
  - Quiet hours skip.
- **Mutation checks:**
  - Drop `waitUntil` in the service worker; the push test must fail.
  - Drop the `createTime` check; the stale test must fail.
  - Drop the mute lookup; the mute test must fail.
  - Accept `alg: none` in production; the auth test must fail.

### Rules (`rules/firestore.rules.test.ts`, emulator)

- **`inbox` create:**
  - A friend's ping and message pass.
  - A stranger is denied.
  - An unknown preset is denied.
  - 0 and 141 characters are denied.
  - Extra keys are denied.
  - A forged `from` or `at` is denied.
  - A missing `sendRate` write in the batch is denied.
  - A second send inside 2 s is denied.
  - The 31st in an hour is denied.
  - After a window reset, `n == 1` passes.
- **`inbox` read:**
  - The recipient lists all.
  - The sender lists only with `where from == me`.
  - The sender can't read the other friend's docs.
- **`inbox` update** is denied.
- **`friends` update:** the owner sets `muted` and `readAt`; can't change `since`; a friend can't set your `muted`.
- **Block:** after the block, `requests` create and both `friends` create paths are denied.
- **`gymInbox` sender `get`:** passes for the sender, denied for others.
- **REST probe** (Worker integration test against the Firestore emulator REST API): `GET users/{x}/meta/__probe` returns 404 for a friend and 403 for a stranger. **Unverified until this runs.**

### e2e (Playwright Chromium, headless, 375×812)

- **Real `pushManager.subscribe` can't run here.** It fails in headless browsers (dev.to/chinchang, 2022; tessl testland/web-push-tests). That corrects the push research's claim that headless Chromium can test the subscribe flow.
- **`push.spec.ts`:**
  - Setup:
    - `addInitScript` stubs `PushManager.prototype.subscribe` to return a subscription made from a test ECDH key, with an endpoint on a fake push service run by the spec.
    - `context.grantPermissions(['notifications'])`.
    - `wrangler dev` (local mode) and the Auth and Firestore emulators as webServers.
  - Opt-in flow: the Notifications card goes from "Turn on" to "On"; `/status` lists the device.
  - Send test: the fake push service receives one request. The spec decrypts it and checks title, body and `navigate`.
  - Deliver that payload to the service worker with CDP `ServiceWorker.deliverPushMessage(origin, registrationId, data)` (experimental domain). The registration id comes from `ServiceWorker.workerRegistrationUpdated`.
  - Assert the service worker's IndexedDB "last push" record. Use `registration.getNotifications()` too if headless Chromium returns it (**unverified**).
  - A `#open=friend.<uid>` launch opens that friend's sheet.
- **`messages.spec.ts`**, two contexts (synthetic users):
  - A pings B; B's push arrives at the fake service.
  - B opens the sheet; B's unread dot clears.
  - B mutes A; A's next ping sends no push but shows in B's inbox.
  - B blocks A; A gets "Couldn't send".
  - The preset row fits at 375 px with no horizontal scroll.
  - Screenshots of the sheet with the keyboard area, the card states and the Today banner, looked at by eye.
- **Not in e2e:** the run uses no visible browser and no sound.

### Device (owner, iPhone 13 mini; the only place these can be confirmed)

- The 3-strike rule never trips over a week of use.
- `tag` still stacks.
- Where a notification tap lands, cold and warm.
- Whether a notification shows while the app is in the foreground.
- Whether re-subscribing without a tap works.
- Rest-push latency.
- The badge.
- `Content-Type: application/notification+json` accepted.

## What the owner does himself (accounts and secrets)

1. **Create a Cloudflare account** (free plan) at dash.cloudflare.com and choose the `workers.dev` subdomain. Tell me the subdomain; the client needs the Worker URL.
2. **`npx wrangler login`** in `worker/`. It opens a browser and is yours to run.
3. **VAPID keys:**
   - Run `npx @pushforge/builder vapid`.
   - Put the private JWK in with `npx wrangler secret put VAPID_PRIVATE_JWK`.
   - Paste only the **public** key (base64url) into chat. It goes in the client and isn't secret.
   - Never paste the private key anywhere.
4. **Deploying the Worker:**
   - If you pick the GitHub Action, create a Cloudflare API token from the "Edit Cloudflare Workers" template. Add it and your account id as repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
   - Otherwise, after your `wrangler login`, I run `wrangler deploy` from this machine.
5. **Rules go live** with `npx firebase deploy --only firestore:rules`, as for friends (parts D and E).
6. **Device passes** after parts B and C: add the app to the Home Screen if it isn't already, tap Turn on, run the listed checks, and report or screenshot the diagnostics panel.
7. **No service-account key.** This design never needs one: every Firestore check uses the caller's own token. The task brief listed one; skip it. Making one would put an admin key, which ignores the rules, into a Worker secret.

## Risks

- **iOS push itself:**
  - Silent subscription death with no event (WebKit 273063, forums 786360). Mitigated by the foreground re-sync, the 30-day prune and the diagnostics panel; not prevented.
  - APNs 201 for dead subscriptions (forums 719990). Each one costs one wasted DO send until the prune.
  - **The manifest has no `id`, so the start URL is the identity.** Changing `start_url`, `scope` or `base` later may split installs and orphan their subscriptions. That's an inference from WebKit 13878, **unverified**.
- **Rest-timer timing:**
  - APNs latency isn't guaranteed, and "high" urgency is a hint.
  - A gym with no signal means no `/timer` call and no lock-screen alert. The in-app timer is unaffected.
- **Sound:** `silent` isn't supported on iOS, so each push makes the default sound or vibration. Round 7 chose no sound for the in-app timer. See Questions.
- **Free-plan CPU:**
  - Token verification in the Worker's 10 ms CPU limit is unmeasured. Check Workers Logs after part B; the fallback is described above.
  - Encryption runs in the DO, but its CPU cost is unpublished. Read it from the logs too.
- **Declarative push:**
  - Its content type and "mutable" status are partly secondary-sourced.
  - Aimtell (2026-04) says mutable isn't shipping, which contradicts WebKit and WWDC25. The service worker path works either way.
- **Library choice:** `@pushforge/builder` has 66 stars and one maintainer. Swapping to `@block65/webcrypto-web-push` is contained in one module.
- **Firestore lite has no listeners**, so an open thread updates on push, visibility change or a send, not live. That's acceptable for pings. Switching the whole app to full Firestore would add about 100 KB and is out of scope.
- **Public repo:** `.dev.vars` must be ignored before the first `wrangler dev`, and test fixtures stay synthetic.
- **Spark quota:** 2 billed reads and 2 writes per message, plus pruning. That's far below 50k reads and 20k writes a day for a small circle.

## Owner answers (2026-10-16)

1. **Reminder:** days and time picked in the app. Off until set; the chips start spread across the sessions-per-week goal (2 → Tue/Fri) at 18:00. It fires only when nothing is logged that day.
2. **Weekly recap:** the counts go in the push ("4 sessions · 61 sets · 2 PRs"); the app sends only those three numbers.
3. **Rest push while the app is open:** cancelled 3 s before the end when the app is on screen; the in-app bar ends the rest.
4. **Sound:** kept.
5. **Quiet hours:** none. Everything is delivered when it happens.
6. **Pings:** 💪 🔥 👏 🏋️ 👀 🫡.
7. **Worker deploy:** a GitHub Action on pushes to `main` that touch `worker/**`, once the owner adds the Cloudflare secrets. Until then nothing deploys and the app hides every notification control.
8. **Manifest `id`:** left unset; `start_url`, `scope` and `base` never change.

**Ready to plug in:** the owner can't create the Cloudflare account yet. Everything is built and tested locally (`wrangler dev`, Miniflare) first. The client reads the Worker URL and VAPID public key from `src/push/config.ts`; while they are empty, no notification UI shows and no request is made. `worker/SETUP.md` lists the owner's steps in order, ending with the one commit that fills in the two values.

## Not in this plan

- Inline replies or action buttons: iOS doesn't support them.
- Show-then-close replacement of older notifications: unverified on a device. Revisit if stacking is annoying.
- Push when a friend finishes a workout.
- Group chats.
- Photos in messages.
- Live presence ("in the app") suppression.
- A switch to the full Firestore SDK.

## Sources

**WebKit and Apple:**
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ (2023-02-16)
- https://webkit.org/blog/14112/badging-for-home-screen-web-apps/
- https://webkit.org/blog/16535/meet-declarative-web-push/ (2025-03-27)
- https://webkit.org/blog/16574/webkit-features-in-safari-18-4/ (2025-03-31)
- https://developer.apple.com/videos/play/wwdc2025/235/ (June 2025)
- https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers (fetched 2026-10-16)

**WebKit bugs and Apple forums:**
- https://bugs.webkit.org/show_bug.cgi?id=258922 (tag doesn't replace notifications; NEW as of 2026-07-31)
- https://bugs.webkit.org/show_bug.cgi?id=263687 (deep link opens the root; not reproduced on iOS 26.0, 2025-12-02)
- https://bugs.webkit.org/show_bug.cgi?id=252544 (notificationclick; fixed April 2023)
- https://bugs.webkit.org/show_bug.cgi?id=273063 (subscription lost after a push; 2024)
- https://developer.apple.com/forums/thread/786360 (tokens stop working; June 2025)
- https://developer.apple.com/forums/thread/719990 (201 for dead subscriptions; 2022–2024)
- https://developer.apple.com/forums/thread/726793 (no action buttons on iOS; Nov 2024)
- https://developer.apple.com/forums/thread/767665 (Simulator returns empty keys; 2024-11)

**Compatibility data and third-party write-ups:**
- MDN browser-compat-data raw JSON, pulled 2026-10-16
- https://mjtsai.com/blog/2025/10/03/web-apps-in-ios-26/ (2025-10-03)
- https://meta.discourse.org/t/ios-notifications-can-lose-permission-to-push-if-the-user-is-currently-active/290225 (2024-01)
- https://pushpad.xyz/blog/declarative-web-push (2025-03)
- https://aimtell.com/blog/state-of-declarative-web-push-2026 (2026-04)
- https://dev.to/progressier/how-to-fix-ios-push-subscriptions-being-terminated-after-3-notifications-39a7 (2023-06-30)

**Cloudflare:**
- https://developers.cloudflare.com/workers/platform/limits/ (updated 2026-10-12)
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/limits/ (updated 2026-06-01)
- https://developers.cloudflare.com/durable-objects/api/alarms/ (updated 2026-04-21)
- https://developers.cloudflare.com/workers/configuration/cron-triggers/ (updated 2026-09-04)
- https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ (updated 2026-10-12)
- https://developers.cloudflare.com/workers/configuration/secrets/ (updated 2026-10-15)
- https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/ (updated 2026-10-10)

**Firebase and Google:**
- https://firebase.google.com/docs/auth/admin/verify-id-tokens (updated 2026-10-13)
- https://firebase.google.com/docs/firestore/use-rest-api (updated 2026-10-15; ID token requests are evaluated against Security Rules)
- https://firebase.google.com/docs/firestore/security/rules-conditions (updated 2026-10-15)
- https://cloud.google.com/firestore/pricing (TTL deletes need billing; fetched 2026-10-16)

**Libraries and standards:**
- https://github.com/draphy/pushforge (`@pushforge/builder` 2.0.5, 2026-04-23)
- https://cdn.jsdelivr.net/npm/@block65/webcrypto-web-push@2.0.0/README.md (2026-09-15)
- `jose` 6.2.12 (2026-09-05)
- https://www.rfc-editor.org/rfc/rfc8291

**Testing:**
- https://cdpstatus.reactnative.dev/devtools-protocol/tot/ServiceWorker (`deliverPushMessage`, experimental)
- https://dev.to/chinchang/mocking-web-push-notification-in-cypress-35a7 (2022-06-28; subscribe fails headless)
- https://tessl.io/registry/testland/web-push-tests

**Friend-feature references:**
- https://support.life360.com/hc/en-us/articles/23053398261399-Emoji-Quick-Notes-In-App-Messaging (2026-03-11)
- https://support.apple.com/guide/watch/apd68a69f5c7 (fetched 2026-10-16)

**Repo files read:**
- `vite.config.ts`
- `src/main.tsx`
- `src/cloud/friends.ts`
- `src/cloud/firebase.ts`
- `src/state/useCloud.ts`
- `src/ui/App.tsx`
- `src/domain/profile.ts`
- `src/domain/program.ts`
- `firestore.rules`
- `rules/firestore.rules.test.ts`
- `firebase.json`
- `playwright.config.ts`
- `.gitignore`
- `.github/workflows/deploy.yml`
- `docs/superpowers/plans/2026-10-16-round-7.md`
- `docs/superpowers/plans/2026-10-16-cardio.md`
- `docs/superpowers/plans/2026-10-07-accounts-friends.md`