import { useMemo, useState } from 'react';
import { PULL, starterOffer, walletOf, type Spend, type Wallet } from '../domain/buddies/gacha';
import { NAME_MAX } from '../domain/buddies/kept';
import { earned } from '../domain/buddies/points';
import { ACCESSORY, BUDDIES, BUDDY, CREDIT_ROWS, RARITIES, SLOTS, STATS, defaultName, type Banner, type BuddyDef, type Rarity, type Slot, type Stat } from '../domain/buddies/roster';
import { statsOf, TRAIT_TENTHS, trainingOf, type BuddyStats } from '../domain/buddies/stats';
import type { Profile } from '../domain/profile';
import type { SetEntry } from '../domain/types';
import { useAchievements } from '../state/useAchievements';
import type { BuddiesStore } from '../state/useBuddies';
import { useProfileId } from '../state/profileDb';
import { BuddySprite } from './buddies/BuddySprite';
import { PullSheet, type Mode } from './buddies/PullSheet';
import { AccIcon, accName, SLOT_NAME, WardrobeSheet, wornClass } from './buddies/Worn';
import { Icon } from './icons';

// The Buddies tab (Gym Buddies plan §16, stage 4): your lead, your buddies, points and tickets; a buddy's card; the first pick
// of three commons; and the Collection, with the credits (it took Characters' place under More). Stage 5: pulls, tickets and
// choosing (ui/buddies/PullSheet), and the wardrobe (ui/buddies/Worn), a slot's sheet from the card. Everything shown is worked
// out from the log and what's kept (state/useBuddies): nothing here is stored but the pick, the lead, a name, what's worn and
// the spends.

const RARITY: Record<Rarity, string> = { 0: 'Common', 1: 'Uncommon', 2: 'Rare', 3: 'Epic', 4: 'Legendary' };
const STAT: Record<Stat, string> = { power: 'Power', size: 'Size', grit: 'Grit', stamina: 'Stamina' };
const n = (x: number) => x.toLocaleString('en-US');
const count = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;
const traitText = (b: BuddyDef) => `${STAT[b.trait]} ×${(TRAIT_TENTHS[b.rarity] / 10).toFixed(1)}`;

/** A buddy's name: its own, else its roster name. */
export const nameOf = (s: BuddiesStore, id: string) => s.kept?.prefs[id]?.name ?? defaultName(id);

type View = { at: 'home' } | { at: 'card'; id: string; from: 'home' | 'collection' } | { at: 'collection' };
type Sheet = { at: 'pull'; mode: Mode; banner: Banner } | { at: 'wear'; id: string; slot: Slot } | null;

export function BuddiesScreen({ buddies, entries, today, profile }: { buddies: BuddiesStore; entries: readonly SetEntry[]; today: string; profile: Profile }) {
  const [view, setView] = useState<View>({ at: 'home' });
  const [sheet, setSheet] = useState<Sheet>(null);
  const go = (v: View) => { setView(v); setSheet(null); window.scrollTo(0, 0); };
  const { kept, ledger, owned, lead } = buddies;
  const ach = useAchievements(entries, today);
  const start = kept?.start;
  const training = useMemo(() => (start ? trainingOf(entries, { start, today, profile }) : null), [entries, start, today, profile]);
  const wallet = useMemo(() => (training && ledger ? walletOf(earned(training, ach), ledger) : null), [training, ach, ledger]);
  if (!kept || !training || !wallet) return <><h1>Buddies</h1><p className="muted">Loading…</p></>;
  if (!owned.length || !lead) return <FirstPick buddies={buddies} />;
  const statsFor = (id: string) => { const o = owned.find((x) => x.def.id === id)!; return statsOf(o.def, o.day, training); };
  const ownedIds = new Set(ledger!.owned.keys());
  const onSlot = (id: string, slot: Slot) => setSheet({ at: 'wear', id, slot });
  const sheets = sheet?.at === 'pull' ? (
    <PullSheet mode={sheet.mode} banner={sheet.banner} ledger={ledger!} wallet={wallet} today={today} names={(id) => nameOf(buddies, id)}
      onSpend={buddies.spend} onClose={() => setSheet(null)}
      onOpen={(sp: Spend) => {
        if (!sp.got) return;
        if (BUDDY.has(sp.got)) { go({ at: 'card', id: sp.got, from: 'home' }); return; }
        void buddies.equip(lead.id, ACCESSORY.get(sp.got)!.slot, sp.got);
        go({ at: 'home' });
      }} />
  ) : sheet?.at === 'wear' ? (
    <WardrobeSheet slot={sheet.slot} wearing={kept.prefs[sheet.id]?.equip?.[sheet.slot]} owned={ownedIds} name={nameOf(buddies, sheet.id)}
      onPick={(acc) => void buddies.equip(sheet.id, sheet.slot, acc)} onClose={() => setSheet(null)}
      onGetMore={() => setSheet({ at: 'pull', mode: 'pull', banner: 'acc' })} />
  ) : null;

  if (view.at === 'collection') {
    return <Collection buddies={buddies} onBack={() => go({ at: 'home' })} onOpen={(id) => go({ at: 'card', id, from: 'collection' })} />;
  }
  if (view.at === 'card' && owned.some((o) => o.def.id === view.id)) {
    const def = owned.find((o) => o.def.id === view.id)!.def;
    return (
      <>
        <button className="back" onClick={() => go(view.from === 'collection' ? { at: 'collection' } : { at: 'home' })}>‹ {view.from === 'collection' ? 'Collection' : 'Buddies'}</button>
        <BuddyCard key={def.id} buddies={buddies} def={def} stats={statsFor(def.id)} today={today} title onSlot={onSlot} />
        {sheets}
      </>
    );
  }
  const rest = owned.filter((o) => o.def.id !== lead.id).sort((a, b) => b.def.rarity - a.def.rarity || a.day.localeCompare(b.day));
  return (
    <>
      <div className="bu-top">
        <h1>Buddies</h1>
        <WalletPills w={wallet} />
      </div>
      <BuddyCard key={lead.id} buddies={buddies} def={lead} stats={statsFor(lead.id)} today={today} onSlot={onSlot} />
      <section className="bu-get" aria-label="Get more">
        <button className="primary" onClick={() => setSheet({ at: 'pull', mode: 'pull', banner: 'buddy' })}>Pull<span>{PULL.buddy} points</span></button>
        <button onClick={() => setSheet({ at: 'pull', mode: 'ticket', banner: 'buddy' })}>Ticket<span>{n(wallet.tickets)} left</span></button>
        <button onClick={() => setSheet({ at: 'pull', mode: 'choose', banner: 'buddy' })}>Choose<span>save up</span></button>
      </section>
      <section className="bu-roster" aria-labelledby="bu-roster-h">
        <h2 id="bu-roster-h">Your buddies <span className="muted small">{owned.length} of {BUDDIES.length}</span></h2>
        <ul>
          {[{ def: lead }, ...rest].map(({ def }) => (
            <li key={def.id}>
              <button className={`bu-tile r${def.rarity}`} onClick={() => go({ at: 'card', id: def.id, from: 'home' })}
                aria-label={`${nameOf(buddies, def.id)}, Lv ${statsFor(def.id).lv}${def.id === lead.id ? ', lead' : ''}`}>
                <BuddySprite poses={def.poses} scale={3} />
                <b>{nameOf(buddies, def.id)}</b>
                <span>{def.id === lead.id ? 'Lead · ' : ''}Lv {statsFor(def.id).lv}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <button className="bu-row" onClick={() => go({ at: 'collection' })}>
        <span><b>Collection</b><span className="muted">Every buddy, and the credits</span></span>
        <Icon name="chev-right" size={18} sw={2} />
      </button>
      <section className="card bu-how" aria-label="How buddies grow">
        <p className="small"><b>How they grow.</b> Every buddy gets all the training you log after it joins: Power from PRs and steps up, Size from sets, Grit from sessions and goal weeks, Stamina from cardio. Its trait grows faster.</p>
        <p className="small"><b>Points:</b> 1 a set, 5 a session, 20 a goal week, 1 per 3 cardio minutes, and achievements. Gold and platinum achievements give tickets, each a free pull.</p>
        <p className="small"><b>Accessories</b> are shared: any buddy can wear any you own. Tap a slot on a card to change it.</p>
      </section>
      {sheets}
    </>
  );
}

function WalletPills({ w }: { w: Wallet }) {
  return (
    <p className="bu-wallet">
      <span className="bu-pill"><i className="bu-coin" aria-hidden="true" />{n(w.points)}<span className="sr-only"> {w.points === 1 ? 'point' : 'points'},</span></span>{' '}
      <span className="bu-pill"><i className="bu-ticket" aria-hidden="true" />{n(w.tickets)}<span className="sr-only"> {w.tickets === 1 ? 'ticket' : 'tickets'}</span></span>
    </p>
  );
}

/** The days from `a` to `b`, both YYYY-MM-DD. */
const daysFrom = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8))) / 864e5);

/** "With you 26 weeks: 41 PRs, 12 steps up, 1,530 sets, 88 sessions, 900 cardio minutes." */
export function fromLine(f: BuddyStats['from'], today: string): string {
  const d = daysFrom(f.since, today);
  const when = d < 1 ? 'since today' : d < 14 ? count(d, 'day') : count(Math.floor(d / 7), 'week');
  const parts = [
    f.prs && count(f.prs, 'PR'), f.steps && count(f.steps, 'step up', 'steps up'), f.sets && count(f.sets, 'set'),
    f.sessions && count(f.sessions, 'session'), f.goalWeeks && count(f.goalWeeks, 'goal week'), f.cardioMin && count(f.cardioMin, 'cardio minute'),
  ].filter(Boolean);
  return parts.length ? `With you ${when}: ${parts.join(', ')}.` : `With you ${when}. Every set you log from here on feeds it.`;
}

/** How far a stat's xp (tenths) is from its number to the next: 0–1. */
const toNext = (tenths: number, level: number) => (tenths - 30 * level * level) / (30 * (2 * level + 1));

function BuddyCard({ buddies, def, stats, today, title, onSlot }: {
  buddies: BuddiesStore; def: BuddyDef; stats: BuddyStats; today: string; /** Its own screen: the name is the page's title. */ title?: boolean;
  onSlot: (id: string, slot: Slot) => void;
}) {
  const isLead = buddies.lead?.id === def.id;
  // What it wears, of what's owned (a worn id that no spend landed on isn't shown).
  const has = (x: string | undefined) => (x && buddies.ledger?.owned.has(x) ? x : undefined);
  const eq = buddies.kept?.prefs[def.id]?.equip ?? {};
  const worn: Partial<Record<Slot, string>> = { held: has(eq.held), aura: has(eq.aura), plinth: has(eq.plinth), backdrop: has(eq.backdrop) };
  const name = nameOf(buddies, def.id);
  const [naming, setNaming] = useState<string | null>(null);
  const Name = title ? 'h1' : 'h2';
  return (
    <section className={`bu-card r${def.rarity}`} aria-label={`${name}’s card`}>
      <div className={`bu-hero ${wornClass(worn.backdrop)}${worn.held ? ' has-held' : ''}`}>
        <span className="bu-tag">Lv {n(stats.lv)}</span>
        {isLead && <span className="bu-tag lead">Lead</span>}
        <BuddySprite poses={def.poses} scale={8} className={`bu-hero-sprite ${wornClass(worn.aura)}`} held={worn.held} />
        <i className={worn.plinth ? `bu-plinth ${wornClass(worn.plinth)}` : 'bu-floor'} aria-hidden="true" />
      </div>
      {naming == null ? (
        <div className="bu-name">
          <Name>{name}</Name>
          <span className="bu-meta"><b className="bu-rarity">{RARITY[def.rarity]}</b> · {traitText(def)}</span>
        </div>
      ) : (
        <form className="bu-rename" onSubmit={(e) => { e.preventDefault(); void buddies.rename(def.id, naming).then(() => setNaming(null)); }}>
          <label>Name<input value={naming} maxLength={NAME_MAX} autoFocus enterKeyHint="done" onChange={(e) => setNaming(e.target.value)} placeholder={defaultName(def.id)} /></label>
          <button type="submit" className="primary">Save</button>
          <button type="button" onClick={() => setNaming(null)}>Cancel</button>
        </form>
      )}
      <ul className="bu-stats" aria-label="Stats">
        {STATS.map((s) => (
          <li key={s} className={`bu-stat s-${s}${s === def.trait ? ' trait' : ''}`} aria-label={`${STAT[s]} ${stats.level[s]}${s === def.trait ? ', its trait' : ''}`}>
            <b>{n(stats.level[s])}</b>
            <span>{STAT[s]}</span>
            <i className="bu-bar" aria-hidden="true"><i style={{ width: `${Math.round(toNext(stats.xp[s], stats.level[s]) * 100)}%` }} /></i>
          </li>
        ))}
      </ul>
      <p className="bu-from">{fromLine(stats.from, today)}</p>
      <ul className="bu-slots" aria-label="Wearing">
        {SLOTS.map((s) => {
          const a = worn[s] ? ACCESSORY.get(worn[s]!) : undefined;
          return (
            <li key={s}>
              <button className={a ? `on r${a.rarity}` : ''} onClick={() => onSlot(def.id, s)} aria-label={`${SLOT_NAME[s]}: ${a ? accName(a.id) : 'none'}. Change`}>
                <span>{SLOT_NAME[s]}</span>
                {a ? <AccIcon acc={a} scale={2} /> : <i className="acc-icon none" aria-hidden="true" />}
                <b>{a ? accName(a.id) : 'None'}</b>
              </button>
            </li>
          );
        })}
      </ul>
      {naming == null && (
        <div className="bu-actions">
          {!isLead && <button className="primary" onClick={() => void buddies.makeLead(def.id)}>Make lead</button>}
          <button onClick={() => setNaming(buddies.kept?.prefs[def.id]?.name ?? '')}>Rename</button>
        </div>
      )}
    </section>
  );
}

/** The same small number for the same text: the first pick's seed (FNV-1a). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function FirstPick({ buddies }: { buddies: BuddiesStore }) {
  const pid = useProfileId();
  // The same three on every phone of this profile: seeded by who and the day buddies started.
  const offer = useMemo(() => starterOffer(hash(`${pid}:${buddies.kept?.start}`)).map((id) => BUDDIES.find((b) => b.id === id)!), [pid, buddies.kept?.start]);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h1>Buddies</h1>
      <p>Pick your first buddy. Every set you log from today feeds it.</p>
      <div className="bu-offer" role="group" aria-label="Your first buddy">
        {offer.map((b) => (
          <button key={b.id} className={`bu-tile r${b.rarity}`} aria-pressed={sel === b.id} onClick={() => setSel(b.id)}>
            <BuddySprite poses={b.poses} scale={5} />
            <b>{defaultName(b.id)}</b>
            <span>{STAT[b.trait]} grows faster</span>
          </button>
        ))}
      </div>
      <button className="primary wide" disabled={!sel || busy} onClick={() => { if (sel) { setBusy(true); void buddies.pickFirst(sel).catch(() => setBusy(false)); } }}>
        {sel ? `Pick ${defaultName(sel)}` : 'Tap one to pick it'}
      </button>
      <p className="muted small">More buddies come from points you earn by training, and tickets from gold and platinum achievements.</p>
    </>
  );
}

function Collection({ buddies, onBack, onOpen }: { buddies: BuddiesStore; onBack: () => void; onOpen: (id: string) => void }) {
  const mine = new Set(buddies.owned.map((o) => o.def.id));
  return (
    <>
      <button className="back" onClick={onBack}>‹ Buddies</button>
      <h1>Collection</h1>
      <p className="muted">{mine.size} of {BUDDIES.length}. The ones you haven’t met yet show as shadows.</p>
      {[...RARITIES.keys()].reverse().map((r) => {
        const all = BUDDIES.filter((b) => b.rarity === r);
        return (
          <section key={r} className="bu-coll-group" aria-label={RARITY[r as Rarity]}>
            <h2><span className={`bu-rarity r${r}`}>{RARITY[r as Rarity]}</span> <span className="muted small">{all.filter((b) => mine.has(b.id)).length} of {all.length}</span></h2>
            <ul className="bu-coll">
              {all.map((b) => (
                <li key={b.id}>
                  {mine.has(b.id)
                    ? <button className={`bu-tile r${r}`} onClick={() => onOpen(b.id)} aria-label={nameOf(buddies, b.id)}><BuddySprite poses={b.poses} scale={3} /><b>{nameOf(buddies, b.id)}</b></button>
                    : <div className={`bu-tile r${r} unmet`} role="img" aria-label={`Not met yet, ${RARITY[r as Rarity].toLowerCase()}`}><BuddySprite poses={b.poses.slice(0, 1)} scale={3} shadow /><b aria-hidden="true">?</b></div>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <section className="card" aria-labelledby="bu-credits-h">
        <h2 id="bu-credits-h">Credits</h2>
        <ul className="credits small">
          {CREDIT_ROWS.map((c) => <li key={c.what}>{c.what}: <a href={c.url} target="_blank" rel="noreferrer">{c.by}</a> · CC0</li>)}
        </ul>
      </section>
    </>
  );
}

