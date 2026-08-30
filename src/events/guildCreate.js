// ============================================================
// Événement "guildCreate" : le bot est ajouté à un serveur
// → snapshot des invitations existantes.
// ============================================================
const { Events } = require('discord.js');
const invitesService = require('../services/invites');

module.exports = {
  name: Events.GuildCreate,

  async execute(guild) {
    console.log(`🏰 Ajouté au serveur : ${guild.name} (${guild.id})`);
    const ok = await invitesService.syncGuild(guild);
    if (!ok) {
      console.warn(`⚠️ Invitations non suivies sur ${guild.name} — permission "Gérer le serveur" manquante ?`);
    }
  },
};
