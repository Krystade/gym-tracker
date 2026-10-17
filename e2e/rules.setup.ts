import { readFileSync } from 'node:fs';
import type { FullConfig } from '@playwright/test';

/**
 * With emulators already running (E2E_EMULATORS=external, and always for the push run), the Firestore emulator holds
 * whatever rules it started with, maybe another branch's. Load this worktree's, so the suite tests the rules that ship.
 * An emulator this suite starts reads them from firebase.json itself.
 */
export default async function loadRules(config: FullConfig) {
  const push = 'worker' in config.metadata; // playwright.push.config.ts: always against running emulators
  if (process.env.E2E_EMULATORS !== 'external' && !push) return;
  const content = readFileSync('firestore.rules', 'utf8');
  const res = await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-gym-tracker:securityRules', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
  });
  if (!res.ok) throw new Error(`Loading firestore.rules into the emulator failed: ${res.status} ${await res.text()}`);
}
