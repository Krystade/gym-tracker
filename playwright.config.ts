import { defineConfig, devices } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EMU_HOST, EMU_PROJECT, emu } from './e2e/emu';

// Run a suite in isolation (its own build, server and emulators, so other worktrees' suites can't slow it or swap its rules):
//   E2E_EMU_BASE=9300 E2E_PORT=4890 npx playwright test
// E2E_EMU_BASE puts this suite's Firestore on 9300, Auth on 9301 and the emulator hub, logging and websocket on 9302-9304;
// pick a base and an E2E_PORT no other running suite uses. The app is built for those ports into .e2e/dist-<E2E_PORT>,
// and the emulators load this worktree's firestore.rules; both stop when the run ends.
// Without E2E_EMU_BASE: the suite previews dist/ (npm run build first) against 8080/9099, starting the emulators itself, or
// with E2E_EMULATORS=external using the ones already running there (shared, and given this worktree's rules first).

/** The environment with a JDK first on the path: JAVA_HOME's, else the newest Temurin install on Windows. */
function withJava(): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] != null));
  const base = 'C:/Program Files/Eclipse Adoptium';
  const home = env.JAVA_HOME ?? (existsSync(base) ? path.join(base, readdirSync(base).filter((d) => d.startsWith('jdk-')).sort().at(-1) ?? '') : '');
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'; // Windows spells it Path
  if (home) env[key] = `${path.join(home, 'bin')}${path.delimiter}${env[key] ?? ''}`;
  return env;
}

const port = Number(process.env.E2E_PORT ?? 4173);
const origin = `http://127.0.0.1:${port}`;
const firebase = 'node node_modules/firebase-tools/lib/bin/firebase.js';
const external = process.env.E2E_EMULATORS === 'external';

/** E2E_EMU_BASE: a firebase.json of this suite's own ports and this worktree's rules, and a scratch dir for the hub's locator file. */
function privateEmulators() {
  const dir = path.resolve('.e2e', `emu-${emu.base}`);
  mkdirSync(path.join(dir, 'tmp'), { recursive: true });
  const config = path.join(dir, 'firebase.json');
  writeFileSync(config, JSON.stringify({
    firestore: { rules: path.resolve('firestore.rules') },
    emulators: {
      auth: { host: EMU_HOST, port: emu.auth },
      firestore: { host: EMU_HOST, port: emu.firestore, websocketPort: emu.websocket },
      hub: { host: EMU_HOST, port: emu.hub },
      logging: { host: EMU_HOST, port: emu.logging },
      ui: { enabled: false },
      singleProjectMode: true,
    },
  }, null, 2));
  // The hub writes hub-<project>.json to the temp dir; a private one keeps it from overwriting the shared emulators'.
  const tmp = path.join(dir, 'tmp');
  return { config, env: { ...withJava(), TEMP: tmp, TMP: tmp } };
}
const own = emu.base != null && !external ? privateEmulators() : null;

const emulators = external ? [] : [
  // The app talks to these when served from 127.0.0.1 (src/cloud/firebase.ts); they need Java 21 on PATH or JAVA_HOME.
  // Ready when Auth answers: it starts after the hub and Firestore.
  own
    ? { command: `${firebase} emulators:start --only auth,firestore --project ${EMU_PROJECT} --config "${own.config}"`, url: `http://${EMU_HOST}:${emu.auth}/`, reuseExistingServer: false, timeout: 180_000, env: own.env }
    : { command: `${firebase} emulators:start --only auth,firestore --project ${EMU_PROJECT}`, url: 'http://127.0.0.1:8080/', reuseExistingServer: false, timeout: 180_000, env: withJava() },
];

// The app: dist/ as built, or with E2E_EMU_BASE a build of its own that talks to this suite's emulator ports.
const vite = 'node node_modules/vite/bin/vite.js';
const preview = (outDir: string) => `${vite} preview --outDir ${outDir} --host 127.0.0.1 --port ${port} --strictPort`;
const out = `.e2e/dist-${port}`;
const app = emu.base == null
  ? { command: preview('dist'), url: `${origin}/`, reuseExistingServer: false, timeout: 180_000 }
  : { command: `${vite} build --outDir ${out} --emptyOutDir && ${preview(out)}`, url: `${origin}/`, reuseExistingServer: false, timeout: 300_000,
      env: { VITE_EMU_HOST: EMU_HOST, VITE_EMU_FIRESTORE_PORT: String(emu.firestore), VITE_EMU_AUTH_PORT: String(emu.auth) } };

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  globalSetup: './e2e/rules.setup.ts', // this worktree's firestore.rules into emulators already running
  reporter: 'list',
  // The device profile's 375×629 is Safari-with-toolbars; the installed app gets the full 375×812.
  use: { ...devices['iPhone 13 Mini'], viewport: { width: 375, height: 812 }, baseURL: `${origin}/`,
    // Every spec but e2e/walkthrough starts on a phone that has already seen the walkthrough.
    storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } },
  // Every spec in WebKit (the phone's engine); the layout audit in Chromium too, as the same 13 mini, and guided capture, whose
  // recording only Chromium can make and play back here (WebKit on this machine has no MediaRecorder or video decoding).
  projects: [
    { name: 'webkit' },
    { name: 'chromium', testMatch: /(layout-audit|capture)\.spec\.ts$/, use: { browserName: 'chromium' } },
  ],
  webServer: [app, ...emulators],
});
