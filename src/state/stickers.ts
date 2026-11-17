import { useEffect, useSyncExternalStore } from 'react';
import { deleteStickerLibraries, getRecentStickers, getStickerLibrary, putRecentStickers, putStickerLibrary } from '../db/db';
import { stickerOk } from '../domain/sticker';
import { keep, stickerId, withFav, type Incoming, type KeptSticker } from '../domain/stickerLibrary';

// Your stickers, per account, kept on the phone (domain/stickerLibrary): in memory once read, every screen showing them told of
// each change, and each change written as it's made. Changes to one account go one after another, so none is lost to another.

interface Kept { lib: KeptSticker[]; removed: string[] }
const mem = new Map<string, Kept>();
const loading = new Map<string, Promise<Kept>>();
const chain = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
/** Thread items already looked at this session (their ids), so a thread read again isn't hashed again. */
const seen = new Map<string, Set<string>>();
let gen = 0; // forgetting bumps it, so a change under way can't bring anything back

function load(uid: string): Promise<Kept> {
  const m = mem.get(uid);
  if (m) return Promise.resolve(m);
  let p = loading.get(uid);
  if (!p) {
    const g = gen;
    p = (async () => {
      const [got, old] = await Promise.all([
        getStickerLibrary(uid).catch(() => ({ lib: [], removed: [] })),
        getRecentStickers().catch(() => [] as string[]),
      ]);
      let k: Kept = got;
      // The recent row from before the library (this profile's last 12 sent): moved in once, in the order it was.
      if (old.length) {
        const now = Date.now();
        const r = keep(k.lib, old.filter(stickerOk).map((src, i) => ({ src, at: now - i, sent: true })), new Set(), true);
        k = { ...k, lib: r.lib };
        if (g === gen) await putStickerLibrary(uid, r.put, r.drop).then(() => putRecentStickers([])).catch(() => {});
      }
      loading.delete(uid);
      if (g !== gen) return { lib: [], removed: [] };
      const kept = mem.get(uid) ?? k;
      mem.set(uid, kept);
      emit();
      return kept;
    })();
    loading.set(uid, p);
  }
  return p;
}

/** One change to an account's stickers, after the ones before it: `f` gives what's kept next and what to write. */
function change<T>(uid: string, f: (k: Kept) => { next: Kept; put: KeptSticker[]; drop: string[]; removed?: boolean; out: T }): Promise<T> {
  const g = gen;
  const run = (chain.get(uid) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const k = await load(uid);
    if (g !== gen) throw new Error('Signed out.');
    const cur = mem.get(uid) ?? k;
    const r = f(cur);
    if (r.next !== cur) { mem.set(uid, r.next); emit(); }
    if (r.put.length || r.drop.length || r.removed) await putStickerLibrary(uid, r.put, r.drop, r.removed ? r.next.removed : undefined);
    return r.out;
  });
  chain.set(uid, run);
  return run;
}

/**
 * Stickers in: sent from this phone or added (`explicit`: one you'd removed comes back), or seen in a thread (one you removed
 * stays out). Only stickers the rules would take are kept.
 */
export function keepStickers(uid: string, add: Incoming[], explicit = false): Promise<void> {
  const ok = add.filter((a) => stickerOk(a.src));
  if (!ok.length) return Promise.resolve();
  return change(uid, (k) => {
    const r = keep(k.lib, ok, new Set(k.removed), explicit);
    const removed = r.revived.length ? k.removed.filter((id) => !r.revived.includes(id)) : k.removed;
    const same = !r.put.length && !r.drop.length && removed === k.removed;
    return { next: same ? k : { lib: r.lib, removed }, put: r.put, drop: r.drop, removed: removed !== k.removed, out: undefined };
  });
}

/** The stickers in a thread or an inbox (each sent or received), kept once each; ones already looked at this session are skipped. */
export function keepFromThread(uid: string, items: readonly { id: string; at: number; sticker?: string }[]): Promise<void> {
  let s = seen.get(uid);
  if (!s) seen.set(uid, (s = new Set()));
  const fresh = items.filter((i) => i.sticker && !s.has(i.id));
  for (const i of fresh) s.add(i.id);
  return keepStickers(uid, fresh.map((i) => ({ src: i.sticker!, at: i.at }))).catch(() => {});
}

/** A sticker made a favourite or not; one not kept yet (a thread's, say) is kept as it's made one. */
export function setFavourite(uid: string, src: string, on: boolean): Promise<void> {
  const id = stickerId(src), now = Date.now();
  if (on) return keepStickers(uid, [{ src, at: now, fav: true }], true);
  return change(uid, (k) => {
    const lib = withFav(k.lib, id, false, now);
    return { next: lib === k.lib ? k : { ...k, lib }, put: lib === k.lib ? [] : lib.filter((s) => s.id === id), drop: [], out: undefined };
  });
}

/** Gone from your stickers, and kept out of them when a thread has it again; what it was is returned, to put it back. */
export function removeSticker(uid: string, id: string): Promise<KeptSticker | undefined> {
  return change(uid, (k) => {
    const was = k.lib.find((s) => s.id === id);
    if (!was) return { next: k, put: [], drop: [], out: undefined };
    return { next: { lib: k.lib.filter((s) => s.id !== id), removed: [...k.removed.filter((x) => x !== id), id] }, put: [], drop: [id], removed: true, out: was };
  });
}

/** One removed a moment ago, back as it was (a favourite still one). */
export function restoreSticker(uid: string, s: KeptSticker): Promise<void> {
  return change(uid, (k) => {
    const removed = k.removed.filter((x) => x !== s.id);
    if (k.lib.some((x) => x.id === s.id)) return { next: { ...k, removed }, put: [], drop: [], removed: true, out: undefined };
    return { next: { lib: [...k.lib, s], removed }, put: [s], drop: [], removed: true, out: undefined };
  });
}

/** Signed out or the account deleted: no one's stickers stay on the phone. */
export async function forgetStickers(): Promise<void> {
  gen++;
  mem.clear(); loading.clear(); seen.clear();
  const runs = [...chain.values()];
  chain.clear();
  emit();
  await Promise.all(runs.map((r) => r.catch(() => {})));
  await deleteStickerLibraries().catch(() => {});
}

export function resetStickersForTests() { gen++; mem.clear(); loading.clear(); seen.clear(); chain.clear(); }

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
/** This account's stickers as kept here, live (in no order: domain/stickerLibrary arrange); undefined while first read. */
export function useStickers(uid: string | null | undefined): readonly KeptSticker[] | undefined {
  const k = useSyncExternalStore(subscribe, () => (uid ? mem.get(uid) : undefined));
  useEffect(() => { if (uid) void load(uid); }, [uid]);
  return k?.lib;
}
/** For tests and the first read: this account's stickers once read. */
export const readStickers = (uid: string) => load(uid).then((k) => k.lib);
