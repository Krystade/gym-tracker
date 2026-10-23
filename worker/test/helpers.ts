import { OWNERS } from '../../src/cloud/owner';
import { decodeJwt, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
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
/** Replaces the network: Google's keys from `jwks`, Firestore from `world`, and every push recorded and answered with `status(url)`. */
export function fakeNet(jwks: unknown, status: (url: string) => number = () => 201, world: World = new World()) {
  forgetKeys();
  const sent: Sent[] = [];
  let keyFetches = 0;
  net.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === JWKS_URL) { keyFetches++; return new Response(JSON.stringify(jwks), { headers: { 'cache-control': 'public, max-age=3600' } }); }
    if (url.startsWith(FIRESTORE)) return world.get(decodeURIComponent(url.slice(FIRESTORE.length)), new Headers(init?.headers).get('authorization'));
    sent.push({ url, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? new TextEncoder().encode(init.body) : new Uint8Array(init?.body as ArrayBuffer) });
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

export const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/`;

/** Firestore's typed JSON for a plain value. */
function typed(v: unknown): Record<string, unknown> {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v === null) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(typed) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, typed(x)])) } };
}

/**
 * A stand-in for Firestore behind the REST API, answering reads the way firestore.rules would for the paths the Worker
 * reads: anyone signed in reads a profile; meta only the owner's friends; requests their two people; friends only
 * the owner; a gym in an inbox only the person who sent it (or the owner). The caller is the token's `sub`.
 */
export class World {
  docs = new Map<string, { fields: Record<string, unknown>; createTime: number }>();
  reads: { path: string; uid: string }[] = [];
  /** As if the rules let anyone signed in read a gym or message sent to someone: the Worker's own checks must hold alone. */
  loose = false;
  put(path: string, fields: Record<string, unknown> = {}, createTime = Date.now()) { this.docs.set(path, { fields, createTime }); return this; }
  friends(a: string, b: string, createTime = Date.now()) { return this.put(`users/${a}/friends/${b}`, { since: 1 }, createTime).put(`users/${b}/friends/${a}`, { since: 1 }, createTime); }
  private may(path: string, uid: string) {
    const [top, owner, coll, id] = path.split('/');
    // A report on a board post (social S4): its reporter, or one of the app's owners.
    if (top === 'board') return coll === 'reports' && (id === uid || OWNERS.includes(uid));
    // Your counters are yours alone (r28); the app's counter for the day is anyone's, signed in or not.
    if (top === 'boardRate' || top === 'reportRate' || top === 'socialRate') return owner === uid;
    if (!coll) return true;
    if (uid === owner) return true;
    if (coll === 'meta' || coll === 'months') return this.docs.has(`users/${owner}/friends/${uid}`);
    if (coll === 'requests') return id === uid;
    if (coll === 'gymInbox' || coll === 'inbox') return this.loose || this.docs.get(path)?.fields.from === uid; // a missing one: no resource, refused
    return false;
  }
  get(path: string, authorization: string | null): Response {
    const uid = authorization ? (decodeJwt(authorization.replace(/^Bearer /, '')).sub ?? '') : '';
    this.reads.push({ path, uid });
    if (!path.startsWith('limits/') && (!uid || !this.may(path, uid))) return Response.json({ error: { code: 403 } }, { status: 403 });
    const d = this.docs.get(path);
    if (!d) return Response.json({ error: { code: 404 } }, { status: 404 });
    return Response.json({ name: path, fields: typed(d.fields).mapValue && (typed(d.fields).mapValue as { fields: unknown }).fields, createTime: new Date(d.createTime).toISOString(), updateTime: new Date(d.createTime).toISOString() });
  }
}
