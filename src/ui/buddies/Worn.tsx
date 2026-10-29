import { ACCESSORIES, ACCESSORY, type AccDef, type Slot } from '../../domain/buddies/roster';
import { spriteUrl, SPRITE } from './BuddySprite';

// The wardrobe (Gym Buddies plan §16.10 stage 5): what a buddy wears, one per slot, from the accessories you own (shared: any
// buddy may wear any of them). Held items are Tiny sprites resting on the head anchor (ui/buddies/BuddySprite); auras, plinths
// and backdrops are CSS (styles.css, `.au-*`, `.pl-*`, `.bg-*`) on the hero.

export const SLOT_NAME: Record<Slot, string> = { held: 'Held', aura: 'Aura', plinth: 'Plinth', backdrop: 'Backdrop' };

const NAMES: Record<string, string> = {
  d075: 'Iron helm', d102: 'Wooden shield', d103: 'Round shield', d104: 'Dagger', d105: 'Short sword', d106: 'Cleaver',
  d107: 'Broadsword', d108: 'Bronze sword', d118: 'Hammer', d119: 'Battle axe', d120: 'Axe', d130: 'Amethyst staff',
  d131: 'Crystal staff', d132: 'Spear', t094: 'Hay bale', t095: 'Beehive', t106: 'Bomb', t107: 'Log',
  'aura-mint': 'Mint aura', 'aura-sky': 'Sky aura', 'aura-peach': 'Peach aura', 'aura-lilac': 'Lilac aura', 'aura-ember': 'Ember aura', 'aura-gold': 'Gold aura',
  'plinth-wood': 'Stump', 'plinth-stone': 'Stone', 'plinth-rubber': 'Gym mat', 'plinth-plate': 'Weight plate', 'plinth-grass': 'Grass', 'plinth-podium': 'Podium',
  'bg-dawn': 'Dawn', 'bg-dusk': 'Dusk', 'bg-gym': 'Gym', 'bg-park': 'Park', 'bg-stage': 'Spotlight', 'bg-stars': 'Stars',
};
export const accName = (id: string) => NAMES[id] ?? id;

/** The CSS class a worn CSS accessory puts on the hero (aura: on the sprite; plinth: the stand; backdrop: the hero). */
export const wornClass = (id: string | undefined) => (id && ACCESSORY.has(id) ? `w-${id}` : '');

/** One accessory as a small picture: the item's sprite, or a swatch of the CSS one. */
export function AccIcon({ acc, scale = 3 }: { acc: AccDef; scale?: number }) {
  const px = SPRITE * scale;
  if (acc.sprite) return <span className="acc-icon" style={{ width: px, height: px }} aria-hidden="true"><img src={spriteUrl(acc.id)} width={px} height={px} alt="" draggable={false} /></span>;
  return <span className={`acc-icon acc-${acc.slot} w-${acc.id}`} style={{ width: px, height: px }} aria-hidden="true"><i /></span>;
}

/** A slot's sheet: the accessories of that slot you own, and None. A tap puts it on (or takes it off) at once. */
export function WardrobeSheet({ slot, wearing, owned, name, onPick, onClose, onGetMore }: {
  slot: Slot; wearing: string | undefined; owned: ReadonlySet<string>; name: string;
  onPick: (acc: string | null) => void; onClose: () => void; onGetMore: () => void;
}) {
  const all = ACCESSORIES.filter((a) => a.slot === slot);
  const mine = all.filter((a) => owned.has(a.id));
  return (
    <>
      <div className="sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <section className="sheet bu-sheet" role="dialog" aria-modal="true" aria-label={`${name}’s ${SLOT_NAME[slot].toLowerCase()}`}>
        <div className="sheet-head">
          <h2>{SLOT_NAME[slot]} <span className="muted small">{mine.length} of {all.length}</span></h2>
          <button className="mini" onClick={onClose}>Done</button>
        </div>
        <div className="bu-sheet-body">
          <ul className="bu-wardrobe" aria-label={`${SLOT_NAME[slot]} you own`}>
            <li><button className="bu-tile" aria-pressed={!wearing} onClick={() => onPick(null)}><span className="acc-icon none" style={{ width: 48, height: 48 }} aria-hidden="true" /><b>None</b></button></li>
            {mine.map((a) => (
              <li key={a.id}>
                <button className={`bu-tile r${a.rarity}`} aria-pressed={wearing === a.id} onClick={() => onPick(a.id)}>
                  <AccIcon acc={a} /><b>{accName(a.id)}</b>
                </button>
              </li>
            ))}
          </ul>
          {mine.length < all.length && (
            <p className="small muted">{all.length - mine.length} more to find. <button className="link" onClick={onGetMore}>Pull for accessories</button></p>
          )}
        </div>
      </section>
    </>
  );
}
