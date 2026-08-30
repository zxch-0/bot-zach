// ============================================================
// ZachServices — Blackjack (partie logique pure, testable sans Discord)
// Règles : croupier tire jusqu'à 17 (il s'arrête sur tous les 17),
// blackjack naturel payé 2,5x, victoire 2x, égalité mise remboursée.
// ============================================================

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠️', '♥️', '♦️', '♣️'];

/** Crée et mélange un sabot de `deckCount` jeux de 52 cartes (mélange Fisher-Yates). */
function createDeck(deckCount = 1, rng = Math.random) {
  const cards = [];
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ rank, suit });
      }
    }
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/** Valeur d'une main. Retourne { total, soft } — soft = un as compté 11. */
function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') {
      aces += 1;
      total += 11;
    } else if (['J', 'Q', 'K'].includes(card.rank)) {
      total += 10;
    } else {
      total += parseInt(card.rank, 10);
    }
  }
  let soft = aces > 0;
  while (total > 21 && aces > 0) {
    total -= 10; // un as repasse de 11 à 1
    aces -= 1;
    if (aces === 0) soft = false;
  }
  return { total, soft };
}

/** Blackjack naturel : exactement 2 cartes totalisant 21. */
function isNatural(cards) {
  return cards.length === 2 && handValue(cards).total === 21;
}

/** Le croupier doit-il encore tirer ? (règle "stand on all 17") */
function dealerShouldHit(cards) {
  return handValue(cards).total < 17;
}

/** Le croupier joue son coup : pioche tant que < 17. Retourne sa main finale. */
function dealerPlay(dealerHand, deck) {
  const hand = [...dealerHand];
  while (dealerShouldHit(hand)) {
    hand.push(deck.pop());
  }
  return hand;
}

/**
 * Retourne 'win' | 'lose' | 'push'.
 */
function compareHands(playerHand, dealerHand) {
  const p = handValue(playerHand).total;
  const d = handValue(dealerHand).total;
  if (p > 21) return 'lose';
  if (d > 21) return 'win';
  if (p > d) return 'win';
  if (p < d) return 'lose';
  return 'push';
}

/** Gain total retourné au joueur selon l'issue (la mise a déjà été débitée). */
function payoutFor(outcome, stake, natural = false) {
  if (outcome === 'win') return natural ? Math.floor(stake * 2.5) : stake * 2;
  if (outcome === 'push') return stake;
  return 0;
}

/** Affichage d'une main : "A♠️ + K♥️" (main du croupier masquée si `hideFirst`). */
function formatHand(cards, hideFirst = false) {
  if (hideFirst) {
    const rest = cards.slice(1).map((c) => `${c.rank}${c.suit}`).join(' + ');
    return `🂠 + ${rest}`;
  }
  return cards.map((c) => `${c.rank}${c.suit}`).join(' + ');
}

module.exports = {
  RANKS,
  SUITS,
  createDeck,
  handValue,
  isNatural,
  dealerShouldHit,
  dealerPlay,
  compareHands,
  payoutFor,
  formatHand,
};
