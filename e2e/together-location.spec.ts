import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { DOCS } from './emu';
import { goto } from './nav';
import { account, atGym, befriend, iso, log, placed, session, signedIn, type Seeded } from './seed';
import { geohash, neighbours } from '../src/domain/place';

// Location for Together (owner 2026-10-29: the same place and the same time): the switch under More › Account and sync, asked
// once; a visit's first set gets its codes, silently; the account never holds the point; a friend there at the same time is
// with you. Synthetic accounts and a made-up point.
const T = new Date(new Date().setHours(18, 0, 0, 0));
const at = (daysAgo: number, h: number, m = 0) => { const d = new Date(T.getTime() - daysAgo * 864e5); d.setHours(h, m, 0, 0); return d; };
const GYM = { latitude: 40.748441, longitude: -73.985664 };
test.use({ serviceWorkers: 'block' });
const crew = (page: Page) => page.getByRole('region', { name: 'Crew' });
const bench = (): [string, [number, number][]][] => [['Bench Press', Array.from({ length: 10 }, (): [number, number] => [135, 8])]];

type Value = { stringValue?: string; mapValue?: { fields?: Record<string, Value> }; arrayValue?: { values?: Value[] } };
const get = (request: APIRequestContext, path: string) => request.get(`${DOCS}/${path}`, { headers: { Authorization: 'Bearer owner' } });
/** Every document of theirs the emulator has, as text: the log, settings, private documents and summary. */
async function everything(request: APIRequestContext, who: Seeded): Promise<string> {
  const out = [await (await get(request, `users/${who.uid}`)).text()];
  for (const c of ['months', 'meta', 'private', 'summary']) out.push(await (await get(request, `users/${who.uid}/${c}`)).text());
  return out.join('\n');
}
/** Today's sets in their month as the emulator has it: each one's codes (none: undefined). */
async function codesOf(request: APIRequestContext, who: Seeded): Promise<(string | undefined)[]> {
  const r = await get(request, `users/${who.uid}/months/${iso(T).slice(0, 7)}`);
  if (!r.ok()) return [];
  const f = ((await r.json()) as { fields: Record<string, Value> }).fields;
  return (f.sets.arrayValue?.values ?? []).map((v) => v.mapValue!.fields!).filter((s) => s.date.stringValue === iso(T)).map((s) => s.loc?.stringValue);
}
async function logSet(card: Locator, weight: string, reps: string) {
  await card.getByRole('textbox', { name: 'Weight' }).fill(weight);
  await card.getByRole('textbox', { name: 'Reps' }).fill(reps);
  await card.getByRole('button', { name: /^Add set/ }).click();
}

test('Location for Together: on from its switch; a visit’s first set gets codes and the account never the point; a friend there is with you', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const [me, fr] = await Promise.all(['me', 'fr'].map((n) => account(request, `${n}${Math.random().toString(36).slice(2, 8)}`)));
  const KFR = 'frfrfrfrfrfrfrfrfrfrf2';
  const since = iso(at(5, 12)), yesterday = atGym('Her Gym', session(at(1, 17), bench()));
  await log(request, fr, yesterday, { since, goal: 2, placeKey: KFR });
  await befriend(request, me, fr);
  const page = await signedIn(browser, me, T, async (p) => {
    await p.context().grantPermissions(['geolocation']);
    await p.context().setGeolocation(GYM);
  });
  // Crew read their window, and with it their key.
  await expect(crew(page).getByTestId(`crew-${fr.name}`)).toContainText('Yesterday', { timeout: 20_000 });

  // Off until turned on, under More › Account and sync.
  await goto(page, 'Account');
  const card = page.getByRole('region', { name: 'Location for Together' });
  const sw = card.getByRole('switch', { name: 'Location for Together' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  // PNGs to look at, when asked for (PLACE_PNG=<dir>): the card as the phone shows it.
  const png = async (name: string) => { if (process.env.PLACE_PNG) await page.screenshot({ path: `${process.env.PLACE_PNG}/${info.project.name}-place-${name}.png` }); };
  await card.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await png('off');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  const box = (await sw.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  await page.clock.runFor(1000); // the switch's slide, done
  await png('on');

  // Two sets today: the first gets the visit's codes, the second none.
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: /^Bench Press/ }).first().click();
  const lift = page.locator('[data-card="bench press"]');
  await logSet(lift, '135', '8');
  await page.clock.runFor(4 * 60_000);
  await logSet(lift, '135', '8');
  await expect.poll(async () => { await page.clock.runFor(30_000); return codesOf(request, me); }, { timeout: 60_000 })
    .toEqual([expect.stringMatching(/^[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{64}$/), undefined]);

  // Nothing of theirs in the account says where: not the point, its cell or the cells around it.
  const all = await everything(request, me), cell = geohash(GYM.latitude, GYM.longitude);
  for (const x of [String(GYM.latitude), String(GYM.longitude), '40.748', '73.985', cell, cell.slice(0, 5), ...neighbours(cell)]) expect(all, x).not.toContain(x);
  // Their key went up with their profile, for friends' phones to pair with.
  const items = ((await (await get(request, `users/${me.uid}/meta/profile`)).json()) as { fields: Record<string, Value> }).fields.items.mapValue!.fields!;
  const KME = (JSON.parse(items.profile.stringValue!) as { placeKey: string }).placeKey;
  expect(KME).toMatch(/^[A-Za-z0-9_-]{22}$/);

  // Their friend at the same place, through the same time, with codes for them: trained together, on their card.
  await log(request, fr, [...yesterday, ...await placed(atGym('Her Gym', session(at(0, 17, 45), bench())), GYM, KFR, [KME])], { since, goal: 2, placeKey: KFR });
  await goto(page, 'Friends');
  await page.getByRole('button', { name: 'Refresh friends' }).evaluate((b: HTMLElement) => b.click());
  await expect(crew(page).getByTestId(`crew-${fr.name}`).locator('.fd-together')).toContainText(`You and @${fr.name}`, { timeout: 20_000 });

  // Off: no more fixes, and the codes come off the sets, here and in the account.
  await goto(page, 'Account');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await card.getByRole('button', { name: 'Remove the codes from 1 set' }).click();
  await expect(card.getByRole('button', { name: /^Remove the codes/ })).toHaveCount(0);
  await expect.poll(async () => { await page.clock.runFor(30_000); return codesOf(request, me); }, { timeout: 60_000 }).toEqual([undefined, undefined]);
  await page.context().close();
});
