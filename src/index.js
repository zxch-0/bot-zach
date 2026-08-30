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
if (!config.adminUserId) {
  console.warn(
    '⚠️  ADMIN_USER_ID n\'est pas défini : les achats de la boutique ne pourront PAS être ' +
      'envoyés par MP à l\'admin (ils seront seulement loggués si PURCHASE_LOG_CHANNEL_ID est défini).'
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

// ---------- Chargement des événements ----------
const eventsPath = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'))) {
  const event = require(path.join(eventsPath, file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

// ---------- Garde-fous ----------
process.on('unhandledRejection', (err) => {
  console.error('❌ Promesse rejetée non gérée :', err);
});
process.on('uncaughtException', (err) => {
  console.error('❌ Exception non capturée :', err);
});

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
    await client.login(config.token);
  } catch (err) {
    console.error('\n❌ Impossible de démarrer ZachServices :', err.message);
    if (String(err.message).includes('TOKEN_INVALID') || String(err.message).includes('An invalid token')) {
      console.error('   → Vérifie DISCORD_TOKEN dans ton fichier .env (Developer Portal > Bot > Reset Token).');
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
