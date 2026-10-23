import type { UserBox } from './userbox';

export interface Env {
  USERS: DurableObjectNamespace<UserBox>;
  LIMIT: RateLimit;
  /** Per account, on /notify alone: 10 a minute. */
  NOTIFY_LIMIT: RateLimit;
  FIREBASE_PROJECT: string;
  APP_ORIGIN: string;
  APP_URL: string;
  VAPID_SUBJECT: string;
  AUTH_EMULATOR: string;
  /** Local mode only: the Firestore emulator (http://127.0.0.1:8080). Otherwise Firestore itself. */
  FIRESTORE_EMULATOR?: string;
  /** Secrets (r28): Resend's API key and the owner's address for limit alerts (email.ts). Unset, no email. */
  RESEND_API_KEY?: string;
  ALERT_EMAIL?: string;
  /** Secret: the VAPID private key as a JWK. Unset, nothing is sent. */
  VAPID_PRIVATE_JWK?: string;
}

/** Local mode (wrangler dev against the Firebase emulators): set only by .dev.vars, and only for the demo project. */
export const localMode = (env: Pick<Env, 'AUTH_EMULATOR' | 'FIREBASE_PROJECT'>) => env.AUTH_EMULATOR === '1' && env.FIREBASE_PROJECT === 'demo-gym-tracker';
