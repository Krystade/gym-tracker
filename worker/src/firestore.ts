import { localMode, type Env } from './env';
import { net } from './net';

// Firestore's REST API, called with the caller's own ID token: Firestore evaluates firestore.rules for it exactly as it
// does for the app, so the Worker can only read what that person could. There is no service account anywhere.

export class FirestoreError extends Error {}

/** A document as read: its fields in plain values, and `createTime`, which Firestore sets (no phone's clock can fake it). */
export interface Doc { fields: Record<string, unknown>; createTime: number }

const base = (env: Pick<Env, 'AUTH_EMULATOR' | 'FIREBASE_PROJECT' | 'FIRESTORE_EMULATOR'>) =>
  `${localMode(env) && env.FIRESTORE_EMULATOR ? env.FIRESTORE_EMULATOR.replace(/\/$/, '') : 'https://firestore.googleapis.com'}/v1/projects/${env.FIREBASE_PROJECT}/databases/(default)/documents`;

/** Firestore's typed values, flattened: strings, numbers, booleans, timestamps (ms), maps and arrays. */
function plain(v: Record<string, unknown> | undefined): unknown {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return Date.parse(String(v.timestampValue));
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return fields((v.mapValue as { fields?: Record<string, Record<string, unknown>> }).fields);
  if ('arrayValue' in v) return ((v.arrayValue as { values?: Record<string, unknown>[] }).values ?? []).map(plain);
  return undefined;
}
const fields = (f: Record<string, Record<string, unknown>> | undefined) => Object.fromEntries(Object.entries(f ?? {}).map(([k, v]) => [k, plain(v)]));

/** Path segments are ids the Worker has already checked; encoded anyway. */
const path = (segments: string[]) => segments.map(encodeURIComponent).join('/');

/**
 * One document, read as the caller. A Doc when it exists and they may read it; null when it doesn't exist but they
 * may (404); 'denied' when the rules refuse them (403). Anything else is a FirestoreError.
 */
export async function getDoc(env: Pick<Env, 'AUTH_EMULATOR' | 'FIREBASE_PROJECT' | 'FIRESTORE_EMULATOR'>, token: string, segments: string[]): Promise<Doc | null | 'denied'> {
  let r: Response;
  try {
    r = await net.fetch(`${base(env)}/${path(segments)}`, { headers: { authorization: `Bearer ${token}` } });
  } catch { throw new FirestoreError('unreachable'); }
  if (r.status === 404) { await r.body?.cancel(); return null; }
  if (r.status === 403) { await r.body?.cancel(); return 'denied'; }
  if (!r.ok) { await r.body?.cancel(); throw new FirestoreError(`firestore ${r.status}`); }
  const d = (await r.json()) as { fields?: Record<string, Record<string, unknown>>; createTime?: string };
  const createTime = Date.parse(d.createTime ?? '');
  if (!Number.isFinite(createTime)) throw new FirestoreError('no createTime');
  return { fields: fields(d.fields), createTime };
}

/** The Firestore URL a document is read from, for tests that stand in for it. */
export const docUrl = (env: Pick<Env, 'AUTH_EMULATOR' | 'FIREBASE_PROJECT' | 'FIRESTORE_EMULATOR'>, segments: string[]) => `${base(env)}/${path(segments)}`;
