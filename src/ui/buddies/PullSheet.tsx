import { useState } from 'react';
import { canSpend, choose, CHOOSE, ODDS, pityIn, pull, PULL, REFUND, type Ledger, type Spend, type Wallet } from '../../domain/buddies/gacha';
import { ACCESSORY, BUDDY, POOL, RARITIES, type Banner, type Rarity } from '../../domain/buddies/roster';
import { BuddySprite } from './BuddySprite';
import { AccIcon, accName, SLOT_NAME } from './Worn';

// Pulls, tickets and choosing (Gym Buddies plan §16.10 stage 5, odds and prices from domain/buddies/gacha): one sheet in three
// modes, on either banner. It shows the odds, what's left to find at each rarity, and how far pity is; a pull is rolled once
// here (a fresh random seed), kept as a spend, and revealed in under a second (transform and opacity only, none under reduced
// motion). Landing on a rarity you've completed gives part of the price back, and says so.

export type Mode = 'pull' | 'ticket' | 'choose';
const RARITY: Record<Rarity, string> = { 0: 'Common', 1: 'Uncommon', 2: 'Rare', 3: 'Epic', 4: 'Legendary' };
const BANNER: Record<Banner, string> = { buddy: 'Buddies', acc: 'Accessories' };
const TITLE: Record<Mode, string> = { pull: 'Pull', ticket: 'Use a ticket', choose: 'Choose one' };
const pct = (x: number) => `${Math.round(x * 100)}%`;
const pts = (x: number) => `${x.toLocaleString('en-US')} ${x === 1 ? 'point' : 'points'}`;

/** What a pull or a choice landed on, by name. */
export const nameOfItem = (id: string, names: (id: string) => string) => (BUDDY.has(id) ? names(id) : accName(id));

const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];

export function PullSheet({ mode: first, banner: firstBanner, ledger, wallet, today, names, onSpend, onClose, onOpen }: {
  mode: Mode; banner: Banner; ledger: Ledger; wallet: Wallet; today: string;
  /** A buddy's name (its own, else its roster name). */ names: (id: string) => string;
  onSpend: (s: Spend) => Promise<void>; onClose: () => void;
  /** Opens what was landed on: a buddy's card, or the lead's card to wear an accessory. */ onOpen: (s: Spend) => void;
}) {
  const [mode, setMode] = useState<Mode>(first);
  const [banner, setBanner] = useState<Banner>(firstBanner);
  const [picked, setPicked] = useState<string | null>(null);
  const [shown, setShown] = useState<Spend | null>(null);
  const [busy, setBusy] = useState(false);
  const pity = pityIn(ledger, banner);
  const left = (r: number) => POOL[banner].filter((x) => x.rarity === r && !ledger.owned.has(x.id)).length;

  const go = (s: Spend) => {
    setBusy(true);
    void onSpend(s).then(() => { setShown(s); setPicked(null); }).finally(() => setBusy(false));
  };
  const roll = (how: 'pull' | 'ticket') => go(pull(ledger, banner, how, seed(), Date.now(), today));

  const can = mode === 'choose' ? !!picked && canSpend(wallet, ledger, { kind: 'choose', banner, got: picked })
    : canSpend(wallet, ledger, { kind: mode, banner, got: null });
  const pickedDef = picked ? POOL[banner].find((x) => x.id === picked) : undefined;

  return (
    <>
      <div className="sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <section className="sheet bu-sheet" role="dialog" aria-modal="true" aria-label={TITLE[mode]}>
        <div className="sheet-head">
          <h2>{TITLE[mode]}</h2>
          <span className="bu-sheet-wallet small"><i className="bu-coin" aria-hidden="true" />{wallet.points.toLocaleString('en-US')}<span className="sr-only"> points,</span> <i className="bu-ticket" aria-hidden="true" />{wallet.tickets}<span className="sr-only"> tickets</span></span>
          <button className="mini" onClick={onClose}>Done</button>
        </div>
        <div className="st-range bu-seg" role="group" aria-label="Mode">
          {(['pull', 'ticket', 'choose'] as const).map((m) => <button key={m} aria-pressed={mode === m} onClick={() => { setMode(m); setShown(null); setPicked(null); }}>{m === 'pull' ? 'Pull' : m === 'ticket' ? 'Ticket' : 'Choose'}</button>)}
        </div>
        <div className="st-range bu-seg two" role="group" aria-label="Banner">
          {(['buddy', 'acc'] as const).map((b) => <button key={b} aria-pressed={banner === b} onClick={() => { setBanner(b); setShown(null); setPicked(null); }}>{BANNER[b]}</button>)}
        </div>
        <div className="bu-sheet-body">
          {shown && <Reveal s={shown} names={names} onOpen={() => onOpen(shown)} />}
          {mode !== 'choose' ? (
            <>
              <table className="bu-odds" aria-label={`Odds, ${BANNER[banner].toLowerCase()}`}>
                <thead><tr><th scope="col">Rarity</th><th scope="col">Odds</th><th scope="col">Left to find</th></tr></thead>
                <tbody>
                  {RARITIES.map((_, r) => (
                    <tr key={r} className={`r${r}`}>
                      <th scope="row"><span className="bu-rarity">{RARITY[r as Rarity]}</span></th>
                      <td>{pct(ODDS[r])}</td>
                      <td>{left(r) ? left(r) : <span className="muted">all yours · {Math.round(PULL[banner] * REFUND[r])} back</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="bu-pity small">Rare or better within <b>{pity.rare}</b> {pity.rare === 1 ? 'pull' : 'pulls'} · epic or better within <b>{pity.epic}</b>. Tickets count.</p>
              {mode === 'pull'
                ? <button className="primary wide" disabled={!can || busy} onClick={() => roll('pull')}>{can ? `Pull for ${pts(PULL[banner])}` : `Pull needs ${pts(PULL[banner])}`}</button>
                : <button className="primary wide" disabled={!can || busy} onClick={() => roll('ticket')}>{wallet.tickets ? `Use a ticket (${wallet.tickets} left)` : 'No tickets yet'}</button>}
              {mode === 'ticket' && !wallet.tickets && <p className="small muted">Gold and platinum achievements give tickets. A ticket is a free pull on either banner.</p>}
            </>
          ) : (
            <>
              <p className="small muted">Saving up costs more than pulling, but you get the one you want.</p>
              {[...RARITIES.keys()].reverse().map((r) => {
                const xs = POOL[banner].filter((x) => x.rarity === r && !ledger.owned.has(x.id));
                if (!xs.length) return null;
                return (
                  <section key={r} className="bu-choose-group" aria-label={`${RARITY[r as Rarity]}, ${pts(CHOOSE[banner][r])} each`}>
                    <h3><span className={`bu-rarity r${r}`}>{RARITY[r as Rarity]}</span> <span className="muted small">{pts(CHOOSE[banner][r])}</span></h3>
                    <ul className="bu-coll">
                      {xs.map((x) => (
                        <li key={x.id}>
                          <button className={`bu-tile r${r}`} aria-pressed={picked === x.id} onClick={() => { setPicked(x.id); setShown(null); }}>
                            {banner === 'buddy' ? <BuddySprite poses={BUDDY.get(x.id)!.poses.slice(0, 1)} scale={3} /> : <AccIcon acc={ACCESSORY.get(x.id)!} />}
                            <b>{nameOfItem(x.id, names)}</b>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </>
          )}
        </div>
        {mode === 'choose' && (
          <button className="primary wide bu-choose-go" disabled={!can || busy} onClick={() => picked && go(choose(banner, picked, Date.now(), today))}>
            {!pickedDef ? 'Tap one to choose it' : can ? `Choose ${nameOfItem(pickedDef.id, names)} for ${pts(CHOOSE[banner][pickedDef.rarity])}` : `${nameOfItem(pickedDef.id, names)} needs ${pts(CHOOSE[banner][pickedDef.rarity])}`}
          </button>
        )}
      </section>
    </>
  );
}

/** What a spend landed on, revealed (≤ 1 s, transform and opacity only), or the refund when its rarity was complete. */
function Reveal({ s, names, onOpen }: { s: Spend; names: (id: string) => string; onOpen: () => void }) {
  const acc = s.got ? ACCESSORY.get(s.got) : undefined, bud = s.got ? BUDDY.get(s.got) : undefined;
  return (
    <div className={`bu-reveal r${s.rarity}`} role="status" key={s.id}>
      {s.got ? (
        <>
          <span className="bu-reveal-art">{bud ? <BuddySprite poses={bud.poses} scale={5} /> : acc && <AccIcon acc={acc} scale={5} />}</span>
          <span className="bu-reveal-text">
            <span className="bu-rarity">{RARITY[s.rarity]}{acc ? ` ${SLOT_NAME[acc.slot].toLowerCase()}` : ''}</span>
            <b>{bud ? names(s.got) : accName(s.got)}</b>
            <span className="small muted">New{bud ? ' buddy' : ''}: it’s yours.</span>
            <button className="mini" onClick={onOpen}>{bud ? 'See its card' : 'Wear it'}</button>
          </span>
        </>
      ) : (
        <span className="bu-reveal-text">
          <span className="bu-rarity">{RARITY[s.rarity]}</span>
          <b>{s.refund} points back</b>
          <span className="small muted">You have every {RARITY[s.rarity].toLowerCase()} {s.banner === 'buddy' ? 'buddy' : 'accessory'} already, so part of the price came back.</span>
        </span>
      )}
    </div>
  );
}
