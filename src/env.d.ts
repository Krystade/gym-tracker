declare const __BUILD_ID__: string;
declare const __BUILT_AT__: string;
/** Set only by the local push e2e build (playwright.push.config.ts); empty otherwise. */
declare const __PUSH_TEST_WORKER_URL__: string;
declare const __PUSH_TEST_VAPID_KEY__: string;

/** Build-time emulator address for e2e builds on private ports (e2e/emu.ts); unset, firebase.json's 127.0.0.1:8080 / 9099. */
interface ImportMetaEnv {
  readonly VITE_EMU_HOST?: string;
  readonly VITE_EMU_AUTH_PORT?: string;
  readonly VITE_EMU_FIRESTORE_PORT?: string;
}
