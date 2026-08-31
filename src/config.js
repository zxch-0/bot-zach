// ============================================================
// ZachServices — Configuration centrale
// Toutes les valeurs proviennent du fichier .env (voir .env.example).
// Le .env est chargé depuis la racine du projet, quel que soit le
// dossier depuis lequel le bot est lancé (pm2, Render, etc.).
// ============================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const PROJECT_ROOT = path.join(__dirname, '..');

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'oui', 'on'].includes(String(value).toLowerCase());
}

/** "123, 456" -> ['123','456'] (séparateurs : virgule, espace, point-virgule) */
function parseIdList(value) {
  return String(value || '')
    .split(/[\s,;]+/)
    .map((id) => id.trim())
    .filter((id) => /^\d{15,21}$/.test(id));
}

const databaseUrl = process.env.DATABASE_URL || '';
const driver = (process.env.DATABASE_DRIVER || (databaseUrl ? 'postgres' : 'json')).toLowerCase();
if (driver !== 'json' && driver !== 'postgres') {
  console.warn(`[config] DATABASE_DRIVER inconnu ("${driver}") — retour au pilote json.`);
}

// Liste des admins : ADMIN_USER_IDS (multi) + ADMIN_USER_ID (compatibilité)
const adminUserIds = [
  ...new Set([...parseIdList(process.env.ADMIN_USER_IDS), ...parseIdList(process.env.ADMIN_USER_ID)]),
];

const config = {
  // --- Discord ---
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',
  adminUserIds, // tous les admins (reçoivent les MP d'achat, accès /give et /product)
  adminUserId: adminUserIds[0] || process.env.ADMIN_USER_ID || '', // compat ancien code
  adminRoleId: process.env.ADMIN_ROLE_ID || '', // rôle Discord admin du bot (optionnel)
  purchaseChannelId: process.env.PURCHASE_LOG_CHANNEL_ID || '',

  // --- Stockage ---
  driver, // 'json' ou 'postgres'
  databaseUrl,
  jsonFile: path.join(PROJECT_ROOT, 'data', 'zach.json'),

  // --- Économie ---
  dailyReward: toInt(process.env.DAILY_REWARD, 100),
  dailyCooldownMs: toInt(process.env.DAILY_COOLDOWN_HOURS, 24) * 60 * 60 * 1000,
  currency: '🪙',

  // --- Boutique ---
  // Produits par défaut, créés automatiquement au premier démarrage.
  // Ensuite, gérez la boutique en jeu avec /product add|remove|list (admins).
  defaultProducts: [
    {
      id: 'zach-checker',
      name: 'Zach-checker',
      emoji: '🧰',
      price: 1000,
      description: 'Le checker Zach de base — livraison par MP après achat.',
    },
    {
      id: 'zach-checker-premium',
      name: 'Zach-checker Premium',
      emoji: '💎',
      price: 5000,
      description: 'La version Premium du Zach-checker — priorité + avantages exclusifs.',
    },
  ],
  maxProducts: 25, // limite des menus de sélection Discord

  // --- Keep-alive (hébergement gratuit type Render + UptimeRobot) ---
  // Activé automatiquement sur Render même sans KEEP_ALIVE dans l'env.
  keepAlive: toBool(process.env.KEEP_ALIVE, Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL)),
  port: toInt(process.env.PORT, 3000),
};

module.exports = config;
