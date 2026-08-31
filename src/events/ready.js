// ============================================================
// Événement "ready" : connexion réussie du bot.
// - enregistre les commandes slash,
// - prend un snapshot des invitations de chaque serveur,
// - resynchronise toutes les 10 minutes.
// ============================================================
const { Events, ActivityType, REST, Routes } = require('discord.js');
const config = require('../config');
const invitesService = require('../services/invites');

const RESYNC_INTERVAL_MS = 10 * 60 * 1000;

module.exports = {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    console.log(`✅ Connecté en tant que ${client.user.tag} (${client.user.id})`);
    console.log(`🏰 Serveur(s) : ${client.guilds.cache.size}`);

    client.user.setPresence({
      status: 'online',
      activities: [{ name: 'au casino • /help', type: ActivityType.Playing }],
    });

    // --- Enregistrement des commandes slash ---
    try {
      const rest = new REST().setToken(config.token);
      const body = [...client.commands.values()].map((command) => command.data.toJSON());

      // Commandes globales (tous les serveurs, propagation ~1 h)
      await rest.put(Routes.applicationCommands(config.clientId), { body });
      console.log(`📜 ${body.length} commande(s) enregistrée(s) globalement`);

      // En dev (GUILD_ID défini) : aussi sur le serveur de test, effet immédiat
      if (config.guildId) {
        await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
        console.log(`📜 ${body.length} commande(s) enregistrée(s) sur le serveur de test (${config.guildId})`);
      }
    } catch (err) {
      console.error('❌ Échec de l\'enregistrement des commandes :', err);
    }

    // --- Snapshot initial des invitations ---
    for (const guild of client.guilds.cache.values()) {
      const ok = await invitesService.syncGuild(guild);
      if (ok) console.log(`🎟️ Invitations suivies sur "${guild.name}"`);
      else console.warn(`⚠️ Invitations NON suivies sur "${guild.name}" — permission "Gérer le serveur" manquante ?`);
    }

    // --- Resynchronisation périodique ---
    setInterval(async () => {
      for (const guild of client.guilds.cache.values()) {
        try {
          await invitesService.syncGuild(guild);
        } catch (err) {
          console.error(`[invitations] Resync échouée sur ${guild.name} :`, err.message);
        }
      }
    }, RESYNC_INTERVAL_MS);

    console.log('🚀 ZachServices est opérationnel !');
  },
};
