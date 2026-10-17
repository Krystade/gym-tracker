import { describe, expect, it } from 'vitest';
import { reloadWhenSafe } from './appUpdate';

const page = (visibilityState: DocumentVisibilityState = 'visible') => Object.assign(new EventTarget(), { visibilityState });
const hide = (d: ReturnType<typeof page>, to: DocumentVisibilityState) => { d.visibilityState = to; d.dispatchEvent(new Event('visibilitychange')); };

describe('reloadWhenSafe', () => {
  it('reloads straight away when no form has unsaved changes', () => {
    let n = 0;
    reloadWhenSafe(() => false, () => n++, page());
    expect(n).toBe(1);
  });

  it('with a form half-typed, waits until the page is next hidden, then reloads once', () => {
    let n = 0;
    const d = page();
    reloadWhenSafe(() => true, () => n++, d);
    expect(n).toBe(0);
    hide(d, 'visible'); // coming back to the front isn't leaving it
    expect(n).toBe(0);
    hide(d, 'hidden');
    expect(n).toBe(1);
    hide(d, 'visible'); hide(d, 'hidden');
    expect(n).toBe(1);
  });

  it('a page already in the background reloads now', () => {
    let n = 0;
    reloadWhenSafe(() => true, () => n++, page('hidden'));
    expect(n).toBe(1);
  });
});
