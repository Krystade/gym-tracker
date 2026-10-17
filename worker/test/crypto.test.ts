import { describe, expect, it } from 'vitest';
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { env } from 'cloudflare:workers';
import { buildPayload, DELIVERY, restNote } from '../../src/push/payload';
import { sendOne } from '../src/send';
import { parseVapid, vapidAuth, type KV } from '../src/vapid';
import { decrypt, fakeNet, receiverKey, subscriber, unb64u } from './helpers';

describe('RFC 8291', () => {
  it('the test decryption reads the RFC §5 example', async () => {
    const body = unb64u(`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
      mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
      pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`);
    const pub = unb64u('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4');
    const key = await receiverKey('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94', pub);
    const plain = await decrypt(body, key, pub, unb64u('BTBZMqHH6r4Tts7J_aSIgg'));
    expect(new TextDecoder().decode(plain)).toBe('When I grow up, I want to be a watermelon');
  });

  it('a sent push decrypts with the subscription\'s key, with the headers Apple wants', async () => {
    const net = fakeNet({ keys: [] });
    const sub = await subscriber();
    const payload = buildPayload('rest', restNote('Squat · set 3 next'), 'https://krystade.github.io/gym-tracker/');
    const status = await sendOne({ endpoint: sub.endpoint, ...sub.keys }, payload, DELIVERY.rest, 'vapid t=x, k=y');
    expect(status).toBe(201);
    const [s] = net.sent;
    expect(s.url).toBe(sub.endpoint);
    expect(Object.fromEntries(s.headers)).toMatchObject({ ttl: '60', urgency: 'high', topic: 'rest', 'content-encoding': 'aes128gcm', authorization: 'vapid t=x, k=y' });
    expect(await sub.read(s.body)).toEqual(payload);
  });
});

describe('VAPID', () => {
  const key = parseVapid(env.VAPID_PRIVATE_JWK)!;
  const store = (): KV & { m: Map<string, unknown> } => {
    const m = new Map<string, unknown>();
    return { m, get: async <T>(k: string) => m.get(k) as T | undefined, put: async (k, v) => { m.set(k, v); } };
  };
  const ep = 'https://web.push.apple.com/abc';

  it('signs ES256 for the push service\'s origin, for 12 hours, verifiable with the public key it sends', async () => {
    const now = Date.UTC(2026, 9, 16, 12);
    const h = await vapidAuth(store(), key, ep, 'https://krystade.github.io/gym-tracker/', now);
    const [, t, k] = /^vapid t=([^,]+), k=(\S+)$/.exec(h)!;
    expect(k).toBe(key.publicKey);
    expect(decodeProtectedHeader(t).alg).toBe('ES256');
    expect(decodeJwt(t)).toMatchObject({ aud: 'https://web.push.apple.com', sub: 'https://krystade.github.io/gym-tracker/', exp: now / 1000 + 12 * 3600 });
    const pub = unb64u(k);
    const b = (x: Uint8Array) => btoa(String.fromCharCode(...x)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await jwtVerify(t, await importJWK({ kty: 'EC', crv: 'P-256', x: b(pub.slice(1, 33)), y: b(pub.slice(33)) }, 'ES256'), { currentDate: new Date(now) });
  });

  it('reuses one JWT for sends an hour apart, and renews one with an hour left', async () => {
    const s = store(), t0 = Date.UTC(2026, 9, 16, 12);
    const a = await vapidAuth(s, key, ep, 'x', t0);
    expect(await vapidAuth(s, key, ep, 'x', t0 + 3600_000)).toBe(a);
    expect(await vapidAuth(s, key, ep, 'x', t0 + 10.9 * 3600_000)).toBe(a);
    const renewed = await vapidAuth(s, key, ep, 'x', t0 + 11 * 3600_000);
    expect(renewed).not.toBe(a);
    // Another push service gets its own.
    expect(await vapidAuth(s, key, 'https://fcm.googleapis.com/fcm/send/x', 'x', t0)).not.toBe(a);
  });

  it('reads the key pushforge\'s CLI prints, and nothing malformed', () => {
    expect(key.publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);
    expect(parseVapid(undefined)).toBeNull();
    expect(parseVapid('{"kty":"EC","crv":"P-256"}')).toBeNull();
    expect(parseVapid('not json')).toBeNull();
  });
});
