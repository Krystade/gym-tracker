import type { UserBox } from './userbox';

export interface Env {
  USERS: DurableObjectNamespace<UserBox>;
  LIMIT: RateLimit;
  FIREBASE_PROJECT: string;
  APP_ORIGIN: string;
  APP_URL: string;
  VAPID_SUBJECT: string;
  AUTH_EMULATOR: string;
  /** Secret: the VAPID private key as a JWK. Unset, nothing is sent. */
  VAPID_PRIVATE_JWK?: string;
}

/** Local mode (wrangler dev against the Firebase emulators): set only by .dev.vars, and only for the demo project. */
export const localMode = (env: Pick<Env, 'AUTH_EMULATOR' | 'FIREBASE_PROJECT'>) => env.AUTH_EMULATOR === '1' && env.FIREBASE_PROJECT === 'demo-gym-tracker';
