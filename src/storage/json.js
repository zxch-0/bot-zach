// ============================================================
// ZachServices — Pilote de stockage JSON (fichier local)
// Toute la base est chargée en mémoire, puis sauvegardée sur disque
// de façon atomique (écriture temporaire + renommage) avec anti-rebond.
// Idéal pour un usage local ou un hébergeur avec disque persistant.
// ============================================================
const fs = require('fs');
const path = require('path');
const { Store } = require('./index');

const SAVE_DEBOUNCE_MS = 250;

function emptyDb() {
  return {
    users: {}, // userId -> { balance, lastDaily, createdAt }
    inviteCounts: {}, // inviterId -> { count, imported }
    joinRecords: {}, // memberId -> { inviterId, joinedAt, leftAt }
    purchases: [], // { id, userId, username, deliveryUsername, productId, price, createdAt }
  };
}

class JsonStore extends Store {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.db = emptyDb();
    this._saveTimer = null;
  }

  async init() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (fs.existsSync(this.filePath)) {
      try {
        this.db = { ...emptyDb(), ...JSON.parse(fs.readFileSync(this.filePath, 'utf8')) };
      } catch (err) {
        console.error(`[stockage] Fichier ${this.filePath} illisible, nouvelle base créée (${err.message})`);
        // On conserve l'ancien fichier en sécurité plutôt que l'écraser
        const backup = `${this.filePath}.corrupt-${Date.now()}`;
        try { fs.copyFileSync(this.filePath, backup); } catch {}
      }
    }
    // Sauvegarde de sécurité à la fermeture du process
    process.on('exit', () => this._saveSync());
  }

  async close() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._saveSync();
  }

  _saveSync() {
    try {
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('[stockage] Échec de sauvegarde JSON :', err.message);
    }
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saveSync();
    }, SAVE_DEBOUNCE_MS);
  }

  _user(userId) {
    if (!this.db.users[userId]) {
      this.db.users[userId] = { balance: 0, lastDaily: null, createdAt: Date.now() };
      this._scheduleSave();
    }
    return this.db.users[userId];
  }

  /* --- Utilisateurs / économie --- */

  async getUser(userId) {
    const u = this._user(userId);
    return { userId, balance: u.balance, lastDaily: u.lastDaily, createdAt: u.createdAt };
  }

  async credit(userId, amount) {
    const u = this._user(userId);
    u.balance += amount;
    this._scheduleSave();
    return u.balance;
  }

  async debit(userId, amount) {
    const u = this._user(userId);
    if (u.balance < amount) return null;
    u.balance -= amount;
    this._scheduleSave();
    return u.balance;
  }

  async setLastDailyIfUnchanged(userId, previousLastDaily, newLastDaily) {
    const u = this._user(userId);
    if ((u.lastDaily ?? null) !== (previousLastDaily ?? null)) return false;
    u.lastDaily = newLastDaily;
    this._scheduleSave();
    return true;
  }

  async topBalances(limit) {
    return Object.entries(this.db.users)
      .filter(([, u]) => u.balance > 0)
      .sort((a, b) => b[1].balance - a[1].balance)
      .slice(0, limit)
      .map(([userId, u]) => ({ userId, balance: u.balance }));
  }

  /* --- Invitations --- */

  _inviter(inviterId) {
    if (!this.db.inviteCounts[inviterId]) {
      this.db.inviteCounts[inviterId] = { count: 0, imported: 0 };
      this._scheduleSave();
    }
    return this.db.inviteCounts[inviterId];
  }

  async getInviteCount(userId) {
    const entry = this.db.inviteCounts[userId] || { count: 0, imported: 0 };
    return { count: entry.count, imported: entry.imported };
  }

  async recordJoin(memberId, inviterId, ts = Date.now()) {
    const existing = this.db.joinRecords[memberId];
    if (existing && existing.leftAt === null) return false; // déjà compté comme présent
    if (existing) {
      // Le membre était parti et revient via une (éventuellement autre) invitation
      existing.inviterId = inviterId;
      existing.joinedAt = ts;
      existing.leftAt = null;
    } else {
      this.db.joinRecords[memberId] = { inviterId, joinedAt: ts, leftAt: null };
    }
    this._inviter(inviterId).count += 1;
    this._scheduleSave();
    return true;
  }

  async recordLeave(memberId, ts = Date.now()) {
    const record = this.db.joinRecords[memberId];
    if (!record || record.leftAt !== null) return false;
    record.leftAt = ts;
    const entry = this.db.inviteCounts[record.inviterId];
    if (entry && entry.count > 0) entry.count -= 1;
    this._scheduleSave();
    return true;
  }

  async importInvites(mapUserIdToUses) {
    const summary = [];
    for (const [inviterId, uses] of Object.entries(mapUserIdToUses)) {
      const entry = this._inviter(inviterId);
      entry.imported = Math.max(entry.imported, uses);
      summary.push({ userId: inviterId, imported: entry.imported });
      this._scheduleSave();
    }
    return summary;
  }

  /* --- Achats --- */

  async addPurchase(purchase) {
    const id = this.db.purchases.length + 1;
    this.db.purchases.push({ id, ...purchase });
    this._scheduleSave();
    return id;
  }
}

module.exports = { JsonStore };
