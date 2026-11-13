import { describe, expect, it } from 'vitest';
import { boxText, clipText, imageNodes, imageUrls, srcsetUrls, type BoxNode } from './boxNodes';

// Nodes by hand, as WebKit leaves them in a contenteditable (vitest runs in node, with no DOM).
type Kid = BoxNode | string;
const text = (s: string): BoxNode => ({ nodeType: 3, nodeName: '#text', nodeValue: s, childNodes: [], parentNode: null, nextSibling: null });
function el(name: string, attrs: Record<string, string> = {}, ...kids: Kid[]): BoxNode {
  const childNodes = kids.map((k) => (typeof k === 'string' ? text(k) : k));
  const n: BoxNode = { nodeType: 1, nodeName: name.toUpperCase(), nodeValue: null, childNodes, parentNode: null, nextSibling: null, getAttribute: (a) => attrs[a] ?? null };
  childNodes.forEach((c, i) => { c.parentNode = n; c.nextSibling = childNodes[i + 1] ?? null; });
  return n;
}
const box = (...kids: Kid[]) => el('div', { contenteditable: 'true' }, ...kids);
const br = () => el('br');
const div = (...kids: Kid[]) => el('div', {}, ...kids);

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const HEIC = 'data:image/heic;base64,AAAAGGZ0eXA=';

describe('boxText', () => {
  it.each<[string, BoxNode, string]>([
    ['empty', box(), ''],
    ['the <br> WebKit leaves in an emptied box', box(br()), ''],
    ['one line', box('On my way'), 'On my way'],
    ['Enter, then more (WebKit: a <div> per new line)', box('Line one', div('line two')), 'Line one\nline two'],
    ['Enter at the end: an empty line held open', box('Line one', div(br())), 'Line one\n'],
    ['an empty line between two', box('a', div(br()), div('b')), 'a\n\nb'],
    ['every line in a <div>', box(div('a'), div('b')), 'a\nb'],
    ['a leading empty line', box(div(br()), div('x')), '\nx'],
    ['<br> between words', box('a', br(), 'b'), 'a\nb'],
    ['two <br>s at the end: the last only ends the line', box('a', br(), br()), 'a\n'],
    ['a <br> straight before a block shows nothing', box('a', br(), div('b')), 'a\nb'],
    ['words after a block', box('a', div('b'), 'c'), 'a\nb\nc'],
    ['inline wrappers (autocorrect, a paste) are just their words', box(el('span', {}, 'big ', el('b', {}, 'lift'))), 'big lift'],
    ['a <br> ending an inline wrapper at the end', box('a', el('span', {}, 'b', br())), 'ab'],
    ['no-break spaces read as spaces', box('a  b'), 'a  b'],
  ])('%s', (_, root, want) => expect(boxText(root)).toBe(want));

  it('never reads an image as text: not its alt, not the replacement character', () => {
    const pic = el('picture', {}, el('source', { srcset: HEIC, type: 'image/heic' }), el('img', { src: PNG, alt: 'Genmoji of a cat' }));
    expect(boxText(box('Ni', pic, 'ce', el('img', { src: PNG, alt: 'sticker' }), '￼'))).toBe('Nice');
  });
});

describe('imageNodes', () => {
  it('finds each image, a <picture> rather than the <img> in it, however deep', () => {
    const pic = el('picture', {}, el('source', { srcset: HEIC }), el('img', { src: PNG }));
    const lone = el('img', { src: PNG });
    const found = imageNodes(box('a', pic, div('b', el('span', {}, lone))));
    expect(found).toEqual([pic, lone]);
  });
  it('finds none in words', () => expect(imageNodes(box('a', div('b'), br()))).toEqual([]));
});

describe('imageUrls', () => {
  it('an <img>: its src', () => expect(imageUrls(el('img', { src: 'blob:http://127.0.0.1/1' }))).toEqual(['blob:http://127.0.0.1/1']));
  it('a <picture> as WebKit makes one (HEIC source, PNG img): the PNG first, the HEIC after', () => {
    const pic = el('picture', {}, el('source', { srcset: 'blob:x/heic', type: 'image/x-apple-adaptive-glyph' }), el('img', { src: 'blob:x/png' }));
    expect(imageUrls(pic)).toEqual(['blob:x/png', 'blob:x/heic']);
  });
  it('a <picture> whose <img> has no src: its sources, HEIC last whatever its order', () => {
    const pic = el('picture', {}, el('source', { srcset: HEIC, type: 'image/heic' }), el('source', { srcset: `${PNG} 2x`, type: 'image/png' }), el('img', {}));
    expect(imageUrls(pic)).toEqual([PNG, HEIC]);
  });
  it('a HEIC data URL in an <img> is tried after its other candidates', () => {
    expect(imageUrls(el('img', { src: HEIC, srcset: `${PNG} 1x` }))).toEqual([PNG, HEIC]);
  });
  it('only what the page can draw without the network', () => {
    expect(imageUrls(el('img', { src: 'https://example.com/a.png', srcset: 'javascript:alert(1) 1x, data:text/html,x 2x' }))).toEqual([]);
  });
  it('each URL once', () => expect(imageUrls(el('img', { src: PNG, srcset: `${PNG} 1x` }))).toEqual([PNG]));
});

describe('srcsetUrls', () => {
  it('keeps a data URL’s own comma', () => expect(srcsetUrls(`${PNG} 1x, ${HEIC} 2x`)).toEqual([PNG, HEIC]));
  it('splits on a comma after a URL with no descriptor', () => expect(srcsetUrls('a.png, b.png 300w,c.png')).toEqual(['a.png', 'b.png', 'c.png']));
  it('empty or missing', () => { expect(srcsetUrls('')).toEqual([]); expect(srcsetUrls(null)).toEqual([]); });
});

describe('clipText', () => {
  it('leaves what fits', () => expect(clipText('abc', 3)).toBe('abc'));
  it('cuts to the limit', () => expect(clipText('x'.repeat(150), 140)).toBe('x'.repeat(140)));
  it('never splits an emoji’s surrogate pair', () => expect(clipText('ab💪', 3)).toBe('ab'));
  it('no room: nothing', () => expect(clipText('abc', 0)).toBe(''));
});
