// ============================================================
// ZachServices — Pilote de stockage PostgreSQL
// Pensé pour les hébergeurs gratuits au disque éphémère (Render, etc.)
// utilisés avec une base PostgreSQL gratuite et persistante (Neon, Supabase...).
// Les débits et le /daily sont faits avec des UPDATE atomiques
// (impossible de passer en solde négatif, même avec des clics simultanés).
// ============================================================
const { Pool } = require('pg');
const { Store } = require('./index');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  user_id   TEXT PRIMARY KEY,
  balance   BIGINT NOT NULL DEFAULT 0,
  last_daily BIGINT,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS invite_counts (
  user_id  TEXT PRIMARY KEY,
  count    INTEGER NOT NULL DEFAULT 0,
  imported INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS join_records (
  member_id TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL,
  joined_at BIGINT NOT NULL,
  left_at   BIGINT
);
CREATE TABLE IF NOT EXISTS purchases (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT,
  delivery_username TEXT NOT NULL,
  product_id TEXT NOT NULL,
  price BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
`;

class PostgresStore extends Store {
  constructor(connectionString) {
    super();
    if (!connectionString) {
      throw new Error('DATABASE_URL est vide : impossible d\'utiliser le pilote postgres.');
    }
    let ssl = undefined;
    try {
      const host = new URL(fixProtocol(connectionString)).hostname;
      if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
        ssl = { rejectUnauthorized: false }; // requis par Neon et la plupart des hébergeurs cloud
      }
    } catch {}
    this.pool = new Pool({ connectionString: fixProtocol(connectionString), ssl, max: 3 });
  }

  /** Neon etc. acceptent les deux schémas ; on normalise vers postgresql:// */
  static normalize(connectionString) {
    return fixProtocol(connectionString);
  }

  async init() {
    await this.pool.query(SCHEMA);
  }

  async close() {
    await this.pool.end();
  }

  async query(sql, params) {
    const res = await this.pool.query(sql, params);
    return res.rows;
  }

  /* --- Utilisateurs / économie --- */

  async getUser(userId) {
    await this.query(
      'INSERT INTO users (user_id, created_at) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
      [userId, Date.now()]
    );
    const rows = await this.query('SELECT user_id, balance, last_daily, created_at FROM users WHERE user_id = $1', [userId]);
    const r = rows[0];
    return {
      userId: r.user_id,
      balance: Number(r.balance),
      lastDaily: r.last_daily === null ? null : Number(r.last_daily),
      createdAt: Number(r.created_at),
    };
  }

  async credit(userId, amount) {
    await this.getUser(userId); // crée la ligne si besoin
    const rows = await this.query(
      'UPDATE users SET balance = balance + $2 WHERE user_id = $1 RETURNING balance',
      [userId, amount]
    );
    return Number(rows[0].balance);
  }

  async debit(userId, amount) {
    await this.getUser(userId);
    // Atomique : ne débite que si le solde suffit
    const rows = await this.query(
      'UPDATE users SET balance = balance - $2 WHERE user_id = $1 AND balance >= $2 RETURNING balance',
      [userId, amount]
    );
    return rows.length ? Number(rows[0].balance) : null;
  }

  async setLastDailyIfUnchanged(userId, previousLastDaily, newLastDaily) {
    await this.getUser(userId);
    const rows = await this.query(
      `UPDATE users SET last_daily = $3
       WHERE user_id = $1 AND COALESCE(last_daily, 0) = $2
       RETURNING last_daily`,
      [userId, previousLastDaily ?? 0, newLastDaily]
    );
    return rows.length > 0;
  }

  async topBalances(limit) {
    const rows = await this.query(
      'SELECT user_id, balance FROM users WHERE balance > 0 ORDER BY balance DESC LIMIT $1',
      [limit]
    );
    return rows.map((r) => ({ userId: r.user_id, balance: Number(r.balance) }));
  }

  /* --- Invitations --- */

  async getInviteCount(userId) {
    const rows = await this.query(
      'SELECT count, imported FROM invite_counts WHERE user_id = $1',
      [userId]
    );
    if (!rows.length) return { count: 0, imported: 0 };
    return { count: Number(rows[0].count), imported: Number(rows[0].imported) };
  }

  async recordJoin(memberId, inviterId, ts = Date.now()) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = (await client.query('SELECT inviter_id, left_at FROM join_records WHERE member_id = $1 FOR UPDATE', [memberId])).rows[0];
      if (existing && existing.left_at === null) {
        await client.query('COMMIT');
        return false; // déjà présent
      }
      if (existing) {
        await client.query(
          'UPDATE join_records SET inviter_id = $2, joined_at = $3, left_at = NULL WHERE member_id = $1',
          [memberId, inviterId, ts]
        );
      } else {
        await client.query(
          'INSERT INTO join_records (member_id, inviter_id, joined_at) VALUES ($1, $2, $3)',
          [memberId, inviterId, ts]
        );
      }
      await client.query(
        `INSERT INTO invite_counts (user_id, count) VALUES ($1, 1)
         ON CONFLICT (user_id) DO UPDATE SET count = invite_counts.count + 1`,
        [inviterId]
      );
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async recordLeave(memberId, ts = Date.now()) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = (await client.query('SELECT inviter_id, left_at FROM join_records WHERE member_id = $1 FOR UPDATE', [memberId])).rows[0];
      if (!existing || existing.left_at !== null) {
        await client.query('COMMIT');
        return false;
      }
      await client.query('UPDATE join_records SET left_at = $2 WHERE member_id = $1', [memberId, ts]);
      await client.query(
        'UPDATE invite_counts SET count = GREATEST(count - 1, 0) WHERE user_id = $1',
        [existing.inviter_id]
      );
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async importInvites(mapUserIdToUses) {
    const summary = [];
    for (const [userId, uses] of Object.entries(mapUserIdToUses)) {
      const rows = await this.query(
        `INSERT INTO invite_counts (user_id, imported) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET imported = GREATEST(invite_counts.imported, $2)
         RETURNING imported`,
        [userId, uses]
      );
      summary.push({ userId, imported: Number(rows[0].imported) });
    }
    return summary;
  }

  /* --- Achats --- */

  async addPurchase(purchase) {
    const rows = await this.query(
      `INSERT INTO purchases (user_id, username, delivery_username, product_id, price, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [purchase.userId, purchase.username, purchase.deliveryUsername, purchase.productId, purchase.price, purchase.createdAt]
    );
    return Number(rows[0].id);
  }
}

function fixProtocol(url) {
  if (url.startsWith('neon://')) return url.replace('neon://', 'postgresql://');
  if (url.startsWith('postgres://')) return url; // pg accepte les deux
  return url;
}

module.exports = { PostgresStore };
