import { encryptNotification } from '@block65/webcrypto-web-push';
import type { Delivery, PushPayload } from '../../src/push/payload';
import { net } from './net';

export interface Target { endpoint: string; p256dh: string; auth: string }

/**
 * One push to one device: the payload encrypted for it (RFC 8291, aes128gcm, which Apple requires), with the VAPID header
 * already made. Returns the push service's status, or 0 when it couldn't be reached.
 */
export async function sendOne(t: Target, payload: PushPayload, d: Delivery, authorization: string): Promise<number> {
  const body = await encryptNotification({ endpoint: t.endpoint, expirationTime: null, keys: { p256dh: t.p256dh, auth: t.auth } },
    new TextEncoder().encode(JSON.stringify(payload)), { pad: false });
  try {
    const r = await net.fetch(t.endpoint, {
      method: 'POST',
      headers: {
        authorization, ttl: String(d.ttl), urgency: d.urgency, topic: d.topic,
        'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream',
      },
      body,
    });
    await r.body?.cancel();
    return r.status;
  } catch { return 0; }
}
