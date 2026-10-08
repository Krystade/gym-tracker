import { defineConfig, devices } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** The environment with a JDK first on the path: JAVA_HOME's, else the newest Temurin install on Windows. */
function withJava(): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] != null));
  const base = 'C:/Program Files/Eclipse Adoptium';
  const home = env.JAVA_HOME ?? (existsSync(base) ? path.join(base, readdirSync(base).filter((d) => d.startsWith('jdk-')).sort().at(-1) ?? '') : '');
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'; // Windows spells it Path
  if (home) env[key] = `${path.join(home, 'bin')}${path.delimiter}${env[key] ?? ''}`;
  return env;
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  // The device profile's 375×629 is Safari-with-toolbars; the installed app gets the full 375×812.
  use: { ...devices['iPhone 13 Mini'], viewport: { width: 375, height: 812 }, baseURL: 'http://127.0.0.1:4173/',
    // Every spec but e2e/walkthrough starts on a phone that has already seen the walkthrough.
    storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:4173', localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } },
  webServer: [
    { command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173/', reuseExistingServer: false, timeout: 180_000 },
    // The app talks to these when served from 127.0.0.1 (src/cloud/firebase.ts); they need Java 21 on PATH or JAVA_HOME.
    { command: 'node node_modules/firebase-tools/lib/bin/firebase.js emulators:start --only auth,firestore --project demo-gym-tracker', url: 'http://127.0.0.1:8080/', reuseExistingServer: false, timeout: 180_000, env: withJava() },
  ],
});
