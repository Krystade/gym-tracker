# Push Worker: owner setup

The Worker that sends Gym Tracker's notifications (rest timer done, workout reminder, weekly recap, and a friend's
request, acceptance or shared gym, and a friend's ping or message). It runs on the
Cloudflare free plan. Until the last step below is pushed, the app shows no notification controls and never calls it.

Everything runs from a terminal in this `worker/` folder. You need Node 20 or later.

## 1. Sign Wrangler in to your Cloudflare account

```sh
cd worker
npm ci
npx wrangler login
```

A browser tab asks you to allow Wrangler. If Cloudflare hasn't asked you for a `workers.dev` subdomain yet, pick one in
the dashboard under Workers & Pages first.

## 2. Deploy the Worker once

```sh
npx wrangler deploy
```

It prints the Worker's address, like `https://gym-tracker-push.<your-subdomain>.workers.dev`. Copy that for step 3.

## 3. Make the keys and store the private one (it is never shown)

```sh
npm run setup-keys -- https://gym-tracker-push.<your-subdomain>.workers.dev
```

This one command:

- runs `npx @pushforge/builder vapid` and captures its output, so nothing is printed;
- pipes the private key straight into `npx wrangler secret put VAPID_PRIVATE_JWK`; it never reaches the screen, a
  file or the clipboard;
- writes the Worker address and the **public** key into `src/push/config.ts`, and prints the public key.

The public key isn't secret: it goes in the app. Never paste the private key anywhere. If anything fails, nothing is
written and you can run it again.

## 4. Let GitHub deploy Worker changes (optional, recommended)

So that later Worker changes deploy on their own when they reach `main`:

1. In the Cloudflare dashboard: My Profile → API Tokens → Create Token → the **Edit Cloudflare Workers** template →
   Create. Copy the token.
2. Your account ID is on the Workers & Pages overview page, in the right-hand column.
3. In GitHub: the repo → Settings → Secrets and variables → Actions → New repository secret, twice:
   `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID` (the account ID).

Until both exist, `.github/workflows/worker.yml` still tests the Worker but skips the deploy, and passes.
Without them you can always deploy by hand with `npx wrangler deploy` from this folder.

## 5. Turn it on in the app

```sh
cd ..
git add src/push/config.ts
git commit -m "Push: Worker URL and public key"
git push
```

Once the site has redeployed, open Gym Tracker **from the Home Screen icon** (push only works there on iPhone), go to
More → Notifications → **Turn on notifications**, allow them, then tap **Send test notification**.

## 6. Limit alerts by email (optional)

When someone runs into one of the app's limits (5 posts a day, 20 reports, 300 social actions, 30 messages an hour to one
friend, or the whole app's 2,000 a day), the Worker pushes to the owner's phone. With these two secrets it also emails you,
at most once a day per person and limit. It uses Resend's free plan (3,000 emails a month, 100 a day).

1. Sign up at resend.com **with the email address the alerts should go to** (until you verify a domain there, Resend's
   test sender only delivers to your own account's address).
2. In Resend: API Keys → Create API Key → permission **Sending access** → Create. Copy it once; don't paste it anywhere else.
3. From this `worker/` folder (each command asks for the value and never shows it):

   ```sh
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put ALERT_EMAIL
   ```

   `ALERT_EMAIL` is that same address. It's a secret only so it stays out of this public repo.

Without them the pushes still go; only the email is skipped. To stop the emails, `npx wrangler secret delete ALERT_EMAIL`.

The Worker also checks the app's counter for the day every 15 minutes (a cron trigger: the free plan allows five), so you hear
when the app is full even if whoever filled it never opened the app.

## Checks on the iPhone (only the phone can confirm these)

- The test notification shows with the app open, in the background, and with the phone locked.
- Tapping it opens the app on Today.
- A rest timer that ends with the phone locked shows "Rest done"; with the app on screen, no notification comes.
- More → Notifications → Diagnostics shows "Last notification received" and the last send's status (201 is good).

## Good to know

- **Changing keys** (`npm run setup-keys -- --rotate`) means every phone has to turn notifications on again.
- **Logs**: Cloudflare dashboard → the Worker → Logs. They carry only the kind of push, its status and timing.
- **What's stored on Cloudflare**: each phone's push subscription, the notification settings, the time zone, the next
  rest label (like "Bench Press · set 4 next"), the last day something was logged, the next program day's name and this
  week's session, set and PR counts. No other part of the log. For friends' pushes: per friend who pushed you, when
  they last did and how many this hour, the ids of the last 200 things pushed (so a repeat sends nothing), the
  app icon's unread count, and the ids of friends you muted. Never a message's words: the Worker reads them from
  Firestore to send the push and keeps nothing of them.
- **Friends' pushes are checked in Firestore** with the sender's own sign-in, against `firestore.rules`: the Worker
  only reads what the sender could. Deploy the rules (`npx firebase deploy --only firestore:rules`) before the app.
- **No service-account key** is used or needed: the Worker only checks each caller's own Firebase sign-in.
- **Local testing**: `npm test` here; the app-to-Worker run is `npx playwright test -c playwright.push.config.ts` from the
  repo root, with the Firebase emulators running. Both make throwaway keys in memory.
