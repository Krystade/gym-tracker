import { createLocalJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import { localMode, type Env } from './env';
import { net } from './net';

// Firebase ID tokens, checked the way Firebase's docs say to without the Admin SDK: RS256 against Google's published keys,
// audience = the project, issuer = securetoken.google.com/<project>, a non-empty subject, and auth_time in the past.

export const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
export class AuthError extends Error {}

let jwks: { set: ReturnType<typeof createLocalJWKSet>; until: number } | null = null;
/** For tests: forget the cached keys. */
export const forgetKeys = () => { jwks = null; };

async function keys(now: number) {
  if (jwks && jwks.until > now) return jwks.set;
  const r = await net.fetch(JWKS_URL);
  if (!r.ok) throw new AuthError(`keys ${r.status}`);
  const age = Number(/max-age=(\d+)/.exec(r.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  jwks = { set: createLocalJWKSet((await r.json()) as JSONWebKeySet), until: now + Math.min(age, 6 * 3600) * 1000 };
  return jwks.set;
}

const SKEW = 60; // seconds of clock difference forgiven

/** The account's uid, or an AuthError. */
export async function verifyIdToken(token: string, env: Pick<Env, 'AUTH_EMULATOR' | 'FIREBASE_PROJECT'>, now = Date.now()): Promise<string> {
  const project = env.FIREBASE_PROJECT;
  const issuer = `https://securetoken.google.com/${project}`;
  let claims: JWTPayload;
  try {
    if (localMode(env)) {
      // The Auth emulator signs nothing (alg "none"). Accepted only here, never for the real project.
      if (decodeProtectedHeader(token).alg !== 'none') throw new AuthError('alg');
      claims = decodeJwt(token);
      if (claims.aud !== project || claims.iss !== issuer || typeof claims.exp !== 'number' || claims.exp * 1000 < now - SKEW * 1000) throw new AuthError('claims');
    } else {
      const opts = { algorithms: ['RS256'], audience: project, issuer, currentDate: new Date(now), clockTolerance: SKEW };
      try {
        claims = (await jwtVerify(token, await keys(now), opts)).payload;
      } catch (e) {
        // Google rotates its keys: a kid we haven't seen means fetch them again, once.
        if ((e as { code?: string }).code !== 'ERR_JWKS_NO_MATCHING_KEY') throw e;
        jwks = null;
        claims = (await jwtVerify(token, await keys(now), opts)).payload;
      }
    }
  } catch (e) {
    throw e instanceof AuthError ? e : new AuthError((e as { code?: string }).code ?? 'invalid');
  }
  const sec = now / 1000 + SKEW;
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw new AuthError('sub');
  if (typeof claims.auth_time !== 'number' || claims.auth_time > sec) throw new AuthError('auth_time');
  if (typeof claims.iat !== 'number' || claims.iat > sec) throw new AuthError('iat');
  return claims.sub;
}
