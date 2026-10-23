import type { Env } from './env';
import { net } from './net';

// The owner's alert emails (r28: a limit reached), through Resend's free plan (3,000 a month, 100 a day). Two Worker secrets,
// both set by the owner (SETUP.md, "Limit alerts by email"): RESEND_API_KEY, and ALERT_EMAIL, the address it goes to, which is
// a secret only so it stays out of this public repo. Without either, nothing is sent. Sent from Resend's own test address,
// which delivers only to the Resend account's own email: ALERT_EMAIL must be that address (or verify a domain in Resend).

export const RESEND_URL = 'https://api.resend.com/emails';
const FROM = 'Gym Tracker <onboarding@resend.dev>';

/** One alert email; its status (0: not configured or unreachable). Nothing about it is logged but the status. */
export async function alertEmail(env: Pick<Env, 'RESEND_API_KEY' | 'ALERT_EMAIL' | 'APP_URL'>, note: { title: string; body: string }): Promise<number> {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL) return 0;
  try {
    const r = await net.fetch(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [env.ALERT_EMAIL], subject: `Gym Tracker: ${note.title}`, text: `${note.body}\n\nBoard review: ${env.APP_URL}#open=review` }),
    });
    await r.body?.cancel();
    console.log(JSON.stringify({ email: r.status }));
    return r.status;
  } catch { return 0; }
}
