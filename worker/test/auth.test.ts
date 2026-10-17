import { beforeAll, describe, expect, it } from 'vitest';
import { verifyIdToken } from '../src/auth';
import { allowedOrigin, withCors } from '../src/cors';
import { ISS, PROJECT, fakeNet, signer, unsigned } from './helpers';

const prod = { FIREBASE_PROJECT: PROJECT, AUTH_EMULATOR: '', APP_ORIGIN: 'https://krystade.github.io' };
const local = { FIREBASE_PROJECT: 'demo-gym-tracker', AUTH_EMULATOR: '1', APP_ORIGIN: 'https://krystade.github.io' };
const now = () => Math.floor(Date.now() / 1000);

describe('Firebase ID tokens', () => {
  let s: Awaited<ReturnType<typeof signer>>;
  beforeAll(async () => { s = await signer(); });

  it('accepts a good token and returns its uid', async () => {
    fakeNet(s.jwks);
    expect(await verifyIdToken(await s.token(), prod)).toBe('uid-a');
  });

  it('rejects expired, wrong audience, wrong issuer, empty subject, future auth_time, and a key Google never published', async () => {
    fakeNet(s.jwks);
    const bad = [
      await s.token({ exp: now() - 3600, iat: now() - 7200 }),
      await s.token({ aud: 'someone-else' }),
      await s.token({ iss: 'https://securetoken.google.com/someone-else' }),
      await s.token({ sub: '' }),
      await s.token({ auth_time: now() + 3600 }),
      await (await signer()).token(), // signed by another key under the same kid
      'not.a.token',
    ];
    for (const t of bad) await expect(verifyIdToken(t, prod)).rejects.toThrow();
  });

  it('never accepts an unsigned token for the real project, even with the emulator switch on', async () => {
    fakeNet(s.jwks);
    const t = unsigned({ aud: PROJECT, iss: ISS, sub: 'uid-a', iat: now(), auth_time: now(), exp: now() + 3600 });
    await expect(verifyIdToken(t, prod)).rejects.toThrow();
    await expect(verifyIdToken(t, { ...prod, AUTH_EMULATOR: '1' })).rejects.toThrow();
  });

  it('accepts the Auth emulator\'s unsigned tokens only in local mode for the demo project', async () => {
    const claims = { aud: 'demo-gym-tracker', iss: 'https://securetoken.google.com/demo-gym-tracker', sub: 'uid-e', iat: now(), auth_time: now(), exp: now() + 3600 };
    expect(await verifyIdToken(unsigned(claims), local)).toBe('uid-e');
    await expect(verifyIdToken(unsigned(claims), { ...local, AUTH_EMULATOR: '' })).rejects.toThrow();
    await expect(verifyIdToken(unsigned({ ...claims, exp: now() - 3600 }), local)).rejects.toThrow();
    // A signed token isn't what the emulator makes: local mode takes unsigned ones only.
    await expect(verifyIdToken(await s.token({ aud: 'demo-gym-tracker', iss: claims.iss }), local)).rejects.toThrow();
  });

  it('fetches Google\'s keys once, and again for a key it hasn\'t seen', async () => {
    const published = { keys: [...s.jwks.keys] };
    const net = fakeNet(published);
    await verifyIdToken(await s.token(), prod);
    await verifyIdToken(await s.token(), prod);
    expect(net.keyFetches()).toBe(1);
    // Google rotates: a token under the new kid makes it look again, once.
    const other = await signer('rotated');
    published.keys.push(...other.jwks.keys);
    expect(await verifyIdToken(await other.token({ sub: 'uid-b' }), prod)).toBe('uid-b');
    expect(net.keyFetches()).toBe(2);
  });
});

describe('CORS', () => {
  it('allows exactly the app\'s origin', () => {
    expect(allowedOrigin('https://krystade.github.io', prod)).toBe('https://krystade.github.io');
    for (const o of ['https://krystade.github.io.evil.com', 'http://krystade.github.io', 'https://evil.github.io', 'null', 'http://127.0.0.1:4187', null]) expect(allowedOrigin(o, prod)).toBeNull();
    expect(allowedOrigin('http://127.0.0.1:4187', local)).toBe('http://127.0.0.1:4187');
    expect(allowedOrigin('http://127.0.0.1.evil.com:80', local)).toBeNull();
  });

  it('answers a preflight with the methods, headers and max age, and varies by origin', () => {
    const r = withCors(new Response(null, { status: 204 }), 'https://krystade.github.io', true);
    expect(Object.fromEntries(r.headers)).toMatchObject({
      'access-control-allow-origin': 'https://krystade.github.io', 'access-control-allow-methods': 'GET, POST, PUT, DELETE',
      'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '7200', vary: 'Origin',
    });
    const no = withCors(new Response(null, { status: 204 }), null, true);
    expect(no.headers.get('access-control-allow-origin')).toBeNull();
    expect(no.headers.get('vary')).toBe('Origin');
  });
});
