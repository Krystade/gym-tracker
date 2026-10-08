/** Usernames: 3–20 lowercase letters, digits or `_` (firestore.rules checks the same). */
export const USERNAME = /^[a-z0-9_]{3,20}$/;
export const cleanUsername = (s: string) => s.trim().toLowerCase().replace(/^@/, '');

export interface Invite { uid: string; token: string }
/** `…#invite=<uid>.<token>`; the whole link, or just the part after `invite=`, as pasted. */
export function parseInvite(text: string): Invite | null {
  const m = /(?:^|[#&\s]invite=|^\s*)([A-Za-z0-9]{6,128})\.([a-f0-9]{32})\s*$/.exec(text.trim());
  return m ? { uid: m[1], token: m[2] } : null;
}
export const inviteUrl = (base: string, i: Invite) => `${base.replace(/#.*$/, '')}#invite=${i.uid}.${i.token}`;
export function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
