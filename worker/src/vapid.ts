import { importJWK, SignJWT } from 'jose';

// VAPID (RFC 8292): each push carries a JWT signed with the server's key, one per push-service origin. Apple asks that it
// not be refreshed more than once an hour and expire within 24 h, so one is signed for 12 h and reused until an hour is left.

export interface VapidKey { jwk: JsonWebKey; /** The public key the app subscribes with: the uncompressed P-256 point, base64url. */ publicKey: string }

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** The private key from the VAPID_PRIVATE_JWK secret (what `npx @pushforge/builder vapid` prints), or null if unset or malformed. */
export function parseVapid(secret: string | undefined): VapidKey | null {
  if (!secret) return null;
  try {
    const jwk = JSON.parse(secret) as JsonWebKey;
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d || !jwk.x || !jwk.y) return null;
    const x = unb64u(jwk.x), y = unb64u(jwk.y);
    if (x.length !== 32 || y.length !== 32) return null;
    return { jwk: { kty: 'EC', crv: 'P-256', d: jwk.d, x: jwk.x, y: jwk.y }, publicKey: b64u(new Uint8Array([4, ...x, ...y])) };
  } catch { return null; }
}

export const VAPID_LIFE = 12 * 3600;
export const RENEW_BEFORE = 3600;

export interface Cached { jwt: string; exp: number; k: string }
export interface KV { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void> }

/** The `Authorization` header for a push to `endpoint`'s origin, from the cache while it has over an hour left. */
export async function vapidAuth(store: KV, key: VapidKey, endpoint: string, subject: string, now: number): Promise<string> {
  const aud = new URL(endpoint).origin;
  const name = `vapid:${aud}`;
  let c = await store.get<Cached>(name);
  if (!c || c.k !== key.publicKey || c.exp * 1000 - now <= RENEW_BEFORE * 1000) {
    const exp = Math.floor(now / 1000) + VAPID_LIFE;
    const jwt = await new SignJWT({ aud, sub: subject, exp }).setProtectedHeader({ typ: 'JWT', alg: 'ES256' }).sign(await importJWK(key.jwk, 'ES256'));
    c = { jwt, exp, k: key.publicKey };
    await store.put(name, c);
  }
  return `vapid t=${c.jwt}, k=${c.k}`;
}
