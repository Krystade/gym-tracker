import type { Locator, Page } from '@playwright/test';

/**
 * Which parts of the page React rendered again, through the hook React DevTools uses (production React calls it on every
 * commit too). A component counts as rendered in a commit when its hooks are new objects: a render makes them anew, a
 * component React skipped keeps the ones it had. Install before the page loads; `rendersAbove` says how many components
 * holding the element rendered since `recordRenders`.
 */
export async function watchRenders(page: Page) {
  await page.addInitScript(() => {
    type Fiber = { tag: number; memoizedState: unknown; alternate: Fiber | null; child: Fiber | null; sibling: Fiber | null; return: Fiber | null };
    const seen = new WeakMap<Fiber, { s: unknown; n: number }>();
    let commit = 0;
    const w = window as unknown as { __renders: { on: boolean; rendered: WeakSet<Fiber>; fetches: { out: number; done: number } }; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown };
    w.__renders = { on: false, rendered: new WeakSet(), fetches: { out: 0, done: 0 } };
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
        const stack: Fiber[] = [root.current];
        while (stack.length) {
          const f = stack.pop()!;
          if ((f.tag === FUNCTION || f.tag === FORWARD_REF || f.tag === SIMPLE_MEMO) && f.memoizedState) {
            // The fiber and its alternate swap places from render to render: the newer of the two records is the last state seen.
            const a = f.alternate, rf = seen.get(f), ra = a ? seen.get(a) : undefined;
            const last = rf && ra ? (rf.n > ra.n ? rf : ra) : rf ?? ra;
            if (last && last.s !== f.memoizedState && w.__renders.on) { w.__renders.rendered.add(f); if (a) w.__renders.rendered.add(a); }
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
  const r = (window as unknown as { __renders: { on: boolean; rendered: WeakSet<object> } }).__renders;
  r.on = true; r.rendered = new WeakSet();
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
