import type { Locator, Page } from '@playwright/test';

/**
 * Which parts of the page React rendered again, through the hook React DevTools uses (production React calls it on every
 * commit too). A component counts as rendered in a commit when its hooks are new objects: a render makes them anew, a
 * component React skipped keeps the ones it had. Install before the page loads; `rendersAbove` says how many components
 * holding the element rendered since `recordRenders`, `commitsOf` in how many commits the nearest of them did.
 */
export async function watchRenders(page: Page) {
  await page.addInitScript(() => {
    type Fiber = { tag: number; memoizedState: unknown; alternate: Fiber | null; child: Fiber | null; sibling: Fiber | null; return: Fiber | null };
    const seen = new WeakMap<Fiber, { s: unknown; n: number }>();
    let commit = 0;
    const w = window as unknown as { __renders: { on: boolean; rendered: WeakSet<Fiber>; commits: WeakSet<Fiber>[]; fetches: { out: number; done: number } }; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown };
    w.__renders = { on: false, rendered: new WeakSet(), commits: [], fetches: { out: 0, done: 0 } };
    // Requests out and done, so a spec can wait for the reads and syncs it set off to finish.
    const fetch = window.fetch, fetches = w.__renders.fetches;
    window.fetch = function (...a: Parameters<typeof fetch>) {
      fetches.out++;
      return fetch.apply(this, a).finally(() => { fetches.out--; fetches.done++; });
    };
    const FUNCTION = 0, FORWARD_REF = 11, SIMPLE_MEMO = 15;
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers: new Map(), inject: () => 1, checkDCE: () => {}, onCommitFiberUnmount: () => {}, onPostCommitFiberRoot: () => {},
      onScheduleFiberRoot: () => {},
      onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
        commit++;
        const now = new WeakSet<Fiber>();
        if (w.__renders.on) w.__renders.commits.push(now);
        const stack: Fiber[] = [root.current];
        while (stack.length) {
          const f = stack.pop()!;
          if ((f.tag === FUNCTION || f.tag === FORWARD_REF || f.tag === SIMPLE_MEMO) && f.memoizedState) {
            // The fiber and its alternate swap places from render to render: the newer of the two records is the last state seen.
            const a = f.alternate, rf = seen.get(f), ra = a ? seen.get(a) : undefined;
            const last = rf && ra ? (rf.n > ra.n ? rf : ra) : rf ?? ra;
            if (last && last.s !== f.memoizedState && w.__renders.on) {
              for (const set of [w.__renders.rendered, now]) { set.add(f); if (a) set.add(a); }
            }
            seen.set(f, { s: f.memoizedState, n: commit });
          }
          if (f.sibling) stack.push(f.sibling);
          if (f.child) stack.push(f.child);
        }
      },
    };
  });
}

/** From now on (what was recorded before is dropped). */
export const recordRenders = (page: Page) => page.evaluate(() => {
  const r = (window as unknown as { __renders: { on: boolean; rendered: WeakSet<object>; commits: WeakSet<object>[] } }).__renders;
  r.on = true; r.rendered = new WeakSet(); r.commits = [];
});

/** Requests finished so far, and how many are out. */
export const fetches = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { __renders: { fetches: { out: number; done: number } } }).__renders.fetches }));

/** How many components above `el` (its own included) rendered since recording began. */
export const rendersAbove = (el: Locator) => el.evaluate((node) => {
  type Fiber = { return: Fiber | null };
  const { rendered } = (window as unknown as { __renders: { rendered: WeakSet<Fiber> } }).__renders;
  const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
  let n = 0;
  for (let f = key ? (node as unknown as Record<string, Fiber>)[key] : null; f; f = f.return) if (rendered.has(f)) n++;
  return n;
});

/**
 * In how many commits since recording began the component holding `el` (the nearest: a screen, for its heading) rendered.
 * Not the ones above it: React may call a component whose state was set to what it was, then skip everything under it.
 */
export const commitsOf = (el: Locator) => el.evaluate((node) => {
  type Fiber = { tag: number; return: Fiber | null };
  const { commits } = (window as unknown as { __renders: { commits: WeakSet<Fiber>[] } }).__renders;
  const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
  let f = key ? (node as unknown as Record<string, Fiber>)[key] : null;
  while (f && f.tag !== 0 && f.tag !== 11 && f.tag !== 15) f = f.return; // function, forwardRef, memo
  return f ? commits.filter((c) => c.has(f!)).length : -1;
});
