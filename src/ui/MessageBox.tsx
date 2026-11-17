import { useEffect, useRef, type KeyboardEvent, type Ref } from 'react';
import { boxText, clipText, imageNodes, imageUrls } from './boxNodes';
import { pastedImage } from './stickerImage';

/** The box's words, as a <textarea>'s value would be. */
export const readBox = (el: HTMLElement | null) => (el ? boxText(el) : '');
/** Put `t` in the box as its only content (plain text: the box keeps its line breaks with `white-space: pre-wrap`). */
export function writeBox(el: HTMLElement | null, t: string) {
  if (!el) return;
  el.textContent = t;
}

/** The images in some HTML (a paste or drop with no image file in it): where each one's pixels are, best first. */
function htmlImages(html: string): string[] {
  if (!/<(img|picture)\b/i.test(html)) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return imageNodes(doc.body).flatMap((n) => imageUrls(n));
}

/** How long the selection in `el` is, in what it would take out of the box's words. */
function selected(el: HTMLElement) {
  const sel = getSelection();
  return sel && sel.rangeCount && el.contains(sel.anchorNode) && el.contains(sel.focusNode) ? sel.toString().length : 0;
}

/** Words typed or pasted into the box where the caret is, as plain text: one undo step, and only as many as still fit. */
function insertPlain(el: HTMLElement, s: string, max: number) {
  const room = max - (readBox(el).length - selected(el));
  const t = clipText(s.replace(/\r\n?/g, '\n').replace(/￼/g, ''), Math.max(0, room));
  if (!t) return;
  if (document.execCommand('insertText', false, t)) return;
  // No execCommand: the words go in by hand, the caret after them.
  const sel = getSelection();
  if (!sel?.rangeCount || !el.contains(sel.anchorNode)) { el.append(t); return; }
  const r = sel.getRangeAt(0);
  r.deleteContents();
  const node = document.createTextNode(t);
  r.insertNode(node);
  r.setStartAfter(node); r.collapse(true);
  sel.removeAllRanges(); sel.addRange(r);
}

/**
 * The thread's message box: a contenteditable kept to plain text, so iOS's emoji keyboard offers its Stickers (and Memoji,
 * Genmoji), which it puts only into a rich-text field. An image arriving by any road (the keyboard's insertion, a paste, a
 * drop) is taken out of the box before it's drawn and handed on (`onFile` for a file, `onImage` for an element WebKit put
 * there or a pasted page's <img>); it never stays among the words, and never goes as text. Formatting is refused; pasted
 * text goes in as plain text. `max` is a <textarea>'s maxLength: typing and pastes stop at it, and anything that gets past
 * (dictation, a replacement) is cut back to it.
 */
export function MessageBox({ ref, label, placeholder, max, empty, onText, onFile, onImage, onKeyDown, onFocus }: {
  ref: Ref<HTMLDivElement>; label: string; placeholder: string; max: number; empty: boolean;
  onText: (t: string) => void; onFile: (f: File) => void; onImage: (urls: string[], el: HTMLImageElement | null) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void; onFocus?: () => void;
}) {
  const own = useRef<HTMLDivElement>(null);
  const props = useRef({ max, onText, onFile, onImage });
  props.current = { max, onText, onFile, onImage };
  const setRef = (el: HTMLDivElement | null) => {
    own.current = el;
    if (typeof ref === 'function') ref(el); else if (ref) (ref as { current: HTMLDivElement | null }).current = el;
  };

  useEffect(() => {
    const el = own.current;
    if (!el) return;
    const p = () => props.current;
    /** Any image in the box goes out now (the first becomes the sticker: its loading starts before it leaves), then the words are read. */
    const sweep = () => {
      const found = imageNodes(el) as unknown as Element[];
      if (found.length) {
        const first = found[0];
        const img = first instanceof HTMLImageElement ? first : first.querySelector('img');
        p().onImage(imageUrls(first as never), img);
        for (const n of found) n.remove();
      }
      const t = readBox(el);
      if (t.length > p().max) {
        writeBox(el, clipText(t, p().max));
        const sel = getSelection();
        if (sel && document.activeElement === el) { sel.selectAllChildren(el); sel.collapseToEnd(); }
      }
      p().onText(readBox(el));
    };
    // Before anything is drawn: the observer's callback runs as a microtask, ahead of the next frame.
    const watch = new MutationObserver((records) => {
      if (records.some((r) => Array.from(r.addedNodes).some((n) => n.nodeType === 1))) sweep();
    });
    watch.observe(el, { childList: true, subtree: true });

    const before = (e: InputEvent) => {
      const type = e.inputType;
      if (type.startsWith('format') || type === 'insertLink') { e.preventDefault(); return; }
      const dt = e.dataTransfer;
      if (dt && e.cancelable) {
        const f = pastedImage(dt);
        if (f) { e.preventDefault(); p().onFile(f); return; }
        const html = dt.getData('text/html');
        const words = dt.getData('text/plain').replace(/[￼\s]/g, '');
        const urls = html ? htmlImages(html) : [];
        if (urls.length && !words) { e.preventDefault(); p().onImage(urls, null); return; }
        // Rich text (a drop, an insertion with its formatting): its words alone.
        if (html) { e.preventDefault(); insertPlain(el, dt.getData('text/plain'), p().max); return; }
      }
      if ((type === 'insertText' || type === 'insertReplacementText') && e.data && e.cancelable) {
        const room = p().max - (readBox(el).length - selected(el));
        if (e.data.length > room) { e.preventDefault(); if (room > 0) insertPlain(el, e.data, p().max); }
      }
    };
    const input = () => sweep();
    const paste = (e: ClipboardEvent) => {
      const d = e.clipboardData;
      e.preventDefault(); // never the clipboard's formatting
      const f = pastedImage(d);
      if (f) { p().onFile(f); return; }
      const words = d?.getData('text/plain') ?? '';
      const urls = htmlImages(d?.getData('text/html') ?? '');
      if (urls.length && !words.replace(/[￼\s]/g, '')) { p().onImage(urls, null); return; }
      insertPlain(el, words, p().max);
    };
    el.addEventListener('beforeinput', before);
    el.addEventListener('input', input);
    el.addEventListener('paste', paste);
    return () => {
      watch.disconnect();
      el.removeEventListener('beforeinput', before);
      el.removeEventListener('input', input);
      el.removeEventListener('paste', paste);
    };
  }, []);

  return (
    <div ref={setRef} className={`compose-field${empty ? ' empty' : ''}`} contentEditable role="textbox" aria-multiline="true" aria-label={label}
      aria-placeholder={placeholder} data-placeholder={placeholder} enterKeyHint="enter" inputMode="text" autoCapitalize="sentences" autoCorrect="on"
      spellCheck onKeyDown={onKeyDown} onFocus={onFocus} />
  );
}
