import { AuthError, verifyIdToken } from './auth';
import { allowedOrigin, withCors } from './cors';
import { localMode, type Env } from './env';
import * as v from './validate';

export { UserBox } from './userbox';

// The Worker only answers CORS, checks the Firebase ID token, applies the rate limit and hands the call to the account's
// Durable Object. Routes are the app's: see src/push/client.ts.

class Http extends Error { constructor(readonly status: number, message: string) { super(message); } }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const MAX_BODY = 4096;

async function body(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new Http(413, 'too large');
  try { return JSON.parse(text); } catch { throw new Http(400, 'json'); }
}

async function handle(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url);
  const token = /^Bearer\s+(\S+)$/.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!token) throw new Http(401, 'no token');
  const uid = await verifyIdToken(token, env).catch((e) => { throw e instanceof AuthError ? new Http(401, 'token') : e; });
  // Fail closed: a limiter that can't answer means no.
  const { success } = await env.LIMIT.limit({ key: uid }).catch(() => ({ success: false }));
  if (!success) throw new Http(429, 'slow down');
  const box = env.USERS.get(env.USERS.idFromName(uid));
  const route = `${req.method} ${pathname.replace(/\/[0-9a-f]{16}$/, '/:id')}`;
  switch (route) {
    case 'POST /subscribe': return json({ id: await box.subscribe(v.subscription(await body(req), localMode(env))) });
    case 'DELETE /subscribe/:id': await box.unsubscribe(pathname.slice(-16)); return json({ ok: true });
    case 'PUT /prefs': await box.setPrefs(v.prefs(await body(req))); return json({ ok: true });
    case 'POST /timer': {
      const t = v.timer(await body(req));
      if (!(await box.setTimer(t.sub, t.seconds, t.label))) throw new Http(404, 'device');
      return json({ ok: true });
    }
    case 'DELETE /timer': await box.cancelTimer(); return json({ ok: true });
    case 'POST /activity': await box.activity(v.activity(await body(req))); return json({ ok: true });
    case 'POST /test': {
      const status = await box.sendTest(v.deviceId((await body(req) as { sub?: unknown })?.sub));
      if (status == null) throw new Http(404, 'device');
      return json({ status });
    }
    case 'GET /status': return json(await box.status());
    default: throw new Http(404, 'route');
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = allowedOrigin(req.headers.get('origin'), env);
    if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), origin, true);
    let res: Response;
    try {
      res = await handle(req, env);
    } catch (e) {
      if (e instanceof Http) res = json({ error: e.message }, e.status);
      else if (e instanceof v.BadRequest) res = json({ error: e.message }, 400);
      else { console.log(JSON.stringify({ error: (e as Error)?.name ?? 'error' })); res = json({ error: 'internal' }, 500); }
    }
    return withCors(res, origin);
  },
} satisfies ExportedHandler<Env>;
