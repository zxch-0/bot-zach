// ============================================================
// ZachServices — Bot Discord
// Invitations • Daily coins • Casino (blackjack & RPS) • Boutique
// Point d'entrée : charge la config, le stockage, les commandes,
// les événements, le keep-alive, puis connecte le bot.
// ============================================================
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');

const config = require('./config');
const { createStore } = require('./storage');
const { startKeepAlive } = require('./keepAlive');

// ---------- Vérification de la version de Node ----------
const [nodeMajor] = process.versions.node.split('.').map(Number);
if (!Number.isFinite(nodeMajor) || nodeMajor < 18) {
  console.error(
    `\n❌ Node.js ${process.versions.node} détecté — ZachServices exige Node.js 18 ou plus.\n` +
      '   Installez la dernière version LTS : https://nodejs.org\n'
  );
  process.exit(1);
}

// ---------- Vérification de la configuration ----------
const fatal = [];
if (!config.token) fatal.push('DISCORD_TOKEN  — le token du bot (Discord Developer Portal > Bot)');
if (!config.clientId) fatal.push('CLIENT_ID      — l\'ID de l\'application (Developer Portal > General Information)');
if (fatal.length) {
  console.error('\n❌ Configuration incomplète ! Ajoute ceci dans ton fichier .env :\n');
  fatal.forEach((line) => console.error(`   ${line}`));
  console.error('\n💡 Copie .env.example en .env puis remplis les valeurs (voir README.md).\n');
  process.exit(1);
}
if (!config.adminUserIds.length) {
  console.warn(
    '⚠️  ADMIN_USER_ID / ADMIN_USER_IDS n\'est pas défini : personne ne recevra les MP ' +
      'd\'achat de la boutique. Les membres avec la permission Discord "Administrateur" ' +
      'pourront quand même utiliser /give et /product.'
  );
}

// ---------- Client Discord ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, // commandes, salons…
    GatewayIntentBits.GuildMembers, // ⚠️ intent privilégié à activer dans le Developer Portal
    GatewayIntentBits.GuildInvites, // création/suppression de liens d'invitation
  ],
});

client.commands = new Collection();

// Une erreur réseau (ECONNRESET, gateway…) émise par le client ne doit
// jamais faire planter le bot : on log et discord.js se reconnecte seul.
client.on('error', (err) => console.error('[discord] Erreur client :', err.message || err));
client.on('shardError', (err) => console.error('[discord] Erreur de shard :', err.message || err));
client.on('shardDisconnect', (event, id) => console.warn(`[discord] Shard ${id} déconnectée (reconnexion auto)…`));
client.on('shardReconnecting', (id) => console.log(`[discord] Shard ${id} reconnexion…`));
client.on('shardResume', (id) => console.log(`[discord] Shard ${id} reconnexion réussie ✅`));

// ---------- Chargement des commandes ----------
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`[commandes] Fichier ignoré (invalide) : ${file}`);
  }
}
console.log(`📦 ${client.commands.size} commande(s) chargée(s)`);

// ---------- Chargement des événements (avec garde-fou anti-plantage) ----------
const eventsPath = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'))) {
  const event = require(path.join(eventsPath, file));
  const handler = async (...args) => {
    try {
      await event.execute(...args);
    } catch (err) {
      console.error(`[event:${event.name}] Erreur :`, err);
    }
  };
  if (event.once) client.once(event.name, handler);
  else client.on(event.name, handler);
}

// ---------- Garde-fous process ----------
process.on('unhandledRejection', (err) => {
  console.error('❌ Promesse rejetée non gérée :', err);
});
process.on('uncaughtException', (err) => {
  console.error('❌ Exception non capturée :', err);
  // Sauvegarde immédiate des données locales avant de laisser la plateforme relancer
  try { client.store && client.store._saveSync && client.store._saveSync(); } catch {}
  process.exit(1);
});

// ---------- Connexion avec retry (le DNS/réseau peut être lent au démarrage) ----------
const FATAL_LOGIN_PATTERNS = ['disallowed intents', 'invalid token', 'TOKEN_INVALID', 'An invalid token', '401'];
const RETRY_LOGIN_PATTERNS = [
  'ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN',
  'getaddrinfo', 'fetch failed', 'socket disconnected', 'network',
];

async function loginWithRetry(attempts = 3, delayMs = 5000) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await client.login(config.token);
      return;
    } catch (err) {
      const msg = String(err && err.message) || '';
      if (FATAL_LOGIN_PATTERNS.some((p) => msg.toLowerCase().includes(p.toLowerCase()))) {
        throw err; // inutile de réessayer : config à corriger
      }
      if (attempt >= attempts) throw err;
      const retryable = RETRY_LOGIN_PATTERNS.some((p) => msg.toLowerCase().includes(p.toLowerCase()));
      console.warn(
        `[connexion] Tentative ${attempt}/${attempts} échouée${retryable ? ' (problème réseau)' : ''} : ${msg}\n` +
          `   Nouvelle tentative dans ${delayMs / 1000} s…`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// ---------- Démarrage ----------
(async () => {
  try {
    // 1. Stockage (JSON local ou PostgreSQL distant)
    const store = await createStore(config);
    await store.init();
    client.store = store;
    console.log(`🗄️  Stockage prêt (pilote : ${config.driver})`);

    // 2. Keep-alive (Render + UptimeRobot)
    if (config.keepAlive) {
      startKeepAlive(config.port);
    }

    // 3. Connexion à Discord
    await loginWithRetry();
  } catch (err) {
    console.error('\n❌ Impossible de démarrer ZachServices :', err.message || err);
    const msg = String(err && err.message) || '';
    if (msg.includes('An invalid token') || msg.includes('TOKEN_INVALID') || msg.includes('401')) {
      console.error('   → Vérifie DISCORD_TOKEN dans ta configuration (Developer Portal > Bot > Reset Token).');
    } else if (msg.includes('disallowed intents') || msg.includes('Used disallowed intents')) {
      console.error('   → Active "Server Members Intent" dans le Developer Portal (onglet Bot), puis relance.');
    } else if (msg.includes('PostgreSQL') || msg.includes('DATABASE_URL')) {
      console.error('   → Vérifie DATABASE_URL / DATABASE_DRIVER (voir README, solution A.2).');
    }
    process.exit(1);
  }
})();

// ---------- Arrêt propre ----------
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n🛑 Signal ${signal} reçu, arrêt de ZachServices…`);
  try {
    if (client.store) await client.store.close();
    await client.destroy();
  } catch (err) {
    console.error('Erreur pendant l\'arrêt :', err.message);
  }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
