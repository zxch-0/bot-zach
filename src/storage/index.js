// ============================================================
// ZachServices — Couche de stockage
// Deux pilotes interchangeables, choisis via DATABASE_DRIVER :
//   - json     : fichier data/zach.json (local, zéro configuration)
//   - postgres : base PostgreSQL distante (Render + Neon, etc.)
// Les deux pilotes exposent EXACTEMENT la même interface asynchrone.
// ============================================================

class Store {
  /* --- Cycle de vie --- */
  async init() {} // appelé au démarrage
  async close() {} // appelé à l'arrêt (flush / fermeture du pool)

  /* --- Utilisateurs / économie --- */
  async getUser(userId) {} // -> { userId, balance, lastDaily, createdAt }
  async credit(userId, amount) {} // -> nouveau solde
  async debit(userId, amount) {} // -> nouveau solde, ou null si solde insuffisant
  async setLastDailyIfUnchanged(userId, previousLastDaily, newLastDaily) {} // -> boolean (CAS atomique)
  async topBalances(limit) {} // -> [{ userId, balance }]

  /* --- Invitations --- */
  async getInviteCount(userId) {} // -> { count, imported } (membres présents + importés)
  async recordJoin(memberId, inviterId, ts) {} // compte une invitation réussie
  async recordLeave(memberId, ts) {} // décompte si le membre invité part
  async importInvites(mapUserIdToUses) {} // import admin des invitations existantes

  /* --- Achats --- */
  async addPurchase(purchase) {} // -> id
}

module.exports = {
  Store,
  async createStore(config) {
    if (config.driver === 'postgres') {
      const { PostgresStore } = require('./postgres');
      return new PostgresStore(config.databaseUrl);
    }
    const { JsonStore } = require('./json');
    return new JsonStore(config.jsonFile);
  },
};
