import { defineConfig, devices } from '@playwright/test';
import { generateKeyPairSync } from 'node:crypto';

// The local push run: the app built against `wrangler dev` (local mode, accepting the Auth emulator's tokens), a fake
// push service in the spec, and Chromium (CDP delivers the push to the service worker). The Auth and Firestore emulators
// must already be running (as with E2E_EMULATORS=external). Run: npx playwright test -c playwright.push.config.ts
//
// The VAPID key is a throwaway made for this run, held in memory and handed to the two servers through their environment.
const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]).toString('base64url');

const appPort = Number(process.env.PUSH_E2E_PORT ?? 4188);
const workerPort = appPort + 1;
const app = `http://127.0.0.1:${appPort}`;
const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] != null));

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.push.ts',
  globalSetup: './e2e/rules.setup.ts', // this worktree's firestore.rules into the running emulator
  reporter: 'list',
  workers: 1,
  use: {
    ...devices['Desktop Chrome'], browserName: 'chromium', viewport: { width: 375, height: 812 }, baseURL: `${app}/`,
    storageState: { cookies: [], origins: [{ origin: app, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] },
  },
  metadata: { worker: `http://127.0.0.1:${workerPort}` },
  webServer: [
    {
      command: `node node_modules/vite/bin/vite.js build --outDir dist-push --emptyOutDir && node node_modules/vite/bin/vite.js preview --outDir dist-push --host 127.0.0.1 --port ${appPort} --strictPort`,
      url: `${app}/`, reuseExistingServer: false, timeout: 180_000,
      env: { ...env, PUSH_TEST_WORKER_URL: `http://127.0.0.1:${workerPort}`, PUSH_TEST_VAPID_KEY: pub },
    },
    {
      command: `node node_modules/wrangler/bin/wrangler.js dev --ip 127.0.0.1 --port ${workerPort} --show-interactive-dev-session=false`,
      cwd: 'worker', url: `http://127.0.0.1:${workerPort}/status`, reuseExistingServer: false, timeout: 180_000,
      // Local mode: the demo project and the emulator's unsigned tokens. Taken from the environment, not a file.
      env: { ...env, CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true', WRANGLER_SEND_METRICS: 'false', AUTH_EMULATOR: '1', FIREBASE_PROJECT: 'demo-gym-tracker', FIRESTORE_EMULATOR: 'http://127.0.0.1:8080', APP_URL: `${app}/`, VAPID_PRIVATE_JWK: JSON.stringify(jwk) },
    },
  ],
});
