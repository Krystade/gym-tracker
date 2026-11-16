import { canSpend, multiBill, MULTI, payWith, pityIn, PULL, type Ledger, type MultiBill, type Wallet } from '../../domain/buddies/gacha';
import type { Banner } from '../../domain/buddies/roster';
import { Icon } from '../icons';

// The Buddies tab's pulls, up front (owner 2026-11-15: the gambling and the tickets much more prominent): the tickets you have
// as a ticket, and each banner with its pull (a ticket first while you have one, else points), its ten pulls (tickets first,
// then points: what it will spend, said on the button) and how far pity is ("rare in 7 · epic in 33", a tap for the odds).
// A pull starts its show at once (ui/buddies/PullShow); nothing is spent that the button didn't say.

export const BANNER: Record<Banner, string> = { buddy: 'Buddies', acc: 'Accessories' };
const n = (x: number) => x.toLocaleString('en-US');

/** "3 tickets + 105 pts", "10 tickets", "150 pts". */
export function billText(b: Pick<MultiBill, 'tickets' | 'points'>): string {
  return [b.tickets && `${b.tickets} ${b.tickets === 1 ? 'ticket' : 'tickets'}`, b.points && `${n(b.points)} pts`].filter(Boolean).join(' + ') || 'free';
}
/** The one pull's label and what it costs, from the wallet as it is. */
export function onePull(w: Wallet, l: Ledger, b: Banner): { label: string; sub: string; ok: boolean } {
  const how = payWith(w), ok = canSpend(w, l, { kind: how, banner: b, got: null });
  return how === 'ticket' ? { label: 'Pull with ticket', sub: '1 ticket', ok } : { label: 'Pull', sub: ok ? `${PULL[b]} pts` : `needs ${PULL[b]} pts`, ok };
}
/** The ten pulls' label and bill. */
export function tenPulls(w: Wallet, b: Banner): { label: string; sub: string; ok: boolean; bill: MultiBill } {
  const bill = multiBill(w, b);
  return { label: `${MULTI} pulls`, sub: bill.ok ? billText(bill) : `${n(bill.short)} more pts needed`, ok: bill.ok, bill };
}

export function TicketStub({ tickets }: { tickets: number }) {
  return (
    <div className={`bu-tix${tickets ? '' : ' none'}`} aria-label={tickets ? `${n(tickets)} ${tickets === 1 ? 'ticket' : 'tickets'}` : 'No tickets yet'} role="group">
      <b className="bu-tix-n" aria-hidden="true">{n(tickets)}</b>
      <span className="bu-tix-text">
        <b>{tickets === 1 ? 'Ticket' : 'Tickets'}</b>
        <span>{tickets ? 'Each one is a free pull, on either banner.' : 'Goal weeks and every 5 sessions earn them.'}</span>
      </span>
    </div>
  );
}

export function PullBooth({ wallet, ledger, busy, onPull, onTen, onOdds, onChoose }: {
  wallet: Wallet; ledger: Ledger; /** A pull is still being kept: no second one yet. */ busy: boolean;
  onPull: (b: Banner) => void; onTen: (b: Banner) => void; onOdds: (b: Banner) => void; onChoose: () => void;
}) {
  return (
    <section className="bu-get" aria-label="Get more">
      <TicketStub tickets={wallet.tickets} />
      {(['buddy', 'acc'] as const).map((b) => {
        const p = pityIn(ledger, b), one = onePull(wallet, ledger, b), ten = tenPulls(wallet, b);
        return (
          <section key={b} className={`bu-banner ${b}`} aria-label={`${BANNER[b]} banner`}>
            <div className="bu-banner-head">
              <h2>{BANNER[b]}</h2>
              <button className="bu-pity" onClick={() => onOdds(b)} aria-label={`Odds: rare in ${p.rare}, epic in ${p.epic}`}>
                <span className="r2">rare in <b>{p.rare}</b></span><span className="sep" aria-hidden="true">·</span><span className="r3">epic in <b>{p.epic}</b></span>
                <Icon name="chev-right" size={14} sw={2.25} />
              </button>
            </div>
            <div className="bu-banner-go">
              <button className={`primary bu-go${one.label !== 'Pull' ? ' ticket' : ''}`} disabled={!one.ok || busy} onClick={() => onPull(b)} aria-label={`${one.label}: ${one.sub}`}>
                <b>{one.label}</b><span>{one.sub}</span>
              </button>
              <button className="bu-go ten" disabled={!ten.ok || busy} onClick={() => onTen(b)} aria-label={`${ten.label}: ${ten.sub}`}>
                <b>{ten.label}</b><span>{ten.sub}</span>
              </button>
            </div>
          </section>
        );
      })}
      <button className="bu-row bu-choose" onClick={onChoose}>
        <span><b>Choose one</b><span className="muted">Pick the one you want: it costs far more</span></span>
        <Icon name="chev-right" size={18} sw={2} />
      </button>
    </section>
  );
}
