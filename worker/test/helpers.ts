import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { JWKS_URL, forgetKeys } from '../src/auth';
import { net } from '../src/net';

export const b64u = (b: Uint8Array | ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export const PROJECT = 'krystade-gym-tracker';
export const ISS = `https://securetoken.google.com/${PROJECT}`;

/** A stand-in for Google's token signing key, and its public half as Google publishes it. */
export async function signer(kid = 'test-key') {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  const now = Math.floor(Date.now() / 1000);
  return {
    jwks: { keys: [jwk] },
    token: (claims: JWTPayload = {}, header: Record<string, unknown> = {}) => new SignJWT({ aud: PROJECT, iss: ISS, sub: 'uid-a', iat: now - 10, auth_time: now - 100, exp: now + 3600, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid, ...header }).sign(privateKey),
  };
}
/** An unsigned token, as the Auth emulator makes them. */
export function unsigned(claims: JWTPayload) {
  const enc = (o: object) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(claims)}.`;
}

export interface Sent { url: string; headers: Headers; body: Uint8Array }
/** Replaces the network: Google's keys from `jwks`, and every push recorded and answered with `status(url)`. */
export function fakeNet(jwks: unknown, status: (url: string) => number = () => 201) {
  forgetKeys();
  const sent: Sent[] = [];
  let keyFetches = 0;
  net.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === JWKS_URL) { keyFetches++; return new Response(JSON.stringify(jwks), { headers: { 'cache-control': 'public, max-age=3600' } }); }
    sent.push({ url, headers: new Headers(init?.headers), body: new Uint8Array(init?.body as ArrayBuffer) });
    return new Response(null, { status: status(url) });
  };
  return { sent, keyFetches: () => keyFetches };
}

/** A browser's push subscription: its keys, and a way to read what was pushed to it. */
export async function subscriber(endpoint = `https://web.push.apple.com/QG${crypto.randomUUID().replace(/-/g, '')}`) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint, keys: { p256dh: b64u(pub), auth: b64u(auth) },
    read: async (body: Uint8Array) => JSON.parse(new TextDecoder().decode(await decrypt(body, pair.privateKey, pub, auth))),
  };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array | ArrayBuffer, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}
const cat = (...xs: Uint8Array[]) => { const o = new Uint8Array(xs.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of xs) { o.set(x, i); i += x.length; } return o; };
const ascii = (s: string) => new TextEncoder().encode(s);

/** RFC 8291 decryption, written from the RFC (checked against its §5 example in crypto.test.ts), independent of the sender's library. */
export async function decrypt(body: Uint8Array, uaPrivate: CryptoKey, uaPublic: Uint8Array, authSecret: Uint8Array): Promise<Uint8Array> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // workers-types spells the ECDH member `$public`; the runtime, like the spec, reads `public`.
  const ecdh = await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, uaPrivate, 256);
  const ikm = await hkdf(authSecret, ecdh, cat(ascii('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, ascii('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, ascii('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext));
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (padded[end] !== 2) throw new Error('no last-record delimiter');
  return padded.slice(0, end);
}

/** Imports a receiver's private key from its base64url `d` and uncompressed public point. */
export async function receiverKey(d: string, pub: Uint8Array) {
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)) }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}
