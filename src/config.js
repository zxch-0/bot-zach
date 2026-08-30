// ============================================================
// ZachServices — Configuration centrale
// Toutes les valeurs proviennent du fichier .env (voir .env.example)
// ============================================================
require('dotenv').config();

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'oui', 'on'].includes(String(value).toLowerCase());
}

const databaseUrl = process.env.DATABASE_URL || '';
const driver = (process.env.DATABASE_DRIVER || (databaseUrl ? 'postgres' : 'json')).toLowerCase();

const config = {
  // --- Discord ---
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',
  adminUserId: process.env.ADMIN_USER_ID || '',
  purchaseChannelId: process.env.PURCHASE_LOG_CHANNEL_ID || '',

  // --- Stockage ---
  driver, // 'json' ou 'postgres'
  databaseUrl,
  jsonFile: 'data/zach.json',

  // --- Économie ---
  dailyReward: toInt(process.env.DAILY_REWARD, 100),
  dailyCooldownMs: toInt(process.env.DAILY_COOLDOWN_HOURS, 24) * 60 * 60 * 1000,
  currency: '🪙',

  // --- Boutique ---
  // ⚠️ Pour changer les produits / prix : modifiez ce tableau puis relancez le bot.
  products: [
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

  // --- Keep-alive (hébergement gratuit type Render + UptimeRobot) ---
  keepAlive: toBool(process.env.KEEP_ALIVE, false),
  port: toInt(process.env.PORT, 3000),
};

module.exports = config;
