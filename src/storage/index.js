// ============================================================
// ZachServices — Couche de stockage
// Deux pilotes interchangeables, choisis via DATABASE_DRIVER :
//   - json     : fichier data/zach.json (local, zéro configuration)
//   - postgres : base PostgreSQL distante (Render + Neon, etc.)
// Les deux pilotes exposent EXACTEMENT la même interface asynchrone.
// (Les @returns {Promise<any>} servent uniquement à la vérification
//  statique tsc : chaque pilote définit ses types de retour précis.)
// ============================================================

class Store {
  /* --- Cycle de vie --- */
  /** @returns {Promise<any>} */
  async init() {} // appelé au démarrage
  /** @returns {Promise<any>} */
  async close() {} // appelé à l'arrêt (flush / fermeture du pool)

  /* --- Utilisateurs / économie --- */
  /** @returns {Promise<any>} -> { userId, balance, lastDaily, createdAt } */
  async getUser(userId) {}
  /** @returns {Promise<any>} -> nouveau solde */
  async credit(userId, amount) {}
  /** @returns {Promise<any>} -> nouveau solde, ou null si solde insuffisant */
  async debit(userId, amount) {}
  /** @returns {Promise<any>} -> boolean (CAS atomique) */
  async setLastDailyIfUnchanged(userId, previousLastDaily, newLastDaily) {}
  /** @returns {Promise<any>} -> [{ userId, balance }] */
  async topBalances(limit) {}

  /* --- Invitations --- */
  /** @returns {Promise<any>} -> { count, imported } */
  async getInviteCount(userId) {}
  /** @returns {Promise<any>} -> boolean */
  async recordJoin(memberId, inviterId, ts) {}
  /** @returns {Promise<any>} -> boolean */
  async recordLeave(memberId, ts) {}
  /** @returns {Promise<any>} -> [{ userId, imported }] */
  async importInvites(mapUserIdToUses) {}

  /* --- Achats --- */
  /** @returns {Promise<any>} -> id */
  async addPurchase(purchase) {}

  /* --- Produits de la boutique (gérés via /produit) --- */
  /** @returns {Promise<any>} -> [{ id, name, emoji, price, description }] */
  async listProducts() {}
  /** @returns {Promise<any>} -> produit ou null */
  async getProductById(productId) {}
  /** @returns {Promise<any>} -> produit créé */
  async addProduct(product) {}
  /** @returns {Promise<any>} -> produit supprimé ou null */
  async removeProduct(productId) {}
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
