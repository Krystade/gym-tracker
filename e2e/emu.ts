/**
 * The emulator ports this suite talks to. Unset E2E_EMU_BASE: the shared defaults of firebase.json (Firestore 8080,
 * Auth 9099). E2E_EMU_BASE=9200: a private set, Firestore 9200, Auth 9201, hub 9202, logging 9203, Firestore's
 * websocket 9204, so suites in other worktrees can run beside this one without sharing data or rules.
 */
const raw = process.env.E2E_EMU_BASE;
const base = raw ? Number(raw) : null;
if (base != null && !(Number.isInteger(base) && base >= 1024 && base <= 65530)) throw new Error(`E2E_EMU_BASE must be a port from 1024 to 65530, not "${raw}"`);

export const EMU_HOST = '127.0.0.1';
export const EMU_PROJECT = 'demo-gym-tracker';
export const emu = {
  /** Set when this suite builds against its own emulator ports. */
  base,
  firestore: base ?? 8080,
  auth: base == null ? 9099 : base + 1,
  hub: base == null ? 4400 : base + 2,
  logging: base == null ? 4500 : base + 3,
  websocket: base == null ? 9150 : base + 4,
};
/** The Firestore emulator's origin, and its REST root for this project's documents. */
export const FIRESTORE = `http://${EMU_HOST}:${emu.firestore}`;
export const DOCS = `${FIRESTORE}/v1/projects/${EMU_PROJECT}/databases/(default)/documents`;
