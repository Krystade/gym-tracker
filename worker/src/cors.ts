import { localMode, type Env } from './env';

/** The caller's origin if it may call: exactly the app's origin, plus 127.0.0.1 on any port in local mode. */
export function allowedOrigin(origin: string | null, env: Pick<Env, 'APP_ORIGIN' | 'AUTH_EMULATOR' | 'FIREBASE_PROJECT'>): string | null {
  if (!origin) return null;
  if (origin === env.APP_ORIGIN) return origin;
  if (localMode(env) && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(origin)) return origin;
  return null;
}

/** Adds CORS headers for an allowed origin; every response varies by Origin either way. */
export function withCors(res: Response, origin: string | null, preflight = false): Response {
  const r = new Response(res.body, res);
  r.headers.append('Vary', 'Origin');
  if (origin) {
    r.headers.set('Access-Control-Allow-Origin', origin);
    if (preflight) {
      r.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      r.headers.set('Access-Control-Allow-Headers', 'authorization, content-type');
      r.headers.set('Access-Control-Max-Age', '7200');
    }
  }
  return r;
}
