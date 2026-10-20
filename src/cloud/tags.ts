import { cleanTag } from '../domain/friendNames';
import type { Cloud } from './firebase';

/**
 * Your private tags for friends ("Sam (gym)"), by their uid, so a tag survives their changes of name. One document only you
 * can read (firestore.rules, match /private): your synced settings, never your friends'.
 */
export const tagsPath = (uid: string) => `users/${uid}/private/tags`;
export type Tags = Record<string, string>;

const asTags = (x: unknown): Tags =>
  Object.fromEntries(Object.entries(x && typeof x === 'object' ? x : {}).filter((e): e is [string, string] => typeof e[1] === 'string' && !!e[1]));

export async function readTags({ F, db }: Cloud, me: string): Promise<Tags> {
  return asTags((await F.getDoc(F.doc(db, tagsPath(me)))).data()?.tags);
}
/** One friend's tag, set or (empty) removed, over what the account holds: another phone's tags for other friends stay. */
export async function saveTag({ F, db }: Cloud, me: string, friend: string, tag: string): Promise<Tags> {
  const t = cleanTag(tag);
  let out: Tags = {};
  await F.runTransaction(db, async (tx) => {
    const ref = F.doc(db, tagsPath(me));
    const { [friend]: _old, ...rest } = asTags((await tx.get(ref)).data()?.tags);
    out = t ? { ...rest, [friend]: t } : rest;
    tx.set(ref, { tags: out, updatedAt: Date.now() });
  });
  return out;
}
