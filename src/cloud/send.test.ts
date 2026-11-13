import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeFirestore } from './fakeFirestore';
import { SEND_WAIT_MS, sendPing, sendSticker } from './friends';

// A send the server never answers (owner, 2026-11-12: a sticker that "looked good" and never came, and no write of it ever
// reached Firestore): it says so, and the sends after it to that friend aren't held behind it.

vi.mock('../push/client', () => ({ notifyFriend: () => {}, notifyLimit: () => {} }));
const STICKER = `data:image/png;base64,${'A'.repeat(4000)}`;
type Batch = { commit: () => Promise<void> };

/** The fake Firestore with every commit left unanswered while `stall.on`. */
function stalling() {
  const w = fakeFirestore({});
  const F = w.cloud.F as unknown as { writeBatch: () => Batch };
  const real = F.writeBatch, stall = { on: true };
  F.writeBatch = () => { const b = real(); if (stall.on) b.commit = () => new Promise<void>(() => {}); return b; };
  return { w, stall };
}

describe('a send that gets no answer', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('fails with a plain reason once SEND_WAIT_MS pass, not before; the next send to that friend then goes', async () => {
    vi.useFakeTimers();
    const { w, stall } = stalling();
    let out: unknown = 'waiting';
    void sendSticker(w.cloud, 'me', 'ana', STICKER).then(() => { out = 'sent'; }, (e: unknown) => { out = e; });
    await vi.advanceTimersByTimeAsync(SEND_WAIT_MS - 1);
    expect(out).toBe('waiting');
    await vi.advanceTimersByTimeAsync(1);
    expect(out).toMatchObject({ plain: true, message: expect.stringMatching(/no answer/i) });
    expect(Object.keys(w.docs).filter((p) => p.startsWith('users/ana/inbox/'))).toEqual([]);

    stall.on = false;
    const next = sendPing(w.cloud, 'me', 'ana', 'strong');
    await vi.advanceTimersByTimeAsync(0);
    await expect(next).resolves.toEqual(expect.any(String));
    expect(Object.values(w.docs).filter((d) => d.kind === 'p')).toHaveLength(1);
  });

  it('one answered in time leaves no timer behind', async () => {
    vi.useFakeTimers();
    const { w, stall } = stalling();
    stall.on = false;
    const sent = sendSticker(w.cloud, 'me', 'bo', STICKER);
    await vi.advanceTimersByTimeAsync(0);
    await expect(sent).resolves.toEqual(expect.any(String));
    expect(vi.getTimerCount()).toBe(0);
  });
});
