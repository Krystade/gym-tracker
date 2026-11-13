// The thread's message box is a contenteditable, not a <textarea>: iOS's emoji keyboard puts a sticker, Memoji or Genmoji
// only into a rich-text field, and in WebKit that's a contenteditable, where it lands as an <img> (or a <picture>: a HEIC
// source with a PNG <img> to fall back on). The box takes any image out at once and makes it the sticker waiting for Send;
// what's left is plain text. This file is the reading of the box's nodes, kept to the few Node fields it needs so the tests
// can build them by hand (vitest runs in node, with no DOM).

/** The parts of a DOM Node read here. */
export interface BoxNode {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<BoxNode>;
  parentNode: BoxNode | null;
  nextSibling: BoxNode | null;
  getAttribute?(name: string): string | null;
}

const TEXT = 3, ELEMENT = 1;
/** What starts a line of its own in the box: WebKit and Chromium wrap each new line in a <div> (a <p> from some pastes). */
const BLOCK = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'TR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER']);
/** Never text: an image (taken out as a sticker), and what has no words to show. */
const SKIP = new Set(['IMG', 'PICTURE', 'SOURCE', 'SCRIPT', 'STYLE', 'TEMPLATE', 'SVG', 'svg', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'IFRAME', 'CANVAS']);
const isBlock = (n: BoxNode) => n.nodeType === ELEMENT && BLOCK.has(n.nodeName.toUpperCase());
const blank = (n: BoxNode) => n.nodeType === TEXT && !n.nodeValue;

/**
 * A <br> that ends its line, and so shows nothing: the last thing in its block (WebKit leaves one in an emptied box, and one
 * holds an empty line open: `<div><br></div>`), or straight before a block, which starts a new line anyway.
 */
function trailing(br: BoxNode, root: BoxNode): boolean {
  for (let n: BoxNode = br; ;) {
    let s = n.nextSibling;
    while (s && blank(s)) s = s.nextSibling;
    if (s) return isBlock(s);
    const p = n.parentNode;
    if (!p || p === root || isBlock(p)) return true;
    n = p;
  }
}

/**
 * The box's words as a <textarea> would hold them: a line for each block (an empty one held open by its <br> still counts),
 * a "\n" for each <br> that isn't only ending its line, images and the object-replacement character WebKit can leave for one
 * dropped, no-break spaces as spaces.
 */
export function boxText(root: BoxNode): string {
  let out = '', pending = false, started = false;
  const line = () => { if (pending) { out += '\n'; pending = false; } started = true; };
  const walk = (n: BoxNode) => {
    for (let i = 0; i < n.childNodes.length; i++) {
      const c = n.childNodes[i];
      if (c.nodeType === TEXT) {
        const s = (c.nodeValue ?? '').replace(/￼/g, '').replace(/ /g, ' ');
        if (s) { line(); out += s; }
      } else if (c.nodeType === ELEMENT) {
        const name = c.nodeName.toUpperCase();
        if (SKIP.has(name)) continue;
        if (name === 'BR') { line(); if (!trailing(c, root)) out += '\n'; continue; }
        const block = isBlock(c);
        if (block && started) pending = true;
        walk(c);
        if (block && started) pending = true;
      }
    }
  };
  walk(root);
  return out;
}

/** Each image in the box, outermost (a <picture>, not the <img> in it), in document order. */
export function imageNodes(root: BoxNode): BoxNode[] {
  const out: BoxNode[] = [];
  const walk = (n: BoxNode) => {
    for (let i = 0; i < n.childNodes.length; i++) {
      const c = n.childNodes[i];
      if (c.nodeType !== ELEMENT) continue;
      const name = c.nodeName.toUpperCase();
      if (name === 'IMG' || name === 'PICTURE') out.push(c);
      else walk(c);
    }
  };
  walk(root);
  return out;
}

/** The URLs in a srcset, in order. A data: URL's own commas stay in it (the HTML spec's parse: a URL runs to whitespace). */
export function srcsetUrls(srcset: string | null | undefined): string[] {
  const s = srcset ?? '', out: string[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    const start = i;
    while (i < s.length && !/\s/.test(s[i])) i++;
    let url = s.slice(start, i);
    const bare = url.replace(/,+$/, '');
    if (bare !== url) url = bare; // "a.png, b.png": the comma ended the candidate
    else while (i < s.length && s[i] !== ',') i++; // its descriptors ("2x", "300w")
    if (url) out.push(url);
  }
  return out;
}

/** A URL the page can draw without asking the network: the keyboard's own blob:, or an image data: URL. */
export const drawable = (u: string) => /^blob:/i.test(u) || /^data:image\//i.test(u);
/** A HEIC or Apple's adaptive glyph (Genmoji): Safari draws it, the other engines don't, so it's tried last. */
const heic = (type: string, url: string) => /hei[cf]|adaptive-glyph/i.test(type) || /^data:image\/hei[cf]/i.test(url);

/**
 * Where an image's pixels can be read, best first: an <img>'s own src (in a <picture>, the PNG WebKit gives as the
 * fallback), then its srcset, then each <source>'s, a HEIC last. Only blob: and image data: URLs; none, the caller draws
 * the element itself.
 */
export function imageUrls(el: BoxNode): string[] {
  const attr = (n: BoxNode, a: string) => n.getAttribute?.(a) ?? null;
  const name = el.nodeName.toUpperCase();
  const kids = Array.from({ length: el.childNodes.length }, (_, i) => el.childNodes[i]).filter((c) => c.nodeType === ELEMENT);
  const img = name === 'IMG' ? el : kids.find((c) => c.nodeName.toUpperCase() === 'IMG');
  const first: string[] = [], last: string[] = [];
  if (img) {
    const src = attr(img, 'src');
    for (const u of [...(src ? [src] : []), ...srcsetUrls(attr(img, 'srcset'))]) (heic('', u) ? last : first).push(u);
  }
  if (name === 'PICTURE') {
    for (const c of kids) {
      if (c.nodeName.toUpperCase() !== 'SOURCE') continue;
      const type = attr(c, 'type') ?? '';
      for (const u of srcsetUrls(attr(c, 'srcset'))) (heic(type, u) ? last : first).push(u);
    }
  }
  return [...new Set([...first, ...last])].filter(drawable);
}

/** `s` cut to `max` UTF-16 units (as a <textarea>'s maxLength counts), never through the middle of a surrogate pair. */
export function clipText(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, Math.max(0, max));
  const end = cut.charCodeAt(cut.length - 1);
  return end >= 0xd800 && end <= 0xdbff ? cut.slice(0, -1) : cut;
}
