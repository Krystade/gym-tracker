import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { arrange, rankOf, type KeptSticker } from '../domain/stickerLibrary';
import { keepStickers, removeSticker, restoreSticker, setFavourite, useStickers } from '../state/stickers';
import { makeSticker } from './stickerImage';
import { Icon } from './icons';

/** Held this long on a sticker, it's Edit (as on the Home Screen), and the tap that ends it sends nothing. */
const HOLD_MS = 450;
const MOVE_PX = 10;

/**
 * Your stickers, in the keyboard's place under the message box (owner, 2026-11-16: sending them was "pretty clunky"): every one
 * you sent, added or saw in a thread, your favourites first. A tap sends it at once, as the recent row does. Add from Photos
 * takes several at a time, each made a sticker as a pasted one is. Edit (or a sticker held down) pins a favourite with a tap and
 * removes one with its ×, with Undo in its place; the grid holds still while you edit, and sorts again on Done.
 *
 * The order shown holds while the drawer is open: a sticker sent again and again stays under the finger; one just added goes first.
 */
export function StickerDrawer({ id, uid, disabled, onSend, onNote }: {
  id: string; uid: string; disabled: boolean; onSend: (src: string) => void; onNote: (ok: boolean, text: string) => void;
}) {
  const lib = useStickers(uid);
  const [editing, setEditing] = useState(false);
  /** Where each was when the grid was last laid out (domain/stickerLibrary arrange). */
  const [rank, setRank] = useState<ReadonlyMap<string, number> | null>(null);
  /** Removed while editing: shown in their place, with Undo, until Done. */
  const [gone, setGone] = useState<ReadonlyMap<string, KeptSticker>>(new Map());
  const [adding, setAdding] = useState(false);
  const hold = useRef<{ t: number; x: number; y: number; fired: boolean } | null>(null);
  /** The click that ends a hold: it lands on what Edit put under the finger, and must do nothing there. */
  const swallow = useRef(false);
  useEffect(() => () => { if (hold.current) clearTimeout(hold.current.t); }, []);

  const pool = lib ? [...lib, ...[...gone.values()].filter((g) => !lib.some((s) => s.id === g.id))] : null;
  const shown = pool ? arrange(pool, { rank: rank ?? undefined, pin: !editing }) : null;
  // The layout shown is the one kept: one new (added, or come in a thread) goes first once, then holds its place too.
  useEffect(() => { if (shown && (!rank || shown.some((s) => !rank.has(s.id)))) setRank(rankOf(shown)); }, [shown, rank]);

  const edit = (on: boolean) => {
    if (hold.current) { clearTimeout(hold.current.t); hold.current = null; }
    setEditing(on);
    setGone(new Map());
    // Into Edit, the grid as it is; out of it, sorted again (a new favourite goes first).
    setRank(on && shown ? rankOf(shown) : lib ? rankOf(arrange(lib)) : null);
  };

  const down = (e: ReactPointerEvent) => {
    if (editing || disabled) return;
    const h = { t: 0, x: e.clientX, y: e.clientY, fired: false };
    h.t = window.setTimeout(() => { h.fired = true; swallow.current = true; edit(true); }, HOLD_MS);
    hold.current = h;
  };
  const move = (e: ReactPointerEvent) => {
    const h = hold.current;
    if (h && !h.fired && Math.hypot(e.clientX - h.x, e.clientY - h.y) > MOVE_PX) { clearTimeout(h.t); hold.current = null; }
  };
  const up = () => { const h = hold.current; if (h && !h.fired) { clearTimeout(h.t); hold.current = null; } };

  /** Photos picked: each made a sticker in turn, the first picked first; what couldn't be says why. */
  const add = async (files: File[]) => {
    if (!files.length) return;
    setAdding(true);
    onNote(true, files.length > 1 ? `Adding ${files.length} stickers…` : 'Adding the sticker…');
    const made: string[] = [];
    let why = '';
    for (const f of files) {
      try { made.push(await makeSticker(f)); } catch (e) { why ||= (e as { plain?: boolean }).plain ? (e as Error).message : 'Couldn’t read that image.'; }
    }
    const now = Date.now();
    try {
      if (made.length) await keepStickers(uid, made.map((src, i) => ({ src, at: now - i })), true);
      const missed = files.length - made.length;
      if (!made.length) onNote(false, why);
      else onNote(!missed, `${made.length === 1 ? 'Added the sticker' : `Added ${made.length} stickers`}.${missed ? ` ${missed} couldn’t be: ${why}` : ''}`);
    } catch {
      onNote(false, 'Couldn’t keep them on this phone. Try again.');
    } finally { setAdding(false); }
  };

  const remove = async (s: KeptSticker) => {
    const was = await removeSticker(uid, s.id).catch(() => undefined);
    if (was) setGone((g) => new Map(g).set(s.id, was));
  };
  const undo = async (s: KeptSticker) => {
    await restoreSticker(uid, s).catch(() => {});
    setGone((g) => { const m = new Map(g); m.delete(s.id); return m; });
  };

  return (
    <section id={id} className="sticker-drawer" aria-label="Your stickers" data-editing={editing || undefined}>
      {/* Editing, what to do takes Add from Photos' place in the bar: the grid under the finger that held it down never moves. */}
      <div className="sd-bar">
        {editing ? <p className="sd-hint">Tap a sticker to make it a favourite. × removes one.</p> : (
          <label className={`button sd-add${adding ? ' disabled' : ''}`}>
            <Icon name="photo" size={20} />Add from Photos
            <input type="file" accept="image/*" multiple hidden disabled={adding} onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; void add(fs); }} />
          </label>
        )}
        {!!lib?.length && <button type="button" className="quiet-btn sd-edit" onClick={() => edit(!editing)}>{editing ? 'Done' : 'Edit'}</button>}
      </div>
      {shown == null ? <p className="sd-empty muted small">Loading…</p>
        : !shown.length ? (
          <div className="sd-empty">
            <p>Stickers you send, and the ones friends send you, are kept here.</p>
            <p className="muted small">Saved a sticker to Photos? Add it from there.</p>
          </div>
        ) : (
          <div className="sd-grid" role="group" aria-label="Stickers" onContextMenu={(e) => e.preventDefault()}
            onPointerDownCapture={() => { swallow.current = false; }} onClickCapture={(e) => { if (swallow.current) { swallow.current = false; e.preventDefault(); e.stopPropagation(); } }}>
            {shown.map((s, k) => {
              const n = k + 1, fav = s.fav != null;
              if (gone.has(s.id) && !lib?.some((x) => x.id === s.id)) return (
                <button key={s.id} type="button" className="sd-cell sd-ghost" aria-label={`Put sticker ${n} back`} onClick={() => void undo(s)}>
                  <img src={s.src} alt="" draggable={false} decoding="async" />
                  <span>Undo</span>
                </button>
              );
              if (editing) return (
                <div key={s.id} className="sd-cell">
                  <button type="button" className="sd-pick" aria-pressed={fav} aria-label={`Favourite sticker ${n}`} onClick={() => void setFavourite(uid, s.src, !fav).catch(() => {})}>
                    <img src={s.src} alt="" draggable={false} decoding="async" />
                    {fav && <span className="sd-star" aria-hidden="true"><Icon name="star-on" size={14} sw={1.5} /></span>}
                  </button>
                  <button type="button" className="sd-remove" aria-label={`Remove sticker ${n}`} onClick={() => void remove(s)}><Icon name="close" size={14} sw={2.5} /></button>
                </div>
              );
              return (
                <button key={s.id} type="button" className="sd-cell" disabled={disabled} aria-label={`Send sticker ${n}${fav ? ', a favourite' : ''}`}
                  onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} onClick={() => onSend(s.src)}>
                  <img src={s.src} alt="" draggable={false} decoding="async" />
                  {fav && <span className="sd-star" aria-hidden="true"><Icon name="star-on" size={14} sw={1.5} /></span>}
                </button>
              );
            })}
          </div>
        )}
    </section>
  );
}
