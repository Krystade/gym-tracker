import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test';
import { goto } from './nav';
import { EMU_HOST, emu } from './emu';
import { account, boardPost, onBoard, ownerAccount, put, rand, signedIn, Ts, type Seeded } from './seed';

// The board (social S3, S4) against the local Auth and Firestore emulators and this worktree's firestore.rules: what it costs to
// open, the gate's refusals, a post held after 3 reports, the owner removing one. Synthetic users and posts only. The board is
// shared by every test in the run, so each finds its own posts by id (data-post) or by a word of its own in them.

test.use({ serviceWorkers: 'block' });
const board = (page: Page) => page.locator('.board');
const card = (page: Page, id: string) => page.locator(`[data-post="${id}"]`);
async function toBoard(page: Page) {
  await page.getByRole('tab', { name: 'Board' }).click();
  await expect(board(page)).toBeVisible();
}

/**
 * The board's reads from `page`, billed as Firestore bills them (a document 1, a query the documents it returns, at least 1):
 * its posts, your gate document and your notice. Everything else the app reads meanwhile is left out, the ✓s with it: Friends'
 * lists read those (and may again behind the board, on their own clock); the board reads them only when the lists never did
 * (state/board.test.ts counts that case).
 */
function boardReads(page: Page) {
  const docs: string[] = [];
  const queries: Promise<string[]>[] = [];
  const BOARD_DOC = /\/documents\/(notices\/[^/]+|users\/[^/]+\/private\/board)$/;
  const on = (req: Request) => {
    const url = req.url().split('?')[0];
    const body = req.postDataJSON() as { structuredQuery?: { from?: { collectionId: string }[] }; documents?: string[] } | null;
    if (/\/documents:runQuery$/.test(url) && body?.structuredQuery?.from?.[0]?.collectionId === 'board') {
      // Each post it returned, as its time on the server.
      queries.push(req.response().then(async (r) => ((await r?.json()) as { document?: { fields: { at: { timestampValue: string } } } }[] ?? [])
        .filter((x) => x.document).map((x) => x.document!.fields.at.timestampValue)));
    } else if (url.endsWith(':batchGet')) {
      docs.push(...(body?.documents ?? []).filter((d) => BOARD_DOC.test(d)).map((d) => (d.includes('/notices/') ? 'notice' : 'gate')));
    }
  };
  page.on('request', on);
  return async () => {
    page.off('request', on);
    const qs = await Promise.all(queries);
    return { docs, queries: qs, total: docs.length + qs.reduce((n, q) => n + Math.max(1, q.length), 0) };
  };
}

test('opening the board reads a page, your gate document and your notice (22); again a minute on with nothing new, 2', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const [me, ...authors] = await Promise.all([0, 1, 2, 3].map(() => account(request)));
  const tag = rand();
  // Five minutes apart: only the newest falls in the minute read again before it.
  for (let i = 0; i < 22; i++) await boardPost(request, authors[i % 3], `Synthetic ${tag} ${i}`, 2 + 5 * i);
  const page = await signedIn(browser, me, new Date());
  // Friends settles first: its lists (the ✓s with them) are read before the board opens.
  await expect(page.getByRole('tab', { name: 'Board' })).toBeVisible();
  await page.waitForLoadState('networkidle');

  let stop = boardReads(page);
  await toBoard(page);
  await expect(board(page).locator('.bd-list > li')).toHaveCount(20, { timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  const cold = await stop();
  const shown = await board(page).locator('.bd-list > li[data-post]').evaluateAll((els) => els.map((e) => e.getAttribute('data-post')));
  expect(shown).toHaveLength(20);
  console.log(`board reads: cold open ${cold.total}`);
  expect(cold.total).toBe(22);
  expect(cold.docs.sort()).toEqual(['gate', 'notice']);

  // Back to Friends, a minute on, and the board again: shown at once from this phone, then only what's new (none) and the notice.
  await page.getByRole('tab', { name: 'Friends' }).click();
  await page.waitForLoadState('networkidle');
  await page.clock.fastForward('01:01');
  stop = boardReads(page);
  await toBoard(page);
  // Every post the cold open showed, still shown; another test's post from that minute lands on top as well (the board is the run's).
  for (const id of shown) await expect(card(page, id!)).toBeVisible();
  expect(await board(page).locator('.bd-list > li').count()).toBeGreaterThanOrEqual(20);
  await page.waitForLoadState('networkidle');
  const again = await stop();
  console.log(`board reads: reopened with nothing new ${again.total}`);
  // The notice, and one query from a minute before the newest post kept: that post alone, unless another test's landed in
  // the same minute (the board is the whole run's), each of them a read.
  expect(again.docs).toEqual(['notice']);
  expect(again.queries).toHaveLength(1);
  const times = again.queries[0].map((t) => Date.parse(t));
  expect(times.length).toBeGreaterThanOrEqual(1);
  expect(Math.max(...times) - Math.min(...times)).toBeLessThanOrEqual(60_000);
  if (times.length === 1) expect(again.total).toBe(2);
  // Within the minute: none.
  await page.getByRole('tab', { name: 'Friends' }).click();
  await page.waitForLoadState('networkidle');
  stop = boardReads(page);
  await toBoard(page);
  await page.waitForLoadState('networkidle');
  expect((await stop()).total).toBe(0);
  await page.context().close();
});

/** An account with no username yet (signed up, nothing more). */
async function bare(request: APIRequestContext): Promise<Seeded> {
  const email = `bare${rand()}@test.local`;
  const res = await request.post(`http://${EMU_HOST}:${emu.auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, { data: { email, password: 'synthetic-pass-1', returnSecureToken: true } });
  expect(res.ok()).toBe(true);
  return { uid: (await res.json()).localId as string, name: '', email };
}

test('the gate refuses until each step is met: a username, the rules, a day-old account (no verified email); and a ban', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const gate = (page: Page) => page.getByRole('region', { name: 'Join the board' });

  // No username: the gate says so, and there's no way to a post.
  const nobody = await bare(request);
  const p0 = await signedIn(browser, nobody, new Date());
  await toBoard(p0);
  await expect(gate(p0)).toContainText('A username · not yet');
  await expect(gate(p0)).toContainText('Posting opens once you’ve chosen a username.');
  await p0.context().close();

  // An email never verified, never accepted, an old enough account: the rules to accept, and nothing more (owner, 2026-10-22).
  const a = await account(request);
  await put(request, `users/${a.uid}`, { username: a.name, displayName: a.name, createdAt: new Ts(Date.now() - 2 * 864e5) });
  const pa = await signedIn(browser, a, new Date());
  await toBoard(pa);
  const g = gate(pa);
  await expect(g).toContainText('Be decent. No harassment, threats, hate or pile-ons.');
  await expect(g).not.toContainText('Email');
  await expect(g.getByRole('button', { name: /link/i })).toHaveCount(0);
  const join = g.getByRole('button', { name: 'Join the board' });
  await expect(join).toBeDisabled();
  await g.getByLabel('I’m 16 or older').check();
  await expect(join).toBeDisabled();
  await g.getByLabel(/I’ll keep to the board’s rules/).check();
  await join.click();
  await expect(gate(pa)).toHaveCount(0);

  // Past the gate: the composer, with what it refuses and what it warns of.
  await board(pa).getByRole('button', { name: 'Post', exact: true }).click();
  const sheet = pa.getByRole('dialog', { name: 'New post' });
  const field = sheet.getByRole('textbox', { name: 'Your post' });
  const send = sheet.getByRole('button', { name: 'Post', exact: true });
  await expect(sheet).toContainText(`Posting as @${a.name}`);
  await field.fill('see www.example.com');
  await expect(sheet.getByRole('alert')).toHaveText('No links: the board takes words only.');
  await expect(send).toBeDisabled();
  await field.fill('text me 555 123 4567');
  await expect(sheet.getByRole('status')).toHaveText('That looks like a phone number. Everyone on the board will see it.');
  const words = `First post ${rand()}`;
  await field.fill(words);
  await expect(sheet).toContainText(`${280 - words.length} left`);
  await send.click();
  await expect(sheet).toHaveCount(0);
  await expect(board(pa).locator('.bd-card', { hasText: words })).toBeVisible();
  // 60 s apart.
  await board(pa).getByRole('button', { name: 'Post', exact: true }).click();
  await field.fill('and another');
  await send.click();
  await expect(sheet.getByRole('alert')).toHaveText(/^One post a minute\. Try again in \d+ s\.$/);
  // 5 a day.
  await put(request, `boardRate/${a.uid}`, { at: new Ts(Date.now() - 5 * 60_000), win: new Ts(Date.now() - 3600_000), n: 5 });
  await send.click();
  await expect(sheet.getByRole('alert')).toHaveText(/^That’s 5 posts today\. You can post again /);
  await pa.context().close();

  // Accepted, but the account is new: a day first. Folded, Post opens the gate again, never the composer.
  const b = await account(request);
  await onBoard(request, b);
  await put(request, `users/${b.uid}`, { username: b.name, displayName: b.name, createdAt: new Ts(Date.now() - 60_000) });
  const pb = await signedIn(browser, b, new Date());
  await toBoard(pb);
  await board(pb).getByRole('button', { name: 'Post', exact: true }).click();
  await expect(gate(pb)).toContainText('Posting opens once your account is a day old');
  await expect(pb.getByRole('dialog', { name: 'New post' })).toHaveCount(0);
  await pb.context().close();

  // Banned: told so, and no Post at all.
  const c = await account(request);
  await onBoard(request, c);
  await put(request, `banned/${c.uid}`, { at: new Ts(Date.now()) });
  await put(request, `notices/${c.uid}`, { removed: 0, banned: true, at: new Ts(Date.now()) });
  const pc = await signedIn(browser, c, new Date());
  await toBoard(pc);
  await expect(board(pc)).toContainText('The app’s owner banned this account from the board for breaking its rules. You can still read it.');
  await expect(board(pc).getByRole('button', { name: 'Post', exact: true })).toHaveCount(0);
  await pc.context().close();
});

test('3 reports hide a post for everyone else until it’s reviewed; its author sees it marked', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const [author, r1, r2, r3, viewer] = await Promise.all([0, 1, 2, 3, 4].map(() => account(request)));
  await Promise.all([author, r3].map((x) => onBoard(request, x)));
  const id = await boardPost(request, author, `Cheap gear ${rand()}`, 0, { reports: 2 });
  for (const r of [r1, r2]) await put(request, `board/${id}/reports/${r.uid}`, { why: 'spam', at: new Ts(Date.now()) });

  // Two reports: still there for everyone. The third, through the app.
  const p = await signedIn(browser, r3, new Date());
  await toBoard(p);
  await expect(card(p, id)).toContainText('Cheap gear');
  await card(p, id).getByRole('button', { name: /^More for the post by/ }).click();
  const acts = p.getByRole('dialog', { name: `@${author.name}` });
  await acts.getByRole('button', { name: 'Report post…' }).click();
  const report = p.getByRole('dialog', { name: 'Report post' });
  await expect(report).toContainText('Why? The owner reviews every report.');
  await report.getByRole('button', { name: 'Spam or selling' }).click();
  await expect(board(p).getByRole('status').filter({ hasText: 'Reported.' })).toBeVisible();
  // Hidden for the reporter at once (their hidden list).
  await expect(card(p, id)).toHaveCount(0);
  await p.context().close();

  // Anyone else: a line where it was, and not its words.
  const pv = await signedIn(browser, viewer, new Date());
  await toBoard(pv);
  await expect(card(pv, id)).toHaveText('Hidden after reports, waiting for review', { timeout: 20_000 });
  await pv.context().close();
  // Its author: the post, marked.
  const pa = await signedIn(browser, author, new Date());
  await toBoard(pa);
  await expect(card(pa, id)).toContainText('Hidden for others after reports, waiting for the owner’s review.');
  await expect(card(pa, id)).toContainText('Cheap gear');
  await pa.context().close();
});

test('the owner removes a reported post from Board review; its author is told once, quietly', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const [author, reporter] = await Promise.all([account(request), account(request)]);
  await onBoard(request, author);
  const words = `Squat depth police ${rand()}`;
  const id = await boardPost(request, author, words, 1, { reports: 1 });
  await put(request, `board/${id}/reports/${reporter.uid}`, { why: 'harass', at: new Ts(Date.now()) });

  const owner = await ownerAccount(request);
  const po = await signedIn(browser, owner, new Date());
  await goto(po, 'More');
  await po.getByRole('main').getByRole('button', { name: /^Board review/ }).click();
  await expect(po.getByRole('heading', { level: 1 })).toHaveText('Board review');
  const item = po.getByRole('region', { name: `Reported post by @${author.name}` }).filter({ hasText: words });
  await expect(item).toContainText('Harassment ×1');
  await expect(item).toContainText('1 report');
  await item.getByRole('button', { name: 'Remove' }).click();
  await item.getByRole('button', { name: 'Sure?' }).click();
  await expect(po.getByRole('status').filter({ hasText: 'Removed.' })).toHaveText(`Removed. @${author.name} is told on their next visit.`);
  await expect(item).toHaveCount(0);
  await po.context().close();

  const pa = await signedIn(browser, author, new Date());
  await toBoard(pa);
  const notice = board(pa).getByRole('status').filter({ hasText: 'removed a post of yours' });
  await expect(notice).toHaveText(/The app’s owner removed a post of yours for breaking the board’s rules\./);
  await expect(card(pa, id)).toHaveCount(0);
  await notice.getByRole('button', { name: 'OK' }).click();
  await expect(notice).toHaveCount(0);
  // Told once: not again on the next open (once this phone has saved that it was seen: a write of a few ms, waited for here
  // because a reload in the same instant would cut it off).
  await pa.waitForFunction(async (uid) => {
    const db = await new Promise<IDBDatabase>((r) => { const q = indexedDB.open('gym-tracker-shared'); q.onsuccess = () => r(q.result); });
    const v = await new Promise<{ board?: { seenRemoved?: number } } | undefined>((r) => { const q = db.transaction('kv').objectStore('kv').get(`friends:${uid}`); q.onsuccess = () => r(q.result); });
    db.close();
    return v?.board?.seenRemoved === 1;
  }, author.uid);
  await pa.reload();
  await goto(pa, 'Friends');
  await toBoard(pa);
  await expect(board(pa).locator('.bd-list, .bd-empty')).toBeVisible({ timeout: 20_000 });
  await expect(board(pa).getByText('removed a post of yours')).toHaveCount(0);
  await pa.context().close();
});

/**
 * The owner's switches as this phone reads them, without touching the shared emulator's (other specs post meanwhile): the read
 * of config/switches answered here, everything else through to the emulator.
 */
async function switches(page: Page, sw: Record<string, boolean>) {
  await page.route(/documents:batchGet/, async (route) => {
    const body = route.request().postData() ?? '';
    if (!body.includes('/documents/config/switches')) return route.fallback();
    const name = JSON.parse(body).documents[0] as string, t = new Date().toISOString();
    const fields = Object.fromEntries(Object.entries(sw).map(([k, v]) => [k, { booleanValue: v }]));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ found: { name, fields, createTime: t, updateTime: t }, readTime: t }]) });
  });
}

test('the owner closes the board: "Board closed", no Post, posts still read; open, Post is back', async ({ browser, request }) => {
  const m = await account(request);
  await onBoard(request, m);
  await boardPost(request, m, `Still readable ${rand()}`, 5);
  const page = await signedIn(browser, m, new Date(), (p) => switches(p, { board: true }));
  await toBoard(page);
  await expect(board(page).getByRole('status').filter({ hasText: 'Board closed' })).toHaveText('Board closed · the app’s owner closed posting for now. You can still read it.');
  await expect(board(page).getByRole('button', { name: 'Post', exact: true })).toHaveCount(0);
  await expect(board(page).locator('.bd-card', { hasText: 'Still readable' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('board-closed.png') });
  await page.context().close();
  const again = await signedIn(browser, m, new Date(), (p) => switches(p, { board: false }));
  await toBoard(again);
  await expect(board(again).getByRole('button', { name: 'Post', exact: true })).toBeVisible();
  await expect(board(again).getByText('Board closed')).toHaveCount(0);
  await again.context().close();
});
