import { readFileSync } from 'node:fs';
import type { FullConfig } from '@playwright/test';
import { EMU_PROJECT, FIRESTORE, emu } from './emu';

/**
 * With emulators already running (E2E_EMULATORS=external, and always for the push run), the Firestore emulator holds
 * whatever rules it started with, maybe another branch's. Load this worktree's, so the suite tests the rules that ship.
 * Private emulators (E2E_EMU_BASE) start from this worktree's rules too, but get them here as well: if the config's path
 * ever missed, the emulator would allow everything and every rules test would pass. firebase.json's own emulator reads them itself.
 */
export default async function loadRules(config: FullConfig) {
  const push = 'worker' in config.metadata; // playwright.push.config.ts: always against running emulators
  if (process.env.E2E_EMULATORS !== 'external' && emu.base == null && !push) return;
  const content = readFileSync('firestore.rules', 'utf8');
  const res = await fetch(`${FIRESTORE}/emulator/v1/projects/${EMU_PROJECT}:securityRules`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
  });
  if (!res.ok) throw new Error(`Loading firestore.rules into the emulator failed: ${res.status} ${await res.text()}`);
}
