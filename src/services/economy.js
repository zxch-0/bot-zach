// ============================================================
// ZachServices — Service économie
// Solde, /daily (réservé aux membres ayant 1 invitation réussie),
// mises du casino. Tout passe par la couche de stockage atomique.
// ============================================================
const config = require('../config');
const { fmtTimeLeft } = require('../utils/format');

/**
 * Retourne le solde d'un utilisateur (0 si inconnu).
 */
async function getBalance(store, userId) {
  const user = await store.getUser(userId);
  return user.balance;
}

/**
 * Retourne les meilleurs soldes du serveur.
 */
async function topBalances(store, limit = 10) {
  return store.topBalances(limit);
}

/**
 * Crédite un montant (peut être négatif pour retirer) — utilisé par /give (admin).
 */
async function credit(store, userId, amount) {
  return store.credit(userId, amount);
}

/**
 * Tente de débiter une mise. Retourne le nouveau solde, ou null si solde insuffisant.
 */
async function tryDebit(store, userId, amount) {
  return store.debit(userId, amount);
}

/**
 * Tente de récupérer le /daily.
 * Conditions : au moins 1 invitation réussie + cooldown écoulé.
 * Retour :
 *   { status: 'ok', balance, reward }
 *   { status: 'cooldown', nextAvailableAt, timeLeft }
 *   { status: 'no_invite', inviteCount }
 */
async function claimDaily(store, userId) {
  const invites = await store.getInviteCount(userId);
  const totalInvites = invites.count + invites.imported;
  if (totalInvites < 1) {
    return { status: 'no_invite', inviteCount: 0 };
  }

  const user = await store.getUser(userId);
  const now = Date.now();
  const last = user.lastDaily ?? 0;

  if (now - last < config.dailyCooldownMs) {
    const nextAvailableAt = last + config.dailyCooldownMs;
    return {
      status: 'cooldown',
      nextAvailableAt,
      timeLeft: fmtTimeLeft(nextAvailableAt - now),
    };
  }

  // Mise à jour atomique du timestamp (évite les doubles /daily en rafale)
  const updated = await store.setLastDailyIfUnchanged(userId, user.lastDaily, now);
  if (!updated) {
    const fresh = await store.getUser(userId);
    const nextAvailableAt = (fresh.lastDaily ?? 0) + config.dailyCooldownMs;
    return { status: 'cooldown', nextAvailableAt, timeLeft: fmtTimeLeft(nextAvailableAt - now) };
  }

  const balance = await store.credit(userId, config.dailyReward);
  return { status: 'ok', balance, reward: config.dailyReward };
}

module.exports = { getBalance, topBalances, credit, tryDebit, claimDaily };
