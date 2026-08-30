// ============================================================
// ZachServices — Pierre-feuille-ciseaux (partie logique pure)
// Joué contre le bot (choix aléatoire). Gagné = mise doublée,
// égalité = mise remboursée.
// ============================================================

const CHOICES = {
  pierre: { emoji: '🪨', beats: 'ciseaux' },
  feuille: { emoji: '📄', beats: 'pierre' },
  ciseaux: { emoji: '✂️', beats: 'feuille' },
};

const CHOICE_KEYS = Object.keys(CHOICES);

/** Le bot choisit (rng injectable pour les tests). */
function botPick(rng = Math.random) {
  return CHOICE_KEYS[Math.floor(rng() * CHOICE_KEYS.length)];
}

/** Résultat du point de vue du joueur : 'win' | 'lose' | 'tie'. */
function resolveRps(playerChoice, botChoice) {
  if (playerChoice === botChoice) return 'tie';
  if (CHOICES[playerChoice].beats === botChoice) return 'win';
  return 'lose';
}

/** Gain retourné au joueur (la mise a déjà été débitée). */
function payoutFor(outcome, stake) {
  if (outcome === 'win') return stake * 2;
  if (outcome === 'tie') return stake;
  return 0;
}

module.exports = { CHOICES, CHOICE_KEYS, botPick, resolveRps, payoutFor };
