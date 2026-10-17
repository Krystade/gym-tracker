// Where push notifications come from. Both empty: no notification controls show and the app never calls the Worker.
// worker/SETUP.md fills these in (`npm run setup-keys` in worker/ writes them); neither is a secret.
// The __PUSH_TEST_*__ values are empty in every normal build; only the local push e2e build sets them (vite.config.ts).

/** The Worker's URL, e.g. https://gym-tracker-push.<subdomain>.workers.dev (no trailing slash). */
export const WORKER_URL: string = __PUSH_TEST_WORKER_URL__ || '';
/** The VAPID public key: the uncompressed P-256 point, base64url. */
export const VAPID_PUBLIC_KEY: string = __PUSH_TEST_VAPID_KEY__ || '';

export const PUSH_ON = WORKER_URL !== '' && VAPID_PUBLIC_KEY !== '';
